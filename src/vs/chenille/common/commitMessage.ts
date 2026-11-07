/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { Event } from '../../base/common/event.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';

/**
 * 需要生成提交消息的变更集合。路径均相对于仓库根目录。
 */
export interface ICommitMessageChangeSet {
	readonly rootPath: string;
	readonly gitPathHints?: readonly string[];
	readonly stagedPaths: readonly string[];
	readonly workingTreePaths: readonly string[];
	readonly untrackedPaths: readonly string[];
}

export const ICommitMessageService = createDecorator<ICommitMessageService>('commitMessageService');

/**
 * 提交消息生成服务接口
 * 调用方只需传入变更集合，diff 与上下文由服务内部通过 git 收集
 */
export interface ICommitMessageService {
	readonly _serviceBrand: undefined;

	readonly onStreamChunk: Event<string>;

	generateCommitMessageStream(changes: ICommitMessageChangeSet, token?: CancellationToken): Promise<void>;
}

export const CommitMessageChannelName = 'commitMessage';

/**
 * IPC Channel（服务端 - main 进程）
 */
export class CommitMessageChannel implements IServerChannel {
	constructor(private readonly service: ICommitMessageService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onStreamChunk': return this.service.onStreamChunk as Event<T>;
		}
		throw new Error(`无效的监听事件: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[], token: CancellationToken = CancellationToken.None): Promise<T> {
		switch (command) {
			case 'generateCommitMessageStream':
				return this.service.generateCommitMessageStream(args?.[0] as ICommitMessageChangeSet, token) as Promise<T>;
		}
		throw new Error(`无效的调用命令: ${command}`);
	}
}

/**
 * IPC Channel 客户端（browser 端调用 main 进程）
 */
export class CommitMessageChannelClient implements ICommitMessageService {
	declare readonly _serviceBrand: undefined;

	readonly onStreamChunk: Event<string>;

	constructor(private readonly channel: IChannel) {
		this.onStreamChunk = this.channel.listen<string>('onStreamChunk');
	}

	generateCommitMessageStream(changes: ICommitMessageChangeSet, token?: CancellationToken): Promise<void> {
		return this.channel.call<void>('generateCommitMessageStream', [changes], token);
	}
}
