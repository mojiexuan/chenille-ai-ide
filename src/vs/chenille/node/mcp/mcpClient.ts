/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import {
	McpServerConfig,
	McpServerStatus,
	McpServerInfo,
	McpToolDefinition,
	McpToolCallRequest,
	McpToolCallResult,
	McpContent,
} from '../../common/types.js';

/**
 * JSON-RPC 请求
 */
interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number;
	method: string;
	params?: unknown;
}

/**
 * JSON-RPC 响应
 */
interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

/**
 * MCP 客户端 - 管理单个 MCP 服务器连接
 */
export class McpClient {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private buffer = '';
	private _status: McpServerStatus = McpServerStatus.DISCONNECTED;
	private _error: string | undefined;
	private _tools: McpToolDefinition[] = [];

	constructor(private readonly config: McpServerConfig) { }

	get status(): McpServerStatus {
		return this._status;
	}

	get error(): string | undefined {
		return this._error;
	}

	get tools(): McpToolDefinition[] {
		return this._tools;
	}

	get info(): McpServerInfo {
		return {
			config: this.config,
			status: this._status,
			error: this._error,
			capabilities: this._tools.length > 0 ? { tools: this._tools } : undefined,
		};
	}

	/**
	 * 连接到 MCP 服务器
	 */
	async connect(): Promise<void> {
		if (this._status === McpServerStatus.CONNECTED) {
			return;
		}

		if (this.config.transport === 'stdio') {
			await this.connectStdio();
		} else {
			throw new Error(`Unsupported transport: ${this.config.transport}`);
		}
	}

	/**
	 * 通过 stdio 连接
	 */
	private async connectStdio(): Promise<void> {
		if (!this.config.command) {
			throw new Error('Command is required for stdio transport');
		}

		this._status = McpServerStatus.CONNECTING;
		this._error = undefined;

		try {
			this.process = spawn(this.config.command, this.config.args || [], {
				env: { ...process.env, ...this.config.env },
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			this.process.stdout?.on('data', (data: Buffer) => {
				this.handleData(data.toString());
			});

			this.process.stderr?.on('data', (data: Buffer) => {
				console.error(`[MCP ${this.config.name}] stderr:`, data.toString());
			});

			this.process.on('error', (err) => {
				this._status = McpServerStatus.ERROR;
				this._error = err.message;
				this.rejectAllPending(err);
			});

			this.process.on('close', (code) => {
				this._status = McpServerStatus.DISCONNECTED;
				if (code !== 0) {
					this._error = `Process exited with code ${code}`;
				}
				this.rejectAllPending(new Error('Connection closed'));
			});

			// 初始化连接
			await this.initialize();

			// 获取工具列表
			await this.listTools();

			this._status = McpServerStatus.CONNECTED;
		} catch (err) {
			this._status = McpServerStatus.ERROR;
			this._error = err instanceof Error ? err.message : String(err);
			this.disconnect();
			throw err;
		}
	}

	/**
	 * 断开连接
	 */
	disconnect(): void {
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		this._status = McpServerStatus.DISCONNECTED;
		this.rejectAllPending(new Error('Disconnected'));
	}

	/**
	 * 初始化 MCP 连接
	 */
	private async initialize(): Promise<void> {
		await this.sendRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: {
				name: 'chenille',
				version: '1.0.0',
			},
		});

		// 发送 initialized 通知
		this.sendNotification('notifications/initialized', {});
	}

	/**
	 * 获取工具列表
	 */
	private async listTools(): Promise<void> {
		try {
			const result = await this.sendRequest('tools/list', {}) as { tools?: McpToolDefinition[] };
			this._tools = result.tools || [];
		} catch {
			this._tools = [];
		}
	}

	/**
	 * 调用工具
	 */
	async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
		if (this._status !== McpServerStatus.CONNECTED) {
			return { success: false, error: 'Not connected' };
		}

		try {
			const result = await this.sendRequest('tools/call', {
				name: request.toolName,
				arguments: request.arguments,
			}) as { content?: McpContent[]; isError?: boolean };

			if (result.isError) {
				const errorText = result.content
					?.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
					.map(c => c.text)
					.join('\n') || 'Unknown error';
				return { success: false, error: errorText };
			}

			return { success: true, content: result.content };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : String(err) };
		}
	}

	/**
	 * 发送 JSON-RPC 请求
	 */
	private sendRequest(method: string, params?: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin) {
				reject(new Error('Not connected'));
				return;
			}

			const id = ++this.requestId;
			const request: JsonRpcRequest = {
				jsonrpc: '2.0',
				id,
				method,
				params,
			};

			this.pendingRequests.set(id, { resolve, reject });

			const message = JSON.stringify(request) + '\n';
			this.process.stdin.write(message);

			// 超时处理
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`Request timeout: ${method}`));
				}
			}, 30000);
		});
	}

	/**
	 * 发送通知（无响应）
	 */
	private sendNotification(method: string, params?: unknown): void {
		if (!this.process?.stdin) {
			return;
		}

		const notification = {
			jsonrpc: '2.0',
			method,
			params,
		};

		const message = JSON.stringify(notification) + '\n';
		this.process.stdin.write(message);
	}

	/**
	 * 处理接收到的数据
	 */
	private handleData(data: string): void {
		this.buffer += data;

		// 按行处理
		const lines = this.buffer.split('\n');
		this.buffer = lines.pop() || '';

		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}

			try {
				const response = JSON.parse(line) as JsonRpcResponse;
				if (response.id !== undefined) {
					const pending = this.pendingRequests.get(response.id);
					if (pending) {
						this.pendingRequests.delete(response.id);
						if (response.error) {
							pending.reject(new Error(response.error.message));
						} else {
							pending.resolve(response.result);
						}
					}
				}
			} catch {
				// 忽略解析错误
			}
		}
	}

	/**
	 * 拒绝所有待处理请求
	 */
	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pendingRequests) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}
}
