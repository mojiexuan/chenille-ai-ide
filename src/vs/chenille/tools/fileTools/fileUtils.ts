/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';

/**
 * 文件工具辅助函数
 */

/**
 * 将相对路径解析为绝对 URI
 */
export function resolveFilePath(
	path: string,
	workspaceService: IWorkspaceContextService
): URI {
	// 如果已经是绝对路径或 URI
	if (path.startsWith('/') || path.startsWith('\\') || path.includes('://') || /^[a-zA-Z]:/.test(path)) {
		return URI.file(path);
	}

	// 相对路径，基于工作区根目录
	const workspaceFolders = workspaceService.getWorkspace().folders;
	if (workspaceFolders.length > 0) {
		return URI.joinPath(workspaceFolders[0].uri, path);
	}

	// 没有工作区，当作绝对路径处理
	return URI.file(path);
}

/**
 * 将 URI 转换为相对于工作区的路径
 */
export function toRelativePath(
	uri: URI,
	workspaceService: IWorkspaceContextService
): string {
	const workspaceFolders = workspaceService.getWorkspace().folders;
	if (workspaceFolders.length > 0) {
		const workspaceRoot = workspaceFolders[0].uri;
		const uriPath = uri.path;
		const rootPath = workspaceRoot.path;

		if (uriPath.startsWith(rootPath)) {
			const relative = uriPath.substring(rootPath.length);
			return relative.startsWith('/') ? relative.substring(1) : relative;
		}
	}
	return uri.fsPath;
}

/**
 * 计算文件行数
 */
export function countLines(content: string): number {
	if (content.length === 0) {
		return 0;
	}
	// 计算换行符数量 + 1（最后一行可能没有换行符）
	let count = 1;
	for (let i = 0; i < content.length; i++) {
		if (content[i] === '\n') {
			count++;
		}
	}
	// 如果文件以换行符结尾，不额外计数
	if (content.endsWith('\n')) {
		count--;
	}
	return count;
}

/**
 * 将内容按行分割
 */
export function splitLines(content: string): string[] {
	if (content.length === 0) {
		return [];
	}
	const lines = content.split('\n');
	// 如果最后一行是空的（文件以换行符结尾），移除它
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

/**
 * 获取指定行范围的内容
 * @param content 文件内容
 * @param startLine 起始行（1-based）
 * @param endLine 结束行（-1 表示末尾）
 */
export function getLineRange(
	content: string,
	startLine: number,
	endLine: number
): { content: string; actualStart: number; actualEnd: number } {
	const lines = splitLines(content);
	const totalLines = lines.length;

	// 规范化行号
	let actualStart = Math.max(1, startLine);
	let actualEnd = endLine === -1 ? totalLines : Math.min(endLine, totalLines);

	if (actualStart > totalLines) {
		return { content: '', actualStart: totalLines, actualEnd: totalLines };
	}

	if (actualEnd < actualStart) {
		actualEnd = actualStart;
	}

	// 提取行（转换为 0-based 索引）
	const selectedLines = lines.slice(actualStart - 1, actualEnd);
	return {
		content: selectedLines.join('\n'),
		actualStart,
		actualEnd
	};
}

/**
 * 在内容中查找所有匹配项
 */
export function findAllMatches(
	content: string,
	query: string,
	options: { isRegex?: boolean; caseSensitive?: boolean } = {}
): Array<{ line: number; column: number; matchText: string; lineContent: string }> {
	const { isRegex = false, caseSensitive = true } = options;
	const lines = splitLines(content);
	const matches: Array<{ line: number; column: number; matchText: string; lineContent: string }> = [];

	let searchPattern: RegExp;
	if (isRegex) {
		try {
			searchPattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
		} catch {
			// 无效正则，当作普通文本处理
			searchPattern = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
		}
	} else {
		searchPattern = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let match: RegExpExecArray | null;

		// 重置 lastIndex
		searchPattern.lastIndex = 0;

		while ((match = searchPattern.exec(line)) !== null) {
			matches.push({
				line: i + 1,  // 1-based
				column: match.index + 1,  // 1-based
				matchText: match[0],
				lineContent: line
			});

			// 防止无限循环（空匹配）
			if (match[0].length === 0) {
				searchPattern.lastIndex++;
			}
		}
	}

	return matches;
}

/**
 * 查找多行文本在内容中的位置
 */
export function findMultilineText(
	content: string,
	searchText: string,
	caseSensitive: boolean = true
): Array<{ startLine: number; endLine: number; startColumn: number; preview: string }> {
	const results: Array<{ startLine: number; endLine: number; startColumn: number; preview: string }> = [];

	const contentToSearch = caseSensitive ? content : content.toLowerCase();
	const textToFind = caseSensitive ? searchText : searchText.toLowerCase();

	let searchStart = 0;
	let index: number;

	while ((index = contentToSearch.indexOf(textToFind, searchStart)) !== -1) {
		// 计算行号
		const beforeMatch = content.substring(0, index);
		const startLine = countLines(beforeMatch + 'x');  // +x 确保最后一行被计数

		// 计算列号
		const lastNewline = beforeMatch.lastIndexOf('\n');
		const startColumn = lastNewline === -1 ? index + 1 : index - lastNewline;

		// 计算结束行
		const matchContent = content.substring(index, index + searchText.length);
		const matchLines = countLines(matchContent + 'x');
		const endLine = startLine + matchLines - 1;

		// 生成预览（最多显示 50 字符）
		const preview = matchContent.length > 50
			? matchContent.substring(0, 47) + '...'
			: matchContent;

		results.push({
			startLine,
			endLine,
			startColumn,
			preview: preview.replace(/\n/g, '↵')
		});

		searchStart = index + 1;
	}

	return results;
}

/**
 * 替换内容中的文本
 */
export function replaceText(
	content: string,
	oldText: string,
	newText: string
): { newContent: string; replacedCount: number; lineNumbers: number[] } {
	const locations = findMultilineText(content, oldText, true);
	const lineNumbers = locations.map(loc => loc.startLine);

	// 从后向前替换，避免位置偏移
	let newContent = content;

	// 简单替换所有匹配
	newContent = content.split(oldText).join(newText);

	return {
		newContent,
		replacedCount: locations.length,
		lineNumbers: [...new Set(lineNumbers)].sort((a, b) => a - b)
	};
}

/**
 * 在指定行后插入内容
 */
export function insertAtLine(
	content: string,
	lineNumber: number,
	insertContent: string
): string {
	const lines = splitLines(content);

	if (lineNumber <= 0) {
		// 在文件开头插入
		return insertContent + (content.length > 0 ? '\n' + content : '');
	}

	if (lineNumber >= lines.length) {
		// 在文件末尾插入
		const needsNewline = content.length > 0 && !content.endsWith('\n');
		return content + (needsNewline ? '\n' : '') + insertContent;
	}

	// 在中间插入
	const before = lines.slice(0, lineNumber);
	const after = lines.slice(lineNumber);

	return [...before, insertContent, ...after].join('\n');
}

/**
 * 删除指定行范围
 */
export function deleteLineRange(
	content: string,
	startLine: number,
	endLine: number
): { newContent: string; deletedContent: string } {
	const lines = splitLines(content);
	const totalLines = lines.length;

	// 规范化行号
	const actualStart = Math.max(1, Math.min(startLine, totalLines));
	const actualEnd = Math.max(actualStart, Math.min(endLine, totalLines));

	// 提取要删除的内容
	const deletedLines = lines.slice(actualStart - 1, actualEnd);
	const deletedContent = deletedLines.join('\n');

	// 构建新内容
	const before = lines.slice(0, actualStart - 1);
	const after = lines.slice(actualEnd);
	const newContent = [...before, ...after].join('\n');

	return { newContent, deletedContent };
}

/**
 * 转义正则表达式特殊字符
 */
export function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检测文件编码（简化版）
 */
export function detectEncoding(buffer: Uint8Array): string {
	// 检查 BOM
	if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
		return 'utf-8-bom';
	}
	if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
		return 'utf-16be';
	}
	if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
		return 'utf-16le';
	}

	// 默认 UTF-8
	return 'utf-8';
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 检查是否为二进制文件（简化检测）
 */
export function isBinaryContent(buffer: Uint8Array): boolean {
	// 检查前 8000 字节中是否有 NULL 字符
	const checkLength = Math.min(buffer.length, 8000);
	for (let i = 0; i < checkLength; i++) {
		if (buffer[i] === 0) {
			return true;
		}
	}
	return false;
}

/**
 * 匹配 glob 模式（简化版）
 */
export function matchGlob(pattern: string, path: string): boolean {
	// 将 glob 转换为正则表达式
	const regexPattern = pattern
		.replace(/\./g, '\\.')
		.replace(/\*\*/g, '{{GLOBSTAR}}')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]')
		.replace(/{{GLOBSTAR}}/g, '.*');

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(path);
}
