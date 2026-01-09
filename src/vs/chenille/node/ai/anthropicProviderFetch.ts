/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage, AiToolCall, generateToolCallId } from '../../common/types.js';
import { fetchJson, fetchStream, joinUrl } from './fetchClient.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
	type: 'text' | 'image' | 'tool_use' | 'tool_result';
	text?: string;
	source?: {
		type: 'base64';
		media_type: string;
		data: string;
	};
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: string;
}

interface AnthropicTool {
	name: string;
	description: string;
	input_schema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

interface AnthropicResponse {
	id: string;
	type: string;
	role: string;
	content: AnthropicContentBlock[];
	stop_reason: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

/**
 * 将多模态内容转换为 Anthropic 格式
 */
function toAnthropicContent(msg: AiModelMessage): string | AnthropicContentBlock[] {
	if (msg.multiContent?.length) {
		return msg.multiContent.map(part => {
			if (part.type === 'text') {
				return { type: 'text' as const, text: part.text };
			} else {
				return {
					type: 'image' as const,
					source: {
						type: 'base64' as const,
						media_type: part.mimeType,
						data: part.data,
					},
				};
			}
		});
	}
	return msg.content;
}

/**
 * 将统一消息格式转换为 Anthropic 格式
 */
function toAnthropicMessages(messages: AiModelMessage[]): AnthropicMessage[] {
	const result: AnthropicMessage[] = [];

	for (const msg of messages) {
		// 跳过 system 消息（单独处理）
		if (msg.role === 'system') {
			continue;
		}

		// 工具结果消息
		if (msg.role === 'tool' && msg.tool_call_id) {
			result.push({
				role: 'user',
				content: [{
					type: 'tool_result',
					tool_use_id: msg.tool_call_id,
					content: msg.content,
				}],
			});
			continue;
		}

		// assistant 消息（可能包含工具调用）
		if (msg.role === 'assistant') {
			if (msg.tool_calls?.length) {
				const content: AnthropicContentBlock[] = [];

				if (msg.content) {
					content.push({ type: 'text', text: msg.content });
				}

				for (const tc of msg.tool_calls) {
					content.push({
						type: 'tool_use',
						id: tc.id,
						name: tc.function.name,
						input: JSON.parse(tc.function.arguments || '{}'),
					});
				}

				result.push({ role: 'assistant', content });
			} else {
				result.push({ role: 'assistant', content: msg.content });
			}
			continue;
		}

		// user 消息
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
function toAnthropicTools(options: ChatCompletionOptions): AnthropicTool[] | undefined {
	if (!options.tools?.length) {
		return undefined;
	}
	return options.tools.map(t => ({
		name: t.function.name,
		description: t.function.description,
		input_schema: t.function.parameters as AnthropicTool['input_schema'],
	}));
}

/**
 * Anthropic Provider (Fetch 版本)
 */
export class AnthropicProviderFetch implements IAIProvider {
	readonly name = 'anthropic-fetch';

	async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, '/v1/messages');

		const requestBody: Record<string, unknown> = {
			model: model.model,
			messages: toAnthropicMessages(options.messages),
			max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
			temperature: Math.min(Math.max(0, model.temperature || 0.7), 1),
		};

		const systemPrompt = extractSystemPrompt(options.messages);
		if (systemPrompt) {
			requestBody.system = systemPrompt;
		}

		const tools = toAnthropicTools(options);
		if (tools) {
			requestBody.tools = tools;
		}

		const response = await fetchJson<AnthropicResponse>({
			url,
			headers: {
				'x-api-key': model.apiKey,
				'anthropic-version': API_VERSION,
			},
			body: requestBody,
			token: options.token,
		});

		const textContent = response.content
			.filter(block => block.type === 'text')
			.map(block => block.text || '')
			.join('');

		const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

		const result: ChatCompletionResult = {
			content: textContent,
			tool_calls: toolUseBlocks.length > 0 ? toolUseBlocks.map(t => ({
				id: t.id || generateToolCallId(),
				type: 'function' as const,
				function: {
					name: t.name || '',
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
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, '/v1/messages');

		const requestBody: Record<string, unknown> = {
			model: model.model,
			messages: toAnthropicMessages(options.messages),
			max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
			temperature: Math.min(Math.max(0, model.temperature || 0.7), 1),
			stream: true,
		};

		const systemPrompt = extractSystemPrompt(options.messages);
		if (systemPrompt) {
			requestBody.system = systemPrompt;
		}

		const tools = toAnthropicTools(options);
		if (tools) {
			requestBody.tools = tools;
		}

		const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
		let currentToolIndex = -1;
		let hasContent = false;
		let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

		return new Promise<void>((resolve) => {
			fetchStream(
				{
					url,
					headers: {
						'x-api-key': model.apiKey,
						'anthropic-version': API_VERSION,
					},
					body: requestBody,
					token: options.token,
				},
				(line) => {
					// Anthropic SSE 格式：event: xxx 和 data: xxx
					// 跳过 event: 行，只处理 data: 行
					if (line.startsWith('event:')) {
						return;
					}

					if (!line.startsWith('data:')) {
						return;
					}

					const data = line.slice(5).trim();
					if (!data || data === '[DONE]') {
						return;
					}

					try {
						const event = JSON.parse(data);

						switch (event.type) {
							case 'content_block_start':
								hasContent = true;
								if (event.content_block?.type === 'tool_use') {
									currentToolIndex++;
									accumulatedToolCalls.set(currentToolIndex, {
										id: event.content_block.id || generateToolCallId(),
										name: event.content_block.name || '',
										arguments: '',
									});
								}
								break;

							case 'content_block_delta':
								hasContent = true;
								if (event.delta?.type === 'text_delta' && event.delta.text) {
									options.call?.({ content: event.delta.text, done: false });
								} else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
									const tc = accumulatedToolCalls.get(currentToolIndex);
									if (tc) {
										tc.arguments += event.delta.partial_json;
									}
								}
								break;

							case 'message_delta':
								if (event.usage) {
									finalUsage = {
										promptTokens: event.usage.input_tokens || 0,
										completionTokens: event.usage.output_tokens || 0,
										totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
									};
								}
								break;

							case 'message_start':
								hasContent = true;
								if (event.message?.usage) {
									finalUsage = {
										promptTokens: event.message.usage.input_tokens || 0,
										completionTokens: event.message.usage.output_tokens || 0,
										totalTokens: (event.message.usage.input_tokens || 0) + (event.message.usage.output_tokens || 0),
									};
								}
								break;
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
							options.call?.({ content: '', tool_calls: toolCalls, done: false });
						}
					}

					options.call?.({ content: '', done: true, usage: finalUsage });
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
 * 创建 Anthropic Provider (Fetch 版本) 实例
 */
export function createAnthropicProviderFetch(): IAIProvider {
	return new AnthropicProviderFetch();
}
