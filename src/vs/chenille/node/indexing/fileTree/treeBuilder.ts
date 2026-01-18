/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../../base/common/path.js';
import { MerkleTree, IBuildOptions } from './merkleTree.js';
import { DEFAULT_INDEXING_CONFIG } from '../../../common/indexing/types.js';

/**
 * 将 glob 模式转换为简单匹配模式
 * 例如: ** /node_modules/** 会被转换为 node_modules
 */
function normalizeExcludePattern(pattern: string): string {
	return pattern
		.replace(/^\*\*\//, '')  // 移除开头的 **/
		.replace(/\/\*\*$/, '')  // 移除结尾的 /**
		.replace(/^\*/, '')      // 移除开头的 *
		.replace(/\*$/, '');     // 移除结尾的 *
}

/**
 * 从 DEFAULT_INDEXING_CONFIG 创建默认选项
 */
function getDefaultBuildOptions(): Required<IBuildOptions> {
	return {
		includeExtensions: DEFAULT_INDEXING_CONFIG.includeExtensions || [],
		excludePatterns: (DEFAULT_INDEXING_CONFIG.excludePatterns || []).map(normalizeExcludePattern),
		maxFileSize: DEFAULT_INDEXING_CONFIG.maxFileSize || 1024 * 1024,
	};
}

/**
 * 树构建器
 */
export class TreeBuilder {
	private options: Required<IBuildOptions>;
	private includeExtSet: Set<string>;
	private excludePatterns: string[];

	constructor(options: IBuildOptions = {}) {
		const defaults = getDefaultBuildOptions();
		this.options = { ...defaults, ...options };
		this.includeExtSet = new Set(this.options.includeExtensions.map(e => e.toLowerCase()));
		this.excludePatterns = this.options.excludePatterns;
	}

	/**
	 * 从文件系统构建 Merkle 树
	 */
	async build(workspacePath: string): Promise<MerkleTree> {
		const tree = new MerkleTree(workspacePath);
		await this.scanDirectory(workspacePath, '', tree);
		return tree;
	}

	/**
	 * 增量更新树（基于文件系统变更）
	 */
	async update(
		tree: MerkleTree,
		changedPaths: string[],
	): Promise<{ changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> }> {
		const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];
		const fileStats = new Map<string, { mtime: number; size: number }>();

		// 获取变更文件的状态
		for (const relativePath of changedPaths) {
			const fullPath = path.join(tree.workspacePath, relativePath);

			try {
				const stat = await fs.promises.stat(fullPath);
				if (stat.isFile() && this.shouldInclude(relativePath)) {
					fileStats.set(relativePath, {
						mtime: stat.mtimeMs,
						size: stat.size,
					});
				}
			} catch {
				// 文件不存在，标记为删除
				fileStats.set(relativePath, undefined as unknown as { mtime: number; size: number });
			}
		}

		// 应用变更到树
		const detected = tree.detectChanges(changedPaths, fileStats);
		for (const change of detected) {
			changes.push({
				path: change.path,
				type: change.type,
			});
		}

		return { changes };
	}

	/**
	 * 懒加载扫描选项
	 */
	private static readonly LAZY_LOAD_YIELD_INTERVAL = 100; // 每处理多少文件让出控制权

	/**
	 * 全量扫描并与现有树对比
	 */
	async fullScan(
		tree: MerkleTree,
		onProgress?: (scanned: number, total: number) => void,
	): Promise<{ changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> }> {
		const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];

		// 获取当前树中的所有文件
		const existingFiles = new Set(tree.getAllFilePaths());

		// 使用懒加载扫描文件系统
		const currentFiles = new Map<string, { mtime: number; size: number }>();
		await this.lazyLoadScan(tree.workspacePath, '', currentFiles, onProgress);

		// 检查新增/修改的文件
		for (const [filePath, stats] of Array.from(currentFiles.entries())) {
			const node = tree.getNode(filePath);

			if (!node) {
				// 新文件
				const change = tree.upsertFile(filePath, stats.mtime, stats.size);
				if (change) {
					changes.push({ path: filePath, type: 'add' });
				}
			} else if (node.type === 'file') {
				// 检查是否修改
				const change = tree.upsertFile(filePath, stats.mtime, stats.size);
				if (change && change.type === 'modify') {
					changes.push({ path: filePath, type: 'modify' });
				}
			}

			existingFiles.delete(filePath);
		}

		// 剩余的是被删除的文件
		for (const deletedPath of Array.from(existingFiles)) {
			const change = tree.deleteNode(deletedPath);
			if (change) {
				changes.push({ path: deletedPath, type: 'delete' });
			}
		}

		return { changes };
	}

	/**
	 * 递归扫描目录
	 */
	private async scanDirectory(
		basePath: string,
		relativePath: string,
		tree: MerkleTree,
	): Promise<void> {
		const fullPath = path.join(basePath, relativePath);

		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

			// 检查排除模式
			if (this.shouldExclude(entry.name, entryRelativePath)) {
				continue;
			}

			if (entry.isDirectory()) {
				await this.scanDirectory(basePath, entryRelativePath, tree);
			} else if (entry.isFile()) {
				// 检查文件扩展名
				if (!this.shouldInclude(entry.name)) {
					continue;
				}

				try {
					const stat = await fs.promises.stat(path.join(fullPath, entry.name));

					// 检查文件大小
					if (stat.size > this.options.maxFileSize) {
						continue;
					}

					tree.upsertFile(entryRelativePath, stat.mtimeMs, stat.size);
				} catch {
					// 跳过无法访问的文件
				}
			}
		}
	}

	/**
	 * 懒加载扫描 - 分批处理，避免一次性加载所有文件
	 */
	private async lazyLoadScan(
		basePath: string,
		relativePath: string,
		result: Map<string, { mtime: number; size: number }>,
		onProgress?: (scanned: number, total: number) => void,
	): Promise<void> {
		// 使用队列实现非递归扫描，便于控制内存
		const dirQueue: string[] = [relativePath];
		let processedFiles = 0;
		let estimatedTotal = 0;

		while (dirQueue.length > 0) {
			const currentDir = dirQueue.shift()!;
			const fullPath = path.join(basePath, currentDir);

			let entries: fs.Dirent[];
			try {
				entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
			} catch {
				continue;
			}

			// 更新估计总数
			estimatedTotal += entries.length;

			for (const entry of entries) {
				const entryRelativePath = currentDir ? `${currentDir}/${entry.name}` : entry.name;

				if (this.shouldExclude(entry.name, entryRelativePath)) {
					continue;
				}

				if (entry.isDirectory()) {
					// 将子目录加入队列（延迟处理）
					dirQueue.push(entryRelativePath);
				} else if (entry.isFile() && this.shouldInclude(entry.name)) {
					try {
						const stat = await fs.promises.stat(path.join(fullPath, entry.name));
						if (stat.size <= this.options.maxFileSize) {
							result.set(entryRelativePath, {
								mtime: stat.mtimeMs,
								size: stat.size,
							});
						}
					} catch {
						// 跳过无法访问的文件
					}

					processedFiles++;

					// 每处理一批文件，让出控制权并报告进度
					if (processedFiles % TreeBuilder.LAZY_LOAD_YIELD_INTERVAL === 0) {
						onProgress?.(processedFiles, estimatedTotal);
						// 让出事件循环，避免阻塞
						await new Promise(resolve => setImmediate(resolve));
					}
				}
			}
		}

		// 最终进度报告
		onProgress?.(processedFiles, processedFiles);
	}

	/**
	 * 分片扫描 - 只扫描指定的目录列表
	 */
	async scanDirectories(
		tree: MerkleTree,
		directories: string[],
	): Promise<{ changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> }> {
		const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];

		for (const dir of directories) {
			const dirChanges = await this.scanSingleDirectory(tree, dir);
			changes.push(...dirChanges);
		}

		return { changes };
	}

	/**
	 * 扫描单个目录
	 */
	private async scanSingleDirectory(
		tree: MerkleTree,
		directory: string,
	): Promise<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>> {
		const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];
		const fullPath = path.join(tree.workspacePath, directory);

		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
		} catch {
			return changes;
		}

		for (const entry of entries) {
			if (entry.isFile() && this.shouldInclude(entry.name)) {
				const relativePath = directory ? `${directory}/${entry.name}` : entry.name;

				if (this.shouldExclude(entry.name, relativePath)) {
					continue;
				}

				try {
					const stat = await fs.promises.stat(path.join(fullPath, entry.name));
					if (stat.size <= this.options.maxFileSize) {
						const change = tree.upsertFile(relativePath, stat.mtimeMs, stat.size);
						if (change) {
							changes.push({ path: relativePath, type: change.type });
						}
					}
				} catch {
					// 跳过
				}
			}
		}

		return changes;
	}

	/**
	 * 检查文件是否应该包含
	 */
	private shouldInclude(fileName: string): boolean {
		const ext = path.extname(fileName).toLowerCase();
		return this.includeExtSet.has(ext);
	}

	/**
	 * 检查是否应该排除
	 */
	private shouldExclude(name: string, relativePath: string): boolean {
		for (const pattern of this.excludePatterns) {
			// 简单匹配：名称匹配或路径包含
			if (name === pattern) {
				return true;
			}
			if (pattern.startsWith('*') && name.endsWith(pattern.slice(1))) {
				return true;
			}
			if (relativePath.includes(pattern)) {
				return true;
			}
		}
		return false;
	}
}

/**
 * 创建树构建器
 */
export function createTreeBuilder(options?: IBuildOptions): TreeBuilder {
	return new TreeBuilder(options);
}
