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

		return new Promise<void>((resolve) => {
			const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
			let currentToolIndex = -1;
			let hasReceivedContent = false;
			let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

			const streamParams = {
				model: model.model,
				messages: toAnthropicMessages(options.messages),
				system: extractSystemPrompt(options.messages),
				temperature,
				max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
				tools: toAnthropicTools(options),
			};

			let stream: ReturnType<typeof client.messages.stream>;
			try {
				stream = client.messages.stream(streamParams);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				options.call?.({ content: '', done: true, error: `Stream creation failed: ${errorMessage}` });
				resolve();
				return;
			}

			stream.on('text', (text) => {
				if (options.token?.isCancellationRequested) {
					return;
				}
				hasReceivedContent = true;
				options.call?.({ content: text, done: false });
			});

			stream.on('contentBlock', (block) => {
				if (options.token?.isCancellationRequested) {
					return;
				}
				hasReceivedContent = true;
				if (block.type === 'tool_use') {
					currentToolIndex++;
					accumulatedToolCalls.set(currentToolIndex, {
						id: block.id || generateToolCallId(),
						name: block.name,
						arguments: JSON.stringify(block.input),
					});
				}
			});

			stream.on('message', (message) => {
				hasReceivedContent = true;
				if (message.usage) {
					finalUsage = {
						promptTokens: message.usage.input_tokens,
						completionTokens: message.usage.output_tokens,
						totalTokens: message.usage.input_tokens + message.usage.output_tokens,
					};
				}
			});

			stream.on('error', (error) => {
				const errorMessage = error instanceof Error ? error.message : String(error);
				options.call?.({ content: '', done: true, error: errorMessage });
				resolve();
			});

			stream.on('end', () => {
				if (options.token?.isCancellationRequested) {
					resolve();
					return;
				}

				if (!hasReceivedContent) {
					options.call?.({ content: '', done: true, error: 'request ended without sending any chunks' });
					resolve();
					return;
				}

				// 流结束后，发送累积的工具调用
				if (accumulatedToolCalls.size > 0) {
					const toolCalls: AiToolCall[] = [];
					for (const [, tc] of accumulatedToolCalls) {
						if (tc.name) {
							toolCalls.push({
								id: tc.id || generateToolCallId(),
								type: 'function' as const,
								function: {
									name: tc.name,
									arguments: tc.arguments,
								},
							});
						}
					}

					if (toolCalls.length > 0) {
						options.call?.({
							content: '',
							tool_calls: toolCalls,
							done: false,
						});
					}
				}

				options.call?.({ content: '', done: true, usage: finalUsage });
				resolve();
			});

			// 处理取消
			const checkCancellation = setInterval(() => {
				if (options.token?.isCancellationRequested) {
					clearInterval(checkCancellation);
					stream.controller.abort();
				}
			}, 100);

			stream.on('end', () => clearInterval(checkCancellation));
			stream.on('error', () => clearInterval(checkCancellation));
		});
	}
}

/**
 * 创建 Anthropic Provider 实例
 */
export function createAnthropicProvider(): IAIProvider {
	return new AnthropicProvider();
}
