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
	OPENAI = 'openai',
	GOOGLE = 'google',
	ANTHROPIC = 'anthropic',
}

/**
 * 获取服务商的 API 端点路径（SDK 内部拼接的路径）
 */
export function getProviderEndpointPath(provider: AiProvider): string {
	switch (provider) {
		case AiProvider.OPENAI:
			return '/chat/completions';  // OpenAI SDK 的 baseURL 默认已包含 /v1
		case AiProvider.ANTHROPIC:
			return '/v1/messages';  // Anthropic SDK 会拼接 /v1/messages
		case AiProvider.GOOGLE:
			return '/v1beta/models/{model}:generateContent';
		default:
			return '';
	}
}

/**
 * 获取完整的请求 URL 预览
 */
export function getFullEndpointUrl(baseUrl: string, provider: AiProvider): string {
	if (!baseUrl) {
		// 显示默认端点
		switch (provider) {
			case AiProvider.OPENAI:
				return 'https://api.openai.com/v1/chat/completions';
			case AiProvider.ANTHROPIC:
				return 'https://api.anthropic.com/v1/messages';
			case AiProvider.GOOGLE:
				return 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
			default:
				return '';
		}
	}
	// 移除末尾斜杠
	const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
	return cleanBaseUrl + getProviderEndpointPath(provider);
}

/**
 * AI模型消息角色
 */
export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 工具调用（带 ID，用于消息历史）
 */
export interface AiToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

/**
 * AI模型消息格式（扩展版，支持工具调用）
 */
export interface AiModelMessage {
	role: AiMessageRole;
	content: string;
	/** assistant 消息的工具调用列表 */
	tool_calls?: AiToolCall[];
	/** tool 消息的工具调用 ID */
	tool_call_id?: string;
	/** DeepSeek 等模型的推理内容 */
	reasoning_content?: string;
}

/**
 * 统一响应结果
 */
export interface ChatCompletionResult {
	content: string;
	reasoning?: string;
	/** 工具调用列表（带 ID） */
	tool_calls?: AiToolCall[];
	done: boolean;
	error?: string;
	/** Token 使用量 */
	usage?: TokenUsage;
}

/**
 * Token 使用量
 */
export interface TokenUsage {
	/** 输入 token 数 */
	promptTokens: number;
	/** 输出 token 数 */
	completionTokens: number;
	/** 总 token 数 */
	totalTokens: number;
}

/**
 * 工具回调（旧格式，保留兼容）
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
 * 生成工具调用 ID
 */
export function generateToolCallId(): string {
	return 'call_' + Math.random().toString(36).substring(2, 15);
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
	/** 取消令牌 */
	token?: { isCancellationRequested: boolean };
}

/**
 * AI Agent（运行时组合）
 */
export interface AiAgent {
	model: AiModel;
	prompt: AiPrompt;
}

/**
 * 智能体类型枚举
 */
export enum AgentType {
	COMMIT_MESSAGE = 'commitMessage',
	CODE_WRITER = 'codeWriter',
	INLINE_COMPLETION = 'inlineCompletion',
}

/**
 * 智能体配置（用于存储）
 */
export interface AiAgentConfig {
	type: AgentType;
	modelName: string;
	promptName: string;
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
	contextSize: number;
	maxTokens: number;
	temperature: number;
}

/**
 * AI提示词
 */
export interface AiPrompt {
	name: string;
	description: string;
	content: string;
	/** 是否为内置提示词（只读，不可编辑/删除） */
	isBuiltin?: boolean;
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
	/** 数组元素类型 */
	items?: AiFunctionDefinitionParameterPropertyDescriptor | { type: string };
	/** 枚举值 */
	enum?: string[];
	/** 嵌套对象属性 */
	properties?: AiFunctionDefinitionParameterProperty;
	/** 嵌套对象必需字段 */
	required?: string[];
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
