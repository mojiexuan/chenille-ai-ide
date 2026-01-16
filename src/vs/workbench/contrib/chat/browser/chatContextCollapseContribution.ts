/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { localize } from '../../../../nls.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatService } from '../common/chatService.js';
import { IContextCollapseService, ContextCollapseState } from '../../../../chenille/browser/chat/contextCollapseService.js';
import { IChatModel } from '../common/chatModel.js';
import { ChatAgentLocation } from '../common/constants.js';
import { ChatViewPaneTarget, IChatWidgetService } from './chat.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

/** 上下文收拢命令 ID */
const CONTEXT_COLLAPSE_COMMAND_ID = 'chenille.contextCollapse';
const CONTEXT_COLLAPSE_DISMISS_COMMAND_ID = 'chenille.contextCollapse.dismiss';

/**
 * 上下文收拢贡献
 * 监听上下文收拢警告并在消息气泡中显示警告
 */
export class ChatContextCollapseContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatContextCollapse';

	/** 已显示警告的会话 ID 集合 */
	private readonly _warnedSessions = new Set<string>();

	/** 当前正在收拢的会话 */
	private _collapsingSessionId: string | undefined;

	/** 待处理的收拢请求（sessionId -> usagePercent） */
	private static readonly _pendingCollapseRequests = new Map<string, number>();

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IContextCollapseService private readonly contextCollapseService: IContextCollapseService,
		@INotificationService private readonly notificationService: INotificationService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super();

		// 监听上下文收拢警告
		this._register(this.chatService.onContextCollapseWarning(async ({ sessionId, usagePercent }) => {
			// 避免重复警告
			if (this._warnedSessions.has(sessionId)) {
				return;
			}
			this._warnedSessions.add(sessionId);

			// 保存待处理的请求
			ChatContextCollapseContribution._pendingCollapseRequests.set(sessionId, usagePercent);

			await this.showContextCollapseWarning(sessionId, usagePercent);
		}));

		// 监听收拢服务事件
		this._register(this.contextCollapseService.onContextCollapse(event => {
			if (event.state === ContextCollapseState.Completed && event.summary) {
				this.handleCollapseCompleted(event.sessionId, event.summary);
			} else if (event.error) {
				this.notificationService.error(event.error);
			}
		}));
	}

	/**
	 * 获取待处理的收拢请求
	 */
	static getPendingRequest(sessionId: string): number | undefined {
		return ChatContextCollapseContribution._pendingCollapseRequests.get(sessionId);
	}

	/**
	 * 清除待处理的收拢请求
	 */
	static clearPendingRequest(sessionId: string): void {
		ChatContextCollapseContribution._pendingCollapseRequests.delete(sessionId);
	}

	/**
	 * 显示上下文收拢警告（在消息气泡中）
	 */
	private async showContextCollapseWarning(sessionId: string, usagePercent: number): Promise<void> {
		// 获取当前聊天 widget
		const widget = this.chatWidgetService.lastFocusedWidget ?? await this.chatWidgetService.revealWidget();
		if (!widget || !widget.viewModel) {
			return;
		}

		// 检查是否是当前会话
		if (widget.viewModel.model.sessionId !== sessionId) {
			return;
		}

		const percentText = (usagePercent * 100).toFixed(0);

		// 创建带命令链接的警告消息
		const warningMessage = new MarkdownString('', { isTrusted: { enabledCommands: [CONTEXT_COLLAPSE_COMMAND_ID, CONTEXT_COLLAPSE_DISMISS_COMMAND_ID] } });
		warningMessage.appendMarkdown(`### ⚠️ ${localize('contextCollapse.warningTitle', '上下文即将达到限制')}\n\n`);
		warningMessage.appendMarkdown(localize(
			'contextCollapse.warningMessage',
			'当前会话的上下文使用量已达 **{0}%**，即将达到模型的上下文限制。建议收拢上下文以继续对话。',
			percentText
		));
		warningMessage.appendMarkdown('\n\n');
		warningMessage.appendMarkdown(`[📦 ${localize('contextCollapse.collapseButton', '收拢上下文')}](command:${CONTEXT_COLLAPSE_COMMAND_ID}?${encodeURIComponent(JSON.stringify({ sessionId }))})`);
		warningMessage.appendMarkdown('&nbsp;&nbsp;&nbsp;');
		warningMessage.appendMarkdown(`[${localize('contextCollapse.laterButton', '稍后处理')}](command:${CONTEXT_COLLAPSE_DISMISS_COMMAND_ID}?${encodeURIComponent(JSON.stringify({ sessionId }))})`);

		// 获取最后一个请求并添加警告
		const requests = widget.viewModel.model.getRequests();
		const lastRequest = requests[requests.length - 1];
		if (lastRequest?.response) {
			// 使用 appendProgress 添加警告到响应中
			this.chatService.appendProgress(lastRequest, {
				kind: 'warning',
				content: warningMessage
			});
		}
	}

	/**
	 * 执行上下文收拢
	 */
	async performContextCollapse(sessionId: string): Promise<void> {
		if (this._collapsingSessionId === sessionId) {
			return; // 避免重复收拢
		}
		this._collapsingSessionId = sessionId;

		// 清除待处理的请求
		ChatContextCollapseContribution.clearPendingRequest(sessionId);

		// 获取会话模型
		const models = this.chatService.chatModels.get();
		let sessionModel: IChatModel | undefined;
		for (const model of models) {
			if (model.sessionId === sessionId) {
				sessionModel = model;
				break;
			}
		}

		if (!sessionModel) {
			this.notificationService.error(localize('contextCollapse.sessionNotFound', '找不到会话'));
			this._collapsingSessionId = undefined;
			return;
		}

		// 构建对话历史文本
		const conversationHistory = this.buildConversationHistory(sessionModel);

		// 显示进度通知
		const progressNotification = this.notificationService.notify({
			severity: Severity.Info,
			message: localize('contextCollapse.collapsing', '⏳ 正在收拢上下文，请稍候...'),
			progress: { infinite: true },
		});

		try {
			// 调用收拢服务
			const summary = await this.contextCollapseService.collapseContext(sessionId, conversationHistory);

			progressNotification.close();

			// 创建新会话并发送收拢的上下文
			await this.createNewSessionWithCollapsedContext(summary);

		} catch (error) {
			progressNotification.close();
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(localize('contextCollapse.error', '上下文收拢失败: {0}', errorMessage));
		} finally {
			this._collapsingSessionId = undefined;
		}
	}

	/**
	 * 忽略上下文收拢警告
	 */
	dismissWarning(sessionId: string): void {
		ChatContextCollapseContribution.clearPendingRequest(sessionId);
		this.notificationService.info(localize('contextCollapse.dismissed', '已忽略上下文收拢警告，您可以继续对话。'));
	}

	/**
	 * 构建对话历史文本
	 */
	private buildConversationHistory(model: IChatModel): string {
		const requests = model.getRequests();
		const parts: string[] = [];

		for (const request of requests) {
			// 跳过空消息和确认相关的消息
			if (!request.message.text || request.message.text.trim() === '') {
				continue;
			}

			// 用户消息
			parts.push(`用户: ${request.message.text}`);

			// AI 响应
			if (request.response) {
				const responseText = request.response.response.toString();
				if (responseText && responseText.trim() !== '') {
					parts.push(`助手: ${responseText}`);
				}
			}
		}

		return parts.join('\n\n');
	}

	/**
	 * 创建新会话并注入收拢的上下文（作为系统上下文，不作为用户消息）
	 */
	private async createNewSessionWithCollapsedContext(summary: string): Promise<void> {
		// 创建新会话
		const sessionRef = this.chatService.startSession(ChatAgentLocation.Chat);
		const newSession = sessionRef.object;

		// 在右侧聊天面板中打开新会话
		const widget = await this.chatWidgetService.openSession(newSession.sessionResource, ChatViewPaneTarget);
		if (widget) {
			widget.focusInput();

			// 设置输入框的初始内容，提示用户可以继续
			const collapsedContextHint = this.contextCollapseService.getCollapsedContextMarker();
			widget.setInput(`${collapsedContextHint}\n\n${summary}\n\n---\n\n请继续之前的工作。`);
		}

		this.notificationService.notify({
			severity: Severity.Info,
			message: localize('contextCollapse.completed', '✅ 上下文已收拢，新会话已创建。摘要已填入输入框，请检查后发送。'),
		});

		// 释放会话引用
		sessionRef.dispose();
	}

	/**
	 * 处理收拢完成
	 */
	private handleCollapseCompleted(sessionId: string, _summary: string): void {
		// 清理警告记录
		this._warnedSessions.delete(sessionId);
	}
}

// 注册上下文收拢命令
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CONTEXT_COLLAPSE_COMMAND_ID,
			title: localize('contextCollapse.command', '收拢上下文'),
		});
	}

	async run(accessor: ServicesAccessor, args: { sessionId: string }): Promise<void> {
		const chatService = accessor.get(IChatService);
		const contextCollapseService = accessor.get(IContextCollapseService);
		const notificationService = accessor.get(INotificationService);
		const chatWidgetService = accessor.get(IChatWidgetService);

		const sessionId = args?.sessionId;
		if (!sessionId) {
			return;
		}

		// 创建一个临时的贡献实例来执行收拢
		const contribution = new ChatContextCollapseContribution(
			chatService,
			contextCollapseService,
			notificationService,
			chatWidgetService
		);

		try {
			await contribution.performContextCollapse(sessionId);
		} finally {
			contribution.dispose();
		}
	}
});

// 注册忽略警告命令
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CONTEXT_COLLAPSE_DISMISS_COMMAND_ID,
			title: localize('contextCollapse.dismiss', '忽略上下文收拢警告'),
		});
	}

	run(accessor: ServicesAccessor, args: { sessionId: string }): void {
		const notificationService = accessor.get(INotificationService);

		const sessionId = args?.sessionId;
		if (!sessionId) {
			return;
		}

		ChatContextCollapseContribution.clearPendingRequest(sessionId);
		notificationService.info(localize('contextCollapse.dismissed', '已忽略上下文收拢警告，您可以继续对话。'));
	}
});

// 注册贡献
registerWorkbenchContribution2(
	ChatContextCollapseContribution.ID,
	ChatContextCollapseContribution,
	WorkbenchPhase.AfterRestored
);
