/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { execFile } from 'child_process';
import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { basename, isAbsolute, join } from '../../base/common/path.js';
import { IEnvironmentMainService } from '../../platform/environment/electron-main/environmentMainService.js';
import { ILogService } from '../../platform/log/common/log.js';
import { ICommitMessageChangeSet, ICommitMessageService } from '../common/commitMessage.js';
import { CHENILLE_HOME_DIR_NAME, COMMIT_MESSAGE_RULES_FILE_NAME, DEFAULT_COMMIT_MESSAGE_RULES } from '../common/commitMessageRules.js';
import { AIClient } from '../node/ai/aiClient.js';
import { AgentType } from '../common/types.js';
import { IAiAgentMainService } from './agentService.js';

/** 未跟踪文件读取上限，超过后只输出补丁头（与官方实现一致） */
const MAX_UNTRACKED_FILE_SIZE = 1 * 1024 * 1024;

/** 单个文件 diff 的字符上限（与官方实现一致） */
const MAX_DIFF_SIZE = 100_000;

/**
 * 提交消息生成服务实现（主进程）
 * 通过 git 收集真实 diff 与提交历史，再调用 Chenille agent
 */
export class CommitMessageMainService extends Disposable implements ICommitMessageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onStreamChunk = this._register(new Emitter<string>());
	readonly onStreamChunk: Event<string> = this._onStreamChunk.event;

	constructor(
		@IAiAgentMainService private readonly agentService: IAiAgentMainService,
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * 读取全局提交消息规则（~/.chenille/commit-message.md），不存在或为空时使用默认规则
	 */
	private async getSystemPrompt(): Promise<string> {
		const rulesFile = join(this.environmentService.userHome.fsPath, CHENILLE_HOME_DIR_NAME, COMMIT_MESSAGE_RULES_FILE_NAME);
		try {
			const content = (await fs.promises.readFile(rulesFile, 'utf-8')).trim();
			if (content) {
				return content;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				this.logService.warn('[Chenille] 读取全局提交消息规则失败:', error);
			}
		}
		return DEFAULT_COMMIT_MESSAGE_RULES;
	}

	async generateCommitMessageStream(changeSet: ICommitMessageChangeSet, token?: CancellationToken): Promise<void> {
		if (token?.isCancellationRequested) {
			return;
		}

		const agent = await this.agentService.getAgent(AgentType.COMMIT_MESSAGE);
		const userPrompt = await this.buildUserPrompt(changeSet, token);
		if (!userPrompt || token?.isCancellationRequested) {
			return;
		}

		this.logService.info(`[Chenille] 提交消息上下文长度: ${userPrompt.length} 字符`);

		await AIClient.stream({
			agent,
			messages: [
				{ role: 'system', content: await this.getSystemPrompt() },
				{ role: 'user', content: userPrompt },
			],
			call: (result) => {
				if (token?.isCancellationRequested) {
					return;
				}
				if (result.content) {
					this._onStreamChunk.fire(result.content);
				}
			},
		});
	}

	/**
	 * 构造与官方实现一致的上下文：真实 git diff、分支名、最近提交。
	 * 有暂存内容时只使用暂存变更，否则使用工作区变更 + 未跟踪文件。
	 */
	private async buildUserPrompt(changeSet: ICommitMessageChangeSet, token?: CancellationToken): Promise<string | undefined> {
		const rootPath = changeSet.rootPath;
		if (!rootPath) {
			return undefined;
		}

		const git = this.resolveGitCommand(changeSet.gitPathHints);
		const hasStaged = changeSet.stagedPaths.length > 0;
		const trackedPaths = hasStaged ? changeSet.stagedPaths : changeSet.workingTreePaths;
		const untrackedPaths = hasStaged ? [] : changeSet.untrackedPaths;

		const sections: string[] = [];

		for (const rawPath of trackedPaths) {
			if (token?.isCancellationRequested) {
				return undefined;
			}
			const relativePath = normalizeRelativePath(rawPath);
			if (!relativePath) {
				continue;
			}

			const args = ['-c', 'core.quotepath=false', 'diff'];
			if (hasStaged) {
				args.push('--cached');
			}
			args.push('--no-ext-diff', '--no-color', '--', relativePath);

			try {
				const diff = await this.runGit(git, rootPath, args);
				if (!diff.trim()) {
					continue;
				}
				sections.push(formatChange(relativePath, truncateDiff(diff)));
			} catch (error) {
				this.logService.warn(`[Chenille] 获取 ${relativePath} 的 diff 失败:`, error);
			}
		}

		for (const rawPath of untrackedPaths) {
			if (token?.isCancellationRequested) {
				return undefined;
			}
			const relativePath = normalizeRelativePath(rawPath);
			if (!relativePath) {
				continue;
			}

			try {
				const patch = await this.buildUntrackedPatch(rootPath, relativePath);
				if (patch) {
					sections.push(formatChange(relativePath, truncateDiff(patch)));
				}
			} catch (error) {
				this.logService.warn(`[Chenille] 处理未跟踪文件 ${relativePath} 失败:`, error);
			}
		}

		if (sections.length === 0) {
			this.logService.info('[Chenille] 未收集到有效的 diff，跳过提交消息生成');
			return undefined;
		}

		const [branchName, userName] = await Promise.all([
			this.getBranchName(git, rootPath),
			this.getUserName(git, rootPath),
		]);
		const [repositoryCommits, userCommits] = await Promise.all([
			this.getRecentCommits(git, rootPath),
			userName ? this.getRecentCommits(git, rootPath, userName) : Promise.resolve([]),
		]);

		const lines: string[] = [
			'# REPOSITORY DETAILS:',
			`Repository name: ${basename(rootPath)}`,
			`Branch name: ${branchName || '(unknown)'}`,
			'',
		];

		if (userCommits.length > 0) {
			lines.push('# RECENT USER COMMITS (For reference only, do not copy!):');
			lines.push(...userCommits.map(message => `- ${message}`));
			lines.push('');
		}

		if (repositoryCommits.length > 0) {
			lines.push('# RECENT REPOSITORY COMMITS (For reference only, do not copy!):');
			lines.push(...repositoryCommits.map(message => `- ${message}`));
			lines.push('');
		}

		lines.push('# CODE CHANGES:');
		lines.push(`变更文件数: ${sections.length}`);
		lines.push('');
		lines.push(sections.join('\n\n'));

		return lines.join('\n');
	}

	private resolveGitCommand(pathHints: readonly string[] | undefined): string {
		for (const hint of pathHints ?? []) {
			if (hint && isAbsolute(hint) && fs.existsSync(hint)) {
				return hint;
			}
		}
		return 'git';
	}

	private runGit(git: string, cwd: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile(git, args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
				if (error) {
					reject(error);
				} else {
					resolve(stdout);
				}
			});
		});
	}

	private async getBranchName(git: string, cwd: string): Promise<string> {
		try {
			return (await this.runGit(git, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		} catch {
			return '';
		}
	}

	private async getUserName(git: string, cwd: string): Promise<string> {
		try {
			return (await this.runGit(git, cwd, ['config', '--get', 'user.name'])).trim();
		} catch {
			return '';
		}
	}

	private async getRecentCommits(git: string, cwd: string, author?: string): Promise<string[]> {
		const args = ['-c', 'core.quotepath=false', 'log', '-n', '5', '--pretty=format:%s'];
		if (author) {
			args.push(`--author=${author}`);
		}

		try {
			const output = await this.runGit(git, cwd, args);
			return output.split('\n').map(line => line.trim()).filter(Boolean);
		} catch {
			return [];
		}
	}

	/**
	 * 为未跟踪文件生成「全部为新增」的补丁，与官方实现一致。
	 */
	private async buildUntrackedPatch(rootPath: string, relativePath: string): Promise<string> {
		const absolutePath = join(rootPath, relativePath);
		const header = [
			`diff --git a/${relativePath} b/${relativePath}`,
			'new file mode 100644',
			'--- /dev/null',
			`+++ b/${relativePath}`,
		];

		try {
			const stat = await fs.promises.stat(absolutePath);
			if (stat.size > MAX_UNTRACKED_FILE_SIZE) {
				header.push(`\\ File too large to diff (${Math.round(stat.size / 1024)} KB)`);
				return header.join('\n') + '\n';
			}
		} catch {
			return '';
		}

		const content = await fs.promises.readFile(absolutePath, 'utf-8');
		if (content.length > 0) {
			const lines = content.split('\n');
			if (content.endsWith('\n')) {
				lines.pop();
			}

			header.push(`@@ -0,0 +1,${lines.length} @@`);
			header.push(...lines.map(line => `+${line}`));

			if (!content.endsWith('\n')) {
				header.push('\\ No newline at end of file');
			}
		}

		return header.join('\n') + '\n';
	}
}

function normalizeRelativePath(path: string): string | undefined {
	const normalized = path.replace(/\\/g, '/');
	if (!normalized || normalized.startsWith('/') || isAbsolute(normalized) || normalized.split('/').includes('..')) {
		return undefined;
	}
	return normalized;
}

function truncateDiff(diff: string): string {
	if (diff.length <= MAX_DIFF_SIZE) {
		return diff;
	}
	return diff.substring(0, MAX_DIFF_SIZE) + '\n... [diff truncated]\n';
}

function formatChange(relativePath: string, diff: string): string {
	return `文件: ${relativePath}\n\`\`\`diff\n${diff.trimEnd()}\n\`\`\``;
}
