/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	McpServerConfig,
	McpServerInfo,
	McpToolDefinition,
	McpToolCallRequest,
	McpToolCallResult,
	AiTool,
	mcpToolToAiTool,
	parseMcpToolName,
} from '../../common/types.js';
import { McpClient } from './mcpClient.js';

/**
 * MCP 管理器 - 管理所有 MCP 服务器连接
 */
export class McpManager {
	private static instance: McpManager | null = null;
	private clients = new Map<string, McpClient>();

	private constructor() { }

	static getInstance(): McpManager {
		if (!McpManager.instance) {
			McpManager.instance = new McpManager();
		}
		return McpManager.instance;
	}

	/**
	 * 初始化 MCP 服务器
	 */
	async initializeServers(configs: McpServerConfig[]): Promise<void> {
		// 断开不再需要的连接
		for (const [name, client] of this.clients) {
			if (!configs.find(c => c.name === name && c.enabled)) {
				client.disconnect();
				this.clients.delete(name);
			}
		}

		// 连接新的服务器
		for (const config of configs) {
			if (!config.enabled) {
				continue;
			}

			if (!this.clients.has(config.name)) {
				const client = new McpClient(config);
				this.clients.set(config.name, client);

				try {
					await client.connect();
				} catch (err) {
					console.error(`[MCP] Failed to connect to ${config.name}:`, err);
				}
			}
		}
	}

	/**
	 * 获取所有服务器信息
	 */
	getServerInfos(): McpServerInfo[] {
		return Array.from(this.clients.values()).map(c => c.info);
	}

	/**
	 * 获取所有可用的 MCP 工具（转换为 AI 工具格式）
	 */
	getAllTools(): AiTool[] {
		const tools: AiTool[] = [];

		for (const [serverName, client] of this.clients) {
			if (client.status !== 'connected') {
				continue;
			}

			for (const tool of client.tools) {
				tools.push(mcpToolToAiTool(serverName, tool));
			}
		}

		return tools;
	}

	/**
	 * 获取指定服务器的工具
	 */
	getServerTools(serverName: string): McpToolDefinition[] {
		const client = this.clients.get(serverName);
		return client?.tools || [];
	}

	/**
	 * 调用 MCP 工具
	 */
	async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
		const client = this.clients.get(request.serverName);
		if (!client) {
			return { success: false, error: `Server not found: ${request.serverName}` };
		}

		return client.callTool(request);
	}

	/**
	 * 通过完整工具名调用（mcp_serverName__toolName 格式）
	 */
	async callToolByFullName(fullName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
		const parsed = parseMcpToolName(fullName);
		if (!parsed) {
			return { success: false, error: `Invalid MCP tool name: ${fullName}` };
		}

		return this.callTool({
			serverName: parsed.serverName,
			toolName: parsed.toolName,
			arguments: args,
		});
	}

	/**
	 * 检查工具是否需要自动批准
	 */
	isAutoApproved(serverName: string, toolName: string): boolean {
		const client = this.clients.get(serverName);
		if (!client) {
			return false;
		}

		const config = client.info.config;
		return config.autoApprove?.includes(toolName) || false;
	}

	/**
	 * 断开所有连接
	 */
	disconnectAll(): void {
		for (const client of this.clients.values()) {
			client.disconnect();
		}
		this.clients.clear();
	}

	/**
	 * 重新连接指定服务器
	 */
	async reconnect(serverName: string): Promise<void> {
		const client = this.clients.get(serverName);
		if (client) {
			client.disconnect();
			await client.connect();
		}
	}
}

/**
 * 获取 MCP 管理器实例
 */
export function getMcpManager(): McpManager {
	return McpManager.getInstance();
}
