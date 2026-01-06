/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatService } from '../common/chatService.js';
import { IContextCollapseService, ContextCollapseState } from '../../../../chenille/browser/chat/contextCollapseService.js';
import { IChatModel } from '../common/chatModel.js';
import { ChatAgentLocation } from '../common/constants.js';
import { IChatWidgetService } from './chat.js';

/**
 * 上下文收拢贡献
 * 监听上下文收拢警告并处理收拢流程
 */
export class ChatContextCollapseContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatContextCollapse';

	/** 已显示警告的会话 ID 集合 */
	private readonly _warnedSessions = new Set<string>();

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IContextCollapseService private readonly contextCollapseService: IContextCollapseService,
		@IDialogService private readonly dialogService: IDialogService,
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

			await this.handleContextCollapseWarning(sessionId, usagePercent);
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
	 * 处理上下文收拢警告
	 */
	private async handleContextCollapseWarning(sessionId: string, usagePercent: number): Promise<void> {
		const percentText = (usagePercent * 100).toFixed(0);

		const result = await this.dialogService.confirm({
			type: 'warning',
			title: localize('contextCollapse.warningTitle', '上下文即将达到限制'),
			message: localize(
				'contextCollapse.warningMessage',
				'当前会话的上下文使用量已达 {0}%，即将达到模型的上下文限制。\n\n建议收拢上下文以继续对话。收拢后将创建新会话，并自动携带之前对话的摘要。',
				percentText
			),
			primaryButton: localize('contextCollapse.collapseButton', '收拢上下文'),
			cancelButton: localize('contextCollapse.laterButton', '稍后处理'),
		});

		if (result.confirmed) {
			await this.performContextCollapse(sessionId);
		}
	}

	/**
	 * 执行上下文收拢
	 */
	private async performContextCollapse(sessionId: string): Promise<void> {
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
			return;
		}

		// 构建对话历史文本
		const conversationHistory = this.buildConversationHistory(sessionModel);

		// 显示进度通知
		const progressNotification = this.notificationService.notify({
			severity: Severity.Info,
			message: localize('contextCollapse.collapsing', '正在收拢上下文...'),
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
		}
	}

	/**
	 * 构建对话历史文本
	 */
	private buildConversationHistory(model: IChatModel): string {
		const requests = model.getRequests();
		const parts: string[] = [];

		for (const request of requests) {
			// 用户消息
			parts.push(`用户: ${request.message.text}`);

			// AI 响应
			if (request.response) {
				const responseText = request.response.response.toString();
				parts.push(`助手: ${responseText}`);
			}
		}

		return parts.join('\n\n');
	}

	/**
	 * 创建新会话并发送收拢的上下文
	 */
	private async createNewSessionWithCollapsedContext(summary: string): Promise<void> {
		// 创建新会话
		const sessionRef = this.chatService.startSession(ChatAgentLocation.Chat);
		const newSession = sessionRef.object;

		// 构建收拢上下文消息
		const collapsedContextMessage = `${this.contextCollapseService.getCollapsedContextMarker()}\n\n${summary}`;

		// 发送收拢的上下文作为用户消息（这条消息会被标记为收拢上下文）
		await this.chatService.sendRequest(newSession.sessionResource, collapsedContextMessage, {
			// 可以添加特殊标记表示这是收拢的上下文
		});

		// 发送继续工作的消息
		await this.chatService.sendRequest(
			newSession.sessionResource,
			this.contextCollapseService.getContinueWorkMessage()
		);

		// 打开新会话
		const widget = await this.chatWidgetService.openSession(newSession.sessionResource);
		if (widget) {
			widget.focusInput();
		}

		this.notificationService.info(localize('contextCollapse.completed', '上下文已收拢，新会话已创建'));

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
