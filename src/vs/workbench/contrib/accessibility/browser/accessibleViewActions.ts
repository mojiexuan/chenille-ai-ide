/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Command, MultiCommand, ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { AccessibilityCommandId } from '../common/accessibilityCommands.js';
import { accessibilityHelpIsShown, accessibleViewContainsCodeBlocks, accessibleViewCurrentProviderId, accessibleViewGoToSymbolSupported, accessibleViewHasAssignedKeybindings, accessibleViewHasUnassignedKeybindings, accessibleViewIsShown, accessibleViewSupportsNavigation, accessibleViewVerbosityEnabled } from './accessibilityConfiguration.js';
import { AccessibleViewProviderId, IAccessibleViewService } from '../../../../platform/accessibility/browser/accessibleView.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { InlineCompletionsController } from '../../../../editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.js';

const accessibleViewMenu = {
	id: MenuId.AccessibleView,
	group: 'navigation',
	when: accessibleViewIsShown
};
const commandPalette = {
	id: MenuId.CommandPalette,
	group: '',
	order: 1
};
class AccessibleViewNextAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.ShowNext,
			precondition: ContextKeyExpr.and(accessibleViewIsShown, accessibleViewSupportsNavigation),
			keybinding: {
				primary: KeyMod.Alt | KeyCode.BracketRight,
				weight: KeybindingWeight.WorkbenchContrib
			},
			menu: [
				commandPalette,
				{
					...accessibleViewMenu,
					when: ContextKeyExpr.and(accessibleViewIsShown, accessibleViewSupportsNavigation),
				}],
			icon: Codicon.arrowDown,
			title: localize('editor.action.accessibleViewNext', "在辅助视图中显示下一个")
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IAccessibleViewService).next();
	}
}
registerAction2(AccessibleViewNextAction);


class AccessibleViewNextCodeBlockAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.NextCodeBlock,
			precondition: ContextKeyExpr.and(accessibleViewContainsCodeBlocks, ContextKeyExpr.or(ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.PanelChat), ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.InlineChat), ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.QuickChat))),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageDown,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageDown, },
				weight: KeybindingWeight.WorkbenchContrib,
			},
			icon: Codicon.arrowRight,
			menu:
			{
				...accessibleViewMenu,
				when: ContextKeyExpr.and(accessibleViewIsShown, accessibleViewContainsCodeBlocks),
			},
			title: localize('editor.action.accessibleViewNextCodeBlock', "辅助视图: 下一个代码块")
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IAccessibleViewService).navigateToCodeBlock('next');
	}
}
registerAction2(AccessibleViewNextCodeBlockAction);


class AccessibleViewPreviousCodeBlockAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.PreviousCodeBlock,
			precondition: ContextKeyExpr.and(accessibleViewContainsCodeBlocks, ContextKeyExpr.or(ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.PanelChat), ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.InlineChat), ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.QuickChat))),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageUp,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageUp, },
				weight: KeybindingWeight.WorkbenchContrib,
			},
			icon: Codicon.arrowLeft,
			menu: {
				...accessibleViewMenu,
				when: ContextKeyExpr.and(accessibleViewIsShown, accessibleViewContainsCodeBlocks),
			},
			title: localize('editor.action.accessibleViewPreviousCodeBlock', "辅助视图: 上一个代码块")
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IAccessibleViewService).navigateToCodeBlock('previous');
	}
}
registerAction2(AccessibleViewPreviousCodeBlockAction);

class AccessibleViewPreviousAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.ShowPrevious,
			precondition: ContextKeyExpr.and(accessibleViewIsShown, accessibleViewSupportsNavigation),
			keybinding: {
				primary: KeyMod.Alt | KeyCode.BracketLeft,
				weight: KeybindingWeight.WorkbenchContrib
			},
			icon: Codicon.arrowUp,
			menu: [
				commandPalette,
				{
					...accessibleViewMenu,
					when: ContextKeyExpr.and(accessibleViewIsShown, accessibleViewSupportsNavigation),
				}
			],
			title: localize('editor.action.accessibleViewPrevious', "在辅助视图中显示上一个")
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IAccessibleViewService).previous();
	}
}
registerAction2(AccessibleViewPreviousAction);


class AccessibleViewGoToSymbolAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.GoToSymbol,
			precondition: ContextKeyExpr.and(ContextKeyExpr.or(accessibleViewIsShown, accessibilityHelpIsShown), accessibleViewGoToSymbolSupported),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyO,
				secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Period],
				weight: KeybindingWeight.WorkbenchContrib + 10
			},
			icon: Codicon.symbolMisc,
			menu: [
				commandPalette,
				{
					...accessibleViewMenu,
					when: ContextKeyExpr.and(ContextKeyExpr.or(accessibleViewIsShown, accessibilityHelpIsShown), accessibleViewGoToSymbolSupported),
				}
			],
			title: localize('editor.action.accessibleViewGoToSymbol', "在辅助视图中转到符号")
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IAccessibleViewService).goToSymbol();
	}
}
registerAction2(AccessibleViewGoToSymbolAction);

function registerCommand<T extends Command>(command: T): T {
	command.register();
	return command;
}

export const AccessibilityHelpAction = registerCommand(new MultiCommand({
	id: AccessibilityCommandId.OpenAccessibilityHelp,
	precondition: undefined,
	kbOpts: {
		primary: KeyMod.Alt | KeyCode.F1,
		weight: KeybindingWeight.WorkbenchContrib,
		linux: {
			primary: KeyMod.Alt | KeyMod.Shift | KeyCode.F1,
			secondary: [KeyMod.Alt | KeyCode.F1]
		},
		kbExpr: accessibilityHelpIsShown.toNegated()
	},
	menuOpts: [{
		menuId: MenuId.CommandPalette,
		group: '',
		title: localize('editor.action.accessibilityHelp', "打开辅助功能帮助"),
		order: 1
	}],
}));


export const AccessibleViewAction = registerCommand(new MultiCommand({
	id: AccessibilityCommandId.OpenAccessibleView,
	precondition: undefined,
	kbOpts: {
		primary: KeyMod.Alt | KeyCode.F2,
		weight: KeybindingWeight.WorkbenchContrib,
		linux: {
			primary: KeyMod.Alt | KeyMod.Shift | KeyCode.F2,
			secondary: [KeyMod.Alt | KeyCode.F2]
		}
	},
	menuOpts: [{
		menuId: MenuId.CommandPalette,
		group: '',
		title: localize('editor.action.accessibleView', "打开辅助视图"),
		order: 1
	}],
}));

class AccessibleViewDisableHintAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.DisableVerbosityHint,
			precondition: ContextKeyExpr.and(ContextKeyExpr.or(accessibleViewIsShown, accessibilityHelpIsShown), accessibleViewVerbosityEnabled),
			keybinding: {
				primary: KeyMod.Alt | KeyCode.F6,
				weight: KeybindingWeight.WorkbenchContrib
			},
			icon: Codicon.bellSlash,
			menu: [
				commandPalette,
				{
					id: MenuId.AccessibleView,
					group: 'navigation',
					when: ContextKeyExpr.and(ContextKeyExpr.or(accessibleViewIsShown, accessibilityHelpIsShown), accessibleViewVerbosityEnabled),
				}
			],
			title: localize('editor.action.accessibleViewDisableHint', "禁用辅助视图提示")
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IAccessibleViewService).disableHint();
	}
}
registerAction2(AccessibleViewDisableHintAction);

class AccessibilityHelpConfigureKeybindingsAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.AccessibilityHelpConfigureKeybindings,
			precondition: ContextKeyExpr.and(accessibilityHelpIsShown, accessibleViewHasUnassignedKeybindings),
			icon: Codicon.recordKeys,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyK,
				weight: KeybindingWeight.WorkbenchContrib
			},
			menu: [
				{
					id: MenuId.AccessibleView,
					group: 'navigation',
					order: 3,
					when: accessibleViewHasUnassignedKeybindings,
				}
			],
			title: localize('editor.action.accessibilityHelpConfigureUnassignedKeybindings', "辅助功能帮助配置未分配的键绑定")
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IAccessibleViewService).configureKeybindings(true);
	}
}
registerAction2(AccessibilityHelpConfigureKeybindingsAction);

class AccessibilityHelpConfigureAssignedKeybindingsAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.AccessibilityHelpConfigureAssignedKeybindings,
			precondition: ContextKeyExpr.and(accessibilityHelpIsShown, accessibleViewHasAssignedKeybindings),
			icon: Codicon.recordKeys,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyA,
				weight: KeybindingWeight.WorkbenchContrib
			},
			menu: [
				{
					id: MenuId.AccessibleView,
					group: 'navigation',
					order: 4,
					when: accessibleViewHasAssignedKeybindings,
				}
			],
			title: localize('editor.action.accessibilityHelpConfigureAssignedKeybindings', "辅助功能帮助配置已分配的键绑定")
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IAccessibleViewService).configureKeybindings(false);
	}
}
registerAction2(AccessibilityHelpConfigureAssignedKeybindingsAction);


class AccessibilityHelpOpenHelpLinkAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.AccessibilityHelpOpenHelpLink,
			precondition: ContextKeyExpr.and(accessibilityHelpIsShown),
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyH,
				weight: KeybindingWeight.WorkbenchContrib
			},
			title: localize('editor.action.accessibilityHelpOpenHelpLink', "辅助功能帮助打开帮助链接")
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IAccessibleViewService).openHelpLink();
	}
}
registerAction2(AccessibilityHelpOpenHelpLinkAction);

class AccessibleViewAcceptInlineCompletionAction extends Action2 {
	constructor() {
		super({
			id: AccessibilityCommandId.AccessibleViewAcceptInlineCompletion,
			precondition: ContextKeyExpr.and(accessibleViewIsShown, ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.InlineCompletions)),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Slash,
				mac: { primary: KeyMod.WinCtrl | KeyCode.Slash },
				weight: KeybindingWeight.WorkbenchContrib
			},
			icon: Codicon.check,
			menu: [
				commandPalette,
				{
					id: MenuId.AccessibleView,
					group: 'navigation',
					order: 0,
					when: ContextKeyExpr.and(accessibleViewIsShown, ContextKeyExpr.equals(accessibleViewCurrentProviderId.key, AccessibleViewProviderId.InlineCompletions))
				}],
			title: localize('editor.action.accessibleViewAcceptInlineCompletionAction', "接受内联补全")
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() || codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}
		const model = InlineCompletionsController.get(editor)?.model.get();
		const state = model?.state.get();
		if (!model || !state) {
			return;
		}
		await model.accept(editor);
		model.stop();
		editor.focus();
	}
}
registerAction2(AccessibleViewAcceptInlineCompletionAction);

