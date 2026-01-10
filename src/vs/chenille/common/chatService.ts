/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { Event } from '../../base/common/event.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { AiModelMessage, ChatCompletionResult, AiTool } from './types.js';

/**
 * AI 调用请求参数（主进程）
 */
export interface IAiCallRequest {
	/** 请求唯一标识符 */
	requestId: string;
	/** 消息历史 */
	messages: AiModelMessage[];
	/** 工具定义 */
	tools?: AiTool[];
}

/**
 * 带请求 ID 的流式响应块
 */
export interface IStreamChunkWithId extends ChatCompletionResult {
	/** 请求唯一标识符 */
	requestId: string;
}

/**
 * AI 调用服务接口（主进程）
 * 只负责调用 AI，不处理工具执行
 */
export const IChenilleAiService = createDecorator<IChenilleAiService>('chenilleAiService');

export interface IChenilleAiService {
	readonly _serviceBrand: undefined;

	/** 流式响应事件（带请求 ID） */
	readonly onStreamChunk: Event<IStreamChunkWithId>;

	/**
	 * 流式调用 AI
	 */
	streamChat(request: IAiCallRequest, token?: CancellationToken): Promise<void>;

	/**
	 * 检查 Code Writer Agent 是否已配置
	 */
	isAgentConfigured(): Promise<boolean>;

	/**
	 * 获取配置错误信息（如果有）
	 */
	getConfigurationError(): Promise<string | undefined>;

	/**
	 * 获取当前模型的上下文大小
	 */
	getContextSize(): Promise<number>;

	/**
	 * 获取当前模型是否支持图像分析
	 */
	supportsVision(): Promise<boolean>;

	/**
	 * 获取 Anthropic 调试日志
	 */
	getDebugLogs(): Promise<{ sdk: string[]; fetch: string[] }>;

	/**
	 * 清除调试日志
	 */
	clearDebugLogs(): Promise<void>;
}

export const ChenilleAiChannelName = 'chenilleAi';

/**
 * IPC Channel（服务端 - main 进程）
 */
export class ChenilleAiChannel implements IServerChannel {
	constructor(private readonly service: IChenilleAiService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onStreamChunk':
				return this.service.onStreamChunk as Event<T>;
		}
		throw new Error(`无效的监听事件: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[], token: CancellationToken = CancellationToken.None): Promise<T> {
		switch (command) {
			case 'streamChat':
				return this.service.streamChat(args?.[0] as IAiCallRequest, token) as Promise<T>;
			case 'isAgentConfigured':
				return this.service.isAgentConfigured() as Promise<T>;
			case 'getConfigurationError':
				return this.service.getConfigurationError() as Promise<T>;
			case 'getContextSize':
				return this.service.getContextSize() as Promise<T>;
			case 'supportsVision':
				return this.service.supportsVision() as Promise<T>;
			case 'getDebugLogs':
				return this.service.getDebugLogs() as Promise<T>;
			case 'clearDebugLogs':
				return this.service.clearDebugLogs() as Promise<T>;
		}
		throw new Error(`无效的调用命令: ${command}`);
	}
}

/**
 * IPC Channel 客户端（browser 端调用 main 进程）
 */
export class ChenilleAiChannelClient implements IChenilleAiService {
	declare readonly _serviceBrand: undefined;

	readonly onStreamChunk: Event<IStreamChunkWithId>;

	constructor(private readonly channel: IChannel) {
		this.onStreamChunk = this.channel.listen<IStreamChunkWithId>('onStreamChunk');
	}

	streamChat(request: IAiCallRequest, token?: CancellationToken): Promise<void> {
		return this.channel.call<void>('streamChat', [request], token);
	}

	isAgentConfigured(): Promise<boolean> {
		return this.channel.call<boolean>('isAgentConfigured');
	}

	getConfigurationError(): Promise<string | undefined> {
		return this.channel.call<string | undefined>('getConfigurationError');
	}

	getContextSize(): Promise<number> {
		return this.channel.call<number>('getContextSize');
	}

	supportsVision(): Promise<boolean> {
		return this.channel.call<boolean>('supportsVision');
	}

	getDebugLogs(): Promise<{ sdk: string[]; fetch: string[] }> {
		return this.channel.call<{ sdk: string[]; fetch: string[] }>('getDebugLogs');
	}

	clearDebugLogs(): Promise<void> {
		return this.channel.call<void>('clearDebugLogs');
	}
}
