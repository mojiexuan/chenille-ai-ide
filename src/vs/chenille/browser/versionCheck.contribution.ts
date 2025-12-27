/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { INotificationService, Severity } from '../../platform/notification/common/notification.js';
import { IOpenerService } from '../../platform/opener/common/opener.js';
import { URI } from '../../base/common/uri.js';
import { IChenilleVersionCheckService, IVersionUpdateInfo } from '../common/versionCheckService.js';

/**
 * 版本检查 UI 服务（渲染进程）
 * 监听主进程的更新事件，显示更新提示
 */
export class ChenilleVersionCheckUIService extends Disposable {
	constructor(
		@IChenilleVersionCheckService private readonly versionCheckService: IChenilleVersionCheckService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();
		this._register(this.versionCheckService.onUpdateAvailable(info => this.showUpdateNotification(info)));

		// 主动检查一次（防止错过启动时的事件）
		this.versionCheckService.checkForUpdates().then(info => {
			if (info) {
				this.showUpdateNotification(info);
			}
		});
	}

	private showUpdateNotification(info: IVersionUpdateInfo): void {
		const hasUrl = info.url && info.url.startsWith('http');
		const choices = [];

		if (hasUrl) {
			choices.push({
				label: '立即更新',
				run: () => {
					this.openerService.open(URI.parse(info.url), { openExternal: true });
				}
			});
		}

		choices.push({
			label: '知道了',
			run: () => { /* 关闭通知 */ }
		});

		this.notificationService.prompt(
			Severity.Info,
			`发现新版本 ${info.name}！`,
			choices,
			{ sticky: true }
		);
	}
}
