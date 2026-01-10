/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, TextBlock, ToolUseBlock, ToolResultBlockParam, ImageBlockParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage, AiToolCall, generateToolCallId } from '../../common/types.js';

// ========== 调试日志 ==========
const DEBUG = true;
const debugLogs: string[] = [];

function debugLog(tag: string, ...args: unknown[]): void {
	if (DEBUG) {
		const msg = `[Anthropic-SDK][${tag}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
		console.log(msg);
		debugLogs.push(`${new Date().toISOString()} ${msg}`);
		// 保留最近 200 条日志
		if (debugLogs.length > 200) {
			debugLogs.shift();
		}
	}
}

// 导出日志供外部访问
export function getAnthropicSdkDebugLogs(): string[] {
	return [...debugLogs];
}

export function clearAnthropicSdkDebugLogs(): void {
	debugLogs.length = 0;
}
// =============================

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
 * 注意：Anthropic 要求消息必须交替出现（user/assistant），
 * 且多个 tool_result 必须合并到同一个 user 消息中
 */
function toAnthropicMessages(messages: AiModelMessage[]): MessageParam[] {
	debugLog('toAnthropicMessages', '输入消息数量:', messages.length);
	debugLog('toAnthropicMessages', '输入消息:', JSON.stringify(messages.map(m => ({
		role: m.role,
		contentLength: m.content?.length,
		hasToolCalls: !!m.tool_calls?.length,
		toolCallId: m.tool_call_id,
	})), null, 2));

	const result: MessageParam[] = [];

	// 用于收集连续的 tool_result
	let pendingToolResults: ToolResultBlockParam[] = [];

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
				debugLog('toAnthropicMessages', 'assistant 普通消息');
				// 普通 assistant 消息
				result.push({
					role: 'assistant',
					content: msg.content,
				});
			}
			continue;
		}

		// user 消息（支持图片）
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
function toAnthropicTools(options: ChatCompletionOptions): Tool[] | undefined {
	if (!options.tools?.length) {
		return undefined;
	}
	return options.tools.map(t => ({
		name: t.function.name,
		description: t.function.description,
		input_schema: t.function.parameters as Tool['input_schema'],
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
		debugLog('chat', '开始非流式请求');
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 1) || 0.7;

		const messages = toAnthropicMessages(options.messages);
		const tools = toAnthropicTools(options);

		debugLog('chat', '消息数量:', messages.length);
		debugLog('chat', '工具数量:', tools?.length || 0);

		const response = await client.messages.create({
			model: model.model,
			messages,
			system: extractSystemPrompt(options.messages),
			temperature,
			max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
			tools,
		});

		debugLog('chat', '响应:', { id: response.id, stop_reason: response.stop_reason, contentBlocks: response.content.length });

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
		debugLog('stream', '========== 开始流式请求 ==========');
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 1) || 0.7;

		const messages = toAnthropicMessages(options.messages);
		const tools = toAnthropicTools(options);

		debugLog('stream', '消息数量:', messages.length);
		debugLog('stream', '消息角色序列:', messages.map(m => m.role).join(' -> '));
		debugLog('stream', '工具数量:', tools?.length || 0);
		debugLog('stream', '完整消息:', JSON.stringify(messages, null, 2));

		const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
		let currentToolIndex = -1;
		let hasReceivedContent = false;
		let eventCount = 0;
		let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

		try {
			debugLog('stream', '创建流式请求...');
			// 使用 create + stream: true，返回 async iterable
			const stream = await client.messages.create({
				model: model.model,
				messages,
				system: extractSystemPrompt(options.messages),
				temperature,
				max_tokens: model.maxTokens > 0 ? model.maxTokens : 4096,
				tools,
				stream: true,
			});

			debugLog('stream', '流创建成功，开始迭代...');

			for await (const event of stream) {
				eventCount++;
				if (options.token?.isCancellationRequested) {
					debugLog('stream', '请求已取消');
					break;
				}

				debugLog('stream', `[Event ${eventCount}] type:`, event.type);

				switch (event.type) {
					case 'message_start':
						hasReceivedContent = true;
						debugLog('stream', 'message_start, message id:', event.message?.id);
						if (event.message?.usage) {
							finalUsage = {
								promptTokens: event.message.usage.input_tokens,
								completionTokens: event.message.usage.output_tokens,
								totalTokens: event.message.usage.input_tokens + event.message.usage.output_tokens,
							};
						}
						break;

					case 'content_block_start':
						hasReceivedContent = true;
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
						hasReceivedContent = true;
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
								promptTokens: finalUsage?.promptTokens || 0,
								completionTokens: event.usage.output_tokens || 0,
								totalTokens: (finalUsage?.promptTokens || 0) + (event.usage.output_tokens || 0),
							};
						}
						break;

					case 'message_stop':
						debugLog('stream', 'message_stop');
						break;

					default:
						debugLog('stream', '未知事件类型:', event.type);
				}
			}

			debugLog('stream', '========== 流迭代结束 ==========');
			debugLog('stream', '事件数:', eventCount);
			debugLog('stream', 'hasReceivedContent:', hasReceivedContent);
			debugLog('stream', '累积工具调用数:', accumulatedToolCalls.size);

			if (options.token?.isCancellationRequested) {
				debugLog('stream', '请求已取消，不发送结果');
				return;
			}

			if (!hasReceivedContent) {
				debugLog('stream', 'ERROR: 没有收到任何内容!');
				options.call?.({ content: '', done: true, error: 'request ended without sending any chunks' });
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
					debugLog('stream', '发送工具调用:', toolCalls.map(t => t.function.name));
					options.call?.({
						content: '',
						tool_calls: toolCalls,
						done: false,
					});
				}
			}

			debugLog('stream', '发送 done: true');
			options.call?.({ content: '', done: true, usage: finalUsage });

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			debugLog('stream', 'ERROR:', errorMessage);
			debugLog('stream', 'Error stack:', error instanceof Error ? error.stack : 'N/A');
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
