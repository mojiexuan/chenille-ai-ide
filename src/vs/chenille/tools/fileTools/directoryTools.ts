/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, FileOperationError, FileOperationResult } from '../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { ISearchService, QueryType } from '../../../workbench/services/search/common/search.js';
import { URI } from '../../../base/common/uri.js';
import {
	FileToolResult,
	ListDirectoryParams,
	ListDirectoryResult,
	DirectoryEntry,
	FindFilesParams,
	FindFilesResult
} from './types.js';
import { resolveFilePath, toRelativePath, matchGlob } from './fileUtils.js';

const MAX_ENTRIES = 500;
const MAX_FIND_RESULTS = 200;

/**
 * 列出目录内容
 */
export async function listDirectory(
	params: ListDirectoryParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<ListDirectoryResult>> {
	try {
		const uri = resolveFilePath(params.path, workspaceService);
		const recursive = params.recursive ?? false;
		const maxDepth = params.maxDepth ?? 3;
		const includeHidden = params.includeHidden ?? false;
		const pattern = params.pattern;

		// 检查目录是否存在
		const stat = await fileService.stat(uri);
		if (!stat.isDirectory) {
			return {
				success: false,
				error: `路径 "${params.path}" 不是一个目录`,
				errorCode: 'NOT_A_DIRECTORY'
			};
		}

		const entries: DirectoryEntry[] = [];
		let totalCount = 0;
		let truncated = false;

		// 递归遍历目录
		async function traverse(currentUri: URI, depth: number): Promise<void> {
			if (truncated || (recursive && depth > maxDepth)) {
				return;
			}

			try {
				const dirStat = await fileService.resolve(currentUri);
				if (!dirStat.children) {
					return;
				}

				for (const child of dirStat.children) {
					// 检查是否超过限制
					if (entries.length >= MAX_ENTRIES) {
						truncated = true;
						return;
					}

					const name = child.name;

					// 过滤隐藏文件
					if (!includeHidden && name.startsWith('.')) {
						continue;
					}

					const relativePath = toRelativePath(child.resource, workspaceService);

					// 应用 glob 模式过滤
					if (pattern && !matchGlob(pattern, name) && !matchGlob(pattern, relativePath)) {
						// 如果是目录且需要递归，仍然进入
						if (child.isDirectory && recursive) {
							await traverse(child.resource, depth + 1);
						}
						continue;
					}

					totalCount++;

					entries.push({
						name,
						path: relativePath,
						type: child.isDirectory ? 'directory' : 'file',
						size: child.isDirectory ? undefined : child.size
					});

					// 递归处理子目录
					if (child.isDirectory && recursive) {
						await traverse(child.resource, depth + 1);
					}
				}
			} catch {
				// 忽略无法访问的目录
			}
		}

		await traverse(uri, 1);

		// 排序：目录在前，然后按名称排序
		entries.sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});

		return {
			success: true,
			data: {
				entries,
				truncated,
				totalCount
			}
		};

	} catch (error) {
		if (error instanceof FileOperationError) {
			if (error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return {
					success: false,
					error: `目录 "${params.path}" 不存在`,
					errorCode: 'DIRECTORY_NOT_FOUND'
				};
			}
		}

		return {
			success: false,
			error: `列出目录失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 搜索文件
 */
export async function findFiles(
	params: FindFilesParams,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService,
	searchService?: ISearchService
): Promise<FileToolResult<FindFilesResult>> {
	try {
		const maxResults = Math.min(params.maxResults ?? 100, MAX_FIND_RESULTS);
		const pattern = params.pattern;
		const excludePattern = params.excludePattern;

		// 确定搜索根目录
		let searchRoot: URI;
		if (params.cwd) {
			searchRoot = resolveFilePath(params.cwd, workspaceService);
		} else {
			const folders = workspaceService.getWorkspace().folders;
			if (folders.length === 0) {
				return {
					success: false,
					error: '没有打开的工作区',
					errorCode: 'DIRECTORY_NOT_FOUND'
				};
			}
			searchRoot = folders[0].uri;
		}

		// 如果有搜索服务，使用它
		if (searchService) {
			try {
				const query = {
					type: QueryType.File as const,
					filePattern: pattern,
					folderQueries: [{ folder: searchRoot }],
					maxResults,
					excludePattern: excludePattern ? { [excludePattern]: true } : undefined
				};

				const results = await searchService.fileSearch(query as any);
				const files = results.results.map((r: any) => toRelativePath(r.resource, workspaceService));

				return {
					success: true,
					data: {
						files,
						truncated: results.limitHit ?? false,
						totalFound: files.length
					}
				};
			} catch {
				// 搜索服务失败，回退到手动遍历
			}
		}

		// 手动遍历（回退方案）
		const files: string[] = [];
		let truncated = false;

		async function traverse(currentUri: URI): Promise<void> {
			if (truncated || files.length >= maxResults) {
				truncated = true;
				return;
			}

			try {
				const dirStat = await fileService.resolve(currentUri);
				if (!dirStat.children) {
					return;
				}

				for (const child of dirStat.children) {
					if (files.length >= maxResults) {
						truncated = true;
						return;
					}

					const relativePath = toRelativePath(child.resource, workspaceService);

					// 排除模式
					if (excludePattern && matchGlob(excludePattern, relativePath)) {
						continue;
					}

					if (child.isDirectory) {
						// 跳过常见的忽略目录
						if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'].includes(child.name)) {
							continue;
						}
						await traverse(child.resource);
					} else {
						// 匹配模式
						if (matchGlob(pattern, child.name) || matchGlob(pattern, relativePath)) {
							files.push(relativePath);
						}
					}
				}
			} catch {
				// 忽略无法访问的目录
			}
		}

		await traverse(searchRoot);

		return {
			success: true,
			data: {
				files,
				truncated,
				totalFound: files.length
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `搜索文件失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}
