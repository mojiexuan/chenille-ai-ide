/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { MarkdownString } from '../../../base/common/htmlContent.js';
import { Codicon } from '../../../base/common/codicons.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { nullExtensionDescription } from '../../../workbench/services/extensions/common/extensions.js';
import { URI } from '../../../base/common/uri.js';
import { FileAccess } from '../../../base/common/network.js';
import { FileType } from '../../../platform/files/common/files.js';
import {
	IChatAgentData,
	IChatAgentImplementation,
	IChatAgentRequest,
	IChatAgentResult,
	IChatAgentService,
	IChatAgentHistoryEntry,
} from '../../../workbench/contrib/chat/common/chatAgents.js';
import {
	IChatProgress,
	IChatContentReference,
	IChatTreeData,
	IChatResponseProgressFileTreeData,
	IChatTaskDto,
} from '../../../workbench/contrib/chat/common/chatService.js';
import { IChatProgressHistoryResponseContent } from '../../../workbench/contrib/chat/common/chatModel.js';
import { ChatAgentLocation, ChatModeKind } from '../../../workbench/contrib/chat/common/constants.js';
import { IChenilleAiService, IStreamChunkWithId } from '../../common/chatService.js';
import { IChenilleChatModeService } from '../../common/chatMode.js';
import { AiModelMessage, AiToolCall, AiTool } from '../../common/types.js';
import { CHENILLE_FILE_TOOLS, buildToolDefinitionsForAI } from '../../tools/definitions.js';
import { IChenilleToolDispatcher, isChenilleFileTool, getInternalToolId } from '../../tools/dispatcher.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import {
	ILanguageModelToolsService,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolResult,
	ToolDataSource,
	ToolProgress,
	CountTokensCallback,
	IPreparedToolInvocation,
} from '../../../workbench/contrib/chat/common/languageModelToolsService.js';
import { IWorkbenchContribution } from '../../../workbench/common/contributions.js';
import { IProjectRulesService } from '../rules/projectRulesService.js';

/** 最大工具调用轮次 */
const MAX_TOOL_ROUNDS = 500;

/**
 * 工具调用信息（从历史中提取）
 */
interface ToolInvocationInfo {
	callId: string;
	name: string;
	parameters: Record<string, unknown>;
	isComplete: boolean;
	result?: string;
}

/**
 * 历史消息验证结果
 */
interface HistoryValidationResult {
	valid: boolean;
	reason?: string;
	messages?: AiModelMessage[];
}

/**
 * Chenille Agent ID
 */
export const CHENILLE_AGENT_ID = 'chenille.agent';

/**
 * Chenille Agent 数据
 */
function createChenilleAgentData(): IChatAgentData {
	// 使用 Chenille 自定义图标
	const iconUri = FileAccess.asBrowserUri('vs/workbench/contrib/chat/browser/media/chenille-icon.png');

	return {
		id: CHENILLE_AGENT_ID,
		name: 'Chenille',
		fullName: 'Chenille',
		description: localize('chenille.agent.description', 'Chenille AI 编程助手'),
		isDefault: true,
		isCore: true,
		modes: [ChatModeKind.Ask, ChatModeKind.Agent],
		slashCommands: [],
		disambiguation: [],
		locations: [ChatAgentLocation.Chat, ChatAgentLocation.EditorInline],
		metadata: {
			icon: iconUri,
			helpTextPrefix: new MarkdownString(localize('chenille.agent.help', '我是 Chenille AI 助手，可以帮助你编写代码、回答问题、执行任务。')),
		},
		extensionId: nullExtensionDescription.identifier,
		extensionVersion: undefined,
		extensionDisplayName: 'Chenille',
		extensionPublisherId: 'chenille',
	};
}

/**
 * Chenille Agent 实现
 * 将 Chenille 的 AI 能力集成到 VS Code Chat 系统中
 */
export class ChenilleAgentImpl extends Disposable implements IChatAgentImplementation {

	constructor(
		@IChenilleAiService private readonly aiService: IChenilleAiService,
		@IChenilleToolDispatcher private readonly toolDispatcher: IChenilleToolDispatcher,
		@IChenilleChatModeService private readonly modeService: IChenilleChatModeService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IProjectRulesService private readonly projectRulesService: IProjectRulesService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async invoke(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		history: IChatAgentHistoryEntry[],
		token: CancellationToken
	): Promise<IChatAgentResult> {
		// 检查配置
		if (!await this.aiService.isAgentConfigured()) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(localize('chenille.notConfigured', '⚠️ Chenille AI 未配置，请先在设置中配置模型。')),
			}]);
			return { errorDetails: { message: 'Agent not configured' } };
		}

		const isAgentMode = this.modeService.isAgentMode();
		const isNewSession = history.length === 0;

		// 新会话时获取项目规则
		let projectRules: string | undefined;
		if (isNewSession) {
			projectRules = await this.projectRulesService.getProjectRules();
			if (projectRules) {
				this.logService.info('[Chenille Agent] 已加载项目规则');
			}
		}

		const messages = this.buildMessages(request, history);

		// 保存会话上下文，用于工具调用时的内联确认
		const sessionContext = {
			sessionResource: request.sessionResource,
			requestId: request.requestId,
		};

		try {
			const result = await this.executeWithToolLoop(messages, isAgentMode, progress, token, sessionContext, projectRules);
			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error('[Chenille Agent] Error:', errorMessage);
			return { errorDetails: { message: errorMessage } };
		}
	}

	/**
	 * 构建消息历史（带过滤）
	 * 过滤掉无效的历史条目，避免发送给 API 时报错
	 */
	private buildMessages(request: IChatAgentRequest, history: IChatAgentHistoryEntry[]): AiModelMessage[] {
		const messages: AiModelMessage[] = [];

		// 添加历史消息（带过滤）
		for (const entry of history) {
			const validation = this.validateHistoryEntry(entry);

			if (!validation.valid) {
				this.logService.debug(`[Chenille] 跳过历史条目: ${validation.reason}`,
					entry.request.message.substring(0, 50));
				continue;
			}

			// 添加验证通过的消息
			if (validation.messages) {
				messages.push(...validation.messages);
			}
		}

		// 添加当前请求
		messages.push({ role: 'user', content: request.message });

		// 最终校验
		return this.finalValidation(messages);
	}

	/**
	 * 验证单个历史条目
	 */
	private validateHistoryEntry(entry: IChatAgentHistoryEntry): HistoryValidationResult {
		const result: AiModelMessage[] = [];
		const response = entry.response as ReadonlyArray<IChatProgressHistoryResponseContent | IChatTaskDto>;

		// 1. 提取响应内容
		const responseText = this.extractResponseText(response);
		const toolInvocations = this.extractToolInvocations(response);

		// 2. 检查是否有有效内容
		if (!responseText && toolInvocations.length === 0) {
			return { valid: false, reason: '响应为空' };
		}

		// 3. 检查是否只有错误
		if (this.hasOnlyErrors(response)) {
			return { valid: false, reason: '只包含错误信息' };
		}

		// 4. 添加用户消息
		result.push({ role: 'user', content: entry.request.message });

		// 5. 处理工具调用
		if (toolInvocations.length > 0) {
			const toolValidation = this.validateToolCalls(toolInvocations);

			if (!toolValidation.valid) {
				// 工具调用不完整，只保留文本部分
				if (responseText && responseText.trim()) {
					result.push({ role: 'assistant', content: responseText });
					this.logService.debug(`[Chenille] 工具调用不完整，只保留文本: ${toolValidation.reason}`);
					return { valid: true, messages: result };
				}
				return { valid: false, reason: toolValidation.reason };
			}

			// 添加带 tool_calls 的 assistant 消息
			result.push({
				role: 'assistant',
				content: responseText || '',
				tool_calls: toolValidation.toolCalls,
			});

			// 添加 tool 响应消息
			if (toolValidation.toolResponses) {
				result.push(...toolValidation.toolResponses);
			}
		} else {
			// 无工具调用，只添加文本
			if (responseText && responseText.trim()) {
				result.push({ role: 'assistant', content: responseText });
			} else {
				return { valid: false, reason: '无有效响应内容' };
			}
		}

		return { valid: true, messages: result };
	}

	/**
	 * 验证工具调用完整性
	 */
	private validateToolCalls(toolInvocations: ToolInvocationInfo[]): {
		valid: boolean;
		reason?: string;
		toolCalls?: AiToolCall[];
		toolResponses?: AiModelMessage[];
	} {
		const toolCalls: AiToolCall[] = [];
		const toolResponses: AiModelMessage[] = [];

		for (const tool of toolInvocations) {
			// 检查是否完成
			if (!tool.isComplete) {
				return { valid: false, reason: `工具 ${tool.name} 未完成` };
			}

			// 检查是否有 ID
			if (!tool.callId) {
				return { valid: false, reason: `工具 ${tool.name} 缺少 call_id` };
			}

			// 检查是否有结果
			if (tool.result === undefined || tool.result === null) {
				return { valid: false, reason: `工具 ${tool.name} 缺少结果` };
			}

			// 构建 tool_call
			toolCalls.push({
				id: tool.callId,
				type: 'function',
				function: {
					name: tool.name,
					arguments: JSON.stringify(tool.parameters),
				},
			});

			// 构建 tool 响应
			toolResponses.push({
				role: 'tool',
				tool_call_id: tool.callId,
				content: typeof tool.result === 'string'
					? tool.result
					: JSON.stringify(tool.result),
			});
		}

		return { valid: true, toolCalls, toolResponses };
	}

	/**
	 * 从响应中提取工具调用信息
	 * 注意：IChatProgressHistoryResponseContent 不包含 toolInvocationSerialized
	 * 工具调用信息可能以其他方式存储或不在历史中
	 */
	private extractToolInvocations(response: ReadonlyArray<IChatProgressHistoryResponseContent | IChatTaskDto>): ToolInvocationInfo[] {
		const tools: ToolInvocationInfo[] = [];

		for (const part of response) {
			// 尝试检查是否有工具调用相关的内容
			// 由于类型限制，我们需要使用类型断言来检查
			const anyPart = part as { kind?: string; toolCallId?: string; toolId?: string; isComplete?: boolean; resultDetails?: unknown; pastTenseMessage?: string | { value: string } };

			if (anyPart.kind === 'toolInvocationSerialized' && anyPart.toolCallId && anyPart.toolId) {
				// 提取工具名称
				const toolName = anyPart.toolId.split('.').pop() || anyPart.toolId;

				// 提取结果内容
				let resultContent: string | undefined;
				if (anyPart.resultDetails) {
					if (Array.isArray(anyPart.resultDetails)) {
						resultContent = anyPart.resultDetails.map(r => String(r)).join('\n');
					} else if (typeof anyPart.resultDetails === 'object') {
						resultContent = JSON.stringify(anyPart.resultDetails);
					}
				}

				// 如果没有 resultDetails，尝试从 pastTenseMessage 推断
				if (!resultContent && anyPart.pastTenseMessage) {
					resultContent = typeof anyPart.pastTenseMessage === 'string'
						? anyPart.pastTenseMessage
						: anyPart.pastTenseMessage.value;
				}

				tools.push({
					callId: anyPart.toolCallId,
					name: toolName,
					parameters: {},
					isComplete: anyPart.isComplete ?? false,
					result: resultContent,
				});
			}
		}

		return tools;
	}

	/**
	 * 提取响应文本
	 */
	private extractResponseText(response: ReadonlyArray<IChatProgressHistoryResponseContent | IChatTaskDto>): string {
		return response
			.filter((r): r is IChatProgressHistoryResponseContent & { kind: 'markdownContent'; content: MarkdownString } =>
				'kind' in r && r.kind === 'markdownContent' && 'content' in r)
			.map(r => r.content.value)
			.join('');
	}

	/**
	 * 检查是否只有错误/警告/进度消息
	 */
	private hasOnlyErrors(response: ReadonlyArray<IChatProgressHistoryResponseContent | IChatTaskDto>): boolean {
		// 有效的内容类型
		const validKinds = new Set([
			'markdownContent',
			'markdownVuln',
			'treeData',
			'inlineReference',
			'codeblockUri',
			'confirmation',
			'thinking',
		]);

		// 检查是否有任何有效内容
		const hasValidContent = response.some(r => {
			const part = r as { kind?: string };
			return part.kind !== undefined && validKinds.has(part.kind);
		});

		if (!hasValidContent) {
			return true;
		}

		// 检查 markdownContent 是否只包含错误信息
		const markdownParts = response.filter((r): r is IChatProgressHistoryResponseContent & { kind: 'markdownContent'; content: MarkdownString } => {
			const part = r as { kind?: string; content?: unknown };
			return part.kind === 'markdownContent' && part.content !== undefined;
		});
		if (markdownParts.length > 0) {
			const allText = markdownParts.map(r => r.content.value).join('');
			// 如果文本很短且包含错误关键词，认为是错误响应
			if (allText.length < 200) {
				const errorKeywords = ['未配置', '执行失败', '错误', 'Error', 'error', '异常', 'Exception'];
				const hasOnlyError = errorKeywords.some(keyword => allText.includes(keyword));
				// 移除 emoji 后检查是否有实际内容
				const cleanText = allText.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
				const hasNoRealContent = cleanText.length < 50;
				if (hasOnlyError && hasNoRealContent) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * 最终校验：确保消息序列合法
	 */
	private finalValidation(messages: AiModelMessage[]): AiModelMessage[] {
		const result: AiModelMessage[] = [];

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			const prev = result[result.length - 1];

			// 避免连续的同角色消息（tool 除外）
			if (prev && prev.role === msg.role && msg.role !== 'tool') {
				// 合并内容
				prev.content = `${prev.content}\n\n${msg.content}`;
				// 如果有 tool_calls，也需要合并
				if (msg.tool_calls) {
					prev.tool_calls = [...(prev.tool_calls || []), ...msg.tool_calls];
				}
				continue;
			}

			// 检查 tool 消息前面是否有对应的 tool_calls
			if (msg.role === 'tool' && msg.tool_call_id) {
				const hasMatchingToolCall = result.some(m =>
					m.role === 'assistant' &&
					m.tool_calls?.some(tc => tc.id === msg.tool_call_id)
				);
				if (!hasMatchingToolCall) {
					this.logService.warn(`[Chenille] 跳过孤立的 tool 响应: ${msg.tool_call_id}`);
					continue;
				}
			}

			// 检查 assistant 消息的 tool_calls 是否都有对应的 tool 响应
			// 这个检查在添加后续消息时进行
			if (prev?.role === 'assistant' && prev.tool_calls?.length) {
				const toolCallIds = new Set(prev.tool_calls.map(tc => tc.id));
				// 收集当前位置之后的所有 tool 响应
				const remainingMessages = messages.slice(i);
				const toolResponseIds = new Set(
					remainingMessages
						.filter(m => m.role === 'tool' && m.tool_call_id)
						.map(m => m.tool_call_id)
				);

				// 检查是否所有 tool_calls 都有对应的响应
				const missingResponses = [...toolCallIds].filter(id => !toolResponseIds.has(id));
				if (missingResponses.length > 0) {
					this.logService.warn(`[Chenille] 移除不完整的 tool_calls: ${missingResponses.join(', ')}`);
					// 移除没有响应的 tool_calls
					prev.tool_calls = prev.tool_calls.filter(tc => toolResponseIds.has(tc.id));
					// 如果所有 tool_calls 都被移除了，清空数组
					if (prev.tool_calls.length === 0) {
						delete prev.tool_calls;
					}
				}
			}

			result.push(msg);
		}

		// 最后检查：确保最后一个 assistant 消息的 tool_calls 都有响应
		const lastAssistant = [...result].reverse().find(m => m.role === 'assistant' && m.tool_calls?.length);
		if (lastAssistant?.tool_calls) {
			const toolCallIds = new Set(lastAssistant.tool_calls.map(tc => tc.id));
			const toolResponseIds = new Set(
				result
					.filter(m => m.role === 'tool' && m.tool_call_id)
					.map(m => m.tool_call_id)
			);

			const missingResponses = [...toolCallIds].filter(id => !toolResponseIds.has(id));
			if (missingResponses.length > 0) {
				this.logService.warn(`[Chenille] 最终检查：移除不完整的 tool_calls: ${missingResponses.join(', ')}`);
				lastAssistant.tool_calls = lastAssistant.tool_calls.filter(tc => toolResponseIds.has(tc.id));
				if (lastAssistant.tool_calls.length === 0) {
					delete lastAssistant.tool_calls;
				}
			}
		}

		return result;
	}

	/**
	 * 获取可用的工具定义
	 * 合并 Chenille 文件工具和 VS Code 内置工具
	 */
	private getAvailableTools(): AiTool[] {
		// 获取 VS Code 已注册的工具
		const vsCodeTools = [...this.toolsService.getTools()];
		const vsCodeToolIds = new Set(vsCodeTools.map(t => t.id));

		// 构建工具定义
		return buildToolDefinitionsForAI(vsCodeToolIds);
	}

	/**
	 * 执行带工具循环的 AI 调用
	 */
	private async executeWithToolLoop(
		messages: AiModelMessage[],
		enableTools: boolean,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
		sessionContext: { sessionResource: URI; requestId: string }
	): Promise<IChatAgentResult> {
		const tools = enableTools ? this.getAvailableTools() : undefined;
		let toolRound = 0;

		while (toolRound < MAX_TOOL_ROUNDS) {
			if (token.isCancellationRequested) {
				return {};
			}

			const roundResult = await this.executeOneRound(messages, tools, progress, token);

			// 无工具调用，对话结束
			if (!roundResult.toolCalls?.length) {
				return {};
			}

			// 添加 assistant 消息
			messages.push({
				role: 'assistant',
				content: roundResult.content || '',
				tool_calls: roundResult.toolCalls,
				reasoning_content: roundResult.reasoning,
				reasoning_signature: roundResult.reasoning_signature,
			});

			// 执行工具调用
			toolRound++;
			await this.executeToolCalls(roundResult.toolCalls, messages, progress, token, sessionContext);
		}

		progress([{
			kind: 'warning',
			content: new MarkdownString(localize('chenille.maxToolRounds', '工具调用轮次超过限制 ({0})', MAX_TOOL_ROUNDS)),
		}]);

		return {};
	}

	/**
	 * 执行一轮 AI 调用
	 */
	private async executeOneRound(
		messages: AiModelMessage[],
		tools: AiTool[] | undefined,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken
	): Promise<{ content: string; toolCalls?: AiToolCall[]; reasoning?: string; reasoning_signature?: string }> {
		const requestId = generateUuid();
		let content = '';
		let toolCalls: AiToolCall[] | undefined;
		let reasoning = '';
		let reasoning_signature = '';

		return new Promise((resolve, reject) => {
			let resolved = false;

			// 超时保护（5分钟）
			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					disposable.dispose();
					resolve({ content, toolCalls, reasoning: reasoning || undefined, reasoning_signature: reasoning_signature || undefined });
				}
			}, 300000);

			const disposable = this.aiService.onStreamChunk((chunk: IStreamChunkWithId) => {
				if (chunk.requestId !== requestId) {
					return;
				}

				if (token.isCancellationRequested) {
					return;
				}

				// 文本内容
				if (chunk.content) {
					content += chunk.content;
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(chunk.content),
					}]);
				}

				// 推理内容
				if (chunk.reasoning) {
					reasoning += chunk.reasoning;
					progress([{
						kind: 'thinking',
						value: chunk.reasoning,
					}]);
				}

				// 工具调用
				if (chunk.tool_calls?.length) {
					toolCalls = chunk.tool_calls;
					// 工具调用 chunk 可能包含累积的 reasoning 和 signature
					if (chunk.reasoning && !reasoning) {
						reasoning = chunk.reasoning;
					}
					if (chunk.reasoning_signature) {
						reasoning_signature = chunk.reasoning_signature;
					}
				}

				// 错误
				if (chunk.error) {
					clearTimeout(timeout);
					if (!resolved) {
						resolved = true;
						reject(new Error(chunk.error));
						disposable.dispose();
					}
					return;
				}

				// 完成
				if (chunk.done) {
					clearTimeout(timeout);
					if (!resolved) {
						resolved = true;
						disposable.dispose();
						resolve({ content, toolCalls, reasoning: reasoning || undefined, reasoning_signature: reasoning_signature || undefined });
					}
				}
			});

			// 发起请求
			this.aiService.streamChat({ requestId, messages, tools }, token).catch((err) => {
				clearTimeout(timeout);
				if (!resolved) {
					resolved = true;
					reject(err);
				}
			});
		});
	}

	/**
	 * 执行工具调用
	 */
	private async executeToolCalls(
		toolCalls: AiToolCall[],
		messages: AiModelMessage[],
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
		sessionContext: { sessionResource: URI; requestId: string }
	): Promise<void> {
		for (const toolCall of toolCalls) {
			if (token.isCancellationRequested) {
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: '[工具执行已取消]',
				});
				break;
			}

			const toolName = toolCall.function.name ?? 'unknown';
			let parameters: Record<string, unknown> = {};

			try {
				if (toolCall.function.arguments) {
					parameters = JSON.parse(toolCall.function.arguments);
				}
			} catch {
				// 参数解析失败，继续执行
			}

			// 显示工具调用进度
			progress([{
				kind: 'progressMessage',
				content: new MarkdownString(localize('chenille.executingTool', '正在执行: {0}', toolName)),
			}]);

			try {
				let resultContent: string;

				// 判断是 Chenille 文件工具还是 VS Code 内置工具
				if (isChenilleFileTool(toolName)) {
					// Chenille 文件工具 - 使用 toolsService.invokeTool 以获得内联确认
					resultContent = await this.invokeChenilleFileTool(toolName, toolCall, token, sessionContext);

					// 为文件工具添加丰富的 UI 反馈
					const success = !resultContent.startsWith('错误:') && !resultContent.includes('执行异常');
					this.emitFileToolProgress(toolName, parameters, success, resultContent, progress);
				} else {
					// VS Code 内置工具 - 使用 toolsService.invokeTool
					resultContent = await this.invokeVSCodeTool(toolName, toolCall, token, sessionContext);
				}

				// 添加工具结果
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: resultContent,
				});

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				// 用户跳过工具调用不算错误
				if (errorMessage.includes('用户已跳过') || errorMessage.includes('user chose to skip')) {
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: `[用户已跳过工具 "${toolName}" 的执行]`,
					});
					continue;
				}

				// 显示警告
				progress([{
					kind: 'warning',
					content: new MarkdownString(localize('chenille.toolError', '工具 {0} 执行失败: {1}', toolName, errorMessage)),
				}]);

				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: `工具 "${toolName}" 执行异常: ${errorMessage}`,
				});
			}
		}
	}

	/**
	 * 为文件工具发送丰富的 UI 反馈
	 */
	private emitFileToolProgress(
		toolName: string,
		parameters: Record<string, unknown>,
		success: boolean,
		content: string | undefined,
		progress: (parts: IChatProgress[]) => void
	): void {
		const path = parameters.path as string | undefined;

		// 根据工具类型发送不同的 UI 组件
		switch (toolName) {
			case 'readFile':
			case 'getFileInfo':
			case 'checkFileExists': {
				// 文件引用
				if (path) {
					this.emitFileReference(path, progress);
				}
				break;
			}

			case 'listDirectory':
			case 'findFiles': {
				// 文件树
				if (success && content) {
					this.emitFileTree(toolName, parameters, content, progress);
				}
				break;
			}

			case 'searchInFile': {
				// 搜索结果引用（单文件）
				if (success && content && path) {
					this.emitSearchResultsWithFile(path, content, progress);
				}
				break;
			}

			case 'searchInFiles': {
				// 搜索结果引用（多文件）
				if (success && content) {
					this.emitSearchResults(content, progress);
				}
				break;
			}

			case 'replaceInFile':
			case 'insertInFile':
			case 'deleteLines': {
				// 文件修改引用
				if (path) {
					this.emitFileReference(path, progress, true);
				}
				break;
			}

			case 'createFile': {
				// 新文件引用
				if (path) {
					this.emitFileReference(path, progress);
				}
				break;
			}

			case 'deleteFile': {
				// 删除文件提示
				if (path && success) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(`🗑️ 已删除: \`${path}\``),
					}]);
				}
				break;
			}

			case 'renameFile': {
				// 重命名引用
				const oldPath = parameters.oldPath as string | undefined;
				const newPath = parameters.newPath as string | undefined;
				if (oldPath && newPath && success) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(`📁 已移动: \`${oldPath}\` → \`${newPath}\``),
					}]);
					this.emitFileReference(newPath, progress);
				}
				break;
			}
		}
	}

	/**
	 * 发送文件引用
	 */
	private emitFileReference(
		path: string,
		progress: (parts: IChatProgress[]) => void,
		isModified: boolean = false
	): void {
		const uri = this.resolveFilePath(path);
		const reference: IChatContentReference = {
			kind: 'reference',
			reference: uri,
			options: isModified ? {
				status: {
					description: localize('chenille.fileModified', '已修改'),
					kind: 1 // Complete
				}
			} : undefined
		};
		progress([reference]);
	}

	/**
	 * 发送文件树
	 */
	private emitFileTree(
		toolName: string,
		parameters: Record<string, unknown>,
		content: string,
		progress: (parts: IChatProgress[]) => void
	): void {
		try {
			// 解析结果
			const lines = content.split('\n');
			const jsonStart = lines.findIndex(l => l.startsWith('{'));
			if (jsonStart === -1) {
				return;
			}

			const jsonContent = lines.slice(jsonStart).join('\n');
			const data = JSON.parse(jsonContent);

			let entries: Array<{ name: string; path: string; type: string }> = [];

			if (toolName === 'listDirectory' && data.entries) {
				entries = data.entries;
			} else if (toolName === 'findFiles' && data.files) {
				entries = data.files.map((f: string) => ({
					name: f.split('/').pop() || f,
					path: f,
					type: 'file'
				}));
			}

			if (entries.length === 0) {
				return;
			}

			// 构建文件树
			const basePath = (parameters.path as string) || (parameters.cwd as string) || '.';
			const baseUri = this.resolveFilePath(basePath);

			const treeData: IChatResponseProgressFileTreeData = {
				label: basePath,
				uri: baseUri,
				type: FileType.Directory,
				children: entries.slice(0, 50).map(entry => ({
					label: entry.name,
					uri: this.resolveFilePath(entry.path),
					type: entry.type === 'directory' ? FileType.Directory : FileType.File,
				}))
			};

			const tree: IChatTreeData = {
				kind: 'treeData',
				treeData
			};

			progress([tree]);

			// 如果有更多文件，显示提示
			if (entries.length > 50) {
				progress([{
					kind: 'markdownContent',
					content: new MarkdownString(localize('chenille.moreFiles', '... 还有 {0} 个文件未显示', entries.length - 50)),
				}]);
			}

		} catch {
			// 解析失败，忽略
		}
	}

	/**
	 * 发送搜索结果引用
	 */
	private emitSearchResults(
		content: string,
		progress: (parts: IChatProgress[]) => void
	): void {
		try {
			const lines = content.split('\n');
			const jsonStart = lines.findIndex(l => l.startsWith('{'));
			if (jsonStart === -1) {
				return;
			}

			const jsonContent = lines.slice(jsonStart).join('\n');
			const data = JSON.parse(jsonContent);

			// searchInFile 结果
			if (data.matches && Array.isArray(data.matches)) {
				const matches = data.matches.slice(0, 10);
				for (const match of matches) {
					if (match.line) {
						// 这里我们没有文件路径，所以只显示行号信息
						progress([{
							kind: 'markdownContent',
							content: new MarkdownString(`📍 第 ${match.line} 行: \`${(match.matchText || '').substring(0, 50)}\``),
						}]);
					}
				}
			}

			// searchInFiles 结果
			if (data.results && Array.isArray(data.results)) {
				const results = data.results.slice(0, 10);
				for (const result of results) {
					if (result.file) {
						const uri = this.resolveFilePath(result.file);
						const firstMatch = result.matches?.[0];
						const reference: IChatContentReference = {
							kind: 'reference',
							reference: firstMatch?.line
								? { uri, range: { startLineNumber: firstMatch.line, startColumn: 1, endLineNumber: firstMatch.line, endColumn: 1 } }
								: uri,
							options: {
								status: {
									description: `${result.matches?.length || 0} 个匹配`,
									kind: 1
								}
							}
						};
						progress([reference]);
					}
				}

				if (data.results.length > 10) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(localize('chenille.moreResults', '... 还有 {0} 个文件包含匹配', data.results.length - 10)),
					}]);
				}
			}

		} catch {
			// 解析失败，忽略
		}
	}

	/**
	 * 发送单文件搜索结果（带文件引用）
	 */
	private emitSearchResultsWithFile(
		filePath: string,
		content: string,
		progress: (parts: IChatProgress[]) => void
	): void {
		try {
			const lines = content.split('\n');
			const jsonStart = lines.findIndex(l => l.startsWith('{'));
			if (jsonStart === -1) {
				return;
			}

			const jsonContent = lines.slice(jsonStart).join('\n');
			const data = JSON.parse(jsonContent);

			if (data.matches && Array.isArray(data.matches) && data.matches.length > 0) {
				const uri = this.resolveFilePath(filePath);
				const matches = data.matches.slice(0, 10);

				// 发送文件引用
				const firstMatch = matches[0];
				const reference: IChatContentReference = {
					kind: 'reference',
					reference: firstMatch?.line
						? { uri, range: { startLineNumber: firstMatch.line, startColumn: 1, endLineNumber: firstMatch.line, endColumn: 1 } }
						: uri,
					options: {
						status: {
							description: `${data.totalMatches || matches.length} 个匹配`,
							kind: 1
						}
					}
				};
				progress([reference]);

				// 显示匹配位置
				const lineNumbers = matches
					.filter((m: { line?: number }) => m.line)
					.map((m: { line: number }) => m.line)
					.join(', ');

				if (lineNumbers) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(`📍 在第 ${lineNumbers} 行找到匹配`),
					}]);
				}
			}

		} catch {
			// 解析失败，忽略
		}
	}

	/**
	 * 解析文件路径为 URI
	 */
	private resolveFilePath(path: string): URI {
		// 如果已经是绝对路径或 URI
		if (path.startsWith('/') || path.startsWith('\\') || path.includes('://') || /^[a-zA-Z]:/.test(path)) {
			return URI.file(path);
		}

		// 相对路径，基于工作区根目录
		const workspaceFolders = this.workspaceService.getWorkspace().folders;
		if (workspaceFolders.length > 0) {
			return URI.joinPath(workspaceFolders[0].uri, path);
		}

		return URI.file(path);
	}

	/**
	 * 调用 Chenille 文件工具（通过 toolsService 以获得内联确认）
	 */
	private async invokeChenilleFileTool(
		toolName: string,
		toolCall: AiToolCall,
		token: CancellationToken,
		sessionContext: { sessionResource: URI; requestId: string }
	): Promise<string> {
		// Chenille 文件工具的内部 ID
		const internalToolId = `chenille.${toolName}`;

		// 检查工具是否已注册
		const toolData = this.toolsService.getTool(internalToolId);
		if (!toolData) {
			// 如果工具未注册，回退到直接调用 dispatcher
			const dispatchToolCall = {
				type: 'function' as const,
				function: toolCall.function,
			};
			const result = await this.toolDispatcher.dispatch(dispatchToolCall, token);
			return result.success
				? (result.content || `工具 "${toolName}" 执行成功`)
				: `错误: ${result.error}`;
		}

		// 解析参数
		let parameters: Record<string, unknown> = {};
		try {
			if (toolCall.function.arguments) {
				parameters = JSON.parse(toolCall.function.arguments);
			}
		} catch {
			return `参数解析失败: ${toolCall.function.arguments}`;
		}

		// 构建调用上下文（包含会话信息以启用内联确认）
		const invocation: IToolInvocation = {
			callId: toolCall.id || `chenille-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			toolId: internalToolId,
			parameters,
			tokenBudget: undefined,
			context: {
				sessionId: sessionContext.requestId,
				sessionResource: sessionContext.sessionResource,
			},
			chatRequestId: sessionContext.requestId,
			modelId: undefined,
			userSelectedTools: undefined,
		};

		// 调用工具（会自动处理内联确认）
		const result = await this.toolsService.invokeTool(
			invocation,
			async () => 0, // countTokens callback
			token
		);

		// 提取结果内容
		return result.content
			.map((part) => {
				if (part.kind === 'text') {
					return part.value;
				} else if (part.kind === 'data') {
					return `[二进制数据: ${part.value.mimeType}]`;
				}
				return JSON.stringify(part);
			})
			.join('\n');
	}

	/**
	 * 调用 VS Code 内置工具
	 */
	private async invokeVSCodeTool(
		toolName: string,
		toolCall: AiToolCall,
		token: CancellationToken,
		sessionContext: { sessionResource: URI; requestId: string }
	): Promise<string> {
		// 获取内部工具 ID
		const internalToolId = getInternalToolId(toolName);
		if (!internalToolId) {
			return `未知工具: ${toolName}`;
		}

		// 检查工具是否已注册
		const toolData = this.toolsService.getTool(internalToolId);
		if (!toolData) {
			return `工具未注册: ${internalToolId}`;
		}

		// 解析参数
		let parameters: Record<string, unknown> = {};
		try {
			if (toolCall.function.arguments) {
				parameters = JSON.parse(toolCall.function.arguments);
			}
		} catch {
			return `参数解析失败: ${toolCall.function.arguments}`;
		}

		// 构建调用上下文（包含会话信息以启用内联确认）
		const invocation: IToolInvocation = {
			callId: toolCall.id || `chenille-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			toolId: internalToolId,
			parameters,
			tokenBudget: undefined,
			context: {
				sessionId: sessionContext.requestId,
				sessionResource: sessionContext.sessionResource,
			},
			chatRequestId: sessionContext.requestId,
			modelId: undefined,
			userSelectedTools: undefined,
		};

		// 调用工具（会自动处理内联确认）
		const result = await this.toolsService.invokeTool(
			invocation,
			async () => 0, // countTokens callback
			token
		);

		// 提取结果内容
		return result.content
			.map((part) => {
				if (part.kind === 'text') {
					return part.value;
				} else if (part.kind === 'data') {
					return `[二进制数据: ${part.value.mimeType}]`;
				}
				return JSON.stringify(part);
			})
			.join('\n');
	}

	/**
	 * 提供后续建议
	 */
	async provideFollowups(
		_request: IChatAgentRequest,
		_result: IChatAgentResult,
		_history: IChatAgentHistoryEntry[],
		_token: CancellationToken
	): Promise<never[]> {
		return [];
	}
}

/**
 * Chenille 文件工具包装器
 * 只包装 Chenille 自己实现的文件工具
 */
class ChenilleFileToolWrapper implements IToolImpl {
	constructor(
		private readonly toolDef: AiTool,
		private readonly toolDispatcher: IChenilleToolDispatcher,
	) { }

	async invoke(
		invocation: IToolInvocation,
		_countTokens: CountTokensCallback,
		_progress: ToolProgress,
		token: CancellationToken
	): Promise<IToolResult> {
		const toolCall = {
			type: 'function' as const,
			function: {
				name: this.toolDef.function.name,
				arguments: JSON.stringify(invocation.parameters),
			},
		};

		try {
			const result = await this.toolDispatcher.dispatch(toolCall, token);
			return {
				content: [{
					kind: 'text',
					value: result.content || (result.success ? '执行成功' : `错误: ${result.error}`),
				}],
			};
		} catch (error) {
			return {
				content: [{
					kind: 'text',
					value: `执行异常: ${error instanceof Error ? error.message : String(error)}`,
				}],
			};
		}
	}

	async prepareToolInvocation(
		_context: unknown,
		_token: CancellationToken
	): Promise<IPreparedToolInvocation | undefined> {
		// 文件修改工具需要确认
		const needsConfirmation = [
			'replaceInFile',
			'insertInFile',
			'deleteLines',
			'createFile',
			'deleteFile',
			'renameFile',
		].includes(this.toolDef.function.name);

		if (needsConfirmation) {
			return {
				invocationMessage: new MarkdownString(localize('chenille.tool.invoking', '正在调用 {0}...', this.toolDef.function.name)),
				confirmationMessages: {
					title: localize('chenille.tool.confirm.title', '确认文件操作'),
					message: new MarkdownString(localize('chenille.tool.confirm.message', '是否允许执行 **{0}**？', this.toolDef.function.name)),
					allowAutoConfirm: true,
				},
			};
		}

		return {
			invocationMessage: new MarkdownString(localize('chenille.tool.invoking', '正在调用 {0}...', this.toolDef.function.name)),
		};
	}
}

/**
 * Chenille Agent 贡献
 * 负责注册 Agent 和 Chenille 特有的文件工具
 */
export class ChenilleAgentContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chenille.agentContribution';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IChenilleToolDispatcher private readonly toolDispatcher: IChenilleToolDispatcher,
	) {
		super();
		this.registerAgent();
		this.registerChenilleFileTools();
	}

	/**
	 * 注册 Chenille Agent
	 */
	private registerAgent(): void {
		const agentData = createChenilleAgentData();

		// 注册 Agent 数据
		this._register(this.chatAgentService.registerAgent(agentData.id, agentData));

		// 注册 Agent 实现
		const agentImpl = this._register(this.instantiationService.createInstance(ChenilleAgentImpl));
		this._register(this.chatAgentService.registerAgentImplementation(agentData.id, agentImpl));
	}

	/**
	 * 只注册 Chenille 特有的文件工具
	 * VS Code 内置工具（终端、测试、扩展等）不需要重复注册
	 */
	private registerChenilleFileTools(): void {
		for (const toolDef of CHENILLE_FILE_TOOLS) {
			const toolData: IToolData = {
				id: `chenille.${toolDef.function.name}`,
				source: ToolDataSource.Internal,
				displayName: toolDef.function.name,
				modelDescription: toolDef.function.description,
				userDescription: toolDef.function.description,
				inputSchema: toolDef.function.parameters as IToolData['inputSchema'],
				canBeReferencedInPrompt: true,
				toolReferenceName: toolDef.function.name,
				icon: Codicon.file,
			};

			const toolImpl = new ChenilleFileToolWrapper(toolDef, this.toolDispatcher);
			this._register(this.toolsService.registerTool(toolData, toolImpl));
		}
	}
}
