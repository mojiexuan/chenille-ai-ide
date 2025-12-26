/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';

/**
 * 代码补全请求参数
 */
export interface IInlineCompletionRequest {
	/** 文件路径 */
	filePath: string;
	/** 语言标识 */
	languageId: string;
	/** 光标前的代码 */
	prefix: string;
	/** 光标后的代码 */
	suffix: string;
}

/**
 * 代码补全响应
 */
export interface IInlineCompletionResponse {
	/** 补全文本 */
	text: string;
	/** 是否成功 */
	success: boolean;
	/** 错误信息 */
	error?: string;
}

/**
 * Inline Completion 服务接口
 */
export const IChenilleInlineCompletionService = createDecorator<IChenilleInlineCompletionService>('chenilleInlineCompletionService');

export interface IChenilleInlineCompletionService {
	readonly _serviceBrand: undefined;

	/**
	 * 获取代码补全
	 */
	getCompletion(request: IInlineCompletionRequest, token?: CancellationToken): Promise<IInlineCompletionResponse>;

	/**
	 * 检查 Agent 是否已配置
	 */
	isAgentConfigured(): Promise<boolean>;
}

export const ChenilleInlineCompletionChannelName = 'chenilleInlineCompletion';

/**
 * IPC Channel（服务端 - main 进程）
 */
export class ChenilleInlineCompletionChannel implements IServerChannel {
	constructor(private readonly service: IChenilleInlineCompletionService) { }

	listen<T>(): never {
		throw new Error('No events');
	}

	call<T>(_context: unknown, command: string, args?: unknown[], token: CancellationToken = CancellationToken.None): Promise<T> {
		switch (command) {
			case 'getCompletion':
				return this.service.getCompletion(args?.[0] as IInlineCompletionRequest, token) as Promise<T>;
			case 'isAgentConfigured':
				return this.service.isAgentConfigured() as Promise<T>;
		}
		throw new Error(`无效的调用命令: ${command}`);
	}
}

/**
 * IPC Channel 客户端（browser 端调用 main 进程）
 */
export class ChenilleInlineCompletionChannelClient implements IChenilleInlineCompletionService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly channel: IChannel) { }

	getCompletion(request: IInlineCompletionRequest, token?: CancellationToken): Promise<IInlineCompletionResponse> {
		return this.channel.call<IInlineCompletionResponse>('getCompletion', [request], token);
	}

	isAgentConfigured(): Promise<boolean> {
		return this.channel.call<boolean>('isAgentConfigured');
	}
}
