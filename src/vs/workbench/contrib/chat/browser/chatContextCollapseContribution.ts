/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatService } from '../common/chatService.js';
import { IContextCollapseService, ContextCollapseState } from '../../../../chenille/browser/chat/contextCollapseService.js';
import { IChatModel } from '../common/chatModel.js';
import { ChatAgentLocation } from '../common/constants.js';
import { ChatViewPaneTarget, IChatWidgetService } from './chat.js';
import { ChatContextCollapseWidget } from './chatContextCollapseWidget.js';

/**
 * 上下文收拢贡献
 * 监听上下文收拢警告并显示内联警告卡片（不污染会话上下文）
 */
export class ChatContextCollapseContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatContextCollapse';

	/** 已显示警告的会话 ID 集合 */
	private readonly _warnedSessions = new Set<string>();

	/** 当前正在收拢的会话 */
	private _collapsingSessionId: string | undefined;

	/** 当前显示的警告 widget */
	private readonly _warningWidget = this._register(new MutableDisposable<ChatContextCollapseWidget>());

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
	 * 显示上下文收拢警告卡片（不污染会话上下文）
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

		// 创建警告卡片（显示在聊天面板中，但不添加到会话历史）
		this._warningWidget.value = new ChatContextCollapseWidget(widget.domNode, usagePercent);

		// 监听用户操作
		this._warningWidget.value.onDidAccept(() => {
			this.performContextCollapse(sessionId);
		});

		this._warningWidget.value.onDidDismiss(() => {
			// 用户选择稍后处理，清理 widget
			this._warningWidget.clear();
		});

		this._warningWidget.value.show();
	}

	/**
	 * 执行上下文收拢
	 */
	private async performContextCollapse(sessionId: string): Promise<void> {
		if (this._collapsingSessionId === sessionId) {
			return; // 避免重复收拢
		}
		this._collapsingSessionId = sessionId;

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

// 注册贡献
registerWorkbenchContribution2(
	ChatContextCollapseContribution.ID,
	ChatContextCollapseContribution,
	WorkbenchPhase.AfterRestored
);
