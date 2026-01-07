/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, TextBlock, ToolUseBlock, ToolResultBlockParam, ImageBlockParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage, AiToolCall, generateToolCallId } from '../../common/types.js';

/**
 * 将多模态内容转换为 Anthropic 格式
 */
function toAnthropicContent(msg: AiModelMessage): string | ContentBlockParam[] {
	// 如果有多模态内容，转换为 Anthropic 格式
	if (msg.multiContent?.length) {
		return msg.multiContent.map(part => {
			if (part.type === 'text') {
				return { type: 'text' as const, text: part.text };
			} else {
				// 图片内容
				const imageBlock: ImageBlockParam = {
					type: 'image',
					source: {
						type: 'base64',
						media_type: part.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
						data: part.data,
					},
				};
				return imageBlock;
			}
		});
	}
	// 否则返回纯文本
	return msg.content;
}

/**
 * 将统一消息格式转换为 Anthropic 格式
 */
function toAnthropicMessages(messages: AiModelMessage[]): MessageParam[] {
	const result: MessageParam[] = [];

	for (const msg of messages) {
		// 跳过 system 消息（单独处理）
		if (msg.role === 'system') {
			continue;
		}

		// 工具结果消息 -> Anthropic 的 tool_result
		if (msg.role === 'tool' && msg.tool_call_id) {
			const toolResultBlock: ToolResultBlockParam = {
				type: 'tool_result',
				tool_use_id: msg.tool_call_id,
				content: msg.content,
			};
			result.push({
				role: 'user',
				content: [toolResultBlock],
			});
			continue;
		}

		// assistant 消息（可能包含工具调用）
		if (msg.role === 'assistant') {
			if (msg.tool_calls?.length) {
				// 有工具调用时，构建包含 text 和 tool_use 的 content
				const content: (TextBlock | ToolUseBlock)[] = [];

				// 如果有文本内容，添加 text block
				if (msg.content) {
					const textBlock: TextBlock = {
						type: 'text',
						text: msg.content,
						citations: null,
					};
					content.push(textBlock);
				}

				// 添加 tool_use blocks
				for (const tc of msg.tool_calls) {
					const toolUseBlock: ToolUseBlock = {
						type: 'tool_use',
						id: tc.id,
						name: tc.function.name,
						input: JSON.parse(tc.function.arguments || '{}'),
					};
					content.push(toolUseBlock);
				}

				result.push({
					role: 'assistant',
					content,
				});
			} else {
				// 普通 assistant 消息
				result.push({
					role: 'assistant',
					content: msg.content,
				});
			}
			continue;
		}

		// user 消息（支持图片）
		result.push({
			role: 'user',
			content: toAnthropicContent(msg),
		});
	}

	return result;
}

/**
 * 提取 system 消息
 */
function extractSystemPrompt(messages: AiModelMessage[]): string | undefined {
	const systemMsg = messages.find(msg => msg.role === 'system');
	return systemMsg?.content;
}

/**
 * 将统一工具格式转换为 Anthropic 格式
 */
function toAnthropicTools(options: ChatCompletionOptions): Tool[] | undefined {
	if (!options.tools?.length) {
		return undefined;
	}
	return options.tools.map(t => ({
		name: t.function.name,
		description: t.function.description,
		input_schema: {
			type: 'object' as const,
			properties: t.function.parameters.properties,
			required: t.function.parameters.required,
		},
	}));
}

/**
 * Anthropic Provider 实现
 */
export class AnthropicProvider implements IAIProvider {
	readonly name = 'anthropic';

	private createClient(options: ChatCompletionOptions): Anthropic {
		return new Anthropic({
			apiKey: options.agent.model.apiKey,
			baseURL: options.agent.model.baseUrl || undefined,
		});
	}

	async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 1) || 0.7;

		const response = await client.messages.create({
			model: model.model,
			messages: toAnthropicMessages(options.messages),
			system: extractSystemPrompt(options.messages),
			temperature,
			max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
			tools: toAnthropicTools(options),
		});

		const content = response.content
			.filter((block): block is TextBlock => block.type === 'text')
			.map(block => block.text)
			.join('');

		const toolUse = response.content
			.filter((block): block is ToolUseBlock => block.type === 'tool_use');

		const result: ChatCompletionResult = {
			content,
			tool_calls: toolUse.length > 0 ? toolUse.map(t => ({
				id: t.id || generateToolCallId(),
				type: 'function' as const,
				function: {
					name: t.name,
					arguments: JSON.stringify(t.input),
				},
			})) : undefined,
			done: true,
			usage: response.usage ? {
				promptTokens: response.usage.input_tokens,
				completionTokens: response.usage.output_tokens,
				totalTokens: response.usage.input_tokens + response.usage.output_tokens,
			} : undefined,
		};

		options.call?.(result);
		return result;
	}

	async stream(options: ChatCompletionOptions): Promise<void> {
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 1) || 0.7;

		try {
			const stream = client.messages.stream({
				model: model.model,
				messages: toAnthropicMessages(options.messages),
				system: extractSystemPrompt(options.messages),
				temperature,
				max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
				tools: toAnthropicTools(options),
			});

			// 监听文本流
			stream.on('text', (text) => {
				if (options.token?.isCancellationRequested) {
					return;
				}
				options.call?.({ content: text, done: false });
			});

			// 等待最终消息 - 这会等待流完成并返回完整的消息
			// 工具调用的完整参数只有在流结束后才能从 finalMessage 获取
			const finalMessage = await stream.finalMessage();

			if (options.token?.isCancellationRequested) {
				return;
			}

			// 从最终消息中提取工具调用
			const toolUseBlocks = finalMessage.content.filter(
				(block): block is ToolUseBlock => block.type === 'tool_use'
			);

			if (toolUseBlocks.length > 0) {
				const toolCalls: AiToolCall[] = toolUseBlocks.map(block => ({
					id: block.id || generateToolCallId(),
					type: 'function' as const,
					function: {
						name: block.name,
						arguments: JSON.stringify(block.input),
					},
				}));

				options.call?.({
					content: '',
					tool_calls: toolCalls,
					done: false,
				});
			}

			const finalUsage = finalMessage.usage ? {
				promptTokens: finalMessage.usage.input_tokens,
				completionTokens: finalMessage.usage.output_tokens,
				totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
			} : undefined;

			options.call?.({ content: '', done: true, usage: finalUsage });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			options.call?.({ content: '', done: true, error: errorMessage });
		}
	}
}

/**
 * 创建 Anthropic Provider 实例
 */
export function createAnthropicProvider(): IAIProvider {
	return new AnthropicProvider();
}
