/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './chenilleSettingsPanel.css';
import { $, append, addDisposableListener, EventType, getWindow } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ChenilleSettingsPanel } from './chenilleSettingsPanel.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';

export class ChenilleSettingsDialog extends Disposable {
	private modalElement: HTMLElement | undefined;
	private dialogElement: HTMLElement | undefined;
	private readonly dialogDisposables = this._register(new DisposableStore());

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose = this._onDidClose.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	show(): void {
		const container = getWindow(document).document.body;

		// 模态背景
		this.modalElement = append(container, $('.chenille-dialog-modal'));
		this.dialogDisposables.add(addDisposableListener(this.modalElement, EventType.CLICK, (e) => {
			if (e.target === this.modalElement) {
				this.hide();
			}
		}));

		// 对话框容器
		this.dialogElement = append(this.modalElement, $('.chenille-dialog'));

		// 头
		const header = append(this.dialogElement, $('.chenille-dialog-header'));
		append(header, $('.chenille-dialog-title')).textContent = localize('chenilleSettings', "Chenille 设置");

		const closeBtn = append(header, $('button.chenille-dialog-close'));
		const closeIcon = append(closeBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.close)}`));
		closeIcon.style.display = 'flex';
		closeBtn.title = localize('close', "关闭");
		this.dialogDisposables.add(addDisposableListener(closeBtn, EventType.CLICK, () => this.hide()));

		// 体
		const body = append(this.dialogElement, $('.chenille-dialog-body'));
		this.dialogDisposables.add(this.instantiationService.createInstance(ChenilleSettingsPanel, body));

		// ESC 关闭
		this.dialogDisposables.add(addDisposableListener(getWindow(document), EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.hide();
			}
		}));
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
