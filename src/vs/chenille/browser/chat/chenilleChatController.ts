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
import { AiModelMessage, AiToolCall, TokenUsage, AiMessageContent } from '../../common/types.js';
import { CHENILLE_TOOLS } from '../../tools/definitions.js';
import { IChenilleToolDispatcher, IToolResult } from '../../tools/dispatcher.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IChenilleChatModeService } from '../../common/chatMode.js';
import { IChenilleSessionContext } from '../../common/chatProvider.js';

/** 最大工具调用轮次（设置为较大值，实际上不限制） */
const MAX_TOOL_ROUNDS = 1000;

/** 聊天模式下的系统提示后缀 */
const CHAT_MODE_SYSTEM_SUFFIX = '\n\n[当前为聊天模式，请直接回答用户问题，不要尝试调用任何工具。]';

/**
 * Chat 响应块类型
 */
export interface IChenilleChatChunk {
	/** 文本内容增量 */
	content?: string;
	/** 推理内容增量 */
	reasoning?: string;
	/** 工具调用（完整列表，带 ID） */
	toolCalls?: AiToolCall[];
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
	/** Token 使用量（仅在 done=true 时有值） */
	usage?: TokenUsage;
}

/**
 * Chat 请求参数
 */
export interface IChenilleChatRequest {
	/** 用户输入 */
	input: string;
	/** 多模态内容（包含图片时使用，优先于 input） */
	multiContent?: AiMessageContent[];
	/** 历史消息（可选） */
	history?: AiModelMessage[];
	/** 系统提示词覆盖（可选） */
	systemPrompt?: string;
	/** 是否启用工具 */
	enableTools?: boolean;
	/** 会话上下文（用于工具内联确认） */
	sessionContext?: IChenilleSessionContext;
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
	 * 获取当前模型的上下文大小
	 */
	getContextSize(): Promise<number>;

	/**
	 * 获取当前模型是否支持图像分析
	 */
	supportsVision(): Promise<boolean>;

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
		@IChenilleChatModeService private readonly modeService: IChenilleChatModeService,
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

	async getContextSize(): Promise<number> {
		return this.aiService.getContextSize();
	}

	async supportsVision(): Promise<boolean> {
		return this.aiService.supportsVision();
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

		// 检查当前模式
		const isAgentMode = this.modeService.isAgentMode();
		const isChatMode = this.modeService.isChatMode();

		// 聊天模式下，在用户消息前添加模式提示
		if (isChatMode) {
			messages.push({
				role: 'system',
				content: CHAT_MODE_SYSTEM_SUFFIX.trim()
			});
		}

		// 添加历史消息
		if (request.history?.length) {
			messages.push(...request.history);
		}

		// 添加用户输入（支持多模态内容）
		if (request.multiContent && request.multiContent.length > 0) {
			messages.push({
				role: 'user',
				content: request.input,
				multiContent: request.multiContent
			});
		} else {
			messages.push({ role: 'user', content: request.input });
		}

		// 只有智能体模式才启用工具
		const tools = (isAgentMode && request.enableTools !== false) ? CHENILLE_TOOLS : undefined;
		let fullResponse = '';
		let toolRound = 0;
		// 累计 token 使用量
		let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

		try {
			// 工具调用循环（聊天模式下只执行一轮）
			while (toolRound < MAX_TOOL_ROUNDS) {
				// 估算上下文长度并在必要时压缩
				this.compressMessagesIfNeeded(messages);

				if (cts.token.isCancellationRequested) {
					this._onChunk.fire({ done: true, error: localize('chenille.cancelled', "已取消") });
					return fullResponse;
				}

				const roundResult = await this.executeOneRound(messages, tools, cts.token, request.systemPrompt);

				fullResponse += roundResult.content;

				// 累计 token 使用量
				if (roundResult.usage) {
					totalUsage.promptTokens += roundResult.usage.promptTokens;
					totalUsage.completionTokens += roundResult.usage.completionTokens;
					totalUsage.totalTokens += roundResult.usage.totalTokens;
				}

				// 无工具调用或聊天模式，对话结束
				if (!roundResult.toolCalls?.length || isChatMode) {
					this._onChunk.fire({ done: true, usage: totalUsage });
					return fullResponse;
				}

				// 有工具调用时，需要添加 assistant 消息来保持对话顺序
				// 包含 tool_calls 数组，这是 OpenAI API 要求的格式
				// 包含 reasoning_content，这是 DeepSeek 等模型要求的格式
				// 包含 reasoning_signature，这是 Anthropic thinking 模型要求的格式
				messages.push({
					role: 'assistant',
					content: roundResult.content || '',
					tool_calls: roundResult.toolCalls,
					reasoning_content: roundResult.reasoning,
					reasoning_signature: roundResult.reasoning_signature,
				});

				// 执行工具调用（仅智能体模式）
				toolRound++;
				await this.executeToolCalls(roundResult.toolCalls, messages, cts.token, request.sessionContext);
			}

			// 超过最大轮次
			const error = localize('chenille.maxToolRounds', "工具调用轮次超过限制 ({0})", MAX_TOOL_ROUNDS);
			this._onChunk.fire({ done: true, error, usage: totalUsage });
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
		token: CancellationToken,
		systemPrompt?: string
	): Promise<{ content: string; reasoning?: string; reasoning_signature?: string; toolCalls?: AiToolCall[]; usage?: TokenUsage }> {
		let content = '';
		let reasoning = '';
		let reasoning_signature = '';
		let toolCalls: AiToolCall[] | undefined;
		let usage: TokenUsage | undefined;
		let streamError: Error | undefined;

		// 为每轮请求生成唯一 ID，用于过滤 IPC 事件
		const requestId = generateUuid();

		// 使用 Promise 来等待流完成
		const streamPromise = new Promise<void>((resolve, reject) => {
			const disposable = this.aiService.onStreamChunk((chunk: IStreamChunkWithId) => {
				// 只处理属于当前请求的事件
				if (chunk.requestId !== requestId) {
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
					reasoning += chunk.reasoning;
					this._onChunk.fire({ reasoning: chunk.reasoning, done: false });
				}

				// 工具调用（可能同时包含累积的 reasoning 和 signature）
				if (chunk.tool_calls?.length) {
					toolCalls = chunk.tool_calls;
					// 工具调用 chunk 可能包含累积的 reasoning（DeepSeek 等模型）和 signature（Anthropic）
					if (chunk.reasoning && !reasoning) {
						reasoning = chunk.reasoning;
					}
					if (chunk.reasoning_signature) {
						reasoning_signature = chunk.reasoning_signature;
					}
					this._onChunk.fire({ toolCalls, done: false });
				}

				// 错误
				if (chunk.error) {
					streamError = new Error(chunk.error);
				}

				// Token 使用量（在 done 时返回）
				if (chunk.usage) {
					usage = chunk.usage;
				}

				// 完成
				if (chunk.done) {
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
		try {
			await this.aiService.streamChat({ requestId, messages, tools, systemPrompt }, token);
		} catch (error) {
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

		return { content, reasoning: reasoning || undefined, reasoning_signature: reasoning_signature || undefined, toolCalls, usage };
	}

	/**
	 * 执行工具调用并更新消息历史
	 */
	private async executeToolCalls(
		toolCalls: AiToolCall[],
		messages: AiModelMessage[],
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<void> {
		// 执行每个工具
		for (const toolCall of toolCalls) {
			if (token.isCancellationRequested) {
				// 取消时也要告诉 AI（使用 tool 角色）
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: '[工具执行已取消]',
				});
				break;
			}

			const toolName = toolCall.function.name ?? 'unknown';

			try {
				// 将 AiToolCall 转换为 ToolCall 格式供 dispatcher 使用
				const dispatchToolCall = {
					type: 'function' as const,
					function: toolCall.function,
				};
				const result = await this.toolDispatcher.dispatch(dispatchToolCall, token, sessionContext);

				// 发送工具结果事件
				this._onChunk.fire({
					toolResult: {
						toolName,
						success: result.success,
						result: result.content,
					},
					done: false,
				});

				// 添加工具结果到消息历史（使用 tool 角色和 tool_call_id）
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: this.formatToolResultContent(toolName, result),
				});

			} catch (error) {
				// 捕获所有异常，确保不会中断工作流
				const errorMessage = error instanceof Error ? error.message : String(error);

				this._onChunk.fire({
					toolResult: {
						toolName,
						success: false,
						result: errorMessage,
					},
					done: false,
				});

				// 将错误信息添加到消息历史（使用 tool 角色和 tool_call_id）
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: this.formatToolErrorContent(toolName, errorMessage),
				});

				// 继续执行下一个工具，不中断
			}
		}
	}

	/**
	 * 格式化工具执行结果内容（用于 tool 消息）
	 */
	private formatToolResultContent(toolName: string, result: IToolResult): string {
		// 限制工具结果长度，避免上下文过长
		const MAX_RESULT_LENGTH = 8000;
		let content = result.content;

		if (content.length > MAX_RESULT_LENGTH) {
			content = content.substring(0, MAX_RESULT_LENGTH) + `\n\n[结果已截断，原始长度: ${result.content.length} 字符]`;
		}

		if (result.success) {
			// 确保返回非空内容
			return content || `工具 "${toolName}" 执行成功`;
		} else {
			return `错误: ${result.error}${content ? `\n${content}` : ''}`;
		}
	}

	/**
	 * 格式化工具执行错误内容（用于 tool 消息）
	 */
	private formatToolErrorContent(toolName: string, error: string): string {
		return `工具 "${toolName}" 执行异常: ${error}`;
	}

	/**
	 * 估算消息的 token 数量（粗略估算：1 token ≈ 4 字符）
	 */
	private estimateTokens(messages: AiModelMessage[]): number {
		let totalChars = 0;
		for (const msg of messages) {
			totalChars += msg.content.length;
		}
		return Math.ceil(totalChars / 4);
	}

	/**
	 * 压缩消息历史以避免上下文过长
	 * 策略：保留第一条用户消息和最近的消息，压缩中间的工具结果
	 */
	private compressMessagesIfNeeded(messages: AiModelMessage[]): void {
		const MAX_CONTEXT_TOKENS = 60000; // 保守估计，留出空间给响应
		const MAX_SINGLE_MESSAGE_CHARS = 6000; // 单条消息最大字符数

		let estimatedTokens = this.estimateTokens(messages);

		// 如果上下文不太长，不需要压缩
		if (estimatedTokens < MAX_CONTEXT_TOKENS) {
			return;
		}

		// 压缩策略：截断过长的单条消息（主要是工具结果）
		for (let i = 1; i < messages.length - 2; i++) { // 保留第一条和最后两条
			const msg = messages[i];
			if (msg.content.length > MAX_SINGLE_MESSAGE_CHARS) {
				// 截断并添加提示
				const truncated = msg.content.substring(0, MAX_SINGLE_MESSAGE_CHARS);
				messages[i] = {
					...msg,
					content: truncated + `\n\n[消息已压缩，原始长度: ${msg.content.length} 字符]`
				};
			}
		}

		// 重新估算
		estimatedTokens = this.estimateTokens(messages);

		// 如果仍然过长，删除中间的一些消息
		if (estimatedTokens > MAX_CONTEXT_TOKENS && messages.length > 6) {
			// 保留前 2 条和后 4 条，删除中间的
			const keepStart = 2;
			const keepEnd = 4;
			const toRemove = messages.length - keepStart - keepEnd;

			if (toRemove > 0) {
				const removed = messages.splice(keepStart, toRemove);
				// 插入一条摘要消息
				messages.splice(keepStart, 0, {
					role: 'user',
					content: `[已省略 ${removed.length} 条中间消息以节省上下文空间]`
				});
			}
		}
	}
}
