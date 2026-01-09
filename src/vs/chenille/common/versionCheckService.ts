/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';

/**
 * 版本更新信息
 */
export interface IVersionUpdateInfo {
	name: string;
	code: number;
	content: string;
	url: string;
}

export const IChenilleVersionCheckService = createDecorator<IChenilleVersionCheckService>('chenilleVersionCheckService');

export interface IChenilleVersionCheckService {
	readonly _serviceBrand: undefined;

	/**
	 * 发现新版本时触发
	 */
	readonly onUpdateAvailable: Event<IVersionUpdateInfo>;

	/**
	 * 手动检查更新
	 */
	checkForUpdates(): Promise<IVersionUpdateInfo | null>;
}

export const ChenilleVersionCheckChannelName = 'chenilleVersionCheck';

/**
 * IPC Channel 客户端（渲染进程使用）
 */
export class ChenilleVersionCheckChannelClient implements IChenilleVersionCheckService {
	declare readonly _serviceBrand: undefined;

	readonly onUpdateAvailable: Event<IVersionUpdateInfo>;

	constructor(private readonly channel: IChannel) {
		this.onUpdateAvailable = this.channel.listen<IVersionUpdateInfo>('onUpdateAvailable');
	}

	checkForUpdates(): Promise<IVersionUpdateInfo | null> {
		return this.channel.call('checkForUpdates');
	}
}

/**
 * IPC Channel 服务端（主进程使用）
 */
export class ChenilleVersionCheckChannel implements IServerChannel<string> {
	constructor(private readonly service: IChenilleVersionCheckService) { }

	listen<T>(_ctx: string, event: string): Event<T> {
		switch (event) {
			case 'onUpdateAvailable':
				return this.service.onUpdateAvailable as Event<T>;
			default:
				throw new Error(`Unknown event: ${event}`);
		}
	}

	call<T>(_ctx: string, command: string): Promise<T> {
		switch (command) {
			case 'checkForUpdates':
				return this.service.checkForUpdates() as Promise<T>;
			default:
				throw new Error(`Unknown command: ${command}`);
		}
	}
}
