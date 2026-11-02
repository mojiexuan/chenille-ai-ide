/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { Emitter, Event } from '../../base/common/event.js';
import { IChenilleVersionCheckService, IVersionUpdateInfo } from '../common/versionCheckService.js';
import { config } from '../common/config.js';

/**
 * 版本检查服务（主进程实现）
 */
export class ChenilleVersionCheckMainService extends Disposable implements IChenilleVersionCheckService {
	declare readonly _serviceBrand: undefined;

	private readonly _onUpdateAvailable = this._register(new Emitter<IVersionUpdateInfo>());
	readonly onUpdateAvailable: Event<IVersionUpdateInfo> = this._onUpdateAvailable.event;

	constructor() {
		super();
		// 不再自动检查，由渲染进程主动调用
	}

	async checkForUpdates(): Promise<IVersionUpdateInfo | null> {
		try {
			const response = await fetch('https://ai.chenjiabao.cn');
			const data = await response.json() as { code: number; data: IVersionUpdateInfo };

			if (data.code !== 200 || !data.data) {
				return null;
			}

			const updateInfo = data.data;
			const currentCode = config.app.version.code;

			if (updateInfo.code > currentCode) {
				this._onUpdateAvailable.fire(updateInfo);
				return updateInfo;
			}

			return null;

		} catch {
			return null;
		}
	}
}
