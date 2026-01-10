/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType, h, reset, isInShadowDOM } from '../../../base/browser/dom.js';
import { renderLabelWithIcons } from '../../../base/browser/ui/iconLabel/iconLabels.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { ICodeEditor, IViewZoneChangeAccessor } from '../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../editor/common/config/editorOptions.js';
import { localize } from '../../../nls.js';
import { createStyleSheet } from '../../../base/browser/domStylesheets.js';
import { EDITOR_FONT_DEFAULTS } from '../../../editor/common/config/fontInfo.js';

/**
 * Hunk 操作项
 */
export interface IHunkAction {
	text: string;
	tooltip?: string;
	action?: () => void;
}

/**
 * Hunk Widget 工厂 - 管理样式和创建 Widget
 */
export class ChenilleHunkWidgetFactory extends Disposable {
	private readonly _styleClassName: string;
	private readonly _styleElement: HTMLStyleElement;

	constructor(private readonly _editor: ICodeEditor) {
		super();

		this._register(this._editor.onDidChangeConfiguration((e) => {
			if (e.hasChanged(EditorOption.fontInfo) || e.hasChanged(EditorOption.codeLensFontSize) || e.hasChanged(EditorOption.codeLensFontFamily)) {
				this._updateLensStyle();
			}
		}));

		// 生成唯一的样式类名
		this._styleClassName = '_chenilleHunkWidget_' + Math.random().toString(36).substring(2, 9);
		this._styleElement = createStyleSheet(
			isInShadowDOM(this._editor.getContainerDomNode())
				? this._editor.getContainerDomNode()
				: undefined, undefined, this._store
		);

		this._updateLensStyle();
	}

	private _updateLensStyle(): void {
		const { codeLensHeight, fontSize } = this._getLayoutInfo();
		const fontFamily = this._editor.getOption(EditorOption.codeLensFontFamily);
		const editorFontInfo = this._editor.getOption(EditorOption.fontInfo);

		const fontFamilyVar = `--chenille-hunk-font-family${this._styleClassName}`;
		const fontFeaturesVar = `--chenille-hunk-font-features${this._styleClassName}`;

		let newStyle = `
		.${this._styleClassName} { line-height: ${codeLensHeight}px; font-size: ${fontSize}px; padding-right: ${Math.round(fontSize * 0.5)}px; font-feature-settings: var(${fontFeaturesVar}) }
		.monaco-workbench .${this._styleClassName} span.codicon { line-height: ${codeLensHeight}px; font-size: ${fontSize}px; }
		`;
		if (fontFamily) {
			newStyle += `.${this._styleClassName} { font-family: var(${fontFamilyVar}), ${EDITOR_FONT_DEFAULTS.fontFamily}}`;
		}
		this._styleElement.textContent = newStyle;
		this._editor.getContainerDomNode().style?.setProperty(fontFamilyVar, fontFamily ?? 'inherit');
		this._editor.getContainerDomNode().style?.setProperty(fontFeaturesVar, editorFontInfo.fontFeatureSettings);
	}

	private _getLayoutInfo() {
		const lineHeightFactor = Math.max(1.3, this._editor.getOption(EditorOption.lineHeight) / this._editor.getOption(EditorOption.fontSize));
		let fontSize = this._editor.getOption(EditorOption.codeLensFontSize);
		if (!fontSize || fontSize < 5) {
			fontSize = (this._editor.getOption(EditorOption.fontSize) * .9) | 0;
		}
		return {
			fontSize,
			codeLensHeight: (fontSize * lineHeightFactor) | 0,
		};
	}

	/**
	 * 创建 Hunk 操作 Widget
	 */
	public createWidget(
		viewZoneAccessor: IViewZoneChangeAccessor,
		afterLineNumber: number,
		actions: IHunkAction[],
		viewZoneIdsToCleanUp: string[]
	): IDisposable {
		const layoutInfo = this._getLayoutInfo();
		return new ChenilleHunkActionsWidget(
			this._editor,
			viewZoneAccessor,
			afterLineNumber,
			layoutInfo.codeLensHeight + 2,
			this._styleClassName,
			actions,
			viewZoneIdsToCleanUp,
		);
	}
}

/**
 * Hunk 操作 Widget - 显示在 ViewZone 中的 Accept/Reject 按钮
 */
class ChenilleHunkActionsWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _viewZoneId: string;

	constructor(
		editor: ICodeEditor,
		viewZoneAccessor: IViewZoneChangeAccessor,
		afterLineNumber: number,
		height: number,
		className: string,
		actions: IHunkAction[],
		viewZoneIdsToCleanUp: string[],
	) {
		super();

		// 创建容器
		const container = h('div.chenille-hunk-actions-container@domNode', [
			h('div.chenille-hunk-actions@actions')
		]);

		this._domNode = container.domNode;
		this._domNode.style.zIndex = '10';

		const actionsNode = container.actions;
		actionsNode.classList.add(className);

		// 渲染操作按钮
		this._renderActions(actionsNode, actions);

		// 创建 ViewZone
		this._viewZoneId = viewZoneAccessor.addZone({
			afterLineNumber,
			heightInPx: height,
			domNode: this._domNode,
			ordinal: 50001,
		});

		viewZoneIdsToCleanUp.push(this._viewZoneId);
	}

	private _renderActions(container: HTMLElement, actions: IHunkAction[]): void {
		const children: HTMLElement[] = [];
		let isFirst = true;

		for (const action of actions) {
			if (isFirst) {
				isFirst = false;
			} else {
				children.push($('span.separator', undefined, '\u00a0|\u00a0'));
			}

			const title = renderLabelWithIcons(action.text);

			if (action.action) {
				const link = $('a.action-link', { title: action.tooltip, role: 'button' }, ...title);
				this._register(addDisposableListener(link, EventType.CLICK, (e) => {
					e.preventDefault();
					e.stopPropagation();
					action.action!();
				}));
				children.push(link);
			} else {
				children.push($('span.action-label', { title: action.tooltip }, ...title));
			}
		}

		reset(container, ...children);
	}
}

/**
 * 创建标准的 Hunk 操作列表
 */
export function createHunkActions(
	onAccept: () => void,
	onReject: () => void,
	onToggleDiff?: () => void,
	showDiff?: boolean
): IHunkAction[] {
	const actions: IHunkAction[] = [
		{
			text: `$(check) ${localize('accept', 'Accept')}`,
			tooltip: localize('acceptTooltip', 'Accept this change (Ctrl+Enter)'),
			action: onAccept,
		},
		{
			text: `$(close) ${localize('reject', 'Reject')}`,
			tooltip: localize('rejectTooltip', 'Reject this change (Ctrl+Escape)'),
			action: onReject,
		},
	];

	if (onToggleDiff) {
		actions.push({
			text: showDiff
				? `$(eye-closed) ${localize('hideDiff', 'Hide Original')}`
				: `$(eye) ${localize('showDiff', 'Show Original')}`,
			tooltip: localize('toggleDiffTooltip', 'Toggle showing the original content'),
			action: onToggleDiff,
		});
	}

	return actions;
}
