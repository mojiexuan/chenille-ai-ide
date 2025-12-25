/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { Event } from '../../base/common/event.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';

export const ICommitMessageService = createDecorator<ICommitMessageService>('commitMessageService');

/**
 * 提交消息生成服务接口
 * 调用方只需传入 changes，agent 由服务内部加载
 */
export interface ICommitMessageService {
	readonly _serviceBrand: undefined;

	readonly onStreamChunk: Event<string>;

	generateCommitMessage(changes: string, token?: CancellationToken): Promise<string>;

	generateCommitMessageStream(changes: string, token?: CancellationToken): Promise<void>;
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
			case 'generateCommitMessage':
				return this.service.generateCommitMessage(args?.[0] as string, token) as Promise<T>;
			case 'generateCommitMessageStream':
				return this.service.generateCommitMessageStream(args?.[0] as string, token) as Promise<T>;
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

	generateCommitMessage(changes: string, token?: CancellationToken): Promise<string> {
		return this.channel.call<string>('generateCommitMessage', [changes], token);
	}

	generateCommitMessageStream(changes: string, token?: CancellationToken): Promise<void> {
		return this.channel.call<void>('generateCommitMessageStream', [changes], token);
	}
}
