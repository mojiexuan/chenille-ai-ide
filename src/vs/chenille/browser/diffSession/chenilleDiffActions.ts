/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import { Action2, registerAction2, MenuId } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { IChenilleDiffSessionService, CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE } from './chenilleDiffSession.js';
import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { Codicon } from '../../../base/common/codicons.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';

// Re-export context key for external use
export { CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE } from './chenilleDiffSession.js';

/**
 * Accept all changes across all files
 */
class ChenilleAcceptAllFilesAction extends Action2 {
	constructor() {
		super({
			id: 'chenille.diff.acceptAllFiles',
			title: localize2('chenille.diff.acceptAllFiles', 'Accept All File Changes'),
			icon: Codicon.checkAll,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter,
				when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
			},
			menu: [
				{
					id: MenuId.ChatEditingWidgetToolbar,
					group: 'navigation',
					order: 0,
					when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
				}
			],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const diffSessionService = accessor.get(IChenilleDiffSessionService);
		await diffSessionService.acceptAllSessions();
	}
}

/**
 * Reject all changes across all files
 */
class ChenilleRejectAllFilesAction extends Action2 {
	constructor() {
		super({
			id: 'chenille.diff.rejectAllFiles',
			title: localize2('chenille.diff.rejectAllFiles', 'Reject All File Changes'),
			icon: Codicon.discard,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Escape,
				when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
			},
			menu: [
				{
					id: MenuId.ChatEditingWidgetToolbar,
					group: 'navigation',
					order: 1,
					when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
				}
			],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const diffSessionService = accessor.get(IChenilleDiffSessionService);
		const dialogService = accessor.get(IDialogService);

		const sessions = diffSessionService.getAllSessions();
		const totalPending = diffSessionService.getTotalPendingCount();

		if (totalPending > 0) {
			const confirmation = await dialogService.confirm({
				title: localize('chenille.diff.rejectAllFiles.confirm.title', '撤销所有编辑？'),
				message: sessions.length === 1
					? localize('chenille.diff.rejectAllFiles.confirm.oneFile', '这将撤销 1 个文件中的 {0} 处更改。是否继续？', totalPending)
					: localize('chenille.diff.rejectAllFiles.confirm.manyFiles', '这将撤销 {0} 个文件中的 {1} 处更改。是否继续？', sessions.length, totalPending),
				primaryButton: localize('chenille.diff.rejectAllFiles.confirm.yes', '是'),
				type: 'warning'
			});

			if (!confirmation.confirmed) {
				return;
			}
		}

		await diffSessionService.rejectAllSessions();
	}
}

/**
 * Accept all changes in the current diff session
 */
class ChenilleAcceptAllChangesAction extends Action2 {
	constructor() {
		super({
			id: 'chenille.diff.acceptAll',
			title: localize2('chenille.diff.acceptAll', 'Accept All Changes'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
				when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const diffSessionService = accessor.get(IChenilleDiffSessionService);

		const editor = codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		const uri = editor.getModel()?.uri;
		if (!uri) {
			return;
		}

		const session = diffSessionService.getSession(uri);
		if (session) {
			await session.acceptAll();
		}
	}
}

/**
 * Reject all changes in the current diff session
 */
class ChenilleRejectAllChangesAction extends Action2 {
	constructor() {
		super({
			id: 'chenille.diff.rejectAll',
			title: localize2('chenille.diff.rejectAll', 'Reject All Changes'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Escape,
				when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const diffSessionService = accessor.get(IChenilleDiffSessionService);

		const editor = codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		const uri = editor.getModel()?.uri;
		if (!uri) {
			return;
		}

		const session = diffSessionService.getSession(uri);
		if (session) {
			await session.rejectAll();
		}
	}
}

/**
 * Accept the current hunk
 */
class ChenilleAcceptHunkAction extends Action2 {
	constructor() {
		super({
			id: 'chenille.diff.acceptHunk',
			title: localize2('chenille.diff.acceptHunk', 'Accept Current Change'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const diffSessionService = accessor.get(IChenilleDiffSessionService);

		const editor = codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		const uri = editor.getModel()?.uri;
		if (!uri) {
			return;
		}

		const session = diffSessionService.getSession(uri);
		if (!session) {
			return;
		}

		// Find the hunk at the current cursor position
		const position = editor.getPosition();
		if (!position) {
			return;
		}

		const hunks = session.getHunks();
		for (const hunk of hunks) {
			const ranges = hunk.getModifiedRanges();
			for (const range of ranges) {
				if (range.containsPosition(position)) {
					hunk.accept();
					return;
				}
			}
		}
	}
}

/**
 * Reject the current hunk
 */
class ChenilleRejectHunkAction extends Action2 {
	constructor() {
		super({
			id: 'chenille.diff.rejectHunk',
			title: localize2('chenille.diff.rejectHunk', 'Reject Current Change'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Escape,
				when: CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const diffSessionService = accessor.get(IChenilleDiffSessionService);

		const editor = codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		const uri = editor.getModel()?.uri;
		if (!uri) {
			return;
		}

		const session = diffSessionService.getSession(uri);
		if (!session) {
			return;
		}

		// Find the hunk at the current cursor position
		const position = editor.getPosition();
		if (!position) {
			return;
		}

		const hunks = session.getHunks();
		for (const hunk of hunks) {
			const ranges = hunk.getModifiedRanges();
			for (const range of ranges) {
				if (range.containsPosition(position)) {
					hunk.reject();
					return;
				}
			}
		}
	}
}

// Register actions
registerAction2(ChenilleAcceptAllFilesAction);
registerAction2(ChenilleRejectAllFilesAction);
registerAction2(ChenilleAcceptAllChangesAction);
registerAction2(ChenilleRejectAllChangesAction);
registerAction2(ChenilleAcceptHunkAction);
registerAction2(ChenilleRejectHunkAction);
