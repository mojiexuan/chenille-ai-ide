/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HierarchicalKind } from '../../../../base/common/hierarchicalKind.js';
import { IJSONSchema, TypeFromJsonSchema } from '../../../../base/common/jsonSchema.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { escapeRegExpCharacters } from '../../../../base/common/strings.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { EditorAction, EditorCommand, ServicesAccessor } from '../../../browser/editorExtensions.js';
import { EditorContextKeys } from '../../../common/editorContextKeys.js';
import { autoFixCommandId, codeActionCommandId, fixAllCommandId, organizeImportsCommandId, quickFixCommandId, refactorCommandId, sourceActionCommandId } from './codeAction.js';
import * as nls from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { CodeActionAutoApply, CodeActionCommandArgs, CodeActionFilter, CodeActionKind, CodeActionTriggerSource } from '../common/types.js';
import { CodeActionController } from './codeActionController.js';
import { SUPPORTED_CODE_ACTIONS } from './codeActionModel.js';

function contextKeyForSupportedActions(kind: HierarchicalKind) {
	return ContextKeyExpr.regex(
		SUPPORTED_CODE_ACTIONS.keys()[0],
		new RegExp('(\\s|^)' + escapeRegExpCharacters(kind.value) + '\\b'));
}

const argsSchema = {
	type: 'object',
	defaultSnippets: [{ body: { kind: '' } }],
	properties: {
		'kind': {
			type: 'string',
			description: nls.localize('args.schema.kind', "要运行的代码操作的类型。"),
		},
		'apply': {
			type: 'string',
			description: nls.localize('args.schema.apply', "控制何时应用返回的操作。"),
			default: CodeActionAutoApply.IfSingle,
			enum: [CodeActionAutoApply.First, CodeActionAutoApply.IfSingle, CodeActionAutoApply.Never],
			enumDescriptions: [
				nls.localize('args.schema.apply.first', "始终应用第一个返回的代码操作。"),
				nls.localize('args.schema.apply.ifSingle', "如果只有一个返回的代码操作，则应用它。"),
				nls.localize('args.schema.apply.never', "不应用返回的代码操作。"),
			]
		},
		'preferred': {
			type: 'boolean',
			default: false,
			description: nls.localize('args.schema.preferred', "控制是否只返回首选的代码操作。"),
		}
	}
} as const satisfies IJSONSchema;

function triggerCodeActionsForEditorSelection(
	editor: ICodeEditor,
	notAvailableMessage: string,
	filter: CodeActionFilter | undefined,
	autoApply: CodeActionAutoApply | undefined,
	triggerAction: CodeActionTriggerSource = CodeActionTriggerSource.Default
): void {
	if (editor.hasModel()) {
		const controller = CodeActionController.get(editor);
		controller?.manualTriggerAtCurrentPosition(notAvailableMessage, triggerAction, filter, autoApply);
	}
}

export class QuickFixAction extends EditorAction {

	constructor() {
		super({
			id: quickFixCommandId,
			label: nls.localize2('quickfix.trigger.label', "快速修复..."),
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasCodeActionsProvider),
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.CtrlCmd | KeyCode.Period,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(_accessor: ServicesAccessor, editor: ICodeEditor): void {
		return triggerCodeActionsForEditorSelection(editor, nls.localize('editor.action.quickFix.noneMessage', "没有可用的代码操作"), undefined, undefined, CodeActionTriggerSource.QuickFix);
	}
}

export class CodeActionCommand extends EditorCommand {

	constructor() {
		super({
			id: codeActionCommandId,
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasCodeActionsProvider),
			metadata: {
				description: 'Trigger a code action',
				args: [{ name: 'args', schema: argsSchema, }]
			}
		});
	}

	public runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor, userArgs?: TypeFromJsonSchema<typeof argsSchema>): void {
		const args = CodeActionCommandArgs.fromUser(userArgs, {
			kind: HierarchicalKind.Empty,
			apply: CodeActionAutoApply.IfSingle,
		});
		return triggerCodeActionsForEditorSelection(editor,
			typeof userArgs?.kind === 'string'
				? args.preferred
					? nls.localize('editor.action.codeAction.noneMessage.preferred.kind', "没有可用的 '{0}' 首选代码操作", userArgs.kind)
					: nls.localize('editor.action.codeAction.noneMessage.kind', "没有可用的 '{0}' 代码操作", userArgs.kind)
				: args.preferred
					? nls.localize('editor.action.codeAction.noneMessage.preferred', "没有可用的首选代码操作")
					: nls.localize('editor.action.codeAction.noneMessage', "没有可用的代码操作"),
			{
				include: args.kind,
				includeSourceActions: true,
				onlyIncludePreferredActions: args.preferred,
			},
			args.apply);
	}
}


export class RefactorAction extends EditorAction {

	constructor() {
		super({
			id: refactorCommandId,
			label: nls.localize2('refactor.label', "重构..."),
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasCodeActionsProvider),
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR,
				mac: {
					primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KeyR
				},
				weight: KeybindingWeight.EditorContrib
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 2,
				when: ContextKeyExpr.and(
					EditorContextKeys.writable,
					contextKeyForSupportedActions(CodeActionKind.Refactor)),
			},
			metadata: {
				description: '重构...',
				args: [{ name: 'args', schema: argsSchema }]
			}
		});
	}

	public run(_accessor: ServicesAccessor, editor: ICodeEditor, userArgs?: TypeFromJsonSchema<typeof argsSchema>): void {
		const args = CodeActionCommandArgs.fromUser(userArgs, {
			kind: CodeActionKind.Refactor,
			apply: CodeActionAutoApply.Never
		});
		return triggerCodeActionsForEditorSelection(editor,
			typeof userArgs?.kind === 'string'
				? args.preferred
					? nls.localize('editor.action.refactor.noneMessage.preferred.kind', "没有可用的 '{0}' 首选重构", userArgs.kind)
					: nls.localize('editor.action.refactor.noneMessage.kind', "没有可用的 '{0}' 重构", userArgs.kind)
				: args.preferred
					? nls.localize('editor.action.refactor.noneMessage.preferred', "没有可用的首选重构")
					: nls.localize('editor.action.refactor.noneMessage', "没有可用的重构"),
			{
				include: CodeActionKind.Refactor.contains(args.kind) ? args.kind : HierarchicalKind.None,
				onlyIncludePreferredActions: args.preferred
			},
			args.apply, CodeActionTriggerSource.Refactor);
	}
}

export class SourceAction extends EditorAction {

	constructor() {
		super({
			id: sourceActionCommandId,
			label: nls.localize2('source.label', "源代码操作..."),
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasCodeActionsProvider),
			contextMenuOpts: {
				group: '1_modification',
				order: 2.1,
				when: ContextKeyExpr.and(
					EditorContextKeys.writable,
					contextKeyForSupportedActions(CodeActionKind.Source)),
			},
			metadata: {
				description: '源代码操作...',
				args: [{ name: 'args', schema: argsSchema }]
			}
		});
	}

	public run(_accessor: ServicesAccessor, editor: ICodeEditor, userArgs?: TypeFromJsonSchema<typeof argsSchema>): void {
		const args = CodeActionCommandArgs.fromUser(userArgs, {
			kind: CodeActionKind.Source,
			apply: CodeActionAutoApply.Never
		});
		return triggerCodeActionsForEditorSelection(editor,
			typeof userArgs?.kind === 'string'
				? args.preferred
					? nls.localize('editor.action.source.noneMessage.preferred.kind', "没有可用的 '{0}' 首选源代码操作", userArgs.kind)
					: nls.localize('editor.action.source.noneMessage.kind', "没有可用的 '{0}' 源代码操作", userArgs.kind)
				: args.preferred
					? nls.localize('editor.action.source.noneMessage.preferred', "没有可用的首选源代码操作")
					: nls.localize('editor.action.source.noneMessage', "没有可用的源代码操作"),
			{
				include: CodeActionKind.Source.contains(args.kind) ? args.kind : HierarchicalKind.None,
				includeSourceActions: true,
				onlyIncludePreferredActions: args.preferred,
			},
			args.apply, CodeActionTriggerSource.SourceAction);
	}
}

export class OrganizeImportsAction extends EditorAction {

	constructor() {
		super({
			id: organizeImportsCommandId,
			label: nls.localize2('organizeImports.label', "整理导入"),
			precondition: ContextKeyExpr.and(
				EditorContextKeys.writable,
				contextKeyForSupportedActions(CodeActionKind.SourceOrganizeImports)),
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyO,
				weight: KeybindingWeight.EditorContrib
			},
			metadata: {
				description: nls.localize2('organizeImports.description', "整理当前文件中的导入。某些工具也称之为「优化导入」")
			}
		});
	}

	public run(_accessor: ServicesAccessor, editor: ICodeEditor): void {
		return triggerCodeActionsForEditorSelection(editor,
			nls.localize('editor.action.organize.noneMessage', "没有可用的整理导入操作"),
			{ include: CodeActionKind.SourceOrganizeImports, includeSourceActions: true },
			CodeActionAutoApply.IfSingle, CodeActionTriggerSource.OrganizeImports);
	}
}

export class FixAllAction extends EditorAction {

	constructor() {
		super({
			id: fixAllCommandId,
			label: nls.localize2('fixAll.label', "全部修复"),
			precondition: ContextKeyExpr.and(
				EditorContextKeys.writable,
				contextKeyForSupportedActions(CodeActionKind.SourceFixAll))
		});
	}

	public run(_accessor: ServicesAccessor, editor: ICodeEditor): void {
		return triggerCodeActionsForEditorSelection(editor,
			nls.localize('fixAll.noneMessage', "没有可用的全部修复操作"),
			{ include: CodeActionKind.SourceFixAll, includeSourceActions: true },
			CodeActionAutoApply.IfSingle, CodeActionTriggerSource.FixAll);
	}
}

export class AutoFixAction extends EditorAction {

	constructor() {
		super({
			id: autoFixCommandId,
			label: nls.localize2('autoFix.label', "自动修复..."),
			precondition: ContextKeyExpr.and(
				EditorContextKeys.writable,
				contextKeyForSupportedActions(CodeActionKind.QuickFix)),
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.Period,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Period
				},
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(_accessor: ServicesAccessor, editor: ICodeEditor): void {
		return triggerCodeActionsForEditorSelection(editor,
			nls.localize('editor.action.autoFix.noneMessage', "没有可用的自动修复"),
			{
				include: CodeActionKind.QuickFix,
				onlyIncludePreferredActions: true
			},
			CodeActionAutoApply.IfSingle, CodeActionTriggerSource.AutoFix);
	}
}
