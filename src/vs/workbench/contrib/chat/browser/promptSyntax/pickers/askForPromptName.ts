/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import { getPromptFileExtension } from '../../../common/promptSyntax/config/promptFileLocations.js';
import { PromptsType } from '../../../common/promptSyntax/promptTypes.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import Severity from '../../../../../../base/common/severity.js';
import { isValidBasename } from '../../../../../../base/common/extpath.js';
import { ServicesAccessor } from '../../../../../../editor/browser/editorExtensions.js';

/**
 * Asks the user for a file name.
 */
export async function askForPromptFileName(
	accessor: ServicesAccessor,
	type: PromptsType,
	selectedFolder: URI,
	existingFileName?: string
): Promise<string | undefined> {
	const quickInputService = accessor.get(IQuickInputService);
	const fileService = accessor.get(IFileService);

	const sanitizeInput = (input: string) => {
		const trimmedName = input.trim();
		if (!trimmedName) {
			return undefined;
		}

		const fileExtension = getPromptFileExtension(type);
		return (trimmedName.endsWith(fileExtension))
			? trimmedName
			: `${trimmedName}${fileExtension}`;
	};

	const validateInput = async (value: string) => {
		const fileName = sanitizeInput(value);
		if (!fileName) {
			return {
				content: localize('askForPromptFileName.error.empty', "请输入名称。"),
				severity: Severity.Warning
			};
		}

		if (!isValidBasename(fileName)) {
			return {
				content: localize('askForPromptFileName.error.invalid', "名称包含无效字符。"),
				severity: Severity.Error
			};
		}

		const fileUri = URI.joinPath(selectedFolder, fileName);
		if (await fileService.exists(fileUri)) {
			return {
				content: localize('askForPromptFileName.error.exists', "该名称的文件已存在。"),
				severity: Severity.Error
			};
		}

		return undefined;
	};
	const placeHolder = existingFileName ? getPlaceholderStringForRename(type) : getPlaceholderStringForNew(type);
	const result = await quickInputService.input({ placeHolder, validateInput, value: existingFileName });
	if (!result) {
		return undefined;
	}

	return sanitizeInput(result);
}

function getPlaceholderStringForNew(type: PromptsType): string {
	switch (type) {
		case PromptsType.instructions:
			return localize('askForInstructionsFileName.placeholder', "输入指令文件的名称");
		case PromptsType.prompt:
			return localize('askForPromptFileName.placeholder', "输入提示文件的名称");
		case PromptsType.agent:
			return localize('askForAgentFileName.placeholder', "输入智能体文件的名称");
		default:
			throw new Error('Unknown prompt type');
	}
}

function getPlaceholderStringForRename(type: PromptsType): string {
	switch (type) {
		case PromptsType.instructions:
			return localize('askForRenamedInstructionsFileName.placeholder', "输入指令文件的新名称");
		case PromptsType.prompt:
			return localize('askForRenamedPromptFileName.placeholder', "输入提示文件的新名称");
		case PromptsType.agent:
			return localize('askForRenamedAgentFileName.placeholder', "输入智能体文件的新名称");
		default:
			throw new Error('Unknown prompt type');
	}
}
