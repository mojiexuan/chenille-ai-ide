/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { Emitter, Event } from '../../../../base/common/event.js';

const $ = dom.$;

/**
 * 上下文收拢警告卡片
 * 显示在聊天面板中，但不添加到会话历史
 */
export class ChatContextCollapseWidget extends Disposable {
	private readonly _onDidAccept = this._register(new Emitter<void>());
	readonly onDidAccept: Event<void> = this._onDidAccept.event;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

	private readonly element: HTMLElement;
	private readonly disposables = this._register(new DisposableStore());

	constructor(
		private readonly container: HTMLElement,
		usagePercent: number,
	) {
		super();

		const percentText = (usagePercent * 100).toFixed(0);

		// 创建警告卡片
		this.element = $('.chat-context-collapse-warning');
		this.element.style.cssText = `
			position: absolute;
			bottom: 80px;
			left: 16px;
			right: 16px;
			background: var(--vscode-editorWidget-background);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 8px;
			padding: 16px;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
			z-index: 100;
		`;

		// 标题
		const title = dom.append(this.element, $('.warning-title'));
		title.style.cssText = `
			font-weight: 600;
			font-size: 14px;
			margin-bottom: 8px;
			color: var(--vscode-editorWarning-foreground);
		`;
		title.textContent = localize('contextCollapse.warningTitle', '⚠️ 上下文即将达到限制');

		// 消息
		const message = dom.append(this.element, $('.warning-message'));
		message.style.cssText = `
			font-size: 13px;
			line-height: 1.5;
			margin-bottom: 16px;
			color: var(--vscode-foreground);
		`;
		message.textContent = localize(
			'contextCollapse.warningMessage',
			'当前会话的上下文使用量已达 {0}%，即将达到模型的上下文限制。建议收拢上下文以继续对话。',
			percentText
		);

		// 按钮容器
		const buttonContainer = dom.append(this.element, $('.warning-buttons'));
		buttonContainer.style.cssText = `
			display: flex;
			gap: 8px;
			justify-content: flex-end;
		`;

		// 稍后处理按钮
		const dismissButton = this.disposables.add(new Button(buttonContainer, {
			...defaultButtonStyles,
			secondary: true,
		}));
		dismissButton.label = localize('contextCollapse.laterButton', '稍后处理');
		this.disposables.add(dismissButton.onDidClick(() => {
			this._onDidDismiss.fire();
			this.hide();
		}));

		// 收拢上下文按钮
		const acceptButton = this.disposables.add(new Button(buttonContainer, defaultButtonStyles));
		acceptButton.label = localize('contextCollapse.collapseButton', '📦 收拢上下文');
		this.disposables.add(acceptButton.onDidClick(() => {
			this._onDidAccept.fire();
			this.hide();
		}));

		// 添加到容器
		this.container.appendChild(this.element);
	}

	show(): void {
		this.element.style.display = 'block';
	}

	hide(): void {
		this.element.style.display = 'none';
	}

	override dispose(): void {
		this.element.remove();
		super.dispose();
	}
}
