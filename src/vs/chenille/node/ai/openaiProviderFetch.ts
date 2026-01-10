/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage, AiToolCall, generateToolCallId } from '../../common/types.js';
import { fetchJson, fetchStream, joinUrl } from './fetchClient.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | OpenAIContentPart[];
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
	reasoning_content?: string;
}

interface OpenAIContentPart {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string };
}

interface OpenAIToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

interface OpenAITool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

interface OpenAIResponse {
	id: string;
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			tool_calls?: OpenAIToolCall[];
			reasoning_content?: string;
		};
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

interface OpenAIStreamDelta {
	role?: string;
	content?: string;
	tool_calls?: Array<{
		index: number;
		id?: string;
		type?: string;
		function?: {
			name?: string;
			arguments?: string;
		};
	}>;
	reasoning_content?: string;
}

/**
 * 将多模态内容转换为 OpenAI 格式
 */
function toOpenAIContent(msg: AiModelMessage): string | OpenAIContentPart[] {
	if (msg.multiContent?.length) {
		return msg.multiContent.map(part => {
			if (part.type === 'text') {
				return { type: 'text' as const, text: part.text };
			} else {
				return {
					type: 'image_url' as const,
					image_url: {
						url: `data:${part.mimeType};base64,${part.data}`,
					},
				};
			}
		});
	}
	return msg.content;
}

/**
 * 将统一消息格式转换为 OpenAI 格式
 */
function toOpenAIMessages(options: ChatCompletionOptions): OpenAIMessage[] {
	return options.messages.map(msg => {
		if (msg.role === 'tool' && msg.tool_call_id) {
			return {
				role: 'tool' as const,
				content: msg.content,
				tool_call_id: msg.tool_call_id,
			};
		}

		if (msg.role === 'assistant') {
			const assistantMsg: OpenAIMessage = {
				role: 'assistant' as const,
				content: msg.content || '',
			};

			// DeepSeek 等模型需要 reasoning_content
			if (msg.reasoning_content) {
				assistantMsg.reasoning_content = msg.reasoning_content;
			}

			if (msg.tool_calls?.length) {
				assistantMsg.tool_calls = msg.tool_calls.map(tc => ({
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

		return {
			role: msg.role as 'system' | 'user' | 'assistant',
			content: toOpenAIContent(msg),
		};
	});
}

/**
 * 将统一工具格式转换为 OpenAI 格式
 */
function toOpenAITools(options: ChatCompletionOptions): OpenAITool[] | undefined {
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

/**
 * OpenAI Provider (Fetch 版本)
 */
export class OpenAIProviderFetch implements IAIProvider {
	readonly name = 'openai-fetch';

	async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, '/chat/completions');

		const requestBody = {
			model: model.model,
			messages: toOpenAIMessages(options),
			temperature: model.temperature || 0.7,
			max_tokens: model.maxTokens > 0 ? model.maxTokens : undefined,
			tools: toOpenAITools(options),
		};

		const response = await fetchJson<OpenAIResponse>({
			url,
			headers: {
				'Authorization': `Bearer ${model.apiKey}`,
			},
			body: requestBody,
			token: options.token,
		});

		const choice = response.choices[0];
		const message = choice?.message;

		const result: ChatCompletionResult = {
			content: message?.content || '',
			reasoning: message?.reasoning_content,
			tool_calls: message?.tool_calls?.map(tc => ({
				id: tc.id,
				type: 'function' as const,
				function: {
					name: tc.function.name,
					arguments: tc.function.arguments,
				},
			})),
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
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, '/chat/completions');

		const requestBody = {
			model: model.model,
			messages: toOpenAIMessages(options),
			temperature: model.temperature || 0.7,
			max_tokens: model.maxTokens > 0 ? model.maxTokens : undefined,
			tools: toOpenAITools(options),
			stream: true,
		};

		const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
		let accumulatedReasoning = '';
		let hasContent = false;

		return new Promise<void>((resolve) => {
			fetchStream(
				{
					url,
					headers: {
						'Authorization': `Bearer ${model.apiKey}`,
					},
					body: requestBody,
					token: options.token,
				},
				(line) => {
					// 解析 SSE 数据
					if (!line.startsWith('data: ')) {
						return;
					}

					const data = line.slice(6).trim();
					if (data === '[DONE]') {
						return;
					}

					try {
						const parsed = JSON.parse(data);
						const delta: OpenAIStreamDelta = parsed.choices?.[0]?.delta;

						if (!delta) {
							return;
						}

						// 处理文本内容
						if (delta.content) {
							hasContent = true;
							options.call?.({ content: delta.content, done: false });
						}

						// 处理推理内容
						if (delta.reasoning_content) {
							hasContent = true;
							accumulatedReasoning += delta.reasoning_content;
							options.call?.({ content: '', reasoning: delta.reasoning_content, done: false });
						}

						// 处理工具调用
						if (delta.tool_calls) {
							hasContent = true;
							for (const tc of delta.tool_calls) {
								const existing = accumulatedToolCalls.get(tc.index);
								if (existing) {
									if (tc.function?.arguments) {
										existing.arguments += tc.function.arguments;
									}
								} else {
									accumulatedToolCalls.set(tc.index, {
										id: tc.id || generateToolCallId(),
										name: tc.function?.name || '',
										arguments: tc.function?.arguments || '',
									});
								}
							}
						}
					} catch {
						// 忽略解析错误
					}
				},
				() => {
					// 流结束
					if (!hasContent) {
						options.call?.({ content: '', done: true, error: 'request ended without sending any chunks' });
						resolve();
						return;
					}

					// 发送累积的工具调用
					if (accumulatedToolCalls.size > 0) {
						const toolCalls: AiToolCall[] = [];
						for (const [, tc] of accumulatedToolCalls) {
							if (tc.name) {
								toolCalls.push({
									id: tc.id,
									type: 'function' as const,
									function: {
										name: tc.name,
										arguments: tc.arguments,
									},
								});
							}
						}
						if (toolCalls.length > 0) {
							options.call?.({ content: '', tool_calls: toolCalls, reasoning: accumulatedReasoning || undefined, done: false });
						}
					}

					options.call?.({ content: '', done: true });
					resolve();
				},
				(error) => {
					options.call?.({ content: '', done: true, error: error.message });
					resolve();
				}
			);
		});
	}
}

/**
 * 创建 OpenAI Provider (Fetch 版本) 实例
 */
export function createOpenAIProviderFetch(): IAIProvider {
	return new OpenAIProviderFetch();
}
