/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';

/** 新建的 git worktree */
export interface IGitWorktreeInfo {
	/** worktree 的绝对路径 */
	readonly path: string;
	/** 为新 worktree 创建的分支名 */
	readonly branch: string;
}

/**
 * 主进程中的 git worktree 服务。
 * 浏览器层无法直接启动进程，多代理隔离通过 IPC 调用这里的实现。
 */
export const IGitWorktreeService = createDecorator<IGitWorktreeService>('chenilleGitWorktreeService');

export interface IGitWorktreeService {
	readonly _serviceBrand: undefined;
	/** 返回路径所属仓库的根目录；不是 git 仓库时返回 undefined */
	getRepositoryRoot(path: string): Promise<string | undefined>;
	/** 基于当前 HEAD 创建 worktree 与分支 */
	createWorktree(repositoryPath: string, name: string): Promise<IGitWorktreeInfo>;
	/** 删除指定 worktree（不会删除分支） */
	removeWorktree(repositoryPath: string, worktreePath: string): Promise<void>;
}

export const GitWorktreeChannelName = 'chenille.gitWorktree';

export class GitWorktreeChannel implements IServerChannel {
	constructor(private readonly service: IGitWorktreeService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		throw new Error(`No event: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'getRepositoryRoot': return this.service.getRepositoryRoot(args?.[0] as string) as Promise<T>;
			case 'createWorktree': return this.service.createWorktree(args?.[0] as string, args?.[1] as string) as Promise<T>;
			case 'removeWorktree': return this.service.removeWorktree(args?.[0] as string, args?.[1] as string) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class GitWorktreeChannelClient implements IGitWorktreeService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly channel: IChannel) { }

	getRepositoryRoot(path: string): Promise<string | undefined> {
		return this.channel.call('getRepositoryRoot', [path]);
	}

	createWorktree(repositoryPath: string, name: string): Promise<IGitWorktreeInfo> {
		return this.channel.call('createWorktree', [repositoryPath, name]);
	}

	removeWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
		return this.channel.call('removeWorktree', [repositoryPath, worktreePath]);
	}
}
