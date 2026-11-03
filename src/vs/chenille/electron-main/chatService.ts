/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { IChenilleAiService, IAiCallRequest, IStreamChunkWithId } from '../common/chatService.js';
import { AIClient } from '../node/ai/aiClient.js';
import { AgentType } from '../common/types.js';
import { IAiAgentMainService } from './agentService.js';
import { IMcpServerStorageService, IAiModelStorageService } from '../common/storageIpc.js';
import { ChenilleError } from '../common/errors.js';
import { INetworkToolsService } from '../common/networkTools.js';
import { DEEPSEEK_TOOL_DEFINITIONS } from '../tools/definitions.js';
import { AiTool } from '../common/types.js';

/**
 * AI 调用服务实现（主进程）
 * 只负责调用 AI，工具执行由渲染进程处理
 */
export class ChenilleAiMainService extends Disposable implements IChenilleAiService {
	declare readonly _serviceBrand: undefined;

	private readonly _onStreamChunk = this._register(new Emitter<IStreamChunkWithId>());
	readonly onStreamChunk: Event<IStreamChunkWithId> = this._onStreamChunk.event;

	private _lastConfigError: string | undefined;
	private _mcpInitialized = false;

	constructor(
		@IAiAgentMainService private readonly agentService: IAiAgentMainService,
		@IMcpServerStorageService private readonly mcpStorage: IMcpServerStorageService,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
		@INetworkToolsService private readonly networkToolsService: INetworkToolsService,
	) {
		super();

		// 监听 MCP 配置变化，重新初始化
		this._register(this.mcpStorage.onDidChangeServers(() => {
			this.initializeMcp();
		}));

		// 模型配置变化后清除错误缓存，使下次调用重新验证配置
		this._register(this.modelStorage.onDidChangeModels(() => {
			this._lastConfigError = undefined;
		}));
	}

	/**
	 * 初始化 MCP 服务器
	 */
	private async initializeMcp(): Promise<void> {
		try {
			const configs = await this.mcpStorage.getAll();
			await AIClient.initializeMcp(configs);
			this._mcpInitialized = true;
		} catch {
			// MCP 初始化失败不影响主流程
		}
	}

	async isAgentConfigured(): Promise<boolean> {
		try {
			await this.agentService.getAgent(AgentType.CODE_WRITER);
			this._lastConfigError = undefined;
			return true;
		} catch (error) {
			this._lastConfigError = error instanceof ChenilleError ? error.message : String(error);
			return false;
		}
	}

	async getConfigurationError(): Promise<string | undefined> {
		if (this._lastConfigError === undefined) {
			await this.isAgentConfigured();
		}
		return this._lastConfigError;
	}

	async getContextSize(): Promise<number> {
		try {
			const agent = await this.agentService.getAgent(AgentType.CODE_WRITER);
			return agent.model.contextSize;
		} catch {
			// 默认返回 128000
			return 128000;
		}
	}

	async supportsVision(): Promise<boolean> {
		try {
			const agent = await this.agentService.getAgent(AgentType.CODE_WRITER);
			return agent.model.supportsVision ?? false;
		} catch {
			return false;
		}
	}

	/**
	 * 合并请求中的工具与 DeepSeek 工具（按名称去重）
	 */
	private async buildTools(requested: AiTool[] | undefined): Promise<AiTool[] | undefined> {
		if (!requested?.length) {
			return requested;
		}
		if (!await this.networkToolsService.isDeepSeekEnabled()) {
			return requested;
		}

		const names = new Set(requested.map(tool => tool.function.name));
		const tools = [...requested];
		for (const tool of DEEPSEEK_TOOL_DEFINITIONS) {
			if (!names.has(tool.function.name)) {
				tools.push(tool);
			}
		}
		return tools;
	}

	async streamChat(request: IAiCallRequest, token?: CancellationToken): Promise<void> {
		// 确保 MCP 已初始化
		if (!this._mcpInitialized) {
			await this.initializeMcp();
		}

		const agent = await this.agentService.getAgent(AgentType.CODE_WRITER, request.modelName);
		const requestId = request.requestId;

		// 构建系统提示：默认提示 + 自定义提示（项目规则等）
		let systemPromptContent = agent.prompt.content;
		if (request.systemPrompt) {
			// 将自定义提示追加到默认提示后面
			systemPromptContent = `${systemPromptContent}\n\n${request.systemPrompt}`;
		}

		// 构建消息列表，确保系统提示在最前面
		const messages = [
			{ role: 'system' as const, content: systemPromptContent },
			...request.messages.filter(m => m.role !== 'system'), // 过滤掉已有的 system 消息
		];

		// 仅当用户在 Chenille 面板中选择了官方 DeepSeek 模型时，才注入 DeepSeek 搜索/抓取工具
		const tools = await this.buildTools(request.tools);

		try {
			await AIClient.stream({
				agent,
				messages,
				tools,
				token,
				call: (result) => {
					if (token?.isCancellationRequested) {
						return;
					}
					this._onStreamChunk.fire({ ...result, requestId });
				},
			});

			// AIClient.stream 内部已经发送了 done: true，这里不需要再发送

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._onStreamChunk.fire({
				content: '',
				done: true,
				error: errorMessage,
				requestId,
			});
		}
	}
}
