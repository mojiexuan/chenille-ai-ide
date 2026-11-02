/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { localize } from '../../nls.js';

/**
 * Chenille 聊天模式
 */
export enum ChenilleChatMode {
	/** 智能体模式：可以调用工具 */
	Agent = 'agent',
	/** 聊天模式：纯对话，不调用工具 */
	Chat = 'chat',
}

/**
 * 模式信息
 */
export interface IChenilleChatModeInfo {
	readonly id: ChenilleChatMode;
	readonly label: string;
	readonly description: string;
}

/**
 * Chenille 聊天模式服务接口
 */
export const IChenilleChatModeService = createDecorator<IChenilleChatModeService>('chenilleChatModeService');

export interface IChenilleChatModeService {
	readonly _serviceBrand: undefined;

	/** 模式变化事件 */
	readonly onDidChangeMode: Event<ChenilleChatMode>;

	/** 获取当前模式 */
	getCurrentMode(): ChenilleChatMode;

	/** 设置当前模式 */
	setMode(mode: ChenilleChatMode): void;

	/** 获取所有可用模式 */
	getModes(): readonly IChenilleChatModeInfo[];

	/** 当前是否为智能体模式 */
	isAgentMode(): boolean;

	/** 当前是否为聊天模式 */
	isChatMode(): boolean;
}

const STORAGE_KEY = 'chenille.chatMode';

/**
 * Chenille 聊天模式服务实现
 */
export class ChenilleChatModeService extends Disposable implements IChenilleChatModeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMode = this._register(new Emitter<ChenilleChatMode>());
	readonly onDidChangeMode = this._onDidChangeMode.event;

	private _currentMode: ChenilleChatMode;

	private readonly _modes: readonly IChenilleChatModeInfo[] = [
		{
			id: ChenilleChatMode.Agent,
			label: localize('chenille.mode.agent', "智能体"),
			description: localize('chenille.mode.agent.desc', "可以调用工具完成复杂任务"),
		},
		{
			id: ChenilleChatMode.Chat,
			label: localize('chenille.mode.chat', "聊天"),
			description: localize('chenille.mode.chat.desc', "纯对话模式，不调用任何工具"),
		},
	];

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// 从存储中恢复模式，默认为智能体模式
		const savedMode = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		this._currentMode = this.isValidMode(savedMode) ? savedMode : ChenilleChatMode.Agent;
	}

	private isValidMode(mode: string | undefined): mode is ChenilleChatMode {
		return mode === ChenilleChatMode.Agent || mode === ChenilleChatMode.Chat;
	}

	getCurrentMode(): ChenilleChatMode {
		return this._currentMode;
	}

	setMode(mode: ChenilleChatMode): void {
		if (this._currentMode !== mode) {
			this._currentMode = mode;
			this.storageService.store(STORAGE_KEY, mode, StorageScope.WORKSPACE, StorageTarget.USER);
			this._onDidChangeMode.fire(mode);
		}
	}

	getModes(): readonly IChenilleChatModeInfo[] {
		return this._modes;
	}

	isAgentMode(): boolean {
		return this._currentMode === ChenilleChatMode.Agent;
	}

	isChatMode(): boolean {
		return this._currentMode === ChenilleChatMode.Chat;
	}
}
