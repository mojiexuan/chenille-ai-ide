/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DirectoryNode, FileNode, ITreeNode, NodeType, parsePathSegments } from './treeNode.js';

/**
 * 文件变更类型
 */
export interface IFileChange {
	/** 文件路径（相对于工作区根） */
	path: string;
	/** 变更类型 */
	type: 'add' | 'modify' | 'delete';
	/** 旧 hash（modify/delete 时有值） */
	oldHash?: string;
	/** 新 hash（add/modify 时有值） */
	newHash?: string;
}

/**
 * 构建选项
 */
export interface IBuildOptions {
	/** 包含的文件扩展名 */
	includeExtensions?: string[];
	/** 排除的目录/文件模式 */
	excludePatterns?: string[];
	/** 最大文件大小（字节） */
	maxFileSize?: number;
}

/**
 * Merkle 文件树接口
 */
export interface IMerkleTree {
	/** 树根节点 */
	readonly root: DirectoryNode;

	/** 根 Hash */
	readonly rootHash: string;

	/** 工作区路径 */
	readonly workspacePath: string;

	/**
	 * 获取指定路径的节点
	 */
	getNode(path: string): ITreeNode | undefined;

	/**
	 * 添加或更新文件节点
	 */
	upsertFile(path: string, mtime: number, size: number): IFileChange | null;

	/**
	 * 删除节点
	 */
	deleteNode(path: string): IFileChange | null;

	/**
	 * 检测文件变更（基于文件系统元数据）
	 */
	detectChanges(filePaths: string[], fileStats: Map<string, { mtime: number; size: number }>): IFileChange[];

	/**
	 * 获取所有文件路径
	 */
	getAllFilePaths(): string[];

	/**
	 * 序列化
	 */
	serialize(): string;

	/**
	 * 反序列化
	 */
	deserialize(data: string): void;

	/**
	 * 清空树
	 */
	clear(): void;
}

/**
 * Merkle 文件树实现
 */
export class MerkleTree implements IMerkleTree {
	private _root: DirectoryNode;

	constructor(
		public readonly workspacePath: string,
	) {
		this._root = new DirectoryNode('', '');
	}

	get root(): DirectoryNode {
		return this._root;
	}

	get rootHash(): string {
		return this._root.hash;
	}

	/**
	 * 获取指定路径的节点
	 */
	getNode(path: string): ITreeNode | undefined {
		if (!path || path === '' || path === '.') {
			return this._root;
		}

		const segments = parsePathSegments(path);
		let current: ITreeNode = this._root;

		for (const segment of segments) {
			if (current.type !== NodeType.Directory) {
				return undefined;
			}
			const child = (current as DirectoryNode).getChild(segment);
			if (!child) {
				return undefined;
			}
			current = child;
		}

		return current;
	}

	/**
	 * 确保路径上的所有目录存在
	 */
	private ensureDirectoryPath(dirPath: string): DirectoryNode {
		if (!dirPath || dirPath === '' || dirPath === '.') {
			return this._root;
		}

		const segments = parsePathSegments(dirPath);
		let current = this._root;
		let currentPath = '';

		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			let child = current.getChild(segment);

			if (!child) {
				// 创建目录节点
				child = new DirectoryNode(segment, currentPath);
				current.addChild(child);
			} else if (child.type !== NodeType.Directory) {
				// 路径冲突：期望目录但找到文件
				throw new Error(`Path conflict: expected directory at ${currentPath}`);
			}

			current = child as DirectoryNode;
		}

		return current;
	}

	/**
	 * 添加或更新文件节点
	 */
	upsertFile(path: string, mtime: number, size: number): IFileChange | null {
		const segments = parsePathSegments(path);
		if (segments.length === 0) {
			return null;
		}

		const fileName = segments.pop()!;
		const dirPath = segments.join('/');
		const parentDir = this.ensureDirectoryPath(dirPath);

		const existingNode = parentDir.getChild(fileName);
		let change: IFileChange | null = null;

		if (existingNode) {
			if (existingNode.type === NodeType.File) {
				const fileNode = existingNode as FileNode;
				const oldHash = fileNode.hash;

				// 检查是否真的有变化
				if (fileNode.mtime !== mtime || fileNode.size !== size) {
					fileNode.mtime = mtime;
					fileNode.size = size;
					fileNode.updateHash();

					change = {
						path,
						type: 'modify',
						oldHash,
						newHash: fileNode.hash,
					};
				}
			} else {
				// 目录变成文件：先删除目录
				parentDir.removeChild(fileName);
				const newFile = new FileNode(fileName, path, mtime, size);
				parentDir.addChild(newFile);
				change = {
					path,
					type: 'add',
					newHash: newFile.hash,
				};
			}
		} else {
			// 新文件
			const newFile = new FileNode(fileName, path, mtime, size);
			parentDir.addChild(newFile);
			change = {
				path,
				type: 'add',
				newHash: newFile.hash,
			};
		}

		// 向上更新所有父目录的 hash
		if (change) {
			parentDir.updateHashToRoot();
		}

		return change;
	}

	/**
	 * 删除节点
	 */
	deleteNode(path: string): IFileChange | null {
		const segments = parsePathSegments(path);
		if (segments.length === 0) {
			return null;
		}

		const nodeName = segments.pop()!;
		const parentPath = segments.join('/');

		const parentNode = this.getNode(parentPath);
		if (!parentNode || parentNode.type !== NodeType.Directory) {
			return null;
		}

		const parentDir = parentNode as DirectoryNode;
		const nodeToDelete = parentDir.getChild(nodeName);

		if (!nodeToDelete) {
			return null;
		}

		const oldHash = nodeToDelete.hash;
		parentDir.removeChild(nodeName);
		parentDir.updateHashToRoot();

		// 清理空目录
		this.cleanupEmptyDirectories(parentDir);

		return {
			path,
			type: 'delete',
			oldHash,
		};
	}

	/**
	 * 清理空目录
	 */
	private cleanupEmptyDirectories(dir: DirectoryNode): void {
		if (dir === this._root) {
			return;
		}

		if (dir.children.size === 0 && dir.parent) {
			const parent = dir.parent as DirectoryNode;
			parent.removeChild(dir.name);
			parent.updateHashToRoot();
			this.cleanupEmptyDirectories(parent);
		}
	}

	/**
	 * 检测文件变更
	 */
	detectChanges(filePaths: string[], fileStats: Map<string, { mtime: number; size: number }>): IFileChange[] {
		const changes: IFileChange[] = [];

		for (const filePath of filePaths) {
			const stats = fileStats.get(filePath);

			if (!stats) {
				// 文件被删除
				const change = this.deleteNode(filePath);
				if (change) {
					changes.push(change);
				}
			} else {
				// 文件添加或修改
				const change = this.upsertFile(filePath, stats.mtime, stats.size);
				if (change) {
					changes.push(change);
				}
			}
		}

		return changes;
	}

	/**
	 * 获取所有文件路径
	 */
	getAllFilePaths(): string[] {
		const paths: string[] = [];
		this.collectFilePaths(this._root, paths);
		return paths;
	}

	private collectFilePaths(node: ITreeNode, paths: string[]): void {
		if (node.type === NodeType.File) {
			paths.push(node.path);
		} else if (node.type === NodeType.Directory) {
			const dir = node as DirectoryNode;
			for (const child of Array.from(dir.children.values())) {
				this.collectFilePaths(child, paths);
			}
		}
	}

	/**
	 * 序列化
	 */
	serialize(): string {
		return JSON.stringify(this.serializeNode(this._root));
	}

	private serializeNode(node: ITreeNode): object {
		if (node.type === NodeType.File) {
			const file = node as FileNode;
			return {
				t: 'f',
				n: file.name,
				p: file.path,
				h: file.hash,
				m: file.mtime,
				s: file.size,
			};
		} else {
			const dir = node as DirectoryNode;
			return {
				t: 'd',
				n: dir.name,
				p: dir.path,
				h: dir.hash,
				c: Array.from(dir.children.values()).map(c => this.serializeNode(c)),
			};
		}
	}

	/**
	 * 反序列化
	 */
	deserialize(data: string): void {
		const parsed = JSON.parse(data);
		this._root = this.deserializeNode(parsed, undefined) as DirectoryNode;
	}

	private deserializeNode(obj: Record<string, unknown>, parent?: ITreeNode): ITreeNode {
		if (obj.t === 'f') {
			const file = new FileNode(
				obj.n as string,
				obj.p as string,
				obj.m as number,
				obj.s as number,
			);
			file.hash = obj.h as string;
			file.parent = parent;
			return file;
		} else {
			const dir = new DirectoryNode(obj.n as string, obj.p as string);
			dir.hash = obj.h as string;
			dir.parent = parent;

			const children = obj.c as Array<Record<string, unknown>> || [];
			for (const childObj of children) {
				const child = this.deserializeNode(childObj, dir);
				dir.children.set(child.name, child);
			}

			return dir;
		}
	}

	/**
	 * 清空树
	 */
	clear(): void {
		this._root = new DirectoryNode('', '');
	}
}
