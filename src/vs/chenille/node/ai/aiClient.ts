/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AiProvider, ChatCompletionOptions, ChatCompletionResult, IAIProvider } from '../../common/types.js';
import { ChenilleError } from '../../common/errors.js';
import { OpenAIProvider } from './openaiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { GoogleProvider } from './googleProvider.js';

/**
 * Provider 注册表
 */
const providers: Map<AiProvider, IAIProvider> = new Map();

/**
 * 注册 Provider
 */
function registerProvider(provider: AiProvider, instance: IAIProvider): void {
	providers.set(provider, instance);
}

/**
 * 获取 Provider
 */
function getProvider(provider: AiProvider): IAIProvider {
	const instance = providers.get(provider);
	if (!instance) {
		throw new ChenilleError(`不支持的 AI 提供商: ${provider}`);
	}
	return instance;
}

// 注册内置 Provider
registerProvider(AiProvider.OPENAI, new OpenAIProvider());
registerProvider(AiProvider.ANTHROPIC, new AnthropicProvider());
registerProvider(AiProvider.GOOGLE, new GoogleProvider());

/**
 * AI 客户端 - 统一入口
 */
export class AIClient {
	/**
	 * 普通对话
	 */
	static async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const provider = getProvider(options.agent.model.provider);
		return provider.chat(options);
	}

	/**
	 * 流式对话
	 */
	static async stream(options: ChatCompletionOptions): Promise<void> {
		const provider = getProvider(options.agent.model.provider);
		return provider.stream(options);
	}

	/**
	 * 注册自定义 Provider
	 */
	static register(provider: AiProvider, instance: IAIProvider): void {
		registerProvider(provider, instance);
	}
}

/**
 * 便捷方法
 */
export const chat = AIClient.chat;
export const stream = AIClient.stream;
