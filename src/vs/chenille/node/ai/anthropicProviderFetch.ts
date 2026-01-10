/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage, AiToolCall, generateToolCallId } from '../../common/types.js';
import { fetchJson, fetchStream, joinUrl } from './fetchClient.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

// ========== 调试日志 ==========
const DEBUG = true;
const debugLogs: string[] = [];

function debugLog(tag: string, ...args: unknown[]): void {
	if (DEBUG) {
		const msg = `[Anthropic-Fetch][${tag}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
		console.log(msg);
		debugLogs.push(`${new Date().toISOString()} ${msg}`);
		// 保留最近 200 条日志
		if (debugLogs.length > 200) {
			debugLogs.shift();
		}
	}
}

// 导出日志供外部访问
export function getAnthropicFetchDebugLogs(): string[] {
	return [...debugLogs];
}

export function clearAnthropicFetchDebugLogs(): void {
	debugLogs.length = 0;
}
// =============================

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
 * 注意：Anthropic 要求消息必须交替出现（user/assistant），
 * 且多个 tool_result 必须合并到同一个 user 消息中
 */
function toAnthropicMessages(messages: AiModelMessage[]): AnthropicMessage[] {
	debugLog('toAnthropicMessages', '输入消息数量:', messages.length);
	debugLog('toAnthropicMessages', '输入消息:', JSON.stringify(messages.map(m => ({
		role: m.role,
		contentLength: m.content?.length,
		hasToolCalls: !!m.tool_calls?.length,
		toolCallId: m.tool_call_id,
	})), null, 2));

	const result: AnthropicMessage[] = [];

	// 用于收集连续的 tool_result
	let pendingToolResults: AnthropicContentBlock[] = [];

	const flushToolResults = () => {
		if (pendingToolResults.length > 0) {
			debugLog('flushToolResults', '合并工具结果数量:', pendingToolResults.length);
			result.push({
				role: 'user',
				content: pendingToolResults,
			});
			pendingToolResults = [];
		}
	};

	for (const msg of messages) {
		// 跳过 system 消息（单独处理）
		if (msg.role === 'system') {
			debugLog('toAnthropicMessages', '跳过 system 消息');
			continue;
		}

		// 工具结果消息 - 收集起来，稍后合并
		if (msg.role === 'tool' && msg.tool_call_id) {
			debugLog('toAnthropicMessages', '收集 tool_result:', msg.tool_call_id);
			pendingToolResults.push({
				type: 'tool_result',
				tool_use_id: msg.tool_call_id,
				content: msg.content,
			});
			continue;
		}

		// 遇到非 tool 消息时，先刷新待处理的 tool_result
		flushToolResults();

		// assistant 消息（可能包含工具调用）
		if (msg.role === 'assistant') {
			if (msg.tool_calls?.length) {
				debugLog('toAnthropicMessages', 'assistant 消息带工具调用:', msg.tool_calls.length);
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
				debugLog('toAnthropicMessages', 'assistant 普通消息');
				result.push({ role: 'assistant', content: msg.content });
			}
			continue;
		}

		// user 消息
		debugLog('toAnthropicMessages', 'user 消息');
		result.push({
			role: 'user',
			content: toAnthropicContent(msg),
		});
	}

	// 处理末尾的 tool_result
	flushToolResults();

	debugLog('toAnthropicMessages', '输出消息数量:', result.length);
	debugLog('toAnthropicMessages', '输出消息角色序列:', result.map(m => m.role).join(' -> '));

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
		debugLog('chat', '开始非流式请求');
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, '/v1/messages');

		const messages = toAnthropicMessages(options.messages);
		const requestBody: Record<string, unknown> = {
			model: model.model,
			messages,
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
			debugLog('chat', '工具数量:', tools.length);
		}

		debugLog('chat', '请求 URL:', url);
		debugLog('chat', '请求体 (不含 messages):', { ...requestBody, messages: `[${messages.length} messages]` });

		const response = await fetchJson<AnthropicResponse>({
			url,
			headers: {
				'x-api-key': model.apiKey,
				'anthropic-version': API_VERSION,
			},
			body: requestBody,
			token: options.token,
		});

		debugLog('chat', '响应:', { id: response.id, stop_reason: response.stop_reason, contentBlocks: response.content.length });

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
		debugLog('stream', '========== 开始流式请求 ==========');
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, '/v1/messages');

		const messages = toAnthropicMessages(options.messages);
		const requestBody: Record<string, unknown> = {
			model: model.model,
			messages,
			max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
			temperature: Math.min(Math.max(0, model.temperature || 0.7), 1),
			stream: true,
		};

		const systemPrompt = extractSystemPrompt(options.messages);
		if (systemPrompt) {
			requestBody.system = systemPrompt;
			debugLog('stream', 'system prompt 长度:', systemPrompt.length);
		}

		const tools = toAnthropicTools(options);
		if (tools) {
			requestBody.tools = tools;
			debugLog('stream', '工具数量:', tools.length);
		}

		debugLog('stream', '请求 URL:', url);
		debugLog('stream', '消息数量:', messages.length);
		debugLog('stream', '消息角色序列:', messages.map(m => m.role).join(' -> '));
		debugLog('stream', '完整请求体:', JSON.stringify(requestBody, null, 2));

		const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
		let currentToolIndex = -1;
		let hasContent = false;
		let lineCount = 0;
		let eventCount = 0;
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
					lineCount++;
					// Anthropic SSE 格式：event: xxx 和 data: xxx
					// 跳过 event: 行，只处理 data: 行
					if (line.startsWith('event:')) {
						debugLog('stream', `[Line ${lineCount}] event:`, line.slice(6).trim());
						return;
					}

					if (!line.startsWith('data:')) {
						debugLog('stream', `[Line ${lineCount}] 非 data 行:`, line.substring(0, 100));
						return;
					}

					const data = line.slice(5).trim();
					if (!data || data === '[DONE]') {
						debugLog('stream', `[Line ${lineCount}] 空数据或 DONE`);
						return;
					}

					try {
						const event = JSON.parse(data);
						eventCount++;
						debugLog('stream', `[Event ${eventCount}] type:`, event.type);

						switch (event.type) {
							case 'content_block_start':
								hasContent = true;
								debugLog('stream', 'content_block_start:', event.content_block?.type);
								if (event.content_block?.type === 'tool_use') {
									currentToolIndex++;
									accumulatedToolCalls.set(currentToolIndex, {
										id: event.content_block.id || generateToolCallId(),
										name: event.content_block.name || '',
										arguments: '',
									});
									debugLog('stream', '工具调用开始:', event.content_block.name);
								}
								break;

							case 'content_block_delta':
								hasContent = true;
								if (event.delta?.type === 'text_delta' && event.delta.text) {
									debugLog('stream', 'text_delta 长度:', event.delta.text.length);
									options.call?.({ content: event.delta.text, done: false });
								} else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
									const tc = accumulatedToolCalls.get(currentToolIndex);
									if (tc) {
										tc.arguments += event.delta.partial_json;
									}
								}
								break;

							case 'message_delta':
								debugLog('stream', 'message_delta:', event.delta);
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
								debugLog('stream', 'message_start, message id:', event.message?.id);
								if (event.message?.usage) {
									finalUsage = {
										promptTokens: event.message.usage.input_tokens || 0,
										completionTokens: event.message.usage.output_tokens || 0,
										totalTokens: (event.message.usage.input_tokens || 0) + (event.message.usage.output_tokens || 0),
									};
								}
								break;

							case 'message_stop':
								debugLog('stream', 'message_stop');
								break;

							case 'error':
								debugLog('stream', 'ERROR 事件:', event.error);
								break;

							default:
								debugLog('stream', '未知事件类型:', event.type, event);
						}
					} catch (e) {
						debugLog('stream', `[Line ${lineCount}] JSON 解析错误:`, e, '原始数据:', data.substring(0, 200));
					}
				},
				() => {
					// 流结束
					debugLog('stream', '========== 流结束 ==========');
					debugLog('stream', '总行数:', lineCount);
					debugLog('stream', '事件数:', eventCount);
					debugLog('stream', 'hasContent:', hasContent);
					debugLog('stream', '累积工具调用数:', accumulatedToolCalls.size);

					if (!hasContent) {
						debugLog('stream', 'ERROR: 没有收到任何内容!');
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
							debugLog('stream', '发送工具调用:', toolCalls.map(t => t.function.name));
							options.call?.({ content: '', tool_calls: toolCalls, done: false });
						}
					}

					debugLog('stream', '发送 done: true');
					options.call?.({ content: '', done: true, usage: finalUsage });
					resolve();
				},
				(error) => {
					debugLog('stream', 'ERROR:', error.message);
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
