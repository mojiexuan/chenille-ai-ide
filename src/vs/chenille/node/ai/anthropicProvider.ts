/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, TextBlock, ToolUseBlock, ContentBlockDeltaEvent } from '@anthropic-ai/sdk/resources/messages';
import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage } from '../../common/types.js';

/**
 * 将统一消息格式转换为 Anthropic 格式
 */
function toAnthropicMessages(messages: AiModelMessage[]): MessageParam[] {
	return messages
		.filter(msg => msg.role !== 'system')
		.map(msg => ({
			role: msg.role as 'user' | 'assistant',
			content: msg.content,
		}));
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
			function_call: toolUse.length > 0 ? toolUse.map(t => ({
				type: 'function' as const,
				function: {
					name: t.name,
					arguments: JSON.stringify(t.input),
				},
			})) : undefined,
			done: true,
		};

		options.call?.(result);
		return result;
	}

	async stream(options: ChatCompletionOptions): Promise<void> {
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 1) || 0.7;

		let stream;
		try {
			stream = client.messages.stream({
				model: model.model,
				messages: toAnthropicMessages(options.messages),
				system: extractSystemPrompt(options.messages),
				temperature,
				max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
				tools: toAnthropicTools(options),
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			options.call?.({ content: '', done: true, error: errorMessage });
			return;
		}

		// 累积工具调用（流式 API 中工具调用是增量发送的）
		const accumulatedToolCalls: Map<number, { name: string; arguments: string }> = new Map();
		let currentToolIndex = -1;
		let hasReceivedContent = false; // 追踪是否收到过任何内容

		try {
			for await (const event of stream) {
				// 检查取消
				if (options.token?.isCancellationRequested) {
					stream.controller.abort();
					break;
				}

				if (event.type === 'content_block_start') {
					hasReceivedContent = true;
					// 新的内容块开始
					if (event.content_block.type === 'tool_use') {
						currentToolIndex++;
						accumulatedToolCalls.set(currentToolIndex, {
							name: event.content_block.name,
							arguments: '',
						});
					}
				} else if (event.type === 'content_block_delta') {
					hasReceivedContent = true;
					const deltaEvent = event as ContentBlockDeltaEvent;
					const delta = deltaEvent.delta;
					if (delta.type === 'text_delta') {
						const result: ChatCompletionResult = {
							content: delta.text,
							done: false,
						};
						options.call?.(result);
					} else if (delta.type === 'input_json_delta') {
						// 累积工具调用参数
						const existing = accumulatedToolCalls.get(currentToolIndex);
						if (existing) {
							existing.arguments += delta.partial_json;
						}
					}
				} else if (event.type === 'message_start' || event.type === 'message_delta') {
					hasReceivedContent = true;
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			options.call?.({ content: '', done: true, error: errorMessage });
			return;
		}

		// 如果被取消，不发送工具调用和完成信号
		if (options.token?.isCancellationRequested) {
			return;
		}

		// 检查是否收到过任何内容
		if (!hasReceivedContent) {
			options.call?.({ content: '', done: true, error: 'request ended without sending any chunks' });
			return;
		}

		// 流结束后，发送累积的工具调用
		if (accumulatedToolCalls.size > 0) {
			const toolCalls = [];
			for (const [, tc] of accumulatedToolCalls) {
				if (tc.name) {
					toolCalls.push({
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
					function_call: toolCalls,
					done: false,
				});
			}
		}

		options.call?.({ content: '', done: true });
	}
}

/**
 * 创建 Anthropic Provider 实例
 */
export function createAnthropicProvider(): IAIProvider {
	return new AnthropicProvider();
}
