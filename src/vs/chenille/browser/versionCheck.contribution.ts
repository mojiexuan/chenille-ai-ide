/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { IChenilleVersionCheckService, IVersionUpdateInfo } from '../common/versionCheckService.js';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { ChenilleUpdateDialog } from './updateDialog/updateDialog.js';

/**
 * 版本检查 UI 服务（渲染进程）
 * 监听主进程的更新事件，显示更新弹窗
 */
export class ChenilleVersionCheckUIService extends Disposable {
	private updateDialog: ChenilleUpdateDialog | undefined;

	constructor(
		@IChenilleVersionCheckService private readonly versionCheckService: IChenilleVersionCheckService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this._register(this.versionCheckService.onUpdateAvailable(info => this.showUpdateDialog(info)));

		// 主动检查一次（防止错过启动时的事件）
		this.versionCheckService.checkForUpdates().then(info => {
			if (info) {
				this.showUpdateDialog(info);
			}
		});
	}

	private showUpdateDialog(info: IVersionUpdateInfo): void {
		// 避免重复弹窗
		if (this.updateDialog) {
			return;
		}

		this.updateDialog = this.instantiationService.createInstance(ChenilleUpdateDialog, info);
		this._register(this.updateDialog);
		this._register(this.updateDialog.onDidClose(() => {
			this.updateDialog = undefined;
		}));
		this.updateDialog.show();
	}
}
