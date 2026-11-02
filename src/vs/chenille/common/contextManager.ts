/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { TokenUsage } from './types.js';

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
	/** 收拢完成，等待创建新会话 */
	Completed = 'completed',
}

/**
 * 上下文收拢事件
 */
export interface IContextCollapseEvent {
	/** 当前状态 */
	state: ContextCollapseState;
	/** 当前 token 使用量 */
	currentTokens: number;
	/** 上下文大小限制 */
	contextSize: number;
	/** 使用百分比 */
	usagePercent: number;
	/** 收拢后的摘要（仅在 Completed 状态时有值） */
	summary?: string;
}

/**
 * 会话 token 统计
 */
export interface ISessionTokenStats {
	/** 会话 ID */
	sessionId: string;
	/** 累计输入 token */
	totalPromptTokens: number;
	/** 累计输出 token */
	totalCompletionTokens: number;
	/** 累计总 token */
	totalTokens: number;
	/** 上下文大小限制 */
	contextSize: number;
}

/**
 * 上下文管理器服务接口
 */
export const IChenilleContextManager = createDecorator<IChenilleContextManager>('chenilleContextManager');

export interface IChenilleContextManager {
	readonly _serviceBrand: undefined;

	/**
	 * 上下文收拢事件
	 */
	readonly onContextCollapse: Event<IContextCollapseEvent>;

	/**
	 * 初始化会话的 token 统计
	 */
	initSession(sessionId: string, contextSize: number): void;

	/**
	 * 更新会话的 token 使用量
	 * @returns 是否需要触发上下文收拢
	 */
	updateTokenUsage(sessionId: string, usage: TokenUsage): boolean;

	/**
	 * 获取会话的 token 统计
	 */
	getSessionStats(sessionId: string): ISessionTokenStats | undefined;

	/**
	 * 检查是否需要收拢上下文
	 */
	shouldCollapseContext(sessionId: string): boolean;

	/**
	 * 获取当前收拢状态
	 */
	getCollapseState(sessionId: string): ContextCollapseState;

	/**
	 * 设置收拢状态
	 */
	setCollapseState(sessionId: string, state: ContextCollapseState): void;

	/**
	 * 清理会话统计
	 */
	clearSession(sessionId: string): void;
}

/**
 * 上下文管理器实现
 */
export class ChenilleContextManager extends Disposable implements IChenilleContextManager {
	declare readonly _serviceBrand: undefined;

	/** 触发收拢的阈值（上下文使用百分比） */
	private static readonly COLLAPSE_THRESHOLD = 0.8; // 80%

	private readonly _onContextCollapse = this._register(new Emitter<IContextCollapseEvent>());
	readonly onContextCollapse: Event<IContextCollapseEvent> = this._onContextCollapse.event;

	/** 会话 token 统计 */
	private readonly _sessionStats = new Map<string, ISessionTokenStats>();

	/** 会话收拢状态 */
	private readonly _collapseStates = new Map<string, ContextCollapseState>();

	constructor() {
		super();
	}

	initSession(sessionId: string, contextSize: number): void {
		this._sessionStats.set(sessionId, {
			sessionId,
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalTokens: 0,
			contextSize,
		});
		this._collapseStates.set(sessionId, ContextCollapseState.Normal);
	}

	updateTokenUsage(sessionId: string, usage: TokenUsage): boolean {
		const stats = this._sessionStats.get(sessionId);
		if (!stats) {
			return false;
		}

		// 累加 token 使用量
		stats.totalPromptTokens += usage.promptTokens;
		stats.totalCompletionTokens += usage.completionTokens;
		stats.totalTokens += usage.totalTokens;

		// 检查是否需要收拢
		const shouldCollapse = this.shouldCollapseContext(sessionId);
		if (shouldCollapse && this.getCollapseState(sessionId) === ContextCollapseState.Normal) {
			this.setCollapseState(sessionId, ContextCollapseState.Pending);
			this._onContextCollapse.fire(this.createCollapseEvent(sessionId, ContextCollapseState.Pending));
		}

		return shouldCollapse;
	}

	getSessionStats(sessionId: string): ISessionTokenStats | undefined {
		return this._sessionStats.get(sessionId);
	}

	shouldCollapseContext(sessionId: string): boolean {
		const stats = this._sessionStats.get(sessionId);
		if (!stats) {
			return false;
		}

		const usagePercent = stats.totalTokens / stats.contextSize;
		return usagePercent >= ChenilleContextManager.COLLAPSE_THRESHOLD;
	}

	getCollapseState(sessionId: string): ContextCollapseState {
		return this._collapseStates.get(sessionId) ?? ContextCollapseState.Normal;
	}

	setCollapseState(sessionId: string, state: ContextCollapseState): void {
		this._collapseStates.set(sessionId, state);
	}

	clearSession(sessionId: string): void {
		this._sessionStats.delete(sessionId);
		this._collapseStates.delete(sessionId);
	}

	private createCollapseEvent(sessionId: string, state: ContextCollapseState, summary?: string): IContextCollapseEvent {
		const stats = this._sessionStats.get(sessionId);
		if (!stats) {
			return {
				state,
				currentTokens: 0,
				contextSize: 0,
				usagePercent: 0,
				summary,
			};
		}

		return {
			state,
			currentTokens: stats.totalTokens,
			contextSize: stats.contextSize,
			usagePercent: stats.totalTokens / stats.contextSize,
			summary,
		};
	}

	/**
	 * 触发收拢完成事件
	 */
	fireCollapseCompleted(sessionId: string, summary: string): void {
		this.setCollapseState(sessionId, ContextCollapseState.Completed);
		this._onContextCollapse.fire(this.createCollapseEvent(sessionId, ContextCollapseState.Completed, summary));
	}
}
