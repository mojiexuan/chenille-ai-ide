/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IChatRendererContent } from '../../common/chatViewModel.js';
import { ChatTreeItem } from '../chat.js';
import { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';
import { IMarkdownRenderer } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { COLLAPSED_CONTEXT_MARKER } from '../../../../../chenille/common/contextCollapsePrompt.js';
import { ButtonWithIcon } from '../../../../../base/browser/ui/button/button.js';

const $ = dom.$;

/**
 * 检查内容是否是收拢的上下文
 */
export function isCollapsedContextContent(content: string): boolean {
	return content.startsWith(COLLAPSED_CONTEXT_MARKER);
}

/**
 * 从收拢的上下文内容中提取摘要
 */
export function extractCollapsedContextSummary(content: string): string {
	return content.replace(COLLAPSED_CONTEXT_MARKER, '').trim();
}

/**
 * 收拢上下文内容部分
 * 显示为可折叠的块，默认折叠状态
 */
export class ChatCollapsedContextContentPart extends Disposable implements IChatContentPart {
	public readonly domNode: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	public readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private _isExpanded = false;
	private readonly contentContainer: HTMLElement;
	private readonly collapseButton: ButtonWithIcon;

	constructor(
		private readonly summary: string,
		_context: IChatContentPartRenderContext,
		private readonly markdownRenderer: IMarkdownRenderer,
	) {
		super();

		// 创建主容器
		this.domNode = $('.chat-collapsed-context');

		// 创建折叠按钮
		const buttonElement = $('.chat-collapsed-context-label');
		this.collapseButton = this._register(new ButtonWithIcon(buttonElement, {
			buttonBackground: undefined,
			buttonBorder: undefined,
			buttonForeground: undefined,
			buttonHoverBackground: undefined,
			buttonSecondaryBackground: undefined,
			buttonSecondaryForeground: undefined,
			buttonSecondaryHoverBackground: undefined,
			buttonSeparator: undefined
		}));

		this.collapseButton.label = localize('collapsedContext.title', '📦 已收拢的上下文');
		this.collapseButton.icon = Codicon.chevronRight;
		this.domNode.appendChild(buttonElement);

		// 创建内容容器
		this.contentContainer = $('.chat-collapsed-context-content');
		this.contentContainer.style.display = 'none';
		this.domNode.appendChild(this.contentContainer);

		// 渲染摘要内容
		this.renderSummary();

		// 绑定点击事件
		this._register(this.collapseButton.onDidClick(() => {
			this.toggleExpanded();
		}));

		// 添加样式类
		this.domNode.classList.add('chat-collapsed-context-collapsed');
	}

	private renderSummary(): void {
		const markdown = new MarkdownString(this.summary, { supportThemeIcons: true });
		const rendered = this.markdownRenderer.render(markdown);
		this._register(rendered);
		this.contentContainer.appendChild(rendered.element);
	}

	private toggleExpanded(): void {
		this._isExpanded = !this._isExpanded;

		if (this._isExpanded) {
			this.collapseButton.icon = Codicon.chevronDown;
			this.contentContainer.style.display = 'block';
			this.domNode.classList.remove('chat-collapsed-context-collapsed');
			this.domNode.classList.add('chat-collapsed-context-expanded');
		} else {
			this.collapseButton.icon = Codicon.chevronRight;
			this.contentContainer.style.display = 'none';
			this.domNode.classList.add('chat-collapsed-context-collapsed');
			this.domNode.classList.remove('chat-collapsed-context-expanded');
		}

		this._onDidChangeHeight.fire();
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		// 收拢的上下文内容不会改变
		if (other.kind !== 'markdownContent') {
			return false;
		}
		const content = other.content;
		const value = typeof content === 'string' ? content : content.value;
		return isCollapsedContextContent(value);
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}
