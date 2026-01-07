/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatConfirmation, IChatProgress, IChatService } from '../common/chatService.js';
import { IContextCollapseService, ContextCollapseState } from '../../../../chenille/browser/chat/contextCollapseService.js';
import { IChatModel } from '../common/chatModel.js';
import { ChatAgentLocation } from '../common/constants.js';
import { ChatViewPaneTarget, IChatWidgetService } from './chat.js';

/**
 * 上下文收拢确认数据
 */
interface IContextCollapseConfirmationData {
	sessionId: string;
	usagePercent: number;
}

/**
 * 上下文收拢贡献
 * 监听上下文收拢警告并在聊天面板显示确认框
 */
export class ChatContextCollapseContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatContextCollapse';

	/** 已显示警告的会话 ID 集合 */
	private readonly _warnedSessions = new Set<string>();

	/** 当前正在收拢的会话 */
	private _collapsingSessionId: string | undefined;

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

			await this.showContextCollapseConfirmation(sessionId, usagePercent);
		}));

		// 监听收拢服务事件
		this._register(this.contextCollapseService.onContextCollapse(event => {
			if (event.state === ContextCollapseState.Completed && event.summary) {
				this.handleCollapseCompleted(event.sessionId, event.summary);
			} else if (event.error) {
				this.notificationService.error(event.error);
			}
		}));

		// 监听确认框的响应
		this._register(this.chatService.onDidSubmitRequest(async (e) => {
			// 检查是否是确认框的响应
			const options = e as unknown as { acceptedConfirmationData?: IContextCollapseConfirmationData[]; rejectedConfirmationData?: IContextCollapseConfirmationData[] };

			if (options.acceptedConfirmationData?.length) {
				for (const data of options.acceptedConfirmationData) {
					if (data.sessionId && data.usagePercent !== undefined) {
						// 用户点击了"收拢上下文"按钮
						await this.performContextCollapse(data.sessionId);
					}
				}
			}
		}));
	}

	/**
	 * 显示上下文收拢确认框
	 */
	private async showContextCollapseConfirmation(sessionId: string, usagePercent: number): Promise<void> {
		const percentText = (usagePercent * 100).toFixed(0);

		// 获取当前聊天 widget
		const widget = this.chatWidgetService.lastFocusedWidget ?? await this.chatWidgetService.revealWidget();
		if (!widget || !widget.viewModel) {
			return;
		}

		// 检查是否是当前会话
		if (widget.viewModel.model.sessionId !== sessionId) {
			return;
		}

		// 创建确认框内容
		const confirmationData: IContextCollapseConfirmationData = {
			sessionId,
			usagePercent,
		};

		const confirmation: IChatConfirmation = {
			kind: 'confirmation',
			title: localize('contextCollapse.confirmTitle', '⚠️ 上下文即将达到限制'),
			message: localize(
				'contextCollapse.confirmMessage',
				'当前会话的上下文使用量已达 {0}%，即将达到模型的上下文限制。\n\n建议收拢上下文以继续对话。收拢后将创建新会话，并自动携带之前对话的摘要。',
				percentText
			),
			data: confirmationData,
			buttons: [
				localize('contextCollapse.collapseButton', '📦 收拢上下文'),
				localize('contextCollapse.laterButton', '稍后处理'),
			],
		};

		// 通过 addCompleteRequest 添加包含确认框的响应
		const progressContent: IChatProgress[] = [confirmation];

		await this.chatService.addCompleteRequest(
			widget.viewModel.sessionResource,
			'', // 空的用户消息
			undefined,
			0,
			{
				message: progressContent,
			}
		);
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
	 * 创建新会话并发送收拢的上下文
	 */
	private async createNewSessionWithCollapsedContext(summary: string): Promise<void> {
		// 创建新会话
		const sessionRef = this.chatService.startSession(ChatAgentLocation.Chat);
		const newSession = sessionRef.object;

		// 构建收拢上下文消息 - 显示为折叠块
		const collapsedContextMessage = `${this.contextCollapseService.getCollapsedContextMarker()}\n\n${summary}`;

		// 发送收拢的上下文作为用户消息
		await this.chatService.sendRequest(newSession.sessionResource, collapsedContextMessage, {});

		// 发送继续工作的消息
		await this.chatService.sendRequest(
			newSession.sessionResource,
			this.contextCollapseService.getContinueWorkMessage()
		);

		// 在右侧聊天面板中打开新会话（使用 ChatViewPaneTarget）
		const widget = await this.chatWidgetService.openSession(newSession.sessionResource, ChatViewPaneTarget);
		if (widget) {
			widget.focusInput();
		}

		this.notificationService.notify({
			severity: Severity.Info,
			message: localize('contextCollapse.completed', '✅ 上下文已收拢，新会话已创建'),
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
