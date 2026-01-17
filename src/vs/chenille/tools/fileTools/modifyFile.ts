/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, FileOperationError, FileOperationResult } from '../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import {
	FileToolResult,
	ReplaceInFileParams,
	ReplaceInFileResult,
	ReplaceLocation,
	InsertInFileParams,
	InsertInFileResult,
	DeleteLinesParams,
	DeleteLinesResult,
	CreateFileParams,
	CreateFileResult,
	DeleteFileParams,
	DeleteFileResult,
	RenameFileParams,
	RenameFileResult,
	EditFileParams,
	EditFileResult,
	AppendToFileParams,
	AppendToFileResult,
} from './types.js';
import {
	resolveFilePath,
	findMultilineText,
	replaceText,
	insertAtLine,
	deleteLineRange,
	countLines
} from './fileUtils.js';

/**
 * 替换文件中的文本（核心工具）
 */
export async function replaceInFile(
	params: ReplaceInFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<ReplaceInFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);
		const expectedOccurrences = params.expectedOccurrences ?? 1;

		// 读取文件
		let content: string;
		try {
			const fileContent = await fileService.readFile(uri);
			content = fileContent.value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return {
					success: false,
					data: {
						success: false,
						error: `文件 "${params.path}" 不存在`,
						reason: 'NOT_FOUND',
						details: {
							foundCount: 0,
							locations: [],
							suggestion: '请检查文件路径是否正确，或使用 findFiles 工具搜索文件。'
						}
					}
				};
			}
			throw error;
		}

		// 查找所有匹配
		const locations = findMultilineText(content, params.oldText, true);

		// 检查匹配数量
		if (locations.length === 0) {
			// 尝试不区分大小写搜索，给出提示
			const caseInsensitiveLocations = findMultilineText(content, params.oldText, false);

			let suggestion = '未找到要替换的文本。';
			if (caseInsensitiveLocations.length > 0) {
				suggestion += ` 找到 ${caseInsensitiveLocations.length} 个大小写不同的匹配。请检查大小写是否正确。`;
			} else {
				suggestion += ' 请使用 searchInFile 工具确认文本内容，或使用 readFile 查看文件。';
			}

			return {
				success: false,
				data: {
					success: false,
					error: '未找到要替换的文本',
					reason: 'NOT_FOUND',
					details: {
						foundCount: 0,
						locations: caseInsensitiveLocations.map(loc => ({
							line: loc.startLine,
							column: loc.startColumn,
							preview: loc.preview
						})),
						suggestion
					}
				}
			};
		}

		if (locations.length > 1 && expectedOccurrences === 1) {
			// 找到多个匹配，需要更精确的上下文
			const locationDetails: ReplaceLocation[] = locations.map(loc => ({
				line: loc.startLine,
				column: loc.startColumn,
				preview: loc.preview
			}));

			return {
				success: false,
				data: {
					success: false,
					error: `找到 ${locations.length} 个匹配，无法确定要替换哪一个`,
					reason: 'MULTIPLE_MATCHES',
					details: {
						foundCount: locations.length,
						locations: locationDetails,
						suggestion: '请提供更多上下文以唯一标识要替换的文本，或设置 expectedOccurrences 参数来替换所有匹配。'
					}
				}
			};
		}

		if (locations.length !== expectedOccurrences && expectedOccurrences > 1) {
			return {
				success: false,
				data: {
					success: false,
					error: `期望找到 ${expectedOccurrences} 个匹配，但实际找到 ${locations.length} 个`,
					reason: 'OCCURRENCE_MISMATCH',
					details: {
						foundCount: locations.length,
						locations: locations.map(loc => ({
							line: loc.startLine,
							column: loc.startColumn,
							preview: loc.preview
						})),
						suggestion: '请检查 expectedOccurrences 参数是否正确。'
					}
				}
			};
		}

		// 执行替换
		const { newContent, replacedCount, lineNumbers } = replaceText(content, params.oldText, params.newText);

		// 写入文件
		await fileService.writeFile(uri, VSBuffer.fromString(newContent));

		return {
			success: true,
			data: {
				success: true,
				replacedCount,
				lineNumbers
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `替换失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 在指定行后插入内容
 */
export async function insertInFile(
	params: InsertInFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<InsertInFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);

		// 读取文件
		const fileContent = await fileService.readFile(uri);
		const content = fileContent.value.toString();
		const totalLines = countLines(content);

		// 验证行号
		if (params.line < 0) {
			return {
				success: false,
				error: '行号不能为负数',
				errorCode: 'LINE_OUT_OF_RANGE'
			};
		}

		if (params.line > totalLines) {
			return {
				success: false,
				error: `行号 ${params.line} 超出文件范围（文件共 ${totalLines} 行）`,
				errorCode: 'LINE_OUT_OF_RANGE'
			};
		}

		// 插入内容
		const newContent = insertAtLine(content, params.line, params.content);
		const newLineCount = countLines(newContent);

		// 写入文件
		await fileService.writeFile(uri, VSBuffer.fromString(newContent));

		return {
			success: true,
			data: {
				success: true,
				newLineCount,
				insertedAt: params.line + 1
			}
		};

	} catch (error) {
		if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
			return {
				success: false,
				error: `文件 "${params.path}" 不存在`,
				errorCode: 'FILE_NOT_FOUND'
			};
		}

		return {
			success: false,
			error: `插入失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 删除指定行范围
 */
export async function deleteLines(
	params: DeleteLinesParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<DeleteLinesResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);

		// 读取文件
		const fileContent = await fileService.readFile(uri);
		const content = fileContent.value.toString();
		const totalLines = countLines(content);

		// 验证行号
		if (params.startLine < 1 || params.startLine > totalLines) {
			return {
				success: false,
				error: `起始行号 ${params.startLine} 超出范围（文件共 ${totalLines} 行）`,
				errorCode: 'LINE_OUT_OF_RANGE'
			};
		}

		if (params.endLine < params.startLine) {
			return {
				success: false,
				error: `结束行号 ${params.endLine} 不能小于起始行号 ${params.startLine}`,
				errorCode: 'LINE_OUT_OF_RANGE'
			};
		}

		// 删除行
		const { newContent, deletedContent } = deleteLineRange(content, params.startLine, params.endLine);
		const deletedLineCount = Math.min(params.endLine, totalLines) - params.startLine + 1;
		const newLineCount = countLines(newContent);

		// 写入文件
		await fileService.writeFile(uri, VSBuffer.fromString(newContent));

		return {
			success: true,
			data: {
				success: true,
				deletedContent,
				deletedLineCount,
				newLineCount
			}
		};

	} catch (error) {
		if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
			return {
				success: false,
				error: `文件 "${params.path}" 不存在`,
				errorCode: 'FILE_NOT_FOUND'
			};
		}

		return {
			success: false,
			error: `删除失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 创建文件
 */
export async function createFile(
	params: CreateFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<CreateFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);
		const content = params.content ?? '';
		const overwrite = params.overwrite ?? false;

		// 检查文件是否已存在
		const exists = await fileService.exists(uri);
		if (exists && !overwrite) {
			return {
				success: false,
				error: `文件 "${params.path}" 已存在。如需覆盖，请设置 overwrite: true`,
				errorCode: 'ALREADY_EXISTS'
			};
		}

		// 创建文件
		await fileService.writeFile(uri, VSBuffer.fromString(content));

		return {
			success: true,
			data: {
				success: true,
				created: true,
				lineCount: countLines(content)
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `创建文件失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 删除文件
 */
export async function deleteFile(
	params: DeleteFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<DeleteFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);

		// 检查文件是否存在
		const exists = await fileService.exists(uri);
		if (!exists) {
			return {
				success: true,
				data: {
					success: true,
					deleted: false  // 文件本来就不存在
				}
			};
		}

		// 检查是否为目录
		const stat = await fileService.stat(uri);
		if (stat.isDirectory) {
			return {
				success: false,
				error: `"${params.path}" 是一个目录，不能使用此工具删除`,
				errorCode: 'NOT_A_FILE'
			};
		}

		// 删除文件
		await fileService.del(uri);

		return {
			success: true,
			data: {
				success: true,
				deleted: true
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `删除文件失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 重命名/移动文件
 */
export async function renameFile(
	params: RenameFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<RenameFileResult>> {
	try {
		const oldUri = resolveFilePath(params.oldPath, workspaceService);
		const newUri = resolveFilePath(params.newPath, workspaceService);
		const overwrite = params.overwrite ?? false;

		// 检查源文件是否存在
		const sourceExists = await fileService.exists(oldUri);
		if (!sourceExists) {
			return {
				success: false,
				error: `源文件 "${params.oldPath}" 不存在`,
				errorCode: 'FILE_NOT_FOUND'
			};
		}

		// 检查目标是否已存在
		const targetExists = await fileService.exists(newUri);
		if (targetExists && !overwrite) {
			return {
				success: false,
				error: `目标文件 "${params.newPath}" 已存在。如需覆盖，请设置 overwrite: true`,
				errorCode: 'ALREADY_EXISTS'
			};
		}

		// 移动/重命名文件
		await fileService.move(oldUri, newUri, overwrite);

		return {
			success: true,
			data: {
				success: true,
				renamed: true
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `重命名失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}


/**
 * 编辑文件（全文覆盖）
 * 如果文件不存在则创建
 */
export async function editFile(
	params: EditFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<EditFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);
		const newContent = params.content;
		const newLineCount = countLines(newContent);

		// 检查文件是否已存在
		let originalLineCount: number | undefined;
		let isCreated = false;

		try {
			const existingContent = await fileService.readFile(uri);
			originalLineCount = countLines(existingContent.value.toString());
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				// 文件不存在，将创建新文件
				isCreated = true;
			} else {
				throw error;
			}
		}

		// 写入文件
		await fileService.writeFile(uri, VSBuffer.fromString(newContent));

		return {
			success: true,
			data: {
				success: true,
				created: isCreated,
				lineCount: newLineCount,
				originalLineCount
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `编辑文件失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}



/**
 * 向文件末尾追加内容
 */
export async function appendToFile(
	params: AppendToFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<AppendToFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);

		let existingContent = '';
		let fileExists = true;

		// 尝试读取现有内容
		try {
			const fileContent = await fileService.readFile(uri);
			existingContent = fileContent.value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				fileExists = false;
			} else {
				throw error;
			}
		}

		// 计算追加的行数
		const appendedLines = countLines(params.content);

		// 构建新内容
		let newContent: string;
		if (!fileExists || existingContent === '') {
			newContent = params.content;
		} else {
			// 确保现有内容以换行符结尾
			if (!existingContent.endsWith('\n') && !existingContent.endsWith('\r\n')) {
				newContent = existingContent + '\n' + params.content;
			} else {
				newContent = existingContent + params.content;
			}
		}

		const newLineCount = countLines(newContent);

		// 写入文件
		await fileService.writeFile(uri, VSBuffer.fromString(newContent));

		return {
			success: true,
			data: {
				success: true,
				appendedLines,
				newLineCount
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `追加内容失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}
