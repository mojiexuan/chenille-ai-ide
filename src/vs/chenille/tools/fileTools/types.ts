/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 文件工具类型定义
 */

// ==================== 通用类型 ====================

export interface FileToolResult<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	errorCode?: FileToolErrorCode;
}

export type FileToolErrorCode =
	| 'FILE_NOT_FOUND'
	| 'DIRECTORY_NOT_FOUND'
	| 'ALREADY_EXISTS'
	| 'PERMISSION_DENIED'
	| 'INVALID_PATH'
	| 'NOT_A_FILE'
	| 'NOT_A_DIRECTORY'
	| 'LINE_OUT_OF_RANGE'
	| 'TEXT_NOT_FOUND'
	| 'MULTIPLE_MATCHES'
	| 'CONTENT_CHANGED'
	| 'ENCODING_ERROR'
	| 'FILE_TOO_LARGE'
	| 'UNKNOWN_ERROR';

// ==================== readFile ====================

export interface ReadFileParams {
	path: string;
	startLine?: number;  // 1-based
	endLine?: number;    // -1 表示末尾
}

export interface ReadFileResult {
	content: string;
	totalLines: number;
	readRange: [number, number];  // [startLine, endLine]
	encoding: string;
}

// ==================== getFileInfo ====================

export interface GetFileInfoParams {
	path: string;
}

export interface GetFileInfoResult {
	exists: boolean;
	isFile: boolean;
	isDirectory: boolean;
	size: number;
	lineCount: number;
	encoding: string;
	lastModified: string;
}

// ==================== checkFileExists ====================

export interface CheckFileExistsParams {
	path: string;
}

export interface CheckFileExistsResult {
	exists: boolean;
	type: 'file' | 'directory' | 'none';
}

// ==================== listDirectory ====================

export interface ListDirectoryParams {
	path: string;
	recursive?: boolean;
	maxDepth?: number;
	pattern?: string;
	includeHidden?: boolean;
}

export interface DirectoryEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number;
}

export interface ListDirectoryResult {
	entries: DirectoryEntry[];
	truncated: boolean;
	totalCount: number;
}

// ==================== findFiles ====================

export interface FindFilesParams {
	pattern: string;
	excludePattern?: string;
	maxResults?: number;
	cwd?: string;
}

export interface FindFilesResult {
	files: string[];
	truncated: boolean;
	totalFound: number;
}

// ==================== searchInFile ====================

export interface SearchInFileParams {
	path: string;
	query: string;
	isRegex?: boolean;
	caseSensitive?: boolean;
	contextLines?: number;
}

export interface SearchMatch {
	line: number;
	column: number;
	content: string;
	matchText: string;
	context: {
		before: string[];
		after: string[];
	};
}

export interface SearchInFileResult {
	matches: SearchMatch[];
	totalMatches: number;
}

// ==================== searchInFiles ====================

export interface SearchInFilesParams {
	query: string;
	filePattern?: string;
	path?: string;
	isRegex?: boolean;
	caseSensitive?: boolean;
	maxResults?: number;
	contextLines?: number;
}

export interface FileSearchResult {
	file: string;
	matches: Omit<SearchMatch, 'context'>[];
}

export interface SearchInFilesResult {
	results: FileSearchResult[];
	truncated: boolean;
	totalMatches: number;
	filesSearched: number;
}

// ==================== replaceInFile ====================

export interface ReplaceInFileParams {
	path: string;
	oldText: string;
	newText: string;
	expectedOccurrences?: number;
}

export interface ReplaceLocation {
	line: number;
	column: number;
	preview: string;
}

export interface ReplaceInFileSuccessResult {
	success: true;
	replacedCount: number;
	lineNumbers: number[];
}

export interface ReplaceInFileFailureResult {
	success: false;
	error: string;
	reason: 'NOT_FOUND' | 'MULTIPLE_MATCHES' | 'CONTENT_CHANGED' | 'OCCURRENCE_MISMATCH';
	details: {
		foundCount: number;
		locations: ReplaceLocation[];
		suggestion: string;
	};
}

export type ReplaceInFileResult = ReplaceInFileSuccessResult | ReplaceInFileFailureResult;

// ==================== insertInFile ====================

export interface InsertInFileParams {
	path: string;
	line: number;  // 在此行之后插入，0 表示文件开头
	content: string;
}

export interface InsertInFileResult {
	success: boolean;
	newLineCount: number;
	insertedAt: number;
}

// ==================== deleteLines ====================

export interface DeleteLinesParams {
	path: string;
	startLine: number;
	endLine: number;
}

export interface DeleteLinesResult {
	success: boolean;
	deletedContent: string;
	deletedLineCount: number;
	newLineCount: number;
}

// ==================== createFile ====================

export interface CreateFileParams {
	path: string;
	content?: string;
	overwrite?: boolean;
}

export interface CreateFileResult {
	success: boolean;
	created: boolean;
	lineCount: number;
}

// ==================== deleteFile ====================

export interface DeleteFileParams {
	path: string;
}

export interface DeleteFileResult {
	success: boolean;
	deleted: boolean;
}

// ==================== renameFile ====================

export interface RenameFileParams {
	oldPath: string;
	newPath: string;
	overwrite?: boolean;
}

export interface RenameFileResult {
	success: boolean;
	renamed: boolean;
}


// ==================== getOpenEditors ====================

export interface GetOpenEditorsParams {
	/** 是否只返回活动编辑器，默认 false 返回所有打开的编辑器 */
	activeOnly?: boolean;
}

export interface OpenEditorInfo {
	/** 文件路径（相对于工作区） */
	path: string;
	/** 文件名 */
	name: string;
	/** 是否为当前活动编辑器 */
	isActive: boolean;
	/** 是否有未保存的更改 */
	isDirty: boolean;
	/** 编辑器所在的组索引 */
	groupIndex: number;
}

export interface GetOpenEditorsResult {
	/** 打开的编辑器列表 */
	editors: OpenEditorInfo[];
	/** 活动编辑器的路径（如果有） */
	activeEditorPath: string | null;
	/** 打开的编辑器总数 */
	totalCount: number;
}


// ==================== editFile ====================

export interface EditFileParams {
	/** 文件路径 */
	path: string;
	/** 新的文件内容（全文覆盖） */
	content: string;
	/** 修改说明（可选） */
	explanation?: string;
}

export interface EditFileResult {
	success: boolean;
	/** 是否为新创建的文件 */
	created: boolean;
	/** 文件行数 */
	lineCount: number;
	/** 原文件行数（如果是修改） */
	originalLineCount?: number;
}



// ==================== appendToFile ====================

export interface AppendToFileParams {
	/** 文件路径 */
	path: string;
	/** 要追加的内容 */
	content: string;
}

export interface AppendToFileResult {
	success: boolean;
	/** 追加的行数 */
	appendedLines: number;
	/** 文件新的总行数 */
	newLineCount: number;
}

// ==================== getSystemInfo ====================

export interface GetSystemInfoParams {
	// 无参数
}

export interface GetSystemInfoResult {
	/** 平台标识：win32, darwin, linux */
	platform: string;
	/** 友好的操作系统名称 */
	osName: string;
	/** CPU 架构：x64, arm64 等 */
	arch: string;
	/** Node.js 版本 */
	nodeVersion: string;
	/** 用户主目录 */
	homeDir: string;
	/** 默认 shell */
	shell: string;
}

// ==================== getCurrentTime ====================

export interface GetCurrentTimeParams {
	/** 时间格式：iso, locale, date, time, timestamp */
	format?: 'iso' | 'locale' | 'date' | 'time' | 'timestamp';
}

export interface GetCurrentTimeResult {
	/** ISO 8601 格式时间 */
	iso: string;
	/** Unix 时间戳（毫秒） */
	timestamp: number;
	/** 按指定格式格式化的时间 */
	formatted: string;
	/** 时区名称 */
	timezone: string;
	/** 时区偏移（分钟） */
	timezoneOffset: number;
}



// ==================== getWorkspaceSymbols ====================

export interface GetWorkspaceSymbolsParams {
	/** 搜索查询（符号名称的部分匹配） */
	query?: string;
	/** 最大返回结果数 */
	maxResults?: number;
	/** 符号类型过滤：class, function, method, variable, interface, enum 等 */
	kindFilter?: string[];
}

export interface WorkspaceSymbolInfo {
	/** 符号名称 */
	name: string;
	/** 符号类型 */
	kind: string;
	/** 容器名称（如类名） */
	containerName?: string;
	/** 位置信息 */
	location: {
		file: string;
		line: number;
		column: number;
	};
}

export interface GetWorkspaceSymbolsResult {
	/** 搜索查询 */
	query: string;
	/** 总共找到的符号数 */
	totalFound: number;
	/** 返回的符号数 */
	returned: number;
	/** 符号列表 */
	symbols: WorkspaceSymbolInfo[];
}

// ==================== getFileOutline ====================

export interface GetFileOutlineParams {
	/** 文件路径 */
	path: string;
}

export interface OutlineSymbol {
	/** 符号名称 */
	name: string;
	/** 符号类型 */
	kind: string;
	/** 详细信息 */
	detail?: string;
	/** 行范围 */
	range: {
		startLine: number;
		endLine: number;
	};
	/** 子符号 */
	children?: OutlineSymbol[];
}

export interface GetFileOutlineResult {
	/** 文件路径 */
	file: string;
	/** 顶层符号总数 */
	totalSymbols: number;
	/** 大纲结构 */
	outline: OutlineSymbol[];
}
