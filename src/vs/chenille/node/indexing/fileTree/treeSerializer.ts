/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../../base/common/path.js';
import { IMerkleTree, MerkleTree } from './merkleTree.js';

/**
 * 树序列化版本号（用于数据迁移）
 */
const SERIALIZATION_VERSION = 1;

/**
 * 序列化数据格式
 */
interface ISerializedData {
	/** 版本号 */
	version: number;
	/** 工作区路径 */
	workspacePath: string;
	/** 创建时间 */
	createdAt: number;
	/** 更新时间 */
	updatedAt: number;
	/** 树数据 */
	tree: string;
}

/**
 * 树序列化器
 */
export class TreeSerializer {
	private cacheDir: string;

	constructor(baseCacheDir: string) {
		this.cacheDir = path.join(baseCacheDir, 'merkle-trees');
	}

	/**
	 * 确保缓存目录存在
	 */
	private async ensureCacheDir(): Promise<void> {
		try {
			await fs.promises.mkdir(this.cacheDir, { recursive: true });
		} catch (err) {
			// 目录可能已存在
		}
	}

	/**
	 * 生成缓存文件路径
	 */
	private getCacheFilePath(workspacePath: string): string {
		// 使用 base64 编码工作区路径作为文件名
		const encoded = Buffer.from(workspacePath).toString('base64url');
		return path.join(this.cacheDir, `${encoded}.json`);
	}

	/**
	 * 保存树到文件（带备份和回滚机制）
	 */
	async save(tree: IMerkleTree): Promise<void> {
		await this.ensureCacheDir();

		const filePath = this.getCacheFilePath(tree.workspacePath);
		const backupPath = `${filePath}.bak`;
		const tempPath = `${filePath}.tmp`;

		// 获取现有文件的创建时间（如果存在）
		let createdAt = Date.now();
		try {
			const content = await fs.promises.readFile(filePath, 'utf-8');
			const existingData: ISerializedData = JSON.parse(content);
			createdAt = existingData.createdAt;
		} catch {
			// 文件不存在，使用当前时间
		}

		const data: ISerializedData = {
			version: SERIALIZATION_VERSION,
			workspacePath: tree.workspacePath,
			createdAt,
			updatedAt: Date.now(),
			tree: tree.serialize(),
		};

		try {
			// 1. 写入临时文件
			await fs.promises.writeFile(tempPath, JSON.stringify(data), 'utf-8');

			// 2. 备份现有文件（如果存在）
			try {
				await fs.promises.copyFile(filePath, backupPath);
			} catch {
				// 文件不存在，无需备份
			}

			// 3. 原子重命名
			await fs.promises.rename(tempPath, filePath);

			// 4. 成功后删除备份
			try {
				await fs.promises.unlink(backupPath);
			} catch {
				// 备份文件不存在
			}
		} catch (err) {
			// 写入失败，尝试回滚
			console.error('[TreeSerializer] 保存失败，尝试回滚:', err);

			// 清理临时文件
			try {
				await fs.promises.unlink(tempPath);
			} catch {
				// 忽略
			}

			// 如果有备份，回滚
			try {
				await fs.promises.access(backupPath, fs.constants.F_OK);
				await fs.promises.rename(backupPath, filePath);
				console.log('[TreeSerializer] 已从备份恢复');
			} catch {
				// 无备份可回滚
			}

			throw err;
		}
	}

	/**
	 * 从文件加载树（带损坏文件自动修复）
	 */
	async load(workspacePath: string): Promise<IMerkleTree | null> {
		const filePath = this.getCacheFilePath(workspacePath);
		const backupPath = `${filePath}.bak`;

		// 尝试从主文件加载
		const mainResult = await this.tryLoadFromFile(filePath, workspacePath);
		if (mainResult.success && mainResult.tree) {
			return mainResult.tree;
		}

		// 主文件损坏，尝试从备份恢复
		if (mainResult.corrupted) {
			console.warn('[TreeSerializer] 主文件损坏，尝试从备份恢复');

			const backupResult = await this.tryLoadFromFile(backupPath, workspacePath);
			if (backupResult.success && backupResult.tree) {
				// 备份有效，恢复主文件
				try {
					await fs.promises.copyFile(backupPath, filePath);
					console.log('[TreeSerializer] 已从备份恢复主文件');
				} catch {
					// 恢复失败，但树已加载成功
				}
				return backupResult.tree;
			}

			// 备份也损坏，删除损坏文件
			console.warn('[TreeSerializer] 备份也损坏，删除损坏文件并重建');
			await this.delete(workspacePath);
			return null;
		}

		// 文件不存在
		return null;
	}

	/**
	 * 尝试从文件加载
	 */
	private async tryLoadFromFile(
		filePath: string,
		workspacePath: string,
	): Promise<{ success: boolean; tree?: IMerkleTree; corrupted?: boolean }> {
		try {
			const content = await fs.promises.readFile(filePath, 'utf-8');

			// JSON 解析
			let data: ISerializedData;
			try {
				data = JSON.parse(content);
			} catch {
				return { success: false, corrupted: true };
			}

			// 版本检查
			if (data.version !== SERIALIZATION_VERSION) {
				console.warn(`[TreeSerializer] 缓存版本不匹配 (${data.version} vs ${SERIALIZATION_VERSION})`);
				return { success: false, corrupted: true };
			}

			// 工作区路径检查
			if (data.workspacePath !== workspacePath) {
				console.warn(`[TreeSerializer] 工作区路径不匹配`);
				return { success: false, corrupted: true };
			}

			// 树数据检查
			if (!data.tree || typeof data.tree !== 'string') {
				return { success: false, corrupted: true };
			}

			// 反序列化
			const tree = new MerkleTree(workspacePath);
			try {
				tree.deserialize(data.tree);
			} catch {
				return { success: false, corrupted: true };
			}

			// 验证树完整性
			if (!this.validateTree(tree)) {
				return { success: false, corrupted: true };
			}

			return { success: true, tree };
		} catch (err) {
			// 文件不存在
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return { success: false };
			}
			// 其他错误视为损坏
			return { success: false, corrupted: true };
		}
	}

	/**
	 * 验证树完整性
	 */
	private validateTree(tree: IMerkleTree): boolean {
		try {
			// 检查根节点存在
			if (!tree.rootHash) {
				return false;
			}

			// 检查工作区路径
			if (!tree.workspacePath) {
				return false;
			}

			// 尝试获取所有文件路径（检查树结构完整）
			tree.getAllFilePaths();

			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 删除缓存（包括备份文件和临时文件）
	 */
	async delete(workspacePath: string): Promise<void> {
		const filePath = this.getCacheFilePath(workspacePath);
		const backupPath = `${filePath}.bak`;
		const tempPath = `${filePath}.tmp`;

		// 删除主文件
		try {
			await fs.promises.unlink(filePath);
		} catch {
			// 文件可能不存在
		}

		// 删除备份文件
		try {
			await fs.promises.unlink(backupPath);
		} catch {
			// 文件可能不存在
		}

		// 删除临时文件
		try {
			await fs.promises.unlink(tempPath);
		} catch {
			// 文件可能不存在
		}
	}

	/**
	 * 检查缓存是否存在
	 */
	async exists(workspacePath: string): Promise<boolean> {
		const filePath = this.getCacheFilePath(workspacePath);

		try {
			await fs.promises.access(filePath, fs.constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 获取缓存元数据
	 */
	async getMetadata(workspacePath: string): Promise<{ createdAt: number; updatedAt: number } | null> {
		const filePath = this.getCacheFilePath(workspacePath);

		try {
			const content = await fs.promises.readFile(filePath, 'utf-8');
			const data: ISerializedData = JSON.parse(content);
			return {
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
			};
		} catch {
			return null;
		}
	}

	/**
	 * 清理过期缓存
	 */
	async cleanup(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
		let deletedCount = 0;

		try {
			const files = await fs.promises.readdir(this.cacheDir);
			const now = Date.now();

			for (const file of files) {
				if (!file.endsWith('.json')) {
					continue;
				}

				const filePath = path.join(this.cacheDir, file);

				try {
					const content = await fs.promises.readFile(filePath, 'utf-8');
					const data: ISerializedData = JSON.parse(content);

					if (now - data.updatedAt > maxAge) {
						await fs.promises.unlink(filePath);
						deletedCount++;
					}
				} catch {
					// 解析失败的文件直接删除
					await fs.promises.unlink(filePath);
					deletedCount++;
				}
			}
		} catch {
			// 目录不存在
		}

		return deletedCount;
	}

	/**
	 * 获取所有缓存的工作区路径
	 */
	async getAllCachedWorkspaces(): Promise<string[]> {
		const workspaces: string[] = [];

		try {
			const files = await fs.promises.readdir(this.cacheDir);

			for (const file of files) {
				if (!file.endsWith('.json')) {
					continue;
				}

				const filePath = path.join(this.cacheDir, file);

				try {
					const content = await fs.promises.readFile(filePath, 'utf-8');
					const data: ISerializedData = JSON.parse(content);
					workspaces.push(data.workspacePath);
				} catch {
					// 跳过无效文件
				}
			}
		} catch {
			// 目录不存在
		}

		return workspaces;
	}
}

/**
 * 创建树序列化器
 */
export function createTreeSerializer(baseCacheDir: string): TreeSerializer {
	return new TreeSerializer(baseCacheDir);
}
