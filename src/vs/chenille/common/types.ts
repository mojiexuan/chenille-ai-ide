/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fetch 请求配置
 */
export interface IFetchOptions<P = unknown> {
	/** HTTP 方法 */
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	/** 请求参数（GET/DELETE 转为 URL 参数，其他转为 body）*/
	params?: P;
	/** 请求头 */
	headers?: Record<string, string>;
	/** 请求体（优先于 params）*/
	body?: BodyInit;
	/** 超时时间（毫秒）*/
	timeout?: number;
	/** 信号 */
	signal?: AbortSignal;
}

/**
 * 请求服务接口
 */
export interface IRequestService {
	request<T = unknown, P = unknown>(url: string, options?: IFetchOptions<P>): Promise<T>;
	get<T = unknown, P = unknown>(url: string, params?: P, options?: Omit<IFetchOptions<P>, 'method' | 'params'>): Promise<T>;
	post<T = unknown, P = unknown>(url: string, params?: P, options?: Omit<IFetchOptions<P>, 'method' | 'params'>): Promise<T>;
	put<T = unknown, P = unknown>(url: string, params?: P, options?: Omit<IFetchOptions<P>, 'method' | 'params'>): Promise<T>;
	delete<T = unknown, P = unknown>(url: string, params?: P, options?: Omit<IFetchOptions<P>, 'method' | 'params'>): Promise<T>;
	patch<T = unknown, P = unknown>(url: string, params?: P, options?: Omit<IFetchOptions<P>, 'method' | 'params'>): Promise<T>;
}

/**
 * 支持的AI平台提供商枚举
 */
export enum AiProvider {
	DEEPSEEK = 'deepseek',
	OPENAI = 'openai',
	GOOGLE = 'google',
	ANTHROPIC = 'anthropic',
}

/**
 * AI模型消息角色
 */
export type AiMessageRole = 'system' | 'user' | 'assistant';

/**
 * AI模型消息格式
 */
export interface AiModelMessage {
	role: AiMessageRole;
	content: string;
}

/**
 * 统一响应结果
 */
export interface ChatCompletionResult {
	content: string;
	reasoning?: string;
	function_call?: ToolCall[];
	done: boolean;
	error?: string;
}

/**
 * 工具回调
 */
export interface ToolCall {
	type: 'function';
	function: ToolCallFunction;
}

export interface ToolCallFunction {
	arguments?: string;
	name?: string;
}

/**
 * AI对话选项
 */
export interface ChatCompletionOptions {
	agent: AiAgent;
	messages: AiModelMessage[];
	tools?: AiTool[];
	tool_choice?:
	| 'auto'
	| 'none'
	| { type: 'function'; function: { name: string } };
	call?: (data: ChatCompletionResult) => void;
}

/**
 * AI Agent
 */
export interface AiAgent {
	name: string;
	model: AiModel;
	prompt: AiPrompt;
	maxTokens: number;
	temperature: number;
}

/**
 * AI模型
 */
export interface AiModel {
	name: string;
	provider: AiProvider;
	model: string;
	baseUrl: string;
	apiKey: string;
}

/**
 * AI提示词
 */
export interface AiPrompt {
	name: string;
	description: string;
	content: string;
}

/**
 * AI工具
 */
export interface AiTool {
	type: 'function';
	function: AiFunctionDefinition;
}

/**
 * 函数端点
 */
export interface AiFunctionDefinition {
	name: string;
	description: string;
	parameters: AiFunctionDefinitionParameter;
}

export interface AiFunctionDefinitionParameter {
	type: string;
	properties: AiFunctionDefinitionParameterProperty;
	required: string[];
}

export interface AiFunctionDefinitionParameterProperty {
	[key: string]: AiFunctionDefinitionParameterPropertyDescriptor;
}

export interface AiFunctionDefinitionParameterPropertyDescriptor {
	type: string;
	description: string;
}

/**
 * AI Provider 统一接口
 * 所有提供商（OpenAI、Anthropic、Google 等）都实现此接口
 */
export interface IAIProvider {
	/** 提供商名称 */
	readonly name: string;
	/** 普通对话 */
	chat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
	/** 流式对话 */
	stream(options: ChatCompletionOptions): Promise<void>;
}
