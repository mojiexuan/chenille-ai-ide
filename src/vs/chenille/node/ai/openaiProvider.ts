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
		const temperature = Math.min(Math.max(0, options.agent.temperature), 2) || 0.7;

		const response = await client.chat.completions.create({
			model: options.agent.model.model,
			messages: toOpenAIMessages(options),
			temperature,
			max_completion_tokens: options.agent.maxTokens > 0 ? options.agent.maxTokens : undefined,
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
		const temperature = Math.min(Math.max(0, options.agent.temperature), 2) || 0.7;

		const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> = await client.chat.completions.create({
			model: options.agent.model.model,
			messages: toOpenAIMessages(options),
			temperature,
			max_completion_tokens: options.agent.maxTokens > 0 ? options.agent.maxTokens : undefined,
			tools: toOpenAITools(options),
			tool_choice: options.tool_choice,
			stream: true,
		});

		for await (const chunk of stream) {
			if (chunk.choices.length === 0) {
				continue;
			}

			const delta = chunk.choices[0].delta as DeltaWithReasoning;
			const result: ChatCompletionResult = {
				content: delta.content ?? '',
				reasoning: delta.reasoning_content ?? undefined,
				function_call: delta.tool_calls?.map(tc => ({
					type: 'function' as const,
					function: {
						name: tc.function?.name,
						arguments: tc.function?.arguments,
					},
				})),
				done: false,
			};

			if (result.content || result.reasoning || result.function_call) {
				options.call?.(result);
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
