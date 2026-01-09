/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IChenilleChatController, IChenilleChatRequest } from './chenilleChatController.js';
import { CONTEXT_COLLAPSE_SYSTEM_PROMPT, createCollapseRequestMessage, CONTINUE_WORK_MESSAGE, COLLAPSED_CONTEXT_MARKER } from '../../common/contextCollapsePrompt.js';
import { localize } from '../../../nls.js';

/**
 * 上下文收拢状态
 */
export enum ContextCollapseState {
	/** 正常状态 */
	Normal = 'normal',
	/** 即将达到限制，准备收拢 */
	Pending = 'pending',
	/** 正在收拢中 */
	Collapsing = 'collapsing',
	/** 收拢完成 */
	Completed = 'completed',
}

/**
 * 上下文收拢事件
 */
export interface IContextCollapseEvent {
	/** 会话 ID */
	sessionId: string;
	/** 当前状态 */
	state: ContextCollapseState;
	/** 使用百分比 */
	usagePercent: number;
	/** 收拢后的摘要（仅在 Completed 状态时有值） */
	summary?: string;
	/** 错误信息 */
	error?: string;
}

/**
 * 上下文收拢服务接口
 */
export const IContextCollapseService = createDecorator<IContextCollapseService>('contextCollapseService');

export interface IContextCollapseService {
	readonly _serviceBrand: undefined;

	/**
	 * 上下文收拢事件
	 */
	readonly onContextCollapse: Event<IContextCollapseEvent>;

	/**
	 * 获取会话的收拢状态
	 */
	getCollapseState(sessionId: string): ContextCollapseState;

	/**
	 * 触发上下文收拢警告
	 */
	triggerCollapseWarning(sessionId: string, usagePercent: number): void;

	/**
	 * 执行上下文收拢
	 * @param sessionId 会话 ID
	 * @param conversationHistory 对话历史文本
	 * @returns 收拢后的摘要
	 */
	collapseContext(sessionId: string, conversationHistory: string): Promise<string>;

	/**
	 * 获取收拢后的上下文标记
	 */
	getCollapsedContextMarker(): string;

	/**
	 * 获取继续工作的消息
	 */
	getContinueWorkMessage(): string;
}

/**
 * 上下文收拢服务实现
 */
export class ContextCollapseService extends Disposable implements IContextCollapseService {
	declare readonly _serviceBrand: undefined;

	private readonly _onContextCollapse = this._register(new Emitter<IContextCollapseEvent>());
	readonly onContextCollapse: Event<IContextCollapseEvent> = this._onContextCollapse.event;

	/** 会话收拢状态 */
	private readonly _collapseStates = new Map<string, ContextCollapseState>();

	constructor(
		@IChenilleChatController private readonly chatController: IChenilleChatController,
	) {
		super();
	}

	getCollapseState(sessionId: string): ContextCollapseState {
		return this._collapseStates.get(sessionId) ?? ContextCollapseState.Normal;
	}

	triggerCollapseWarning(sessionId: string, usagePercent: number): void {
		const currentState = this.getCollapseState(sessionId);
		if (currentState === ContextCollapseState.Normal) {
			this._collapseStates.set(sessionId, ContextCollapseState.Pending);
			this._onContextCollapse.fire({
				sessionId,
				state: ContextCollapseState.Pending,
				usagePercent,
			});
		}
	}

	async collapseContext(sessionId: string, conversationHistory: string): Promise<string> {
		// 设置状态为收拢中
		this._collapseStates.set(sessionId, ContextCollapseState.Collapsing);
		this._onContextCollapse.fire({
			sessionId,
			state: ContextCollapseState.Collapsing,
			usagePercent: 1,
		});

		try {
			// 构建收拢请求
			const request: IChenilleChatRequest = {
				input: createCollapseRequestMessage(conversationHistory),
				systemPrompt: CONTEXT_COLLAPSE_SYSTEM_PROMPT,
				enableTools: false, // 收拢时不需要工具
			};

			// 调用 AI 生成摘要
			const summary = await this.chatController.chat(request);

			// 设置状态为完成
			this._collapseStates.set(sessionId, ContextCollapseState.Completed);
			this._onContextCollapse.fire({
				sessionId,
				state: ContextCollapseState.Completed,
				usagePercent: 1,
				summary,
			});

			return summary;

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// 恢复状态
			this._collapseStates.set(sessionId, ContextCollapseState.Pending);
			this._onContextCollapse.fire({
				sessionId,
				state: ContextCollapseState.Pending,
				usagePercent: 1,
				error: localize('contextCollapse.error', "上下文收拢失败: {0}", errorMessage),
			});

			throw error;
		}
	}

	getCollapsedContextMarker(): string {
		return COLLAPSED_CONTEXT_MARKER;
	}

	getContinueWorkMessage(): string {
		return CONTINUE_WORK_MESSAGE;
	}
}
