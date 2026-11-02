/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, FileOperationError, FileOperationResult } from '../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import {
	FileToolResult,
	ReadFileParams,
	ReadFileResult,
	GetFileInfoParams,
	GetFileInfoResult,
	CheckFileExistsParams,
	CheckFileExistsResult
} from './types.js';
import {
	resolveFilePath,
	countLines,
	getLineRange,
	detectEncoding,
	isBinaryContent
} from './fileUtils.js';

// ==================== 常量配置 ====================

/** 默认最大读取行数 */
const DEFAULT_MAX_LINES = 500;

/** 绝对最大读取行数（即使指定了更大的范围也不会超过） */
const ABSOLUTE_MAX_LINES = 2000;

/** 最大文件大小（字节），超过此大小必须指定行范围 */
const MAX_FILE_SIZE_FOR_FULL_READ = 100 * 1024; // 100KB

/** 单行最大长度，超过会被截断 */
const MAX_LINE_LENGTH = 500;

/**
 * 读取文件内容
 */
export async function readFile(
	params: ReadFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<ReadFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);

		// 检查文件是否存在
		const stat = await fileService.stat(uri);
		if (stat.isDirectory) {
			return {
				success: false,
				error: `路径 "${params.path}" 是一个目录，不是文件`,
				errorCode: 'NOT_A_FILE'
			};
		}

		// 检查文件大小
		const fileSize = stat.size;
		const hasLineRange = params.startLine !== undefined || params.endLine !== undefined;

		if (fileSize > MAX_FILE_SIZE_FOR_FULL_READ && !hasLineRange) {
			return {
				success: false,
				error: `文件 "${params.path}" 太大（${formatSize(fileSize)}），请指定 startLine 和 endLine 参数分段读取。建议先使用 getFileInfo 获取文件行数。`,
				errorCode: 'FILE_TOO_LARGE'
			};
		}

		// 读取文件内容
		const content = await fileService.readFile(uri);
		const buffer = content.value.buffer;

		// 检查是否为二进制文件
		if (isBinaryContent(new Uint8Array(buffer))) {
			return {
				success: false,
				error: `文件 "${params.path}" 是二进制文件，无法作为文本读取`,
				errorCode: 'ENCODING_ERROR'
			};
		}

		const encoding = detectEncoding(new Uint8Array(buffer));
		const textContent = content.value.toString();
		const totalLines = countLines(textContent);

		// 处理行范围
		let startLine = params.startLine ?? 1;
		let endLine = params.endLine ?? -1;

		// 如果没有指定结束行，限制最大读取行数
		if (endLine === -1) {
			endLine = Math.min(startLine + DEFAULT_MAX_LINES - 1, totalLines);
		}

		// 确保不超过绝对最大行数
		const requestedLines = endLine - startLine + 1;
		if (requestedLines > ABSOLUTE_MAX_LINES) {
			endLine = startLine + ABSOLUTE_MAX_LINES - 1;
		}

		// 读取指定行范围
		const { content: rangeContent, actualStart, actualEnd } = getLineRange(textContent, startLine, endLine);

		// 截断过长的行
		const truncatedContent = truncateLongLines(rangeContent, MAX_LINE_LENGTH);
		const wasTruncated = truncatedContent !== rangeContent;

		// 构建返回结果
		const result: ReadFileResult = {
			content: truncatedContent,
			totalLines,
			readRange: [actualStart, actualEnd],
			encoding
		};

		// 添加提示信息
		let hint = '';
		if (actualEnd < totalLines) {
			hint = `\n\n[提示: 文件共 ${totalLines} 行，当前显示第 ${actualStart}-${actualEnd} 行。使用 startLine=${actualEnd + 1} 继续读取]`;
		}
		if (wasTruncated) {
			hint += '\n[提示: 部分过长的行已被截断]';
		}

		if (hint) {
			result.content = truncatedContent + hint;
		}

		return {
			success: true,
			data: result
		};

	} catch (error) {
		if (error instanceof FileOperationError) {
			if (error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return {
					success: false,
					error: `文件 "${params.path}" 不存在。建议使用 findFiles 工具搜索正确的文件路径。`,
					errorCode: 'FILE_NOT_FOUND'
				};
			}
			if (error.fileOperationResult === FileOperationResult.FILE_IS_DIRECTORY) {
				return {
					success: false,
					error: `路径 "${params.path}" 是一个目录`,
					errorCode: 'NOT_A_FILE'
				};
			}
		}

		return {
			success: false,
			error: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 截断过长的行
 */
function truncateLongLines(content: string, maxLength: number): string {
	const lines = content.split('\n');
	const truncatedLines = lines.map(line => {
		if (line.length > maxLength) {
			return line.substring(0, maxLength) + '... [行已截断]';
		}
		return line;
	});
	return truncatedLines.join('\n');
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 获取文件信息
 */
export async function getFileInfo(
	params: GetFileInfoParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<GetFileInfoResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);

		// 检查是否存在
		const exists = await fileService.exists(uri);
		if (!exists) {
			return {
				success: true,
				data: {
					exists: false,
					isFile: false,
					isDirectory: false,
					size: 0,
					lineCount: 0,
					encoding: '',
					lastModified: ''
				}
			};
		}

		const stat = await fileService.stat(uri);

		let lineCount = 0;
		let encoding = 'utf-8';

		// 如果是文件，读取内容获取行数和编码
		if (!stat.isDirectory) {
			try {
				const content = await fileService.readFile(uri);
				const buffer = new Uint8Array(content.value.buffer);

				if (!isBinaryContent(buffer)) {
					encoding = detectEncoding(buffer);
					lineCount = countLines(content.value.toString());
				} else {
					encoding = 'binary';
				}
			} catch {
				// 无法读取内容，忽略
			}
		}

		return {
			success: true,
			data: {
				exists: true,
				isFile: !stat.isDirectory,
				isDirectory: stat.isDirectory,
				size: stat.size,
				lineCount,
				encoding,
				lastModified: new Date(stat.mtime).toISOString()
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `获取文件信息失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 检查文件是否存在
 */
export async function checkFileExists(
	params: CheckFileExistsParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<CheckFileExistsResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);

		const exists = await fileService.exists(uri);
		if (!exists) {
			return {
				success: true,
				data: {
					exists: false,
					type: 'none'
				}
			};
		}

		const stat = await fileService.stat(uri);
		return {
			success: true,
			data: {
				exists: true,
				type: stat.isDirectory ? 'directory' : 'file'
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `检查文件存在性失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}
