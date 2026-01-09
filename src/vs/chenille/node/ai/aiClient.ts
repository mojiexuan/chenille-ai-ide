/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AiProvider, ChatCompletionOptions, ChatCompletionResult, IAIProvider, AiTool, parseMcpToolName, McpServerConfig } from '../../common/types.js';
import { ChenilleError } from '../../common/errors.js';
import { OpenAIProvider } from './openaiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { GoogleProvider } from './googleProvider.js';
import { OpenAIProviderFetch } from './openaiProviderFetch.js';
import { AnthropicProviderFetch } from './anthropicProviderFetch.js';
import { GoogleProviderFetch } from './googleProviderFetch.js';
import { getMcpManager } from '../mcp/mcpManager.js';

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

// 注册内置 Provider（SDK 版本）
registerProvider(AiProvider.OPENAI, new OpenAIProvider());
registerProvider(AiProvider.ANTHROPIC, new AnthropicProvider());
registerProvider(AiProvider.GOOGLE, new GoogleProvider());

// 注册 Fetch 版本 Provider（不依赖 SDK，打包后更稳定）
registerProvider(AiProvider.OPENAI_FETCH, new OpenAIProviderFetch());
registerProvider(AiProvider.ANTHROPIC_FETCH, new AnthropicProviderFetch());
registerProvider(AiProvider.GOOGLE_FETCH, new GoogleProviderFetch());

/**
 * 合并 MCP 工具到选项中
 */
function mergeWithMcpTools(options: ChatCompletionOptions): ChatCompletionOptions {
	const mcpManager = getMcpManager();
	const mcpTools = mcpManager.getAllTools();

	if (mcpTools.length === 0) {
		return options;
	}

	// 合并工具列表
	const mergedTools: AiTool[] = [...(options.tools || []), ...mcpTools];

	return {
		...options,
		tools: mergedTools,
	};
}

/**
 * AI 客户端 - 统一入口
 */
export class AIClient {
	/**
	 * 初始化 MCP 服务器
	 */
	static async initializeMcp(configs: McpServerConfig[]): Promise<void> {
		const mcpManager = getMcpManager();
		await mcpManager.initializeServers(configs);
	}

	/**
	 * 普通对话（自动注入 MCP 工具）
	 */
	static async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const provider = getProvider(options.agent.model.provider);
		const mergedOptions = mergeWithMcpTools(options);
		return provider.chat(mergedOptions);
	}

	/**
	 * 流式对话（自动注入 MCP 工具）
	 */
	static async stream(options: ChatCompletionOptions): Promise<void> {
		const provider = getProvider(options.agent.model.provider);
		const mergedOptions = mergeWithMcpTools(options);
		return provider.stream(mergedOptions);
	}

	/**
	 * 调用 MCP 工具
	 */
	static async callMcpTool(toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; content?: string; error?: string }> {
		const parsed = parseMcpToolName(toolName);
		if (!parsed) {
			return { success: false, error: `Invalid MCP tool name: ${toolName}` };
		}

		const mcpManager = getMcpManager();
		const result = await mcpManager.callTool({
			serverName: parsed.serverName,
			toolName: parsed.toolName,
			arguments: args,
		});

		if (!result.success) {
			return { success: false, error: result.error };
		}

		// 将 MCP 内容转换为字符串
		const content = result.content
			?.map(c => {
				if (c.type === 'text') {
					return c.text;
				} else if (c.type === 'resource' && c.resource.text) {
					return c.resource.text;
				}
				return '';
			})
			.filter(s => s)
			.join('\n') || '';

		return { success: true, content };
	}

	/**
	 * 检查是否为 MCP 工具
	 */
	static isMcpTool(toolName: string): boolean {
		return toolName.startsWith('mcp_');
	}

	/**
	 * 获取所有 MCP 工具
	 */
	static getMcpTools(): AiTool[] {
		return getMcpManager().getAllTools();
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
