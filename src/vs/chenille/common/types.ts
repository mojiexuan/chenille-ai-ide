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
			return '/chat/completions';
		case AiProvider.ANTHROPIC:
			return '/v1/messages';
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
	/** Google Gemini thoughtSignature（必须原样传回） */
	thoughtSignature?: string;
}

/**
 * 图片内容
 */
export interface AiImageContent {
	type: 'image';
	/** base64 编码的图片数据 */
	data: string;
	/** MIME 类型，如 image/png, image/jpeg, image/gif, image/webp */
	mimeType: string;
}

/**
 * 文本内容
 */
export interface AiTextContent {
	type: 'text';
	text: string;
}

/**
 * 多模态内容（文本或图片）
 */
export type AiMessageContent = AiTextContent | AiImageContent;

/**
 * AI模型消息格式（扩展版，支持工具调用和多模态）
 */
export interface AiModelMessage {
	role: AiMessageRole;
	/** 文本内容（简单模式） */
	content: string;
	/** 多模态内容（包含图片时使用） */
	multiContent?: AiMessageContent[];
	/** assistant 消息的工具调用列表 */
	tool_calls?: AiToolCall[];
	/** tool 消息的工具调用 ID */
	tool_call_id?: string;
	/** DeepSeek 等模型的推理内容 */
	reasoning_content?: string;
	/** Anthropic thinking block 的签名（必须原样传回） */
	reasoning_signature?: string;
}

/**
 * 统一响应结果
 */
export interface ChatCompletionResult {
	content: string;
	reasoning?: string;
	/** Anthropic thinking block 的签名（必须原样传回） */
	reasoning_signature?: string;
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
	/** 是否支持图像分析（视觉能力） */
	supportsVision?: boolean;
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


// ============================================================================
// MCP (Model Context Protocol) 类型定义
// ============================================================================

/**
 * MCP 服务器传输类型
 */
export type McpTransportType = 'stdio' | 'sse';

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
	/** 服务器唯一名称 */
	name: string;
	/** 显示名称 */
	displayName?: string;
	/** 描述 */
	description?: string;
	/** 传输类型 */
	transport: McpTransportType;
	/** stdio 传输配置 */
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	/** SSE 传输配置 */
	url?: string;
	/** 是否启用 */
	enabled: boolean;
	/** 自动批准的工具列表（无需用户确认） */
	autoApprove?: string[];
}

/**
 * MCP 工具定义（从服务器获取）
 */
export interface McpToolDefinition {
	/** 工具名称 */
	name: string;
	/** 工具描述 */
	description?: string;
	/** 输入参数 JSON Schema */
	inputSchema: {
		type: 'object';
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

/**
 * MCP 资源定义
 */
export interface McpResourceDefinition {
	/** 资源 URI */
	uri: string;
	/** 资源名称 */
	name: string;
	/** 资源描述 */
	description?: string;
	/** MIME 类型 */
	mimeType?: string;
}

/**
 * MCP 提示词定义
 */
export interface McpPromptDefinition {
	/** 提示词名称 */
	name: string;
	/** 提示词描述 */
	description?: string;
	/** 参数定义 */
	arguments?: McpPromptArgument[];
}

/**
 * MCP 提示词参数
 */
export interface McpPromptArgument {
	/** 参数名称 */
	name: string;
	/** 参数描述 */
	description?: string;
	/** 是否必需 */
	required?: boolean;
}

/**
 * MCP 服务器能力
 */
export interface McpServerCapabilities {
	/** 支持的工具 */
	tools?: McpToolDefinition[];
	/** 支持的资源 */
	resources?: McpResourceDefinition[];
	/** 支持的提示词 */
	prompts?: McpPromptDefinition[];
}

/**
 * MCP 服务器状态
 */
export enum McpServerStatus {
	/** 已断开 */
	DISCONNECTED = 'disconnected',
	/** 连接中 */
	CONNECTING = 'connecting',
	/** 已连接 */
	CONNECTED = 'connected',
	/** 错误 */
	ERROR = 'error',
}

/**
 * MCP 服务器运行时信息
 */
export interface McpServerInfo {
	/** 服务器配置 */
	config: McpServerConfig;
	/** 当前状态 */
	status: McpServerStatus;
	/** 错误信息 */
	error?: string;
	/** 服务器能力（连接后获取） */
	capabilities?: McpServerCapabilities;
}

/**
 * MCP 工具调用请求
 */
export interface McpToolCallRequest {
	/** 服务器名称 */
	serverName: string;
	/** 工具名称 */
	toolName: string;
	/** 工具参数 */
	arguments: Record<string, unknown>;
}

/**
 * MCP 工具调用结果
 */
export interface McpToolCallResult {
	/** 是否成功 */
	success: boolean;
	/** 结果内容 */
	content?: McpContent[];
	/** 错误信息 */
	error?: string;
}

/**
 * MCP 内容类型
 */
export interface McpTextContent {
	type: 'text';
	text: string;
}

export interface McpImageContent {
	type: 'image';
	data: string;
	mimeType: string;
}

export interface McpResourceContent {
	type: 'resource';
	resource: {
		uri: string;
		text?: string;
		blob?: string;
		mimeType?: string;
	};
}

export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

/**
 * 将 MCP 工具转换为 AI 工具格式
 */
export function mcpToolToAiTool(serverName: string, tool: McpToolDefinition): AiTool {
	return {
		type: 'function',
		function: {
			// 使用 serverName__toolName 格式避免冲突
			name: `mcp_${serverName}__${tool.name}`,
			description: tool.description || tool.name,
			parameters: {
				type: tool.inputSchema.type,
				properties: (tool.inputSchema.properties || {}) as AiFunctionDefinitionParameterProperty,
				required: tool.inputSchema.required || [],
			},
		},
	};
}

/**
 * 解析 MCP 工具名称
 */
export function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
	if (!fullName.startsWith('mcp_')) {
		return null;
	}
	const parts = fullName.slice(4).split('__');
	if (parts.length !== 2) {
		return null;
	}
	return { serverName: parts[0], toolName: parts[1] };
}
