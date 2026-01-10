/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../base/common/cancellation.js';
import { Event } from '../../base/common/event.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { AiToolCall, TokenUsage, AiMessageContent } from './types.js';
import { URI } from '../../base/common/uri.js';

/**
 * Chenille Chat 响应块
 */
export interface IChenilleChatResponseChunk {
	/** 文本内容增量 */
	content?: string;
	/** 推理内容增量 */
	reasoning?: string;
	/** 工具调用信息 */
	toolCall?: {
		name: string;
		status: 'calling' | 'success' | 'error';
		result?: string;
	};
	/** 是否完成 */
	done: boolean;
	/** 错误信息 */
	error?: string;
	/** Token 使用量（仅在 done=true 时有值） */
	usage?: TokenUsage;
}

/**
 * Chenille Chat 历史消息
 */
export interface IChenilleChatMessage {
	role: 'user' | 'assistant' | 'tool';
	content: string;
	/** 多模态内容（包含图片时使用） */
	multiContent?: AiMessageContent[];
	/** assistant 消息的工具调用列表 */
	tool_calls?: AiToolCall[];
	/** tool 消息的工具调用 ID */
	tool_call_id?: string;
}

/**
 * 会话上下文（用于工具确认）
 */
export interface IChenilleSessionContext {
	/** 会话资源 URI */
	sessionResource: URI;
	/** 请求 ID */
	requestId: string;
}

/**
 * Chenille Chat 请求
 */
export interface IChenilleChatRequest {
	/** 用户输入 */
	input: string;
	/** 多模态内容（包含图片时使用，优先于 input） */
	multiContent?: AiMessageContent[];
	/** 历史消息 */
	history: IChenilleChatMessage[];
	/** 是否启用工具 */
	enableTools?: boolean;
	/** 会话上下文（用于工具内联确认） */
	sessionContext?: IChenilleSessionContext;
}

/**
 * Chenille Chat 结果
 */
export interface IChenilleChatResult {
	/** 是否成功 */
	success: boolean;
	/** 完整响应文本 */
	content: string;
	/** 错误信息 */
	error?: string;
	/** 耗时（毫秒） */
	elapsed?: number;
	/** Token 使用量 */
	usage?: TokenUsage;
}

/**
 * Chenille Chat Provider 接口
 * 定义在 common 层，实现在 browser 层
 */
export const IChenilleChatProvider = createDecorator<IChenilleChatProvider>('chenilleChatProvider');

export interface IChenilleChatProvider {
	readonly _serviceBrand: undefined;

	/**
	 * 响应流事件
	 */
	readonly onResponseChunk: Event<IChenilleChatResponseChunk>;

	/**
	 * 检查是否已配置
	 */
	isConfigured(): Promise<boolean>;

	/**
	 * 获取配置错误信息
	 */
	getConfigurationError(): Promise<string | undefined>;

	/**
	 * 提示用户配置
	 */
	promptConfiguration(): void;

	/**
	 * 获取当前模型的上下文大小
	 */
	getContextSize(): Promise<number>;

	/**
	 * 获取当前模型是否支持图像分析
	 */
	supportsVision(): Promise<boolean>;

	/**
	 * 发送 Chat 请求
	 * @returns 完整的响应结果
	 */
	chat(request: IChenilleChatRequest, token?: CancellationToken): Promise<IChenilleChatResult>;

	/**
	 * 取消当前请求
	 */
	cancel(): void;
}
