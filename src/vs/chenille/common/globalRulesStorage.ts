/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { Event } from '../../base/common/event.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';

/**
 * 全局规则配置
 */
export interface IGlobalRulesConfig {
	/** 规则内容（Markdown 格式） */
	content: string;
	/** 是否启用 */
	enabled: boolean;
	/** 最大字数限制 */
	maxLength: number;
}

/** 默认最大字数 */
export const DEFAULT_MAX_LENGTH = 10000;

/** 默认全局规则配置 */
export const DEFAULT_GLOBAL_RULES: IGlobalRulesConfig = {
	content: '',
	enabled: false,
	maxLength: DEFAULT_MAX_LENGTH,
};

// ============ Global Rules Storage IPC ============

export const IGlobalRulesStorageService = createDecorator<IGlobalRulesStorageService>('globalRulesStorageService');

export interface IGlobalRulesStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeRules: Event<void>;

	/**
	 * 获取全局规则配置
	 */
	get(): Promise<IGlobalRulesConfig>;

	/**
	 * 保存全局规则配置
	 */
	save(config: IGlobalRulesConfig): Promise<void>;
}

export const GlobalRulesStorageChannelName = 'chenille.globalRulesStorage';

export class GlobalRulesStorageChannel implements IServerChannel {
	constructor(private readonly service: IGlobalRulesStorageService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onDidChangeRules': return this.service.onDidChangeRules as Event<T>;
		}
		throw new Error(`No event: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'get': return this.service.get() as Promise<T>;
			case 'save': return this.service.save(args?.[0] as IGlobalRulesConfig) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class GlobalRulesStorageChannelClient implements IGlobalRulesStorageService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeRules: Event<void>;

	constructor(private readonly channel: IChannel) {
		this.onDidChangeRules = this.channel.listen<void>('onDidChangeRules');
	}

	get(): Promise<IGlobalRulesConfig> {
		return this.channel.call('get');
	}

	save(config: IGlobalRulesConfig): Promise<void> {
		return this.channel.call('save', [config]);
	}
}
