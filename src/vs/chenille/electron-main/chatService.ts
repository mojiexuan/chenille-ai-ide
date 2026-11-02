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
import { IMcpServerStorageService, IAiAgentStorageService, IAiModelStorageService, IAiPromptStorageService } from '../common/storageIpc.js';
import { ChenilleError } from '../common/errors.js';

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
		@IAiAgentStorageService private readonly agentStorage: IAiAgentStorageService,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
		@IAiPromptStorageService private readonly promptStorage: IAiPromptStorageService,
	) {
		super();

		// 监听 MCP 配置变化，重新初始化
		this._register(this.mcpStorage.onDidChangeServers(() => {
			this.initializeMcp();
		}));

		// 监听配置变化，清除错误缓存，使下次调用重新验证配置
		this._register(this.agentStorage.onDidChangeAgents(() => {
			this._lastConfigError = undefined;
		}));

		this._register(this.modelStorage.onDidChangeModels(() => {
			this._lastConfigError = undefined;
		}));

		this._register(this.promptStorage.onDidChangePrompts(() => {
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

	async streamChat(request: IAiCallRequest, token?: CancellationToken): Promise<void> {
		// 确保 MCP 已初始化
		if (!this._mcpInitialized) {
			await this.initializeMcp();
		}

		const agent = await this.agentService.getAgent(AgentType.CODE_WRITER);
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

		try {
			await AIClient.stream({
				agent,
				messages,
				tools: request.tools,
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
