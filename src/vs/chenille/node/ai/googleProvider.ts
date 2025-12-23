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
					{ type: toGoogleType(value.type), description: value.description }
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
		const temperature = Math.min(Math.max(0, options.agent.temperature), 2) || 0.7;

		const response = await client.models.generateContent({
			model: options.agent.model.model,
			contents: toGoogleContents(options.messages),
			config: {
				systemInstruction: extractSystemInstruction(options.messages),
				temperature,
				maxOutputTokens: options.agent.maxTokens > 0 ? options.agent.maxTokens : undefined,
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
		const functionCall = functionCalls.length > 0 ? functionCalls.map(p => ({
			type: 'function' as const,
			function: {
				name: p.functionCall?.name,
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
		const temperature = Math.min(Math.max(0, options.agent.temperature), 2) || 0.7;

		const response = await client.models.generateContentStream({
			model: options.agent.model.model,
			contents: toGoogleContents(options.messages),
			config: {
				systemInstruction: extractSystemInstruction(options.messages),
				temperature,
				maxOutputTokens: options.agent.maxTokens > 0 ? options.agent.maxTokens : undefined,
				tools: toGoogleTools(options),
			},
		});

		for await (const chunk of response) {
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
					const result: ChatCompletionResult = {
						content: '',
						function_call: [{
							type: 'function',
							function: {
								name: funcPart.functionCall.name,
								arguments: JSON.stringify(funcPart.functionCall.args ?? {}),
							},
						}],
						done: false,
					};
					options.call?.(result);
				}
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
