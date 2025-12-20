/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { isWindows, OperatingSystem, OS } from '../../../../base/common/platform.js';
import { extname, basename, isAbsolute } from '../../../../base/common/path.js';
import * as resources from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Action } from '../../../../base/common/actions.js';
import { dispose, IDisposable } from '../../../../base/common/lifecycle.js';
import { VIEWLET_ID, IFilesConfiguration, VIEW_ID, UndoConfirmLevel } from '../common/files.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { IQuickInputService, ItemActivation } from '../../../../platform/quickinput/common/quickInput.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { REVEAL_IN_EXPLORER_COMMAND_ID, SAVE_ALL_IN_GROUP_COMMAND_ID, NEW_UNTITLED_FILE_COMMAND_ID } from './fileConstants.js';
import { ITextModelService, ITextModelContentProvider } from '../../../../editor/common/services/resolverService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { Schemas } from '../../../../base/common/network.js';
import { IDialogService, IConfirmationResult, getFileNamesMessage } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Constants } from '../../../../base/common/uint.js';
import { CLOSE_EDITORS_AND_GROUP_COMMAND_ID } from '../../../browser/parts/editor/editorCommands.js';
import { coalesce } from '../../../../base/common/arrays.js';
import { ExplorerItem, NewExplorerItem } from '../common/explorerModel.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { triggerUpload } from '../../../../base/browser/dom.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IWorkingCopy } from '../../../services/workingCopy/common/workingCopy.js';
import { timeout } from '../../../../base/common/async.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { trim, rtrim } from '../../../../base/common/strings.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { ResourceFileEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { IExplorerService } from './files.js';
import { BrowserFileUpload, FileDownload } from './fileImportExport.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ActiveEditorCanToggleReadonlyContext, ActiveEditorContext, EmptyWorkspaceSupportContext } from '../../../common/contextkeys.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { getPathForFile } from '../../../../platform/dnd/browser/dnd.js';

export const NEW_FILE_COMMAND_ID = 'explorer.newFile';
export const NEW_FILE_LABEL = nls.localize2('newFile', "新建文件...");
export const NEW_FOLDER_COMMAND_ID = 'explorer.newFolder';
export const NEW_FOLDER_LABEL = nls.localize2('newFolder', "新建文件夹...");
export const TRIGGER_RENAME_LABEL = nls.localize('rename', "重命名...");
export const MOVE_FILE_TO_TRASH_LABEL = nls.localize('delete', "删除");
export const COPY_FILE_LABEL = nls.localize('copyFile', "复制");
export const PASTE_FILE_LABEL = nls.localize('pasteFile', "粘贴");
export const FileCopiedContext = new RawContextKey<boolean>('fileCopied', false);
export const DOWNLOAD_COMMAND_ID = 'explorer.download';
export const DOWNLOAD_LABEL = nls.localize('download', "下载...");
export const UPLOAD_COMMAND_ID = 'explorer.upload';
export const UPLOAD_LABEL = nls.localize('upload', "上传...");
const CONFIRM_DELETE_SETTING_KEY = 'explorer.confirmDelete';
const MAX_UNDO_FILE_SIZE = 5000000; // 5mb

async function refreshIfSeparator(value: string, explorerService: IExplorerService): Promise<void> {
	if (value && ((value.indexOf('/') >= 0) || (value.indexOf('\\') >= 0))) {
		// New input contains separator, multiple resources will get created workaround for #68204
		await explorerService.refresh();
	}
}

async function deleteFiles(explorerService: IExplorerService, workingCopyFileService: IWorkingCopyFileService, dialogService: IDialogService, configurationService: IConfigurationService, filesConfigurationService: IFilesConfigurationService, elements: ExplorerItem[], useTrash: boolean, skipConfirm = false, ignoreIfNotExists = false): Promise<void> {
	let primaryButton: string;
	if (useTrash) {
		primaryButton = isWindows ? nls.localize('deleteButtonLabelRecycleBin', "移动到回收站") : nls.localize({ key: 'deleteButtonLabelTrash', comment: ['&& denotes a mnemonic'] }, "移动到回收站");
	} else {
		primaryButton = nls.localize({ key: 'deleteButtonLabel', comment: ['&& denotes a mnemonic'] }, "删除");
	}

	// Handle dirty
	const distinctElements = resources.distinctParents(elements, e => e.resource);
	const dirtyWorkingCopies = new Set<IWorkingCopy>();
	for (const distinctElement of distinctElements) {
		for (const dirtyWorkingCopy of workingCopyFileService.getDirty(distinctElement.resource)) {
			dirtyWorkingCopies.add(dirtyWorkingCopy);
		}
	}

	if (dirtyWorkingCopies.size) {
		let message: string;
		if (distinctElements.length > 1) {
			message = nls.localize('dirtyMessageFilesDelete', "您正在删除具有未保存更改的文件。您想继续吗？");
		} else if (distinctElements[0].isDirectory) {
			if (dirtyWorkingCopies.size === 1) {
				message = nls.localize('dirtyMessageFolderOneDelete', "你正在删除文件夹 {0}，其中有 1 个文件包含未保存的更改。是否继续？", distinctElements[0].name);
			} else {
				message = nls.localize('dirtyMessageFolderDelete', "你正在删除文件夹 {0}，其中有 {1} 个文件包含未保存的更改。是否继续？", distinctElements[0].name, dirtyWorkingCopies.size);
			}
		} else {
			message = nls.localize('dirtyMessageFileDelete', "你正在删除 {0}，其中包含未保存的更改。是否继续？", distinctElements[0].name);
		}

		const response = await dialogService.confirm({
			type: 'warning',
			message,
			detail: nls.localize('dirtyWarning', "如果不保存，您的更改将丢失。"),
			primaryButton
		});

		if (!response.confirmed) {
			return;
		} else {
			skipConfirm = true;
		}
	}

	// Handle readonly
	if (!skipConfirm) {
		const readonlyResources = distinctElements.filter(e => filesConfigurationService.isReadonly(e.resource));
		if (readonlyResources.length) {
			let message: string;
			if (readonlyResources.length > 1) {
				message = nls.localize('readonlyMessageFilesDelete', "你正在删除配置为只读的文件。是否继续？");
			} else if (readonlyResources[0].isDirectory) {
				message = nls.localize('readonlyMessageFolderOneDelete', "你正在删除配置为只读的文件夹 {0}。是否继续？", distinctElements[0].name);
			} else {
				message = nls.localize('readonlyMessageFolderDelete', "你正在删除配置为只读的文件 {0}。是否继续？", distinctElements[0].name);
			}

			const response = await dialogService.confirm({
				type: 'warning',
				message,
				detail: nls.localize('continueDetail', "如果继续，只读保护将被覆盖。"),
				primaryButton: nls.localize('continueButtonLabel', "继续")
			});

			if (!response.confirmed) {
				return;
			}
		}
	}

	let confirmation: IConfirmationResult;

	// We do not support undo of folders, so in that case the delete action is irreversible
	const deleteDetail = distinctElements.some(e => e.isDirectory) ? nls.localize('irreversible', "此操作不可撤销！") :
		distinctElements.length > 1 ? nls.localize('restorePlural', "你可以使用撤销命令恢复这些文件。") : nls.localize('restore', "你可以使用撤销命令恢复此文件。");

	// Check if we need to ask for confirmation at all
	if (skipConfirm || (useTrash && configurationService.getValue<boolean>(CONFIRM_DELETE_SETTING_KEY) === false)) {
		confirmation = { confirmed: true };
	}

	// Confirm for moving to trash
	else if (useTrash) {
		let { message, detail } = getMoveToTrashMessage(distinctElements);
		detail += detail ? '\n' : '';
		if (isWindows) {
			detail += distinctElements.length > 1 ? nls.localize('undoBinFiles', "你可以从回收站恢复这些文件。") : nls.localize('undoBin', "你可以从回收站恢复此文件。");
		} else {
			detail += distinctElements.length > 1 ? nls.localize('undoTrashFiles', "你可以从回收站恢复这些文件。") : nls.localize('undoTrash', "你可以从回收站恢复此文件。");
		}

		confirmation = await dialogService.confirm({
			message,
			detail,
			primaryButton,
			checkbox: {
				label: nls.localize('doNotAskAgain', "不再询问")
			}
		});
	}

	// Confirm for deleting permanently
	else {
		let { message, detail } = getDeleteMessage(distinctElements);
		detail += detail ? '\n' : '';
		detail += deleteDetail;
		confirmation = await dialogService.confirm({
			type: 'warning',
			message,
			detail,
			primaryButton
		});
	}

	// Check for confirmation checkbox
	if (confirmation.confirmed && confirmation.checkboxChecked === true) {
		await configurationService.updateValue(CONFIRM_DELETE_SETTING_KEY, false);
	}

	// Check for confirmation
	if (!confirmation.confirmed) {
		return;
	}

	// Call function
	try {
		const resourceFileEdits = distinctElements.map(e => new ResourceFileEdit(e.resource, undefined, { recursive: true, folder: e.isDirectory, ignoreIfNotExists, skipTrashBin: !useTrash, maxSize: MAX_UNDO_FILE_SIZE }));
		const options = {
			undoLabel: distinctElements.length > 1 ? nls.localize({ key: 'deleteBulkEdit', comment: ['Placeholder will be replaced by the number of files deleted'] }, "删除 {0} 个文件", distinctElements.length) : nls.localize({ key: 'deleteFileBulkEdit', comment: ['Placeholder will be replaced by the name of the file deleted'] }, "删除 {0}", distinctElements[0].name),
			progressLabel: distinctElements.length > 1 ? nls.localize({ key: 'deletingBulkEdit', comment: ['Placeholder will be replaced by the number of files deleted'] }, "正在删除 {0} 个文件", distinctElements.length) : nls.localize({ key: 'deletingFileBulkEdit', comment: ['Placeholder will be replaced by the name of the file deleted'] }, "正在删除 {0}", distinctElements[0].name),
		};
		await explorerService.applyBulkEdit(resourceFileEdits, options);
	} catch (error) {

		// Handle error to delete file(s) from a modal confirmation dialog
		let errorMessage: string;
		let detailMessage: string | undefined;
		let primaryButton: string;
		if (useTrash) {
			errorMessage = isWindows ? nls.localize('binFailed', "使用回收站删除失败。是否改为永久删除？") : nls.localize('trashFailed', "使用回收站删除失败。是否改为永久删除？");
			detailMessage = deleteDetail;
			primaryButton = nls.localize({ key: 'deletePermanentlyButtonLabel', comment: ['&& denotes a mnemonic'] }, "永久删除");
		} else {
			errorMessage = toErrorMessage(error, false);
			primaryButton = nls.localize({ key: 'retryButtonLabel', comment: ['&& denotes a mnemonic'] }, "重试");
		}

		const res = await dialogService.confirm({
			type: 'warning',
			message: errorMessage,
			detail: detailMessage,
			primaryButton
		});

		if (res.confirmed) {
			if (useTrash) {
				useTrash = false; // Delete Permanently
			}

			skipConfirm = true;
			ignoreIfNotExists = true;

			return deleteFiles(explorerService, workingCopyFileService, dialogService, configurationService, filesConfigurationService, elements, useTrash, skipConfirm, ignoreIfNotExists);
		}
	}
}

function getMoveToTrashMessage(distinctElements: ExplorerItem[]): { message: string; detail: string } {
	if (containsBothDirectoryAndFile(distinctElements)) {
		return {
			message: nls.localize('confirmMoveTrashMessageFilesAndDirectories', "确定要删除以下 {0} 个文件/目录及其内容吗？", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements.length > 1) {
		if (distinctElements[0].isDirectory) {
			return {
				message: nls.localize('confirmMoveTrashMessageMultipleDirectories', "确定要删除以下 {0} 个目录及其内容吗？", distinctElements.length),
				detail: getFileNamesMessage(distinctElements.map(e => e.resource))
			};
		}

		return {
			message: nls.localize('confirmMoveTrashMessageMultiple', "确定要删除以下 {0} 个文件吗？", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements[0].isDirectory && !distinctElements[0].isSymbolicLink) {
		return { message: nls.localize('confirmMoveTrashMessageFolder', "确定要删除{0}及其内容吗？", distinctElements[0].name), detail: '' };
	}

	return { message: nls.localize('confirmMoveTrashMessageFile', "确定要删除{0}吗？", distinctElements[0].name), detail: '' };
}

function getDeleteMessage(distinctElements: ExplorerItem[]): { message: string; detail: string } {
	if (containsBothDirectoryAndFile(distinctElements)) {
		return {
			message: nls.localize('confirmDeleteMessageFilesAndDirectories', "确定要永久删除以下 {0} 个文件/目录及其内容吗？", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements.length > 1) {
		if (distinctElements[0].isDirectory) {
			return {
				message: nls.localize('confirmDeleteMessageMultipleDirectories', "确定要永久删除以下 {0} 个目录及其内容吗？", distinctElements.length),
				detail: getFileNamesMessage(distinctElements.map(e => e.resource))
			};
		}

		return {
			message: nls.localize('confirmDeleteMessageMultiple', "确定要永久删除以下 {0} 个文件吗？", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements[0].isDirectory) {
		return { message: nls.localize('confirmDeleteMessageFolder', "确定要永久删除{0}及其内容吗？", distinctElements[0].name), detail: '' };
	}

	return { message: nls.localize('confirmDeleteMessageFile', "确定要永久删除{0}吗？", distinctElements[0].name), detail: '' };
}

function containsBothDirectoryAndFile(distinctElements: ExplorerItem[]): boolean {
	const directory = distinctElements.find(element => element.isDirectory);
	const file = distinctElements.find(element => !element.isDirectory);

	return !!directory && !!file;
}


export async function findValidPasteFileTarget(
	explorerService: IExplorerService,
	fileService: IFileService,
	dialogService: IDialogService,
	targetFolder: ExplorerItem,
	fileToPaste: { resource: URI | string; isDirectory?: boolean; allowOverwrite: boolean },
	incrementalNaming: 'simple' | 'smart' | 'disabled'
): Promise<URI | undefined> {

	let name = typeof fileToPaste.resource === 'string' ? fileToPaste.resource : resources.basenameOrAuthority(fileToPaste.resource);
	let candidate = resources.joinPath(targetFolder.resource, name);

	// In the disabled case we must ask if it's ok to overwrite the file if it exists
	if (incrementalNaming === 'disabled') {
		const canOverwrite = await askForOverwrite(fileService, dialogService, candidate);
		if (!canOverwrite) {
			return;
		}
	}

	while (true && !fileToPaste.allowOverwrite) {
		if (!explorerService.findClosest(candidate)) {
			break;
		}

		if (incrementalNaming !== 'disabled') {
			name = incrementFileName(name, !!fileToPaste.isDirectory, incrementalNaming);
		}
		candidate = resources.joinPath(targetFolder.resource, name);
	}

	return candidate;
}

export function incrementFileName(name: string, isFolder: boolean, incrementalNaming: 'simple' | 'smart'): string {
	if (incrementalNaming === 'simple') {
		let namePrefix = name;
		let extSuffix = '';
		if (!isFolder) {
			extSuffix = extname(name);
			namePrefix = basename(name, extSuffix);
		}

		// name copy 5(.txt) => name copy 6(.txt)
		// name copy(.txt) => name copy 2(.txt)
		const suffixRegex = /^(.+ copy)( \d+)?$/;
		if (suffixRegex.test(namePrefix)) {
			return namePrefix.replace(suffixRegex, (match, g1?, g2?) => {
				const number = (g2 ? parseInt(g2) : 1);
				return number === 0
					? `${g1}`
					: (number < Constants.MAX_SAFE_SMALL_INTEGER
						? `${g1} ${number + 1}`
						: `${g1}${g2} copy`);
			}) + extSuffix;
		}

		// name(.txt) => name copy(.txt)
		return `${namePrefix} copy${extSuffix}`;
	}

	const separators = '[\\.\\-_]';
	const maxNumber = Constants.MAX_SAFE_SMALL_INTEGER;

	// file.1.txt=>file.2.txt
	const suffixFileRegex = RegExp('(.*' + separators + ')(\\d+)(\\..*)$');
	if (!isFolder && name.match(suffixFileRegex)) {
		return name.replace(suffixFileRegex, (match, g1?, g2?, g3?) => {
			const number = parseInt(g2);
			return number < maxNumber
				? g1 + String(number + 1).padStart(g2.length, '0') + g3
				: `${g1}${g2}.1${g3}`;
		});
	}

	// 1.file.txt=>2.file.txt
	const prefixFileRegex = RegExp('(\\d+)(' + separators + '.*)(\\..*)$');
	if (!isFolder && name.match(prefixFileRegex)) {
		return name.replace(prefixFileRegex, (match, g1?, g2?, g3?) => {
			const number = parseInt(g1);
			return number < maxNumber
				? String(number + 1).padStart(g1.length, '0') + g2 + g3
				: `${g1}${g2}.1${g3}`;
		});
	}

	// 1.txt=>2.txt
	const prefixFileNoNameRegex = RegExp('(\\d+)(\\..*)$');
	if (!isFolder && name.match(prefixFileNoNameRegex)) {
		return name.replace(prefixFileNoNameRegex, (match, g1?, g2?) => {
			const number = parseInt(g1);
			return number < maxNumber
				? String(number + 1).padStart(g1.length, '0') + g2
				: `${g1}.1${g2}`;
		});
	}

	// file.txt=>file.1.txt
	const lastIndexOfDot = name.lastIndexOf('.');
	if (!isFolder && lastIndexOfDot >= 0) {
		return `${name.substr(0, lastIndexOfDot)}.1${name.substr(lastIndexOfDot)}`;
	}

	// 123 => 124
	const noNameNoExtensionRegex = RegExp('(\\d+)$');
	if (!isFolder && lastIndexOfDot === -1 && name.match(noNameNoExtensionRegex)) {
		return name.replace(noNameNoExtensionRegex, (match, g1?) => {
			const number = parseInt(g1);
			return number < maxNumber
				? String(number + 1).padStart(g1.length, '0')
				: `${g1}.1`;
		});
	}

	// file => file1
	// file1 => file2
	const noExtensionRegex = RegExp('(.*)(\\d*)$');
	if (!isFolder && lastIndexOfDot === -1 && name.match(noExtensionRegex)) {
		return name.replace(noExtensionRegex, (match, g1?, g2?) => {
			let number = parseInt(g2);
			if (isNaN(number)) {
				number = 0;
			}
			return number < maxNumber
				? g1 + String(number + 1).padStart(g2.length, '0')
				: `${g1}${g2}.1`;
		});
	}

	// folder.1=>folder.2
	if (isFolder && name.match(/(\d+)$/)) {
		return name.replace(/(\d+)$/, (match, ...groups) => {
			const number = parseInt(groups[0]);
			return number < maxNumber
				? String(number + 1).padStart(groups[0].length, '0')
				: `${groups[0]}.1`;
		});
	}

	// 1.folder=>2.folder
	if (isFolder && name.match(/^(\d+)/)) {
		return name.replace(/^(\d+)(.*)$/, (match, ...groups) => {
			const number = parseInt(groups[0]);
			return number < maxNumber
				? String(number + 1).padStart(groups[0].length, '0') + groups[1]
				: `${groups[0]}${groups[1]}.1`;
		});
	}

	// file/folder=>file.1/folder.1
	return `${name}.1`;
}

/**
 * Checks to see if the resource already exists, if so prompts the user if they would be ok with it being overwritten
 * @param fileService The file service
 * @param dialogService The dialog service
 * @param targetResource The resource to be overwritten
 * @return A boolean indicating if the user is ok with resource being overwritten, if the resource does not exist it returns true.
 */
async function askForOverwrite(fileService: IFileService, dialogService: IDialogService, targetResource: URI): Promise<boolean> {
	const exists = await fileService.exists(targetResource);
	if (!exists) {
		return true;
	}
	// Ask for overwrite confirmation
	const { confirmed } = await dialogService.confirm({
		type: Severity.Warning,
		message: nls.localize('confirmOverwrite', "目标文件夹中已存在名为{0}的文件或文件夹。是否替换？", basename(targetResource.path)),
		primaryButton: nls.localize('replaceButtonLabel', "替换")
	});
	return confirmed;
}

// Global Compare with
export class GlobalCompareResourcesAction extends Action2 {

	static readonly ID = 'workbench.files.action.compareFileWith';
	static readonly LABEL = nls.localize2('globalCompareFile', "将活动文件与...比较");

	constructor() {
		super({
			id: GlobalCompareResourcesAction.ID,
			title: GlobalCompareResourcesAction.LABEL,
			f1: true,
			category: Categories.File,
			precondition: ActiveEditorContext,
			metadata: {
				description: nls.localize2('compareFileWithMeta', "打开选择器以选择要与活动编辑器进行差异比较的文件。")
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const textModelService = accessor.get(ITextModelService);
		const quickInputService = accessor.get(IQuickInputService);

		const activeInput = editorService.activeEditor;
		const activeResource = EditorResourceAccessor.getOriginalUri(activeInput);
		if (activeResource && textModelService.canHandleResource(activeResource)) {
			const picks = await quickInputService.quickAccess.pick('', { itemActivation: ItemActivation.SECOND });
			if (picks?.length === 1) {
				const resource = (picks[0] as unknown as { resource: unknown }).resource;
				if (URI.isUri(resource) && textModelService.canHandleResource(resource)) {
					editorService.openEditor({
						original: { resource: activeResource },
						modified: { resource: resource },
						options: { pinned: true }
					});
				}
			}
		}
	}
}

export class ToggleAutoSaveAction extends Action2 {
	static readonly ID = 'workbench.action.toggleAutoSave';

	constructor() {
		super({
			id: ToggleAutoSaveAction.ID,
			title: nls.localize2('toggleAutoSave', "切换自动保存"),
			f1: true,
			category: Categories.File,
			metadata: { description: nls.localize2('toggleAutoSaveDescription', "切换输入后自动保存文件的功能") }
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		const filesConfigurationService = accessor.get(IFilesConfigurationService);
		return filesConfigurationService.toggleAutoSave();
	}
}

abstract class BaseSaveAllAction extends Action {
	private lastDirtyState: boolean;

	constructor(
		id: string,
		label: string,
		@ICommandService protected commandService: ICommandService,
		@INotificationService private notificationService: INotificationService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
	) {
		super(id, label);

		this.lastDirtyState = this.workingCopyService.hasDirty;
		this.enabled = this.lastDirtyState;

		this.registerListeners();
	}

	protected abstract doRun(context: unknown): Promise<void>;

	private registerListeners(): void {

		// update enablement based on working copy changes
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.updateEnablement(workingCopy)));
	}

	private updateEnablement(workingCopy: IWorkingCopy): void {
		const hasDirty = workingCopy.isDirty() || this.workingCopyService.hasDirty;
		if (this.lastDirtyState !== hasDirty) {
			this.enabled = hasDirty;
			this.lastDirtyState = this.enabled;
		}
	}

	override async run(context?: unknown): Promise<void> {
		try {
			await this.doRun(context);
		} catch (error) {
			this.notificationService.error(toErrorMessage(error, false));
		}
	}
}

export class SaveAllInGroupAction extends BaseSaveAllAction {

	static readonly ID = 'workbench.files.action.saveAllInGroup';
	static readonly LABEL = nls.localize('saveAllInGroup', "保存组中全部");

	override get class(): string {
		return 'explorer-action ' + ThemeIcon.asClassName(Codicon.saveAll);
	}

	protected doRun(context: unknown): Promise<void> {
		return this.commandService.executeCommand(SAVE_ALL_IN_GROUP_COMMAND_ID, {}, context);
	}
}

export class CloseGroupAction extends Action {

	static readonly ID = 'workbench.files.action.closeGroup';
	static readonly LABEL = nls.localize('closeGroup', "关闭组");

	constructor(id: string, label: string, @ICommandService private readonly commandService: ICommandService) {
		super(id, label, ThemeIcon.asClassName(Codicon.closeAll));
	}

	override run(context?: unknown): Promise<void> {
		return this.commandService.executeCommand(CLOSE_EDITORS_AND_GROUP_COMMAND_ID, {}, context);
	}
}

export class FocusFilesExplorer extends Action2 {

	static readonly ID = 'workbench.files.action.focusFilesExplorer';
	static readonly LABEL = nls.localize2('focusFilesExplorer', "聚焦到文件资源管理器");

	constructor() {
		super({
			id: FocusFilesExplorer.ID,
			title: FocusFilesExplorer.LABEL,
			f1: true,
			category: Categories.File,
			metadata: {
				description: nls.localize2('focusFilesExplorerMetadata', "将焦点移动到文件资源管理器视图容器。")
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const paneCompositeService = accessor.get(IPaneCompositePartService);
		await paneCompositeService.openPaneComposite(VIEWLET_ID, ViewContainerLocation.Sidebar, true);
	}
}

export class ShowActiveFileInExplorer extends Action2 {

	static readonly ID = 'workbench.files.action.showActiveFileInExplorer';
	static readonly LABEL = nls.localize2('showInExplorer', "在资源管理器视图中显示活动文件");

	constructor() {
		super({
			id: ShowActiveFileInExplorer.ID,
			title: ShowActiveFileInExplorer.LABEL,
			f1: true,
			category: Categories.File,
			metadata: {
				description: nls.localize2('showInExplorerMetadata', "在资源管理器视图中显示并选中活动文件。")
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const editorService = accessor.get(IEditorService);
		const resource = EditorResourceAccessor.getOriginalUri(editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, resource);
		}
	}
}

export class OpenActiveFileInEmptyWorkspace extends Action2 {

	static readonly ID = 'workbench.action.files.showOpenedFileInNewWindow';
	static readonly LABEL = nls.localize2('openFileInEmptyWorkspace', "在新的空工作区中打开活动编辑器");

	constructor(
	) {
		super({
			id: OpenActiveFileInEmptyWorkspace.ID,
			title: OpenActiveFileInEmptyWorkspace.LABEL,
			f1: true,
			category: Categories.File,
			precondition: EmptyWorkspaceSupportContext,
			metadata: {
				description: nls.localize2('openFileInEmptyWorkspaceMetadata', "在没有打开文件夹的新窗口中打开活动编辑器。")
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const hostService = accessor.get(IHostService);
		const dialogService = accessor.get(IDialogService);
		const fileService = accessor.get(IFileService);

		const fileResource = EditorResourceAccessor.getOriginalUri(editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (fileResource && fileService.hasProvider(fileResource)) {
			hostService.openWindow([{ fileUri: fileResource }], { forceNewWindow: true });
		} else {
			dialogService.error(nls.localize('openFileToShowInNewWindow.unsupportedschema', "活动编辑器必须包含可打开的资源。"));
		}
	}
}

export function validateFileName(pathService: IPathService, item: ExplorerItem, name: string, os: OperatingSystem): { content: string; severity: Severity } | null {
	// Produce a well formed file name
	name = getWellFormedFileName(name);

	// Name not provided
	if (!name || name.length === 0 || /^\s+$/.test(name)) {
		return {
			content: nls.localize('emptyFileNameError', "必须提供文件或文件夹名称。"),
			severity: Severity.Error
		};
	}

	// Relative paths only
	if (name[0] === '/' || name[0] === '\\') {
		return {
			content: nls.localize('fileNameStartsWithSlashError', "文件或文件夹名称不能以斜杠开头。"),
			severity: Severity.Error
		};
	}

	const names = coalesce(name.split(/[\\/]/));
	const parent = item.parent;

	if (name !== item.name) {
		// Do not allow to overwrite existing file
		const child = parent?.getChild(name);
		if (child && child !== item) {
			return {
				content: nls.localize('fileNameExistsError', "此位置已存在名为 **{0}** 的文件或文件夹。请选择其他名称。", name),
				severity: Severity.Error
			};
		}
	}

	// Check for invalid file name.
	if (names.some(folderName => !pathService.hasValidBasename(item.resource, os, folderName))) {
		// Escape * characters
		const escapedName = name.replace(/\*/g, '\\*'); // CodeQL [SM02383] This only processes filenames which are enforced against having backslashes in them farther up in the stack.
		return {
			content: nls.localize('invalidFileNameError', "名称 **{0}** 作为文件或文件夹名称无效。请选择其他名称。", trimLongName(escapedName)),
			severity: Severity.Error
		};
	}

	if (names.some(name => /^\s|\s$/.test(name))) {
		return {
			content: nls.localize('fileNameWhitespaceWarning', "检测到文件或文件夹名称中存在前导或尾随空格。"),
			severity: Severity.Warning
		};
	}

	return null;
}

function trimLongName(name: string): string {
	if (name?.length > 255) {
		return `${name.substr(0, 255)}...`;
	}

	return name;
}

function getWellFormedFileName(filename: string): string {
	if (!filename) {
		return filename;
	}

	// Trim tabs
	filename = trim(filename, '\t');

	// Remove trailing slashes
	filename = rtrim(filename, '/');
	filename = rtrim(filename, '\\');

	return filename;
}

export class CompareNewUntitledTextFilesAction extends Action2 {

	static readonly ID = 'workbench.files.action.compareNewUntitledTextFiles';
	static readonly LABEL = nls.localize2('compareNewUntitledTextFiles', "比较新的无标题文本文件");

	constructor() {
		super({
			id: CompareNewUntitledTextFilesAction.ID,
			title: CompareNewUntitledTextFilesAction.LABEL,
			f1: true,
			category: Categories.File,
			metadata: {
				description: nls.localize2('compareNewUntitledTextFilesMeta', "打开包含两个无标题文件的新差异编辑器。")
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);

		await editorService.openEditor({
			original: { resource: undefined },
			modified: { resource: undefined },
			options: { pinned: true }
		});
	}
}

export class CompareWithClipboardAction extends Action2 {

	static readonly ID = 'workbench.files.action.compareWithClipboard';
	static readonly LABEL = nls.localize2('compareWithClipboard', "将活动文件与剪贴板比较");

	private registrationDisposal: IDisposable | undefined;
	private static SCHEME_COUNTER = 0;

	constructor() {
		super({
			id: CompareWithClipboardAction.ID,
			title: CompareWithClipboardAction.LABEL,
			f1: true,
			category: Categories.File,
			keybinding: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyC), weight: KeybindingWeight.WorkbenchContrib },
			metadata: {
				description: nls.localize2('compareWithClipboardMeta', "打开新的差异编辑器，将活动文件与剪贴板内容进行比较。")
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const textModelService = accessor.get(ITextModelService);
		const fileService = accessor.get(IFileService);

		const resource = EditorResourceAccessor.getOriginalUri(editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		const scheme = `clipboardCompare${CompareWithClipboardAction.SCHEME_COUNTER++}`;
		if (resource && (fileService.hasProvider(resource) || resource.scheme === Schemas.untitled)) {
			if (!this.registrationDisposal) {
				const provider = instantiationService.createInstance(ClipboardContentProvider);
				this.registrationDisposal = textModelService.registerTextModelContentProvider(scheme, provider);
			}

			const name = resources.basename(resource);
			const editorLabel = nls.localize('clipboardComparisonLabel', "剪贴板 ↔ {0}", name);

			await editorService.openEditor({
				original: { resource: resource.with({ scheme }) },
				modified: { resource: resource },
				label: editorLabel,
				options: { pinned: true }
			}).finally(() => {
				dispose(this.registrationDisposal);
				this.registrationDisposal = undefined;
			});
		}
	}

	dispose(): void {
		dispose(this.registrationDisposal);
		this.registrationDisposal = undefined;
	}
}

class ClipboardContentProvider implements ITextModelContentProvider {
	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IModelService private readonly modelService: IModelService
	) { }

	async provideTextContent(resource: URI): Promise<ITextModel> {
		const text = await this.clipboardService.readText();
		const model = this.modelService.createModel(text, this.languageService.createByFilepathOrFirstLine(resource), resource);

		return model;
	}
}

function onErrorWithRetry(notificationService: INotificationService, error: unknown, retry: () => Promise<unknown>): void {
	notificationService.prompt(Severity.Error, toErrorMessage(error, false),
		[{
			label: nls.localize('retry', "重试"),
			run: () => retry()
		}]
	);
}

async function openExplorerAndCreate(accessor: ServicesAccessor, isFolder: boolean): Promise<void> {
	const explorerService = accessor.get(IExplorerService);
	const fileService = accessor.get(IFileService);
	const configService = accessor.get(IConfigurationService);
	const filesConfigService = accessor.get(IFilesConfigurationService);
	const editorService = accessor.get(IEditorService);
	const viewsService = accessor.get(IViewsService);
	const notificationService = accessor.get(INotificationService);
	const remoteAgentService = accessor.get(IRemoteAgentService);
	const commandService = accessor.get(ICommandService);
	const pathService = accessor.get(IPathService);

	const wasHidden = !viewsService.isViewVisible(VIEW_ID);
	const view = await viewsService.openView(VIEW_ID, true);
	if (wasHidden) {
		// Give explorer some time to resolve itself #111218
		await timeout(500);
	}
	if (!view) {
		// Can happen in empty workspace case (https://github.com/microsoft/vscode/issues/100604)

		if (isFolder) {
			throw new Error('请先打开文件夹或工作区。');
		}

		return commandService.executeCommand(NEW_UNTITLED_FILE_COMMAND_ID);
	}

	const stats = explorerService.getContext(false);
	const stat = stats.length > 0 ? stats[0] : undefined;
	let folder: ExplorerItem;
	if (stat) {
		folder = stat.isDirectory ? stat : (stat.parent || explorerService.roots[0]);
	} else {
		folder = explorerService.roots[0];
	}

	if (folder.isReadonly) {
		throw new Error('父文件夹为只读。');
	}

	const newStat = new NewExplorerItem(fileService, configService, filesConfigService, folder, isFolder);
	folder.addChild(newStat);

	const onSuccess = async (value: string): Promise<void> => {
		try {
			const resourceToCreate = resources.joinPath(folder.resource, value);
			if (value.endsWith('/')) {
				isFolder = true;
			}
			await explorerService.applyBulkEdit([new ResourceFileEdit(undefined, resourceToCreate, { folder: isFolder })], {
				undoLabel: nls.localize('createBulkEdit', "创建 {0}", value),
				progressLabel: nls.localize('creatingBulkEdit', "正在创建 {0}", value),
				confirmBeforeUndo: true
			});
			await refreshIfSeparator(value, explorerService);

			if (isFolder) {
				await explorerService.select(resourceToCreate, true);
			} else {
				await editorService.openEditor({ resource: resourceToCreate, options: { pinned: true } });
			}
		} catch (error) {
			onErrorWithRetry(notificationService, error, () => onSuccess(value));
		}
	};

	const os = (await remoteAgentService.getEnvironment())?.os ?? OS;

	await explorerService.setEditable(newStat, {
		validationMessage: value => validateFileName(pathService, newStat, value, os),
		onFinish: async (value, success) => {
			folder.removeChild(newStat);
			await explorerService.setEditable(newStat, null);
			if (success) {
				onSuccess(value);
			}
		}
	});
}

CommandsRegistry.registerCommand({
	id: NEW_FILE_COMMAND_ID,
	handler: async (accessor) => {
		await openExplorerAndCreate(accessor, false);
	}
});

CommandsRegistry.registerCommand({
	id: NEW_FOLDER_COMMAND_ID,
	handler: async (accessor) => {
		await openExplorerAndCreate(accessor, true);
	}
});

export const renameHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const notificationService = accessor.get(INotificationService);
	const remoteAgentService = accessor.get(IRemoteAgentService);
	const pathService = accessor.get(IPathService);
	const configurationService = accessor.get(IConfigurationService);

	const stats = explorerService.getContext(false);
	const stat = stats.length > 0 ? stats[0] : undefined;
	if (!stat) {
		return;
	}

	const os = (await remoteAgentService.getEnvironment())?.os ?? OS;

	await explorerService.setEditable(stat, {
		validationMessage: value => validateFileName(pathService, stat, value, os),
		onFinish: async (value, success) => {
			if (success) {
				const parentResource = stat.parent!.resource;
				const targetResource = resources.joinPath(parentResource, value);
				if (stat.resource.toString() !== targetResource.toString()) {
					try {
						await explorerService.applyBulkEdit([new ResourceFileEdit(stat.resource, targetResource)], {
							confirmBeforeUndo: configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose,
							undoLabel: nls.localize('renameBulkEdit', "将 {0} 重命名为 {1}", stat.name, value),
							progressLabel: nls.localize('renamingBulkEdit', "正在将 {0} 重命名为 {1}", stat.name, value),
						});
						await refreshIfSeparator(value, explorerService);
					} catch (e) {
						notificationService.error(e);
					}
				}
			}
			await explorerService.setEditable(stat, null);
		}
	});
};

export const moveFileToTrashHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true).filter(s => !s.isRoot);
	if (stats.length) {
		await deleteFiles(accessor.get(IExplorerService), accessor.get(IWorkingCopyFileService), accessor.get(IDialogService), accessor.get(IConfigurationService), accessor.get(IFilesConfigurationService), stats, true);
	}
};

export const deleteFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true).filter(s => !s.isRoot);

	if (stats.length) {
		await deleteFiles(accessor.get(IExplorerService), accessor.get(IWorkingCopyFileService), accessor.get(IDialogService), accessor.get(IConfigurationService), accessor.get(IFilesConfigurationService), stats, false);
	}
};

let pasteShouldMove = false;
export const copyFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);
	if (stats.length > 0) {
		await explorerService.setToCopy(stats, false);
		pasteShouldMove = false;
	}
};

export const cutFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);
	if (stats.length > 0) {
		await explorerService.setToCopy(stats, true);
		pasteShouldMove = true;
	}
};

const downloadFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const notificationService = accessor.get(INotificationService);
	const instantiationService = accessor.get(IInstantiationService);

	const context = explorerService.getContext(true);
	const explorerItems = context.length ? context : explorerService.roots;

	const downloadHandler = instantiationService.createInstance(FileDownload);

	try {
		await downloadHandler.download(explorerItems);
	} catch (error) {
		notificationService.error(error);

		throw error;
	}
};

CommandsRegistry.registerCommand({
	id: DOWNLOAD_COMMAND_ID,
	handler: downloadFileHandler
});

const uploadFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const notificationService = accessor.get(INotificationService);
	const instantiationService = accessor.get(IInstantiationService);

	const context = explorerService.getContext(false);
	const element = context.length ? context[0] : explorerService.roots[0];

	try {
		const files = await triggerUpload();
		if (files) {
			const browserUpload = instantiationService.createInstance(BrowserFileUpload);
			await browserUpload.upload(element, files);
		}
	} catch (error) {
		notificationService.error(error);

		throw error;
	}
};

CommandsRegistry.registerCommand({
	id: UPLOAD_COMMAND_ID,
	handler: uploadFileHandler
});

export const pasteFileHandler = async (accessor: ServicesAccessor, fileList?: FileList) => {
	const clipboardService = accessor.get(IClipboardService);
	const explorerService = accessor.get(IExplorerService);
	const fileService = accessor.get(IFileService);
	const notificationService = accessor.get(INotificationService);
	const editorService = accessor.get(IEditorService);
	const configurationService = accessor.get(IConfigurationService);
	const uriIdentityService = accessor.get(IUriIdentityService);
	const dialogService = accessor.get(IDialogService);
	const hostService = accessor.get(IHostService);

	const context = explorerService.getContext(false);
	const hasNativeFilesToPaste = fileList && fileList.length > 0;
	const confirmPasteNative = hasNativeFilesToPaste && configurationService.getValue<boolean>('explorer.confirmPasteNative');

	const toPaste = await getFilesToPaste(fileList, clipboardService, hostService);

	if (confirmPasteNative && toPaste.files.length >= 1) {
		const message = toPaste.files.length > 1 ?
			nls.localize('confirmMultiPasteNative', "确定要粘贴以下 {0} 个项目吗？", toPaste.files.length) :
			nls.localize('confirmPasteNative', "确定要粘贴{0}吗？", basename(toPaste.type === 'paths' ? toPaste.files[0].fsPath : toPaste.files[0].name));
		const detail = toPaste.files.length > 1 ? getFileNamesMessage(toPaste.files.map(item => {
			if (URI.isUri(item)) {
				return item.fsPath;
			}

			if (toPaste.type === 'paths') {
				const path = getPathForFile(item);
				if (path) {
					return path;
				}
			}

			return item.name;
		})) : undefined;
		const confirmation = await dialogService.confirm({
			message,
			detail,
			checkbox: {
				label: nls.localize('doNotAskAgain', "不再询问")
			},
			primaryButton: nls.localize({ key: 'pasteButtonLabel', comment: ['&& denotes a mnemonic'] }, "粘贴")
		});

		if (!confirmation.confirmed) {
			return;
		}

		// Check for confirmation checkbox
		if (confirmation.checkboxChecked === true) {
			await configurationService.updateValue('explorer.confirmPasteNative', false);
		}
	}
	const element = context.length ? context[0] : explorerService.roots[0];
	const incrementalNaming = configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;

	const editableItem = explorerService.getEditable();
	// If it's an editable item, just do nothing
	if (editableItem) {
		return;
	}

	try {
		let targets: URI[] = [];

		if (toPaste.type === 'paths') { // Pasting from files on disk

			// Check if target is ancestor of pasted folder
			const sourceTargetPairs = coalesce(await Promise.all(toPaste.files.map(async fileToPaste => {
				if (element.resource.toString() !== fileToPaste.toString() && resources.isEqualOrParent(element.resource, fileToPaste)) {
					throw new Error(nls.localize('fileIsAncestor', "要粘贴的文件是目标文件夹的上级目录"));
				}
				const fileToPasteStat = await fileService.stat(fileToPaste);

				// Find target
				let target: ExplorerItem;
				if (uriIdentityService.extUri.isEqual(element.resource, fileToPaste)) {
					target = element.parent!;
				} else {
					target = element.isDirectory ? element : element.parent!;
				}

				const targetFile = await findValidPasteFileTarget(
					explorerService,
					fileService,
					dialogService,
					target,
					{ resource: fileToPaste, isDirectory: fileToPasteStat.isDirectory, allowOverwrite: pasteShouldMove || incrementalNaming === 'disabled' },
					incrementalNaming
				);

				if (!targetFile) {
					return undefined;
				}

				return { source: fileToPaste, target: targetFile };
			})));

			if (sourceTargetPairs.length >= 1) {
				// Move/Copy File
				if (pasteShouldMove) {
					const resourceFileEdits = sourceTargetPairs.map(pair => new ResourceFileEdit(pair.source, pair.target, { overwrite: incrementalNaming === 'disabled' }));
					const options = {
						confirmBeforeUndo: configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose,
						progressLabel: sourceTargetPairs.length > 1 ? nls.localize({ key: 'movingBulkEdit', comment: ['Placeholder will be replaced by the number of files being moved'] }, "正在移动 {0} 个文件", sourceTargetPairs.length)
							: nls.localize({ key: 'movingFileBulkEdit', comment: ['Placeholder will be replaced by the name of the file moved.'] }, "正在移动 {0}", resources.basenameOrAuthority(sourceTargetPairs[0].target)),
						undoLabel: sourceTargetPairs.length > 1 ? nls.localize({ key: 'moveBulkEdit', comment: ['Placeholder will be replaced by the number of files being moved'] }, "移动 {0} 个文件", sourceTargetPairs.length)
							: nls.localize({ key: 'moveFileBulkEdit', comment: ['Placeholder will be replaced by the name of the file moved.'] }, "移动 {0}", resources.basenameOrAuthority(sourceTargetPairs[0].target))
					};
					await explorerService.applyBulkEdit(resourceFileEdits, options);
				} else {
					const resourceFileEdits = sourceTargetPairs.map(pair => new ResourceFileEdit(pair.source, pair.target, { copy: true, overwrite: incrementalNaming === 'disabled' }));
					await applyCopyResourceEdit(sourceTargetPairs.map(pair => pair.target), resourceFileEdits);
				}
			}

			targets = sourceTargetPairs.map(pair => pair.target);

		} else { // Pasting from file data
			const targetAndEdits = coalesce(await Promise.all(toPaste.files.map(async file => {
				const target = element.isDirectory ? element : element.parent!;

				const targetFile = await findValidPasteFileTarget(
					explorerService,
					fileService,
					dialogService,
					target,
					{ resource: file.name, isDirectory: false, allowOverwrite: pasteShouldMove || incrementalNaming === 'disabled' },
					incrementalNaming
				);
				if (!targetFile) {
					return;
				}
				return {
					target: targetFile,
					edit: new ResourceFileEdit(undefined, targetFile, {
						overwrite: incrementalNaming === 'disabled',
						contents: (async () => VSBuffer.wrap(new Uint8Array(await file.arrayBuffer())))(),
					})
				};
			})));

			await applyCopyResourceEdit(targetAndEdits.map(pair => pair.target), targetAndEdits.map(pair => pair.edit));
			targets = targetAndEdits.map(pair => pair.target);
		}

		if (targets.length) {
			const firstTarget = targets[0];
			await explorerService.select(firstTarget);
			if (targets.length === 1) {
				const item = explorerService.findClosest(firstTarget);
				if (item && !item.isDirectory) {
					await editorService.openEditor({ resource: item.resource, options: { pinned: true, preserveFocus: true } });
				}
			}
		}
	} catch (e) {
		notificationService.error(toErrorMessage(new Error(nls.localize('fileDeleted', "要粘贴的文件自复制后已被删除或移动。{0}", getErrorMessage(e))), false));
	} finally {
		if (pasteShouldMove) {
			// Cut is done. Make sure to clear cut state.
			await explorerService.setToCopy([], false);
			pasteShouldMove = false;
		}
	}

	async function applyCopyResourceEdit(targets: readonly URI[], resourceFileEdits: ResourceFileEdit[]) {
		const undoLevel = configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo;
		const options = {
			confirmBeforeUndo: undoLevel === UndoConfirmLevel.Default || undoLevel === UndoConfirmLevel.Verbose,
			progressLabel: targets.length > 1 ? nls.localize({ key: 'copyingBulkEdit', comment: ['Placeholder will be replaced by the number of files being copied'] }, "正在复制 {0} 个文件", targets.length)
				: nls.localize({ key: 'copyingFileBulkEdit', comment: ['Placeholder will be replaced by the name of the file copied.'] }, "正在复制 {0}", resources.basenameOrAuthority(targets[0])),
			undoLabel: targets.length > 1 ? nls.localize({ key: 'copyBulkEdit', comment: ['Placeholder will be replaced by the number of files being copied'] }, "粘贴 {0} 个文件", targets.length)
				: nls.localize({ key: 'copyFileBulkEdit', comment: ['Placeholder will be replaced by the name of the file copied.'] }, "粘贴 {0}", resources.basenameOrAuthority(targets[0]))
		};
		await explorerService.applyBulkEdit(resourceFileEdits, options);
	}
};

type FilesToPaste =
	| { type: 'paths'; files: URI[] }
	| { type: 'data'; files: File[] };

async function getFilesToPaste(fileList: FileList | undefined, clipboardService: IClipboardService, hostService: IHostService): Promise<FilesToPaste> {
	if (fileList && fileList.length > 0) {
		// with a `fileList` we support natively pasting file from disk from clipboard
		const resources = [...fileList].map(file => getPathForFile(file)).filter(filePath => !!filePath && isAbsolute(filePath)).map((filePath) => URI.file(filePath!));
		if (resources.length) {
			return { type: 'paths', files: resources, };
		}

		// Support pasting files that we can't read from disk
		return { type: 'data', files: [...fileList].filter(file => !getPathForFile(file)) };
	} else {
		// otherwise we fallback to reading resources from our clipboard service
		return { type: 'paths', files: resources.distinctParents(await clipboardService.readResources(), resource => resource) };
	}
}

export const openFilePreserveFocusHandler = async (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);

	await editorService.openEditors(stats.filter(s => !s.isDirectory).map(s => ({
		resource: s.resource,
		options: { preserveFocus: true }
	})));
};

class BaseSetActiveEditorReadonlyInSession extends Action2 {

	constructor(
		id: string,
		title: ILocalizedString,
		private readonly newReadonlyState: true | false | 'toggle' | 'reset'
	) {
		super({
			id,
			title,
			f1: true,
			category: Categories.File,
			precondition: ActiveEditorCanToggleReadonlyContext
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const filesConfigurationService = accessor.get(IFilesConfigurationService);

		const fileResource = EditorResourceAccessor.getOriginalUri(editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (!fileResource) {
			return;
		}

		await filesConfigurationService.updateReadonly(fileResource, this.newReadonlyState);
	}
}

export class SetActiveEditorReadonlyInSession extends BaseSetActiveEditorReadonlyInSession {

	static readonly ID = 'workbench.action.files.setActiveEditorReadonlyInSession';
	static readonly LABEL = nls.localize2('setActiveEditorReadonlyInSession', "在会话中将活动编辑器设为只读");

	constructor() {
		super(
			SetActiveEditorReadonlyInSession.ID,
			SetActiveEditorReadonlyInSession.LABEL,
			true
		);
	}
}

export class SetActiveEditorWriteableInSession extends BaseSetActiveEditorReadonlyInSession {

	static readonly ID = 'workbench.action.files.setActiveEditorWriteableInSession';
	static readonly LABEL = nls.localize2('setActiveEditorWriteableInSession', "在会话中将活动编辑器设为可写");

	constructor() {
		super(
			SetActiveEditorWriteableInSession.ID,
			SetActiveEditorWriteableInSession.LABEL,
			false
		);
	}
}

export class ToggleActiveEditorReadonlyInSession extends BaseSetActiveEditorReadonlyInSession {

	static readonly ID = 'workbench.action.files.toggleActiveEditorReadonlyInSession';
	static readonly LABEL = nls.localize2('toggleActiveEditorReadonlyInSession', "在会话中切换活动编辑器只读状态");

	constructor() {
		super(
			ToggleActiveEditorReadonlyInSession.ID,
			ToggleActiveEditorReadonlyInSession.LABEL,
			'toggle'
		);
	}
}

export class ResetActiveEditorReadonlyInSession extends BaseSetActiveEditorReadonlyInSession {

	static readonly ID = 'workbench.action.files.resetActiveEditorReadonlyInSession';
	static readonly LABEL = nls.localize2('resetActiveEditorReadonlyInSession', "在会话中重置活动编辑器只读状态");

	constructor() {
		super(
			ResetActiveEditorReadonlyInSession.ID,
			ResetActiveEditorReadonlyInSession.LABEL,
			'reset'
		);
	}
}
