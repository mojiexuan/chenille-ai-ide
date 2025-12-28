/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../../base/common/actions.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import * as dom from '../../../base/browser/dom.js';
import { renderLabelWithIcons } from '../../../base/browser/ui/iconLabel/iconLabels.js';
import { ActionWidgetDropdownActionViewItem } from '../../../platform/actions/browser/actionWidgetDropdownActionViewItem.js';
import { IActionWidgetService } from '../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownActionProvider, IActionWidgetDropdownOptions } from '../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { ChenilleChatMode, IChenilleChatModeService } from '../../common/chatMode.js';

/** 分类配置 */
const CHENILLE_MODE_CATEGORY = { label: localize('chenille.modePicker.category', "模式"), order: 0 };

/**
 * 创建模式列表的 Action Provider
 */
function createModeActionsProvider(
	modeService: IChenilleChatModeService,
	onModeSelected: () => void
): IActionWidgetDropdownActionProvider {
	return {
		getActions: () => {
			const modes = modeService.getModes();
			const currentMode = modeService.getCurrentMode();

			const actions: IActionWidgetDropdownAction[] = modes.map(mode => ({
				id: mode.id,
				enabled: true,
				checked: mode.id === currentMode,
				category: CHENILLE_MODE_CATEGORY,
				class: undefined,
				tooltip: mode.description,
				label: mode.label,
				run: () => {
					modeService.setMode(mode.id);
					onModeSelected();
				}
			}));

			return actions;
		}
	};
}

/**
 * Chenille 模式选择器 Action View Item
 * 显示当前模式（智能体/聊天），点击可切换
 */
export class ChenilleModePickerActionItem extends ActionWidgetDropdownActionViewItem {
	private _currentMode: ChenilleChatMode;

	constructor(
		action: IAction,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IChenilleChatModeService private readonly modeService: IChenilleChatModeService,
	) {
		const initialMode = modeService.getCurrentMode();
		const initialLabel = modeService.getModes().find(m => m.id === initialMode)?.label ?? '智能体';

		const actionWithLabel: IAction = {
			...action,
			label: initialLabel,
			tooltip: localize('chenille.modePicker.tooltip', "选择聊天模式"),
			run: () => { }
		};

		const options: Omit<IActionWidgetDropdownOptions, 'label' | 'labelRenderer'> = {
			actionProvider: createModeActionsProvider(modeService, () => {
				if (this.element) {
					this.renderLabel(this.element);
				}
			}),
		};

		super(actionWithLabel, options, actionWidgetService, keybindingService, contextKeyService);

		this._currentMode = initialMode;

		// 监听模式变化
		this._register(modeService.onDidChangeMode(mode => {
			this._currentMode = mode;
			if (this.element) {
				this.renderLabel(this.element);
			}
		}));
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		const modeInfo = this.modeService.getModes().find(m => m.id === this._currentMode);
		const label = modeInfo?.label ?? '智能体';

		const domChildren = [
			dom.$('span.chat-mode-label', undefined, label),
			...renderLabelWithIcons('$(chevron-down)')
		];

		dom.reset(element, ...domChildren);
		this.setAriaLabelAttributes(element);
		return null;
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('chat-modePicker-item');
		container.classList.add('chenille-modePicker-item');
	}
}
