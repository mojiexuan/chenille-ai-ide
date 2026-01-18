/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';

/**
 * 节点类型
 */
export enum NodeType {
	File = 'file',
	Directory = 'directory',
}

/**
 * 树节点接口
 */
export interface ITreeNode {
	/** 节点名称（文件名或目录名） */
	name: string;
	/** 节点类型 */
	type: NodeType;
	/** 相对于工作区根目录的路径 */
	path: string;
	/** Merkle Hash */
	hash: string;
	/** 文件修改时间（仅文件） */
	mtime?: number;
	/** 文件大小（仅文件） */
	size?: number;
	/** 子节点（仅目录） */
	children?: Map<string, ITreeNode>;
	/** 父节点引用 */
	parent?: ITreeNode;
}

/**
 * 文件节点
 */
export class FileNode implements ITreeNode {
	readonly type = NodeType.File;
	hash: string = '';
	parent?: ITreeNode;

	constructor(
		public readonly name: string,
		public readonly path: string,
		public mtime: number = 0,
		public size: number = 0,
	) {
		this.updateHash();
	}

	/**
	 * 更新文件 hash（基于 mtime + size，避免读取内容）
	 */
	updateHash(): void {
		// 使用 mtime + size 作为快速 hash，避免读取文件内容
		this.hash = computeHash(`${this.path}:${this.mtime}:${this.size}`);
	}

	/**
	 * 基于内容更新 hash（更精确但更慢）
	 */
	updateHashFromContent(content: string): void {
		this.hash = computeHash(content);
	}
}

/**
 * 目录节点
 */
export class DirectoryNode implements ITreeNode {
	readonly type = NodeType.Directory;
	hash: string = '';
	children: Map<string, ITreeNode> = new Map();
	parent?: ITreeNode;

	constructor(
		public readonly name: string,
		public readonly path: string,
	) { }

	/**
	 * 添加子节点
	 */
	addChild(node: ITreeNode): void {
		node.parent = this;
		this.children.set(node.name, node);
	}

	/**
	 * 移除子节点
	 */
	removeChild(name: string): boolean {
		const child = this.children.get(name);
		if (child) {
			child.parent = undefined;
			this.children.delete(name);
			return true;
		}
		return false;
	}

	/**
	 * 获取子节点
	 */
	getChild(name: string): ITreeNode | undefined {
		return this.children.get(name);
	}

	/**
	 * 更新目录 hash（基于所有子节点的 hash）
	 */
	updateHash(): void {
		if (this.children.size === 0) {
			this.hash = computeHash(`empty:${this.path}`);
			return;
		}

		// 按名称排序后拼接子节点 hash
		const childHashes = Array.from(this.children.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, node]) => `${name}:${node.hash}`)
			.join('|');

		this.hash = computeHash(childHashes);
	}

	/**
	 * 递归更新从此节点到根的所有 hash
	 */
	updateHashToRoot(): void {
		this.updateHash();
		if (this.parent && this.parent.type === NodeType.Directory) {
			(this.parent as DirectoryNode).updateHashToRoot();
		}
	}
}

/**
 * 计算字符串的 hash
 */
export function computeHash(content: string): string {
	return crypto.createHash('md5').update(content).digest('hex').substring(0, 16);
}

/**
 * 从路径解析出各级目录名
 */
export function parsePathSegments(filePath: string): string[] {
	return filePath.split(/[/\\]/).filter(s => s.length > 0);
}
