/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GoogleGenAI, Content, Tool, FunctionDeclaration, Type } from '@google/genai';
import { ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiModelMessage } from '../../common/types.js';
import { ChenilleError } from '../../common/errors.js';

/**
 * 将统一消息格式转换为 Google 格式
 */
function toGoogleContents(messages: AiModelMessage[]): Content[] {
	return messages
		.filter(msg => msg.role !== 'system')
		.map(msg => ({
			role: msg.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: msg.content }],
		}));
}

/**
 * 提取 system 消息
 */
function extractSystemInstruction(messages: AiModelMessage[]): string | undefined {
	const systemMsg = messages.find(msg => msg.role === 'system');
	return systemMsg?.content;
}

/**
 * 将类型字符串转换为 Google Type
 */
function toGoogleType(type: string): Type {
	const typeMap: Record<string, Type> = {
		'string': Type.STRING,
		'number': Type.NUMBER,
		'boolean': Type.BOOLEAN,
		'object': Type.OBJECT,
		'array': Type.ARRAY,
		'integer': Type.INTEGER,
	};
	return typeMap[type] ?? Type.STRING;
}

/**
 * 将属性描述符转换为 Google 格式
 */
function toGoogleProperty(value: { type: string; description: string; items?: { type: string }; properties?: Record<string, { type: string; description: string }> }): Record<string, unknown> {
	const prop: Record<string, unknown> = {
		type: toGoogleType(value.type),
		description: value.description,
	};

	// 处理数组类型
	if (value.type === 'array' && value.items) {
		prop.items = { type: toGoogleType(value.items.type) };
	}

	// 处理嵌套对象
	if (value.type === 'object' && value.properties) {
		prop.properties = Object.fromEntries(
			Object.entries(value.properties).map(([k, v]) => [k, toGoogleProperty(v)])
		);
	}

	return prop;
}

/**
 * 将统一工具格式转换为 Google 格式
 */
function toGoogleTools(options: ChatCompletionOptions): Tool[] | undefined {
	if (!options.tools?.length) {
		return undefined;
	}
	const functionDeclarations = options.tools.map(t => ({
		name: t.function.name,
		description: t.function.description,
		parameters: {
			type: Type.OBJECT,
			properties: Object.fromEntries(
				Object.entries(t.function.parameters.properties).map(([key, value]) => [
					key,
					toGoogleProperty(value)
				])
			),
			required: t.function.parameters.required,
		},
	})) as unknown as FunctionDeclaration[];
	return [{ functionDeclarations }];
}

/**
 * Google Provider 实现
 */
export class GoogleProvider implements IAIProvider {
	readonly name = 'google';

	private createClient(options: ChatCompletionOptions): GoogleGenAI {
		return new GoogleGenAI({
			apiKey: options.agent.model.apiKey,
		});
	}

	async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 2) || 0.7;

		const response = await client.models.generateContent({
			model: model.model,
			contents: toGoogleContents(options.messages),
			config: {
				systemInstruction: extractSystemInstruction(options.messages),
				temperature,
				maxOutputTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
				tools: toGoogleTools(options),
			},
		});

		if (!response.candidates?.length) {
			throw new ChenilleError('请求失败：无返回结果');
		}

		const candidate = response.candidates[0];
		const parts = candidate.content?.parts ?? [];

		const textParts = parts.filter((p): p is { text: string } => typeof (p as { text?: string }).text === 'string');
		const content = textParts.map(p => p.text).join('');

		const functionCalls = parts.filter((p): p is { functionCall: { name?: string; args?: Record<string, unknown> } } =>
			typeof (p as { functionCall?: unknown }).functionCall === 'object');
		const functionCall = functionCalls.length > 0 ? functionCalls
			.filter(p => p.functionCall?.name) // 过滤掉没有 name 的
			.map(p => ({
				type: 'function' as const,
				function: {
					name: p.functionCall.name!,
					arguments: JSON.stringify(p.functionCall?.args ?? {}),
				},
			})) : undefined;

		const result: ChatCompletionResult = {
			content,
			function_call: functionCall,
			done: true,
		};

		options.call?.(result);
		return result;
	}

	async stream(options: ChatCompletionOptions): Promise<void> {
		const client = this.createClient(options);
		const { model } = options.agent;
		const temperature = Math.min(Math.max(0, model.temperature), 2) || 0.7;

		const response = await client.models.generateContentStream({
			model: model.model,
			contents: toGoogleContents(options.messages),
			config: {
				systemInstruction: extractSystemInstruction(options.messages),
				temperature,
				maxOutputTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
				tools: toGoogleTools(options),
			},
		});

		// 累积工具调用
		const accumulatedToolCalls: { name: string; arguments: string }[] = [];

		for await (const chunk of response) {
			// 检查取消
			if (options.token?.isCancellationRequested) {
				break;
			}

			const parts = chunk.candidates?.[0]?.content?.parts ?? [];

			for (const part of parts) {
				const textPart = part as { text?: string };
				const funcPart = part as { functionCall?: { name?: string; args?: Record<string, unknown> } };

				if (typeof textPart.text === 'string' && textPart.text) {
					const result: ChatCompletionResult = {
						content: textPart.text,
						done: false,
					};
					options.call?.(result);
				} else if (typeof funcPart.functionCall === 'object' && funcPart.functionCall) {
					// 累积工具调用，而不是立即发送
					accumulatedToolCalls.push({
						name: funcPart.functionCall.name ?? '',
						arguments: JSON.stringify(funcPart.functionCall.args ?? {}),
					});
				}
			}
		}

		// 如果被取消，不发送工具调用和完成信号
		if (options.token?.isCancellationRequested) {
			return;
		}

		// 流结束后，发送累积的工具调用
		if (accumulatedToolCalls.length > 0) {
			const toolCalls = accumulatedToolCalls
				.filter(tc => tc.name)
				.map(tc => ({
					type: 'function' as const,
					function: {
						name: tc.name,
						arguments: tc.arguments,
					},
				}));

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
 * 创建 Google Provider 实例
 */
export function createGoogleProvider(): IAIProvider {
	return new GoogleProvider();
}
