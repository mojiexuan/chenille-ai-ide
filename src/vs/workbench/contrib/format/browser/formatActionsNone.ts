/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorAction, registerEditorAction, ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import * as nls from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';

registerEditorAction(class FormatDocumentMultipleAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.formatDocument.none',
			label: nls.localize2('formatDocument.label.multiple', "格式化文档"),
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasDocumentFormattingProvider.toNegated()),
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF,
				linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI },
				weight: KeybindingWeight.EditorContrib,
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}

		const commandService = accessor.get(ICommandService);
		const extensionsWorkbenchService = accessor.get(IExtensionsWorkbenchService);
		const notificationService = accessor.get(INotificationService);
		const dialogService = accessor.get(IDialogService);
		const languageFeaturesService = accessor.get(ILanguageFeaturesService);

		const model = editor.getModel();
		const formatterCount = languageFeaturesService.documentFormattingEditProvider.all(model).length;

		if (formatterCount > 1) {
			return commandService.executeCommand('editor.action.formatDocument.multiple');
		} else if (formatterCount === 1) {
			return commandService.executeCommand('editor.action.formatDocument');
		} else if (model.isTooLargeForSyncing()) {
			notificationService.warn(nls.localize('too.large', "此文件太大，无法格式化"));
		} else {
			const langName = model.getLanguageId();
			const message = nls.localize('no.provider', "没有为 '{0}' 文件安装格式化程序。", langName);
			const { confirmed } = await dialogService.confirm({
				message,
				primaryButton: nls.localize({ key: 'install.formatter', comment: ['&& denotes a mnemonic'] }, "安装格式化程序...")
			});
			if (confirmed) {
				extensionsWorkbenchService.openSearch(`category:formatters ${langName}`);
			}
		}
	}
});
