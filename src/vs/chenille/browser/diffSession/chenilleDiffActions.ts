/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { IChenilleDiffSessionService, CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE } from './chenilleDiffSession.js';
import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';

// Re-export context key for external use
export { CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE } from './chenilleDiffSession.js';

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
registerAction2(ChenilleAcceptAllChangesAction);
registerAction2(ChenilleRejectAllChangesAction);
registerAction2(ChenilleAcceptHunkAction);
registerAction2(ChenilleRejectHunkAction);
