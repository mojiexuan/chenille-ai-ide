/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { basename, dirname, join } from '../../base/common/path.js';
import { IGitWorktreeInfo, IGitWorktreeService } from '../common/gitWorktree.js';

const GIT_TIMEOUT_MS = 120_000;

function execGit(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: GIT_TIMEOUT_MS }, (error, stdout, stderr) => {
			if (error) {
				const detail = (stderr || stdout || error.message).trim();
				reject(new Error(detail || error.message));
			} else {
				resolve(stdout);
			}
		});
	});
}

function sanitizeName(name: string): string {
	const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40);
	return slug || 'agent';
}

/**
 * 通过命令行 git 管理 worktree。
 * 刻意不复用 node 层的 IAgentHostGitService：那个服务绑定在 agent host 进程中，渲染进程无法注入。
 */
export class GitWorktreeMainService implements IGitWorktreeService {
	declare readonly _serviceBrand: undefined;

	async getRepositoryRoot(path: string): Promise<string | undefined> {
		try {
			const root = (await execGit(['rev-parse', '--show-toplevel'], path)).trim();
			return root || undefined;
		} catch {
			return undefined;
		}
	}

	async createWorktree(repositoryPath: string, name: string): Promise<IGitWorktreeInfo> {
		const repositoryRoot = await this.getRepositoryRoot(repositoryPath);
		if (!repositoryRoot) {
			throw new Error(`不是 Git 仓库，无法创建 worktree：${repositoryPath}`);
		}

		const suffix = randomUUID().substring(0, 8);
		const slug = sanitizeName(name);
		const branch = `chenille/${slug}-${suffix}`;
		const worktreePath = join(dirname(repositoryRoot), `${basename(repositoryRoot)}-chenille-worktrees`, `${slug}-${suffix}`);

		await fs.promises.mkdir(dirname(worktreePath), { recursive: true });
		await execGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repositoryRoot);

		return { path: worktreePath, branch };
	}

	async removeWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
		const repositoryRoot = await this.getRepositoryRoot(repositoryPath);
		if (!repositoryRoot) {
			throw new Error(`不是 Git 仓库：${repositoryPath}`);
		}
		// 不加 --force：有未提交改动时让 git 拒绝，避免误删代理的产出。
		await execGit(['worktree', 'remove', worktreePath], repositoryRoot);
	}
}
