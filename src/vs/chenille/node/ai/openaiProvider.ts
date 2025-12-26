/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/index';
import type { Stream } from 'openai/streaming';
import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, ToolCall } from '../../common/types.js';
import { ChenilleError } from '../../common/errors.js';

/**
 * 将统一消息格式转换为 OpenAI 格式
 */
function toOpenAIMessages(options: ChatCompletionOptions): ChatCompletionMessageParam[] {
	return options.messages.map(msg => ({
		role: msg.role,
		content: msg.content,
	}));
}

/**
 * 将统一工具格式转换为 OpenAI 格式
 */
function toOpenAITools(options: ChatCompletionOptions): ChatCompletionTool[] | undefined {
	if (!options.tools?.length) {
		return undefined;
	}
	return options.tools.map(t => ({
		type: 'function' as const,
		function: {
			name: t.function.name,
			description: t.function.description,
			parameters: t.function.parameters as unknown as Record<string, unknown>,
		},
	}));
}

interface MessageWithReasoning extends OpenAI.Chat.Completions.ChatCompletionMessage {
	reasoning_content?: string | null;
}

interface DeltaWithReasoning extends OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta {
	reasoning_content?: string | null;
}

/**
 * 解析 tool_calls 为统一格式
 */
function parseToolCalls(message: MessageWithReasoning): ToolCall[] | undefined {
	const toolCalls = message.tool_calls;
	if (!toolCalls?.length) {
		return undefined;
	}
	return toolCalls
		.filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
		.map(tc => ({
			type: 'function' as const,
			function: {
				name: tc.function.name,
				arguments: tc.function.arguments,
			},
		}));
}

/**
 * OpenAI Provider 实现
 */
export class OpenAIProvider implements IAIProvider {
	readonly name = 'openai';

	private createClient(options: ChatCompletionOptions): OpenAI {
		return new OpenAI({
			apiKey: options.agent.model.apiKey,
			baseURL: options.agent.model.baseUrl,
		});
	}

	async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 2) || 0.7;

		const response = await client.chat.completions.create({
			model: model.model,
			messages: toOpenAIMessages(options),
			temperature,
			max_completion_tokens: model.maxTokens > 0 ? model.maxTokens : undefined,
			tools: toOpenAITools(options),
			tool_choice: options.tool_choice,
			stream: false,
		});

		if (response.choices.length === 0) {
			throw new ChenilleError('请求失败：无返回结果');
		}

		const choice = response.choices[0];
		const message = choice.message as MessageWithReasoning;

		const result: ChatCompletionResult = {
			content: message.content ?? '',
			reasoning: message.reasoning_content ?? undefined,
			function_call: parseToolCalls(message),
			done: true,
		};

		options.call?.(result);
		return result;
	}

	async stream(options: ChatCompletionOptions): Promise<void> {
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 2) || 0.7;

		const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> = await client.chat.completions.create({
			model: model.model,
			messages: toOpenAIMessages(options),
			temperature,
			max_completion_tokens: model.maxTokens > 0 ? model.maxTokens : undefined,
			tools: toOpenAITools(options),
			tool_choice: options.tool_choice,
			stream: true,
		});

		// 累积工具调用（流式 API 中工具调用是增量发送的）
		const accumulatedToolCalls: Map<number, { name: string; arguments: string }> = new Map();

		for await (const chunk of stream) {
			// 检查取消
			if (options.token?.isCancellationRequested) {
				stream.controller.abort();
				break;
			}

			if (chunk.choices.length === 0) {
				continue;
			}

			const delta = chunk.choices[0].delta as DeltaWithReasoning;

			// 累积工具调用
			if (delta.tool_calls?.length) {
				for (const tc of delta.tool_calls) {
					const index = tc.index;
					const existing = accumulatedToolCalls.get(index) ?? { name: '', arguments: '' };

					if (tc.function?.name) {
						existing.name = tc.function.name;
					}
					if (tc.function?.arguments) {
						existing.arguments += tc.function.arguments;
					}

					accumulatedToolCalls.set(index, existing);
				}
			}

			const result: ChatCompletionResult = {
				content: delta.content ?? '',
				reasoning: delta.reasoning_content ?? undefined,
				done: false,
			};

			if (result.content || result.reasoning) {
				options.call?.(result);
			}
		}

		// 如果被取消，不发送工具调用和完成信号
		if (options.token?.isCancellationRequested) {
			return;
		}

		// 流结束后，发送累积的工具调用
		if (accumulatedToolCalls.size > 0) {
			const toolCalls: ToolCall[] = [];
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
 * 创建 OpenAI Provider 实例
 */
export function createOpenAIProvider(): IAIProvider {
	return new OpenAIProvider();
}
