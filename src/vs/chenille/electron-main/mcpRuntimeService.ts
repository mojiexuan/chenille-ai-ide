/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { IMcpRuntimeService } from '../common/storageIpc.js';
import { McpServerConfig, McpServerInfo, McpToolCallRequest, McpToolCallResult, AiTool } from '../common/types.js';
import { McpManager } from '../node/mcp/mcpManager.js';

/**
 * MCP 运行时服务 - 主进程实现
 * 在主进程中执行 MCP 工具调用，避免在渲染进程中导入 child_process
 */
export class McpRuntimeMainService extends Disposable implements IMcpRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly mcpManager: McpManager;

	constructor() {
		super();
		this.mcpManager = McpManager.getInstance();
	}

	async initializeServers(configs: McpServerConfig[]): Promise<void> {
		await this.mcpManager.initializeServers(configs);
	}

	async getServerInfos(): Promise<McpServerInfo[]> {
		return this.mcpManager.getServerInfos();
	}

	async getAllTools(): Promise<AiTool[]> {
		return this.mcpManager.getAllTools();
	}

	async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
		return this.mcpManager.callTool(request);
	}

	async callToolByFullName(fullName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
		return this.mcpManager.callToolByFullName(fullName, args);
	}

	async isAutoApproved(serverName: string, toolName: string): Promise<boolean> {
		return this.mcpManager.isAutoApproved(serverName, toolName);
	}

	async disconnectAll(): Promise<void> {
		this.mcpManager.disconnectAll();
	}

	async reconnect(serverName: string): Promise<void> {
		await this.mcpManager.reconnect(serverName);
	}

	override dispose(): void {
		this.mcpManager.disconnectAll();
		super.dispose();
	}
}
