/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DirectoryNode, ITreeNode, NodeType } from './treeNode.js';
import { IFileChange, IMerkleTree } from './merkleTree.js';

/**
 * 树差异计算器
 */
export class TreeDiff {
	/**
	 * 快速比较两棵树是否完全相同
	 */
	isIdentical(tree1: IMerkleTree, tree2: IMerkleTree): boolean {
		return tree1.rootHash === tree2.rootHash;
	}

	/**
	 * 计算两棵树的差异
	 * 复杂度：O(变更节点数) 而非 O(总节点数)
	 */
	findChanges(oldTree: IMerkleTree, newTree: IMerkleTree): IFileChange[] {
		const changes: IFileChange[] = [];

		// 如果根 hash 相同，没有变化
		if (oldTree.rootHash === newTree.rootHash) {
			return changes;
		}

		// 递归比较
		this.compareNodes(oldTree.root, newTree.root, changes);

		return changes;
	}

	/**
	 * 递归比较两个节点
	 */
	private compareNodes(
		oldNode: ITreeNode | undefined,
		newNode: ITreeNode | undefined,
		changes: IFileChange[],
	): void {
		// 两个都不存在
		if (!oldNode && !newNode) {
			return;
		}

		// 新增节点
		if (!oldNode && newNode) {
			this.collectAllFiles(newNode, 'add', changes);
			return;
		}

		// 删除节点
		if (oldNode && !newNode) {
			this.collectAllFiles(oldNode, 'delete', changes);
			return;
		}

		// 两个都存在
		const old = oldNode!;
		const current = newNode!;

		// hash 相同，无变化
		if (old.hash === current.hash) {
			return;
		}

		// 类型不同
		if (old.type !== current.type) {
			this.collectAllFiles(old, 'delete', changes);
			this.collectAllFiles(current, 'add', changes);
			return;
		}

		// 都是文件
		if (old.type === NodeType.File && current.type === NodeType.File) {
			changes.push({
				path: current.path,
				type: 'modify',
				oldHash: old.hash,
				newHash: current.hash,
			});
			return;
		}

		// 都是目录，递归比较子节点
		if (old.type === NodeType.Directory && current.type === NodeType.Directory) {
			const oldDir = old as DirectoryNode;
			const newDir = current as DirectoryNode;

			// 收集所有子节点名
			const allChildNames = new Set([
				...Array.from(oldDir.children.keys()),
				...Array.from(newDir.children.keys()),
			]);

			for (const name of Array.from(allChildNames)) {
				const oldChild = oldDir.getChild(name);
				const newChild = newDir.getChild(name);

				// 只有 hash 不同时才递归
				if (oldChild?.hash !== newChild?.hash) {
					this.compareNodes(oldChild, newChild, changes);
				}
			}
		}
	}

	/**
	 * 收集节点下的所有文件
	 */
	private collectAllFiles(
		node: ITreeNode,
		type: 'add' | 'delete',
		changes: IFileChange[],
	): void {
		if (node.type === NodeType.File) {
			changes.push({
				path: node.path,
				type,
				...(type === 'add' ? { newHash: node.hash } : { oldHash: node.hash }),
			});
		} else if (node.type === NodeType.Directory) {
			const dir = node as DirectoryNode;
			for (const child of Array.from(dir.children.values())) {
				this.collectAllFiles(child, type, changes);
			}
		}
	}
}

/**
 * 创建树差异计算器
 */
export function createTreeDiff(): TreeDiff {
	return new TreeDiff();
}
