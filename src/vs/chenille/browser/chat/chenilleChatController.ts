/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { IChenilleAiService, IStreamChunkWithId } from '../../common/chatService.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { CHENILLE_SETTINGS_ACTION_ID } from '../settingsPanel/chenilleSettingsAction.js';
import { localize } from '../../../nls.js';
import { AiModelMessage, ToolCall } from '../../common/types.js';
import { CHENILLE_TOOLS } from '../../tools/definitions.js';
import { IChenilleToolDispatcher, IToolResult } from '../../tools/dispatcher.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../base/common/uuid.js';

/** 最大工具调用轮次 */
const MAX_TOOL_ROUNDS = 15;

/**
 * Chat 响应块类型
 */
export interface IChenilleChatChunk {
	/** 文本内容增量 */
	content?: string;
	/** 推理内容增量 */
	reasoning?: string;
	/** 工具调用（完整列表） */
	toolCalls?: ToolCall[];
	/** 工具执行结果 */
	toolResult?: {
		toolName: string;
		success: boolean;
		result: string;
	};
	/** 是否完成 */
	done: boolean;
	/** 错误信息 */
	error?: string;
}

/**
 * Chat 请求参数
 */
export interface IChenilleChatRequest {
	/** 用户输入 */
	input: string;
	/** 历史消息（可选） */
	history?: AiModelMessage[];
	/** 系统提示词覆盖（可选） */
	systemPrompt?: string;
	/** 是否启用工具 */
	enableTools?: boolean;
}

/**
 * Chenille Chat 控制器服务接口
 */
export const IChenilleChatController = createDecorator<IChenilleChatController>('chenilleChatController');

export interface IChenilleChatController {
	readonly _serviceBrand: undefined;

	/** 响应流事件 */
	readonly onChunk: Event<IChenilleChatChunk>;

	/**
	 * 检查是否已配置
	 */
	isConfigured(): Promise<boolean>;

	/**
	 * 获取配置错误信息
	 */
	getConfigurationError(): Promise<string | undefined>;

	/**
	 * 提示用户配置
	 */
	promptConfiguration(): void;

	/**
	 * 发送 Chat 请求
	 * @returns 完整的响应文本
	 */
	chat(request: IChenilleChatRequest, token?: CancellationToken): Promise<string>;

	/**
	 * 取消当前请求
	 */
	cancel(): void;
}


/**
 * Chenille Chat 控制器实现
 * 负责：
 * 1. 调用主进程 AI 服务
 * 2. 处理工具调用循环
 * 3. 流式输出响应
 */
export class ChenilleChatControllerImpl extends Disposable implements IChenilleChatController {
	declare readonly _serviceBrand: undefined;

	private readonly _onChunk = this._register(new Emitter<IChenilleChatChunk>());
	readonly onChunk: Event<IChenilleChatChunk> = this._onChunk.event;

	private _currentCts: CancellationTokenSource | undefined;

	constructor(
		@IChenilleAiService private readonly aiService: IChenilleAiService,
		@IChenilleToolDispatcher private readonly toolDispatcher: IChenilleToolDispatcher,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
	}

	async isConfigured(): Promise<boolean> {
		return this.aiService.isAgentConfigured();
	}

	async getConfigurationError(): Promise<string | undefined> {
		return this.aiService.getConfigurationError();
	}

	promptConfiguration(): void {
		this.aiService.getConfigurationError().then(error => {
			const message = error ?? localize('chenille.agentNotConfigured', "代码编写智能体未配置，请先配置模型和提示词");
			this.notificationService.prompt(
				Severity.Warning,
				message,
				[{
					label: localize('chenille.openSettings', "打开设置"),
					run: () => {
						this.commandService.executeCommand(CHENILLE_SETTINGS_ACTION_ID);
					}
				}]
			);
		});
	}

	cancel(): void {
		this._currentCts?.cancel();
		this._currentCts = undefined;
	}

	async chat(request: IChenilleChatRequest, token?: CancellationToken): Promise<string> {
		// 检查配置
		if (!await this.isConfigured()) {
			this.promptConfiguration();
			const error = await this.getConfigurationError() ?? localize('chenille.agentNotConfiguredShort', "智能体未配置");
			this._onChunk.fire({ done: true, error });
			throw new Error(error);
		}

		// 创建取消令牌并确保正确释放
		const cts = new CancellationTokenSource(token);
		this._currentCts = cts;

		const messages: AiModelMessage[] = [];

		// 添加历史消息
		if (request.history?.length) {
			messages.push(...request.history);
		}

		// 添加用户输入
		messages.push({ role: 'user', content: request.input });

		const tools = request.enableTools !== false ? CHENILLE_TOOLS : undefined;
		let fullResponse = '';
		let toolRound = 0;

		try {
			// 工具调用循环
			while (toolRound < MAX_TOOL_ROUNDS) {
				console.log(`[ChenilleChatController] 开始第 ${toolRound + 1} 轮对话`);

				if (cts.token.isCancellationRequested) {
					console.log('[ChenilleChatController] 请求已取消');
					this._onChunk.fire({ done: true, error: localize('chenille.cancelled', "已取消") });
					return fullResponse;
				}

				console.log(`[ChenilleChatController] 调用 executeOneRound，消息数: ${messages.length}`);
				const roundResult = await this.executeOneRound(messages, tools, cts.token);
				console.log(`[ChenilleChatController] executeOneRound 返回，内容长度: ${roundResult.content.length}, 工具调用数: ${roundResult.toolCalls?.length ?? 0}`);

				fullResponse += roundResult.content;

				// 无工具调用，对话结束
				if (!roundResult.toolCalls?.length) {
					console.log('[ChenilleChatController] 无工具调用，对话结束');
					this._onChunk.fire({ done: true });
					return fullResponse;
				}

				// 执行工具调用
				toolRound++;
				console.log(`[ChenilleChatController] 执行工具调用，轮次: ${toolRound}`);
				await this.executeToolCalls(roundResult.toolCalls, messages, cts.token);
				console.log(`[ChenilleChatController] 工具调用完成，继续下一轮`);
			}

			// 超过最大轮次
			const error = localize('chenille.maxToolRounds', "工具调用轮次超过限制 ({0})", MAX_TOOL_ROUNDS);
			this._onChunk.fire({ done: true, error });
			return fullResponse;

		} finally {
			// 正确释放 CancellationTokenSource
			if (this._currentCts === cts) {
				this._currentCts = undefined;
			}
			cts.dispose();
		}
	}


	/**
	 * 执行一轮 AI 调用
	 */
	private async executeOneRound(
		messages: AiModelMessage[],
		tools: typeof CHENILLE_TOOLS | undefined,
		token: CancellationToken
	): Promise<{ content: string; toolCalls?: ToolCall[] }> {
		let content = '';
		let toolCalls: ToolCall[] | undefined;
		let streamError: Error | undefined;

		// 为每轮请求生成唯一 ID，用于过滤 IPC 事件
		const requestId = generateUuid();
		console.log(`[ChenilleChatController] executeOneRound 开始, requestId: ${requestId}`);

		// 使用 Promise 来等待流完成
		const streamPromise = new Promise<void>((resolve, reject) => {
			const disposable = this.aiService.onStreamChunk((chunk: IStreamChunkWithId) => {
				// 只处理属于当前请求的事件
				if (chunk.requestId !== requestId) {
					console.log(`[ChenilleChatController] 忽略其他请求的事件, 期望: ${requestId}, 收到: ${chunk.requestId}`);
					return;
				}

				if (token.isCancellationRequested) {
					return;
				}

				// 文本内容
				if (chunk.content) {
					content += chunk.content;
					this._onChunk.fire({ content: chunk.content, done: false });
				}

				// 推理内容
				if (chunk.reasoning) {
					this._onChunk.fire({ reasoning: chunk.reasoning, done: false });
				}

				// 工具调用
				if (chunk.function_call?.length) {
					console.log(`[ChenilleChatController] 收到工具调用: ${chunk.function_call.map(tc => tc.function.name).join(', ')}`);
					toolCalls = chunk.function_call;
					this._onChunk.fire({ toolCalls, done: false });
				}

				// 错误
				if (chunk.error) {
					console.log(`[ChenilleChatController] 收到错误: ${chunk.error}`);
					streamError = new Error(chunk.error);
				}

				// 完成
				if (chunk.done) {
					console.log(`[ChenilleChatController] 收到完成信号，requestId: ${requestId}, toolCalls: ${toolCalls?.length ?? 0}`);
					disposable.dispose();
					if (streamError) {
						reject(streamError);
					} else {
						resolve();
					}
				}
			});
		});

		// 发起请求并等待完成
		console.log(`[ChenilleChatController] 调用 aiService.streamChat, requestId: ${requestId}`);
		try {
			await this.aiService.streamChat({ requestId, messages, tools }, token);
			console.log(`[ChenilleChatController] aiService.streamChat Promise 完成, requestId: ${requestId}`);
		} catch (error) {
			console.log(`[ChenilleChatController] aiService.streamChat 错误: ${error}`);
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._onChunk.fire({ done: true, error: errorMessage });
			throw error;
		}

		// 等待流处理完成
		try {
			await streamPromise;
		} catch (error) {
			this._onChunk.fire({ done: true, error: error instanceof Error ? error.message : String(error) });
			throw error;
		}

		console.log(`[ChenilleChatController] executeOneRound 完成, requestId: ${requestId}, content: ${content.length}, toolCalls: ${toolCalls?.length ?? 0}`);
		return { content, toolCalls };
	}

	/**
	 * 执行工具调用并更新消息历史
	 */
	private async executeToolCalls(
		toolCalls: ToolCall[],
		messages: AiModelMessage[],
		token: CancellationToken
	): Promise<void> {
		// 添加 assistant 的工具调用消息
		const toolCallsDescription = toolCalls
			.map(tc => tc.function.name)
			.filter(Boolean)
			.join(', ');

		messages.push({
			role: 'assistant',
			content: `[调用工具: ${toolCallsDescription}]`,
		});

		// 执行每个工具
		for (const toolCall of toolCalls) {
			if (token.isCancellationRequested) {
				break;
			}

			const toolName = toolCall.function.name ?? 'unknown';

			try {
				const result = await this.toolDispatcher.dispatch(toolCall, token);

				// 发送工具结果事件
				this._onChunk.fire({
					toolResult: {
						toolName,
						success: result.success,
						result: result.content,
					},
					done: false,
				});

				// 添加工具结果到消息历史
				messages.push({
					role: 'user',
					content: this.formatToolResult(toolName, result),
				});

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				this._onChunk.fire({
					toolResult: {
						toolName,
						success: false,
						result: errorMessage,
					},
					done: false,
				});

				messages.push({
					role: 'user',
					content: this.formatToolError(toolName, errorMessage),
				});
			}
		}
	}

	/**
	 * 格式化工具执行结果
	 */
	private formatToolResult(toolName: string, result: IToolResult): string {
		if (result.success) {
			return `工具 "${toolName}" 执行成功:\n\`\`\`\n${result.content}\n\`\`\``;
		} else {
			return `工具 "${toolName}" 执行失败:\n错误: ${result.error}\n${result.content ? `输出:\n\`\`\`\n${result.content}\n\`\`\`` : ''}`;
		}
	}

	/**
	 * 格式化工具执行错误
	 */
	private formatToolError(toolName: string, error: string): string {
		return `工具 "${toolName}" 执行异常:\n错误: ${error}`;
	}
}
