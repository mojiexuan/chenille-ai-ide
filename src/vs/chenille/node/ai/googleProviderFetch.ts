/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage, AiToolCall, generateToolCallId } from '../../common/types.js';
import { fetchJson, fetchStream, joinUrl } from './fetchClient.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GooglePart {
	text?: string;
	inlineData?: {
		mimeType: string;
		data: string;
	};
	functionCall?: {
		name: string;
		args: Record<string, unknown>;
	};
	functionResponse?: {
		name: string;
		response: unknown;
	};
	/** Gemini 3/2.5 thinking 模型的 thought signature */
	thoughtSignature?: string;
}

interface GoogleContent {
	role: 'user' | 'model';
	parts: GooglePart[];
}

interface GoogleTool {
	functionDeclarations: Array<{
		name: string;
		description: string;
		parameters: {
			type: string;
			properties: Record<string, unknown>;
			required?: string[];
		};
	}>;
}

interface GoogleResponse {
	candidates: Array<{
		content: {
			parts: GooglePart[];
			role: string;
		};
		finishReason: string;
	}>;
	usageMetadata?: {
		promptTokenCount: number;
		candidatesTokenCount: number;
		totalTokenCount: number;
	};
}

/**
 * 将多模态内容转换为 Google 格式
 */
function toGoogleParts(msg: AiModelMessage): GooglePart[] {
	if (msg.multiContent?.length) {
		return msg.multiContent.map(part => {
			if (part.type === 'text') {
				return { text: part.text };
			} else {
				return {
					inlineData: {
						mimeType: part.mimeType,
						data: part.data,
					},
				};
			}
		});
	}
	return [{ text: msg.content }];
}

/**
 * 将统一消息格式转换为 Google 格式
 */
function toGoogleContents(messages: AiModelMessage[]): GoogleContent[] {
	const result: GoogleContent[] = [];

	for (const msg of messages) {
		// 跳过 system 消息（单独处理）
		if (msg.role === 'system') {
			continue;
		}

		// 工具结果消息
		if (msg.role === 'tool' && msg.tool_call_id) {
			result.push({
				role: 'user',
				parts: [{
					functionResponse: {
						name: msg.tool_call_id,
						response: JSON.parse(msg.content || '{}'),
					},
				}],
			});
			continue;
		}

		// assistant 消息（可能包含工具调用）
		if (msg.role === 'assistant') {
			if (msg.tool_calls?.length) {
				const parts: GooglePart[] = [];

				if (msg.content) {
					parts.push({ text: msg.content });
				}

				for (const tc of msg.tool_calls) {
					const part: GooglePart = {
						functionCall: {
							name: tc.function.name,
							args: JSON.parse(tc.function.arguments || '{}'),
						},
					};
					// 保留 thoughtSignature（Gemini 3 必需）
					if (tc.thoughtSignature) {
						part.thoughtSignature = tc.thoughtSignature;
					}
					parts.push(part);
				}

				result.push({ role: 'model', parts });
			} else {
				result.push({
					role: 'model',
					parts: [{ text: msg.content }],
				});
			}
			continue;
		}

		// user 消息
		result.push({
			role: 'user',
			parts: toGoogleParts(msg),
		});
	}

	return result;
}

/**
 * 提取 system 消息
 */
function extractSystemInstruction(messages: AiModelMessage[]): string | undefined {
	const systemMsg = messages.find(msg => msg.role === 'system');
	return systemMsg?.content;
}

/**
 * 将统一工具格式转换为 Google 格式
 */
function toGoogleTools(options: ChatCompletionOptions): GoogleTool[] | undefined {
	if (!options.tools?.length) {
		return undefined;
	}

	const functionDeclarations = options.tools.map(t => ({
		name: t.function.name,
		description: t.function.description,
		parameters: {
			type: 'OBJECT',
			properties: Object.fromEntries(
				Object.entries(t.function.parameters.properties).map(([key, value]) => [
					key,
					toGoogleProperty(value as { type: string; description: string }),
				])
			),
			required: t.function.parameters.required,
		},
	}));

	return [{ functionDeclarations }];
}

/**
 * 转换属性类型
 */
function toGoogleProperty(value: { type: string; description: string; items?: { type: string }; properties?: Record<string, { type: string; description: string }> }): Record<string, unknown> {
	const typeMap: Record<string, string> = {
		'string': 'STRING',
		'number': 'NUMBER',
		'boolean': 'BOOLEAN',
		'object': 'OBJECT',
		'array': 'ARRAY',
		'integer': 'INTEGER',
	};

	const prop: Record<string, unknown> = {
		type: typeMap[value.type] || 'STRING',
		description: value.description,
	};

	if (value.type === 'array' && value.items) {
		prop.items = { type: typeMap[value.items.type] || 'STRING' };
	}

	if (value.type === 'object' && value.properties) {
		prop.properties = Object.fromEntries(
			Object.entries(value.properties).map(([k, v]) => [k, toGoogleProperty(v)])
		);
	}

	return prop;
}

/**
 * Google Provider (Fetch 版本)
 */
export class GoogleProviderFetch implements IAIProvider {
	readonly name = 'google-fetch';

	async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, `/v1beta/models/${model.model}:generateContent?key=${model.apiKey}`);

		const requestBody: Record<string, unknown> = {
			contents: toGoogleContents(options.messages),
			generationConfig: {
				temperature: model.temperature || 0.7,
				maxOutputTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
			},
		};

		const systemInstruction = extractSystemInstruction(options.messages);
		if (systemInstruction) {
			requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
		}

		const tools = toGoogleTools(options);
		if (tools) {
			requestBody.tools = tools;
		}

		const response = await fetchJson<GoogleResponse>({
			url,
			body: requestBody,
			token: options.token,
		});

		const candidate = response.candidates?.[0];
		const parts = candidate?.content?.parts || [];

		const textContent = parts
			.filter(p => p.text)
			.map(p => p.text || '')
			.join('');

		const functionCalls = parts.filter(p => p.functionCall);

		const result: ChatCompletionResult = {
			content: textContent,
			tool_calls: functionCalls.length > 0 ? functionCalls.map(p => ({
				id: generateToolCallId(),
				type: 'function' as const,
				function: {
					name: p.functionCall!.name,
					arguments: JSON.stringify(p.functionCall!.args),
				},
				// 保留 thoughtSignature（Gemini 3 必需）
				thoughtSignature: p.thoughtSignature,
			})) : undefined,
			done: true,
			usage: response.usageMetadata ? {
				promptTokens: response.usageMetadata.promptTokenCount,
				completionTokens: response.usageMetadata.candidatesTokenCount,
				totalTokens: response.usageMetadata.totalTokenCount,
			} : undefined,
		};

		options.call?.(result);
		return result;
	}

	async stream(options: ChatCompletionOptions): Promise<void> {
		const { model } = options.agent;
		const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
		const url = joinUrl(baseUrl, `/v1beta/models/${model.model}:streamGenerateContent?key=${model.apiKey}&alt=sse`);

		const requestBody: Record<string, unknown> = {
			contents: toGoogleContents(options.messages),
			generationConfig: {
				temperature: model.temperature || 0.7,
				maxOutputTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
			},
		};

		const systemInstruction = extractSystemInstruction(options.messages);
		if (systemInstruction) {
			requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
		}

		const tools = toGoogleTools(options);
		if (tools) {
			requestBody.tools = tools;
		}

		const accumulatedToolCalls: AiToolCall[] = [];
		let hasContent = false;
		let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

		return new Promise<void>((resolve) => {
			fetchStream(
				{
					url,
					body: requestBody,
					token: options.token,
				},
				(line) => {
					// 解析 SSE 数据
					if (!line.startsWith('data: ')) {
						return;
					}

					const data = line.slice(6).trim();
					if (!data) {
						return;
					}

					try {
						const event: GoogleResponse = JSON.parse(data);
						const candidate = event.candidates?.[0];
						const parts = candidate?.content?.parts || [];

						for (const part of parts) {
							if (part.text) {
								hasContent = true;
								options.call?.({ content: part.text, done: false });
							}

							if (part.functionCall) {
								hasContent = true;
								accumulatedToolCalls.push({
									id: generateToolCallId(),
									type: 'function' as const,
									function: {
										name: part.functionCall.name,
										arguments: JSON.stringify(part.functionCall.args),
									},
									// 保留 thoughtSignature（Gemini 3 必需）
									thoughtSignature: part.thoughtSignature,
								});
							}
						}

						if (event.usageMetadata) {
							finalUsage = {
								promptTokens: event.usageMetadata.promptTokenCount,
								completionTokens: event.usageMetadata.candidatesTokenCount,
								totalTokens: event.usageMetadata.totalTokenCount,
							};
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
					if (accumulatedToolCalls.length > 0) {
						options.call?.({ content: '', tool_calls: accumulatedToolCalls, done: false });
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
 * 创建 Google Provider (Fetch 版本) 实例
 */
export function createGoogleProviderFetch(): IAIProvider {
	return new GoogleProviderFetch();
}
