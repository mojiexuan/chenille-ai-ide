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
	 * 保存树到文件
	 */
	async save(tree: IMerkleTree): Promise<void> {
		await this.ensureCacheDir();

		const filePath = this.getCacheFilePath(tree.workspacePath);
		const data: ISerializedData = {
			version: SERIALIZATION_VERSION,
			workspacePath: tree.workspacePath,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			tree: tree.serialize(),
		};

		// 先写入临时文件，再重命名（原子操作）
		const tempPath = `${filePath}.tmp`;
		await fs.promises.writeFile(tempPath, JSON.stringify(data), 'utf-8');
		await fs.promises.rename(tempPath, filePath);
	}

	/**
	 * 从文件加载树
	 */
	async load(workspacePath: string): Promise<IMerkleTree | null> {
		const filePath = this.getCacheFilePath(workspacePath);

		try {
			const content = await fs.promises.readFile(filePath, 'utf-8');
			const data: ISerializedData = JSON.parse(content);

			// 版本检查
			if (data.version !== SERIALIZATION_VERSION) {
				console.warn(`[TreeSerializer] 缓存版本不匹配 (${data.version} vs ${SERIALIZATION_VERSION})，需要重建`);
				await this.delete(workspacePath);
				return null;
			}

			// 工作区路径检查
			if (data.workspacePath !== workspacePath) {
				console.warn(`[TreeSerializer] 工作区路径不匹配`);
				return null;
			}

			const tree = new MerkleTree(workspacePath);
			tree.deserialize(data.tree);

			return tree;
		} catch (err) {
			// 文件不存在或解析失败
			return null;
		}
	}

	/**
	 * 删除缓存
	 */
	async delete(workspacePath: string): Promise<void> {
		const filePath = this.getCacheFilePath(workspacePath);

		try {
			await fs.promises.unlink(filePath);
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
