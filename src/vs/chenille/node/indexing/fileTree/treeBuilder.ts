/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../../base/common/path.js';
import { MerkleTree, IBuildOptions } from './merkleTree.js';

/**
 * 默认构建选项
 */
const DEFAULT_BUILD_OPTIONS: Required<IBuildOptions> = {
	includeExtensions: [
		'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
		'.py', '.java', '.kt', '.scala',
		'.c', '.cpp', '.h', '.hpp', '.cc',
		'.go', '.rs', '.rb', '.php',
		'.cs', '.fs', '.vb',
		'.swift', '.m', '.mm',
		'.vue', '.svelte', '.astro',
		'.html', '.css', '.scss', '.less',
		'.json', '.yaml', '.yml', '.toml',
		'.md', '.mdx', '.txt',
		'.sql', '.graphql', '.gql',
		'.sh', '.bash', '.zsh', '.ps1',
		'.dockerfile', '.makefile',
	],
	excludePatterns: [
		'node_modules',
		'.git',
		'dist',
		'build',
		'out',
		'.next',
		'.nuxt',
		'coverage',
		'__pycache__',
		'.pytest_cache',
		'.venv',
		'venv',
		'.idea',
		'.vscode',
		'*.min.js',
		'*.min.css',
		'*.map',
		'*.lock',
		'package-lock.json',
		'yarn.lock',
		'pnpm-lock.yaml',
	],
	maxFileSize: 1024 * 1024, // 1MB
};

/**
 * 树构建器
 */
export class TreeBuilder {
	private options: Required<IBuildOptions>;
	private includeExtSet: Set<string>;
	private excludePatterns: string[];

	constructor(options: IBuildOptions = {}) {
		this.options = { ...DEFAULT_BUILD_OPTIONS, ...options };
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
	 * 全量扫描并与现有树对比
	 */
	async fullScan(tree: MerkleTree): Promise<{ changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> }> {
		const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];

		// 获取当前树中的所有文件
		const existingFiles = new Set(tree.getAllFilePaths());

		// 扫描文件系统
		const currentFiles = new Map<string, { mtime: number; size: number }>();
		await this.scanDirectoryForStats(tree.workspacePath, '', currentFiles);

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
	 * 扫描目录获取文件状态
	 */
	private async scanDirectoryForStats(
		basePath: string,
		relativePath: string,
		result: Map<string, { mtime: number; size: number }>,
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

			if (this.shouldExclude(entry.name, entryRelativePath)) {
				continue;
			}

			if (entry.isDirectory()) {
				await this.scanDirectoryForStats(basePath, entryRelativePath, result);
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
					// 跳过
				}
			}
		}
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
