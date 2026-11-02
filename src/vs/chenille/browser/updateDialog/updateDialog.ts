/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './updateDialog.css';
import { $, append, addDisposableListener, EventType } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { URI } from '../../../base/common/uri.js';
import { ILayoutService } from '../../../platform/layout/browser/layoutService.js';
import { IVersionUpdateInfo } from '../../common/versionCheckService.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { FileAccess } from '../../../base/common/network.js';
import { INativeHostService } from '../../../platform/native/common/native.js';

export class ChenilleUpdateDialog extends Disposable {
	private modalElement: HTMLElement | undefined;
	private dialogElement: HTMLElement | undefined;
	private readonly dialogDisposables = this._register(new DisposableStore());

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose = this._onDidClose.event;

	constructor(
		private readonly updateInfo: IVersionUpdateInfo,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IOpenerService private readonly openerService: IOpenerService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super();
	}

	show(): void {
		const container = this.layoutService.mainContainer;
		const isForceUpdate = this.updateInfo.forceUpdate;

		// 模态蒙层（点击不关闭）
		this.modalElement = append(container, $('.chenille-update-modal'));

		// 对话框容器
		this.dialogElement = append(this.modalElement, $('.chenille-update-dialog'));

		// 内容区
		const content = append(this.dialogElement, $('.chenille-update-content'));

		// 图标（使用 Chenille 图标）
		const iconContainer = append(content, $('.chenille-update-icon'));
		const iconImg = append(iconContainer, $('img')) as HTMLImageElement;
		const iconUri = FileAccess.asBrowserUri('vs/workbench/contrib/chat/browser/media/chenille-icon.png');
		iconImg.src = iconUri.toString(true);
		iconImg.alt = 'Chenille';

		// 标题
		append(content, $('.chenille-update-title')).textContent = isForceUpdate ? '重要更新' : '发现新版本';

		// 版本号
		append(content, $('.chenille-update-version')).textContent = `${this.updateInfo.name}`;

		// 强制更新提示
		if (isForceUpdate) {
			const forceHint = append(content, $('.chenille-update-force-hint'));
			forceHint.textContent = '此版本包含重要更新，请立即更新后继续使用';
		}

		// 更新内容
		if (this.updateInfo.content) {
			const message = append(content, $('.chenille-update-message'));
			message.textContent = this.updateInfo.content;
		}

		// 按钮区域
		const actions = append(this.dialogElement, $('.chenille-update-actions'));

		// 稍后提醒按钮（强制更新时显示为"退出程序"）
		const laterBtn = append(actions, $('button.chenille-update-btn.chenille-update-btn-secondary'));
		laterBtn.textContent = isForceUpdate ? '退出程序' : '稍后提醒';
		this.dialogDisposables.add(addDisposableListener(laterBtn, EventType.CLICK, () => {
			if (isForceUpdate) {
				this.nativeHostService.closeWindow();
			} else {
				this.hide();
			}
		}));

		// 立即更新按钮
		const hasUrl = this.updateInfo.url && this.updateInfo.url.startsWith('http');
		if (hasUrl) {
			const updateBtn = append(actions, $('button.chenille-update-btn.chenille-update-btn-primary'));
			const updateIcon = append(updateBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.cloudDownload)}`));
			updateIcon.style.display = 'flex';
			append(updateBtn, $('span')).textContent = '立即更新';
			this.dialogDisposables.add(addDisposableListener(updateBtn, EventType.CLICK, () => {
				this.openerService.open(URI.parse(this.updateInfo.url), { openExternal: true });
				if (isForceUpdate) {
					// 强制更新：打开链接后关闭程序
					this.nativeHostService.closeWindow();
				} else {
					this.hide();
				}
			}));
		}
	}

	hide(): void {
		this.dialogDisposables.clear();
		this.modalElement?.remove();
		this.modalElement = undefined;
		this.dialogElement = undefined;
		this._onDidClose.fire();
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}
