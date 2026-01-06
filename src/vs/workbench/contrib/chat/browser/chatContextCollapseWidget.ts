/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';

const $ = dom.$;

/**
 * 上下文收拢警告组件
 */
export class ChatContextCollapseWidget extends Disposable {
	private readonly _onDidClickCollapse = this._register(new Emitter<void>());
	readonly onDidClickCollapse: Event<void> = this._onDidClickCollapse.event;

	private readonly _onDidClickCancel = this._register(new Emitter<void>());
	readonly onDidClickCancel: Event<void> = this._onDidClickCancel.event;

	private readonly container: HTMLElement;
	private readonly messageElement: HTMLElement;
	private readonly progressElement: HTMLElement;
	private readonly buttonContainer: HTMLElement;
	private collapseButton: Button | undefined;
	private cancelButton: Button | undefined;

	private _isCollapsing = false;

	constructor(parent: HTMLElement) {
		super();

		this.container = dom.append(parent, $('.chat-context-collapse-warning'));
		this.container.style.display = 'none';

		// 警告图标和消息
		const contentContainer = dom.append(this.container, $('.chat-context-collapse-content'));
		const iconElement = dom.append(contentContainer, $('.chat-context-collapse-icon'));
		iconElement.textContent = '⚠️';

		this.messageElement = dom.append(contentContainer, $('.chat-context-collapse-message'));

		// 进度指示器
		this.progressElement = dom.append(contentContainer, $('.chat-context-collapse-progress'));
		this.progressElement.style.display = 'none';

		// 按钮容器
		this.buttonContainer = dom.append(this.container, $('.chat-context-collapse-buttons'));
	}

	/**
	 * 显示警告
	 */
	show(usagePercent: number): void {
		this.container.style.display = 'flex';
		this._isCollapsing = false;

		const percentText = (usagePercent * 100).toFixed(0);
		this.messageElement.textContent = localize(
			'contextCollapse.warning',
			'上下文使用量已达 {0}%，建议收拢上下文以继续对话',
			percentText
		);

		this.progressElement.style.display = 'none';
		this.buttonContainer.style.display = 'flex';

		// 清理旧按钮
		this.collapseButton?.dispose();
		this.cancelButton?.dispose();
		dom.clearNode(this.buttonContainer);

		// 收拢按钮
		this.collapseButton = this._register(new Button(this.buttonContainer, {
			...defaultButtonStyles,
			title: localize('contextCollapse.collapseButton', '收拢上下文'),
		}));
		this.collapseButton.label = localize('contextCollapse.collapseButton', '收拢上下文');
		this._register(this.collapseButton.onDidClick(() => {
			this._onDidClickCollapse.fire();
		}));

		// 取消按钮
		this.cancelButton = this._register(new Button(this.buttonContainer, {
			...defaultButtonStyles,
			secondary: true,
			title: localize('contextCollapse.cancelButton', '稍后处理'),
		}));
		this.cancelButton.label = localize('contextCollapse.cancelButton', '稍后处理');
		this._register(this.cancelButton.onDidClick(() => {
			this._onDidClickCancel.fire();
		}));
	}

	/**
	 * 显示收拢进度
	 */
	showProgress(): void {
		this._isCollapsing = true;
		this.messageElement.textContent = localize('contextCollapse.collapsing', '正在收拢上下文...');
		this.progressElement.style.display = 'block';
		this.progressElement.innerHTML = '<div class="chat-context-collapse-spinner"></div>';
		this.buttonContainer.style.display = 'none';
	}

	/**
	 * 显示错误
	 */
	showError(error: string): void {
		this._isCollapsing = false;
		this.messageElement.textContent = error;
		this.progressElement.style.display = 'none';
		this.buttonContainer.style.display = 'flex';
	}

	/**
	 * 隐藏警告
	 */
	hide(): void {
		this.container.style.display = 'none';
		this._isCollapsing = false;
	}

	/**
	 * 是否正在收拢
	 */
	get isCollapsing(): boolean {
		return this._isCollapsing;
	}

	/**
	 * 是否可见
	 */
	get isVisible(): boolean {
		return this.container.style.display !== 'none';
	}
}
