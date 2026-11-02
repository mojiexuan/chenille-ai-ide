/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, FileOperationError, FileOperationResult } from '../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { ISearchService, QueryType, ITextQuery } from '../../../workbench/services/search/common/search.js';
import {
	FileToolResult,
	SearchInFileParams,
	SearchInFileResult,
	SearchMatch,
	SearchInFilesParams,
	SearchInFilesResult,
	FileSearchResult
} from './types.js';
import { resolveFilePath, toRelativePath, findAllMatches, splitLines } from './fileUtils.js';

const MAX_MATCHES_PER_FILE = 100;
const MAX_TOTAL_MATCHES = 500;
const MAX_FILES_TO_SEARCH = 50;

/**
 * 在单个文件中搜索
 */
export async function searchInFile(
	params: SearchInFileParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<SearchInFileResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);
		const contextLines = params.contextLines ?? 2;

		// 读取文件
		const content = await fileService.readFile(uri);
		const textContent = content.value.toString();
		const lines = splitLines(textContent);

		// 查找匹配
		const rawMatches = findAllMatches(textContent, params.query, {
			isRegex: params.isRegex,
			caseSensitive: params.caseSensitive ?? true
		});

		// 限制匹配数量
		const limitedMatches = rawMatches.slice(0, MAX_MATCHES_PER_FILE);

		// 构建带上下文的匹配结果
		const matches: SearchMatch[] = limitedMatches.map(match => {
			const lineIndex = match.line - 1;

			// 获取上下文行
			const beforeStart = Math.max(0, lineIndex - contextLines);
			const afterEnd = Math.min(lines.length - 1, lineIndex + contextLines);

			const beforeLines = lines.slice(beforeStart, lineIndex);
			const afterLines = lines.slice(lineIndex + 1, afterEnd + 1);

			return {
				line: match.line,
				column: match.column,
				content: match.lineContent,
				matchText: match.matchText,
				context: {
					before: beforeLines,
					after: afterLines
				}
			};
		});

		return {
			success: true,
			data: {
				matches,
				totalMatches: rawMatches.length
			}
		};

	} catch (error) {
		if (error instanceof FileOperationError) {
			if (error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return {
					success: false,
					error: `文件 "${params.path}" 不存在`,
					errorCode: 'FILE_NOT_FOUND'
				};
			}
		}

		return {
			success: false,
			error: `搜索文件失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 在多个文件中搜索（grep 风格）
 */
export async function searchInFiles(
	params: SearchInFilesParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService,
	searchService?: ISearchService
): Promise<FileToolResult<SearchInFilesResult>> {
	try {
		const maxResults = Math.min(params.maxResults ?? 100, MAX_TOTAL_MATCHES);

		// 确定搜索根目录
		const folders = workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return {
				success: false,
				error: '没有打开的工作区',
				errorCode: 'DIRECTORY_NOT_FOUND'
			};
		}

		const searchRoot = params.path
			? resolveFilePath(params.path, workspaceService)
			: folders[0].uri;

		// 如果有搜索服务，使用它
		if (searchService) {
			try {
				// 处理 filePattern，确保使用正确的 glob 格式
				let includePattern: Record<string, boolean> | undefined;
				if (params.filePattern) {
					let pattern = params.filePattern;
					// 如果是简单的扩展名模式（如 *.vue），转换为递归模式（**/*.vue）
					if (pattern.startsWith('*.') && !pattern.includes('/') && !pattern.includes('**')) {
						pattern = '**/' + pattern;
					}
					// 如果没有通配符，假设是扩展名，添加 **/*.
					else if (!pattern.includes('*') && !pattern.includes('/')) {
						pattern = '**/*.' + pattern;
					}
					includePattern = { [pattern]: true };
				}

				const query: ITextQuery = {
					type: QueryType.Text,
					contentPattern: {
						pattern: params.query,
						isRegExp: params.isRegex ?? false,
						isCaseSensitive: params.caseSensitive ?? true
					},
					folderQueries: [{ folder: searchRoot }],
					maxResults,
					includePattern
				};

				const searchResults = await searchService.textSearch(query);

				const results: FileSearchResult[] = [];
				let totalMatches = 0;

				for (const result of searchResults.results) {
					const relativePath = toRelativePath(result.resource, workspaceService);
					const fileMatches: FileSearchResult['matches'] = [];

					if (result.results) {
						for (const match of result.results) {
							if ('rangeLocations' in match && match.rangeLocations) {
								for (const range of match.rangeLocations) {
									fileMatches.push({
										line: range.source.startLineNumber,
										column: range.source.startColumn,
										content: match.previewText || '',
										matchText: params.query
									});
									totalMatches++;
								}
							}
						}
					}

					if (fileMatches.length > 0) {
						results.push({
							file: relativePath,
							matches: fileMatches
						});
					}
				}

				return {
					success: true,
					data: {
						results,
						truncated: searchResults.limitHit ?? false,
						totalMatches,
						filesSearched: results.length
					}
				};
			} catch {
				// 搜索服务失败，回退到手动搜索
			}
		}

		// 手动搜索（回退方案）
		const results: FileSearchResult[] = [];
		let totalMatches = 0;
		let filesSearched = 0;
		let truncated = false;

		async function searchInDirectory(dirUri: typeof searchRoot): Promise<void> {
			if (truncated || totalMatches >= maxResults) {
				truncated = true;
				return;
			}

			try {
				const dirStat = await fileService.resolve(dirUri);
				if (!dirStat.children) {
					return;
				}

				for (const child of dirStat.children) {
					if (truncated || totalMatches >= maxResults) {
						truncated = true;
						return;
					}

					if (child.isDirectory) {
						// 跳过常见的忽略目录
						if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'vendor'].includes(child.name)) {
							continue;
						}
						await searchInDirectory(child.resource);
					} else {
						// 检查文件模式
						if (params.filePattern) {
							const name = child.name;
							let pattern = params.filePattern;

							// 标准化模式：移除 **/ 前缀
							if (pattern.startsWith('**/')) {
								pattern = pattern.substring(3);
							}

							// 简单的扩展名匹配（*.vue, *.ts 等）
							if (pattern.startsWith('*.')) {
								const ext = pattern.substring(1); // 包含点，如 .vue
								if (!name.endsWith(ext)) {
									continue;
								}
							}
							// 纯扩展名（vue, ts 等）
							else if (!pattern.includes('*') && !pattern.includes('/')) {
								if (!name.endsWith('.' + pattern)) {
									continue;
								}
							}
							// 其他模式暂不支持，跳过文件
							else if (pattern.includes('*')) {
								// 简单的通配符匹配
								const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
								if (!regex.test(name)) {
									continue;
								}
							}
						}

						// 限制搜索的文件数量
						if (filesSearched >= MAX_FILES_TO_SEARCH) {
							truncated = true;
							return;
						}

						try {
							const content = await fileService.readFile(child.resource);
							const textContent = content.value.toString();

							const matches = findAllMatches(textContent, params.query, {
								isRegex: params.isRegex,
								caseSensitive: params.caseSensitive ?? true
							});

							filesSearched++;

							if (matches.length > 0) {
								const relativePath = toRelativePath(child.resource, workspaceService);
								const limitedMatches = matches.slice(0, Math.min(matches.length, maxResults - totalMatches));

								results.push({
									file: relativePath,
									matches: limitedMatches.map(m => ({
										line: m.line,
										column: m.column,
										content: m.lineContent,
										matchText: m.matchText
									}))
								});

								totalMatches += limitedMatches.length;
							}
						} catch {
							// 忽略无法读取的文件
						}
					}
				}
			} catch {
				// 忽略无法访问的目录
			}
		}

		await searchInDirectory(searchRoot);

		return {
			success: true,
			data: {
				results,
				truncated,
				totalMatches,
				filesSearched
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}
