/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionContentPart } from 'openai/resources/index';
import type { Stream } from 'openai/streaming';
import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiToolCall, generateToolCallId, AiModelMessage } from '../../common/types.js';
import { ChenilleError } from '../../common/errors.js';

/**
 * 将多模态内容转换为 OpenAI 格式
 */
function toOpenAIContent(msg: AiModelMessage): string | ChatCompletionContentPart[] {
	// 如果有多模态内容，转换为 OpenAI 格式
	if (msg.multiContent?.length) {
		return msg.multiContent.map(part => {
			if (part.type === 'text') {
				return { type: 'text' as const, text: part.text };
			} else {
				// 图片内容
				return {
					type: 'image_url' as const,
					image_url: {
						url: `data:${part.mimeType};base64,${part.data}`,
					},
				};
			}
		});
	}
	// 否则返回纯文本
	return msg.content;
}

/**
 * 将统一消息格式转换为 OpenAI 格式
 */
function toOpenAIMessages(options: ChatCompletionOptions): ChatCompletionMessageParam[] {
	return options.messages.map(msg => {
		// 工具结果消息
		if (msg.role === 'tool' && msg.tool_call_id) {
			return {
				role: 'tool' as const,
				content: msg.content,
				tool_call_id: msg.tool_call_id,
			};
		}

		// assistant 消息（可能包含工具调用）
		if (msg.role === 'assistant') {
			// 构建基础消息
			const assistantMsg: ChatCompletionMessageParam & { reasoning_content?: string } = {
				role: 'assistant' as const,
				content: msg.content || null,
			};

			// DeepSeek 等模型需要 reasoning_content
			if (msg.reasoning_content) {
				assistantMsg.reasoning_content = msg.reasoning_content;
			}

			if (msg.tool_calls?.length) {
				(assistantMsg as ChatCompletionMessageParam & { tool_calls?: unknown[] }).tool_calls = msg.tool_calls.map(tc => ({
					id: tc.id,
					type: 'function' as const,
					function: {
						name: tc.function.name,
						arguments: tc.function.arguments,
					},
				}));
			}

			return assistantMsg;
		}

		// system 消息（不支持图片）
		if (msg.role === 'system') {
			return {
				role: 'system' as const,
				content: msg.content,
			};
		}

		// user 消息（支持图片）
		return {
			role: 'user' as const,
			content: toOpenAIContent(msg),
		};
	});
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
 * 解析 tool_calls 为统一格式（带 ID）
 */
function parseToolCalls(message: MessageWithReasoning): AiToolCall[] | undefined {
	const toolCalls = message.tool_calls;
	if (!toolCalls?.length) {
		return undefined;
	}
	return toolCalls
		.filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
		.map(tc => ({
			id: tc.id,
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
			// 防止模型重复输出
			frequency_penalty: 0.3,
			presence_penalty: 0.1,
		});

		if (response.choices.length === 0) {
			throw new ChenilleError('请求失败：无返回结果');
		}

		const choice = response.choices[0];
		const message = choice.message as MessageWithReasoning;

		const result: ChatCompletionResult = {
			content: message.content ?? '',
			reasoning: message.reasoning_content ?? undefined,
			tool_calls: parseToolCalls(message),
			done: true,
			usage: response.usage ? {
				promptTokens: response.usage.prompt_tokens,
				completionTokens: response.usage.completion_tokens,
				totalTokens: response.usage.total_tokens,
			} : undefined,
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
			stream_options: { include_usage: true },
			// 防止模型重复输出
			frequency_penalty: 0.3,
			presence_penalty: 0.1,
		});

		// 累积工具调用（流式 API 中工具调用是增量发送的）
		const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
		// 累积推理内容（DeepSeek 等模型需要）
		let accumulatedReasoning = '';
		// 累积 usage（流式 API 在最后一个 chunk 返回）
		let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

		for await (const chunk of stream) {
			// 检查取消
			if (options.token?.isCancellationRequested) {
				stream.controller.abort();
				break;
			}

			// 捕获 usage（在最后一个 chunk 中）
			if (chunk.usage) {
				finalUsage = {
					promptTokens: chunk.usage.prompt_tokens,
					completionTokens: chunk.usage.completion_tokens,
					totalTokens: chunk.usage.total_tokens,
				};
			}

			if (chunk.choices.length === 0) {
				continue;
			}

			const delta = chunk.choices[0].delta as DeltaWithReasoning;

			// 累积工具调用
			if (delta.tool_calls?.length) {
				for (const tc of delta.tool_calls) {
					const index = tc.index;
					const existing = accumulatedToolCalls.get(index) ?? { id: '', name: '', arguments: '' };

					if (tc.id) {
						existing.id = tc.id;
					}
					if (tc.function?.name) {
						existing.name = tc.function.name;
					}
					if (tc.function?.arguments) {
						existing.arguments += tc.function.arguments;
					}

					accumulatedToolCalls.set(index, existing);
				}
			}

			// 累积推理内容
			if (delta.reasoning_content) {
				accumulatedReasoning += delta.reasoning_content;
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

		// 流结束后，发送累积的工具调用（包含累积的推理内容）
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
					reasoning: accumulatedReasoning || undefined,
					tool_calls: toolCalls,
					done: false,
				});
			}
		}

		options.call?.({ content: '', done: true, usage: finalUsage });
	}
}

/**
 * 创建 OpenAI Provider 实例
 */
export function createOpenAIProvider(): IAIProvider {
	return new OpenAIProvider();
}
