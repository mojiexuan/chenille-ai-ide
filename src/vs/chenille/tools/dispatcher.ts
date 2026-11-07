/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../base/common/lifecycle.js';
import { createDecorator, IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../platform/workspace/common/workspace.js';
import { ISearchService } from '../../workbench/services/search/common/search.js';
import { ToolCall } from '../common/types.js';
import { IMcpRuntimeService } from '../common/storageIpc.js';
import { EditOperation } from '../../editor/common/core/editOperation.js';
import { Range } from '../../editor/common/core/range.js';
import { Position } from '../../editor/common/core/position.js';
import { IChenilleSessionContext } from '../common/chatProvider.js';
import { VSBuffer } from '../../base/common/buffer.js';
import { URI } from '../../base/common/uri.js';
import { IChatSendRequestOptions, IChatService } from '../../workbench/contrib/chat/common/chatService/chatService.js';
import { ChatAgentLocation, ChatModeKind, ChatPermissionLevel } from '../../workbench/contrib/chat/common/constants.js';
import { LocalChatSessionUri } from '../../workbench/contrib/chat/common/model/chatUri.js';
import { IChatResponseModel } from '../../workbench/contrib/chat/common/model/chatModel.js';
import { CHENILLE_AGENT_ID } from '../common/modelIdentifier.js';
import { IGitWorktreeService } from '../common/gitWorktree.js';
import type { ISession } from '../../sessions/services/sessions/common/session.js';
import { ISessionsManagementService } from '../../sessions/services/sessions/common/sessionsManagement.js';
import { ISessionsProvidersService } from '../../sessions/services/sessions/browser/sessionsProvidersService.js';
import { CHENILLE_PROVIDER_ID, CHENILLE_SESSION_TYPE_ID } from '../sessions/browser/chenilleSessionsProvider.js';

// 导入文件工具
import {
	readFile,
	getFileInfo,
	checkFileExists,
	listDirectory,
	findFiles,
	searchInFile,
	searchInFiles,
	replaceInFile,
	insertInFile,
	deleteLines,
	createFile,
	deleteFile,
	renameFile,
	getOpenEditors,
	editFile,
	FileToolResult,
	// 导入参数类型
	ReadFileParams,
	GetFileInfoParams,
	CheckFileExistsParams,
	ListDirectoryParams,
	FindFilesParams,
	SearchInFileParams,
	SearchInFilesParams,
	ReplaceInFileParams,
	InsertInFileParams,
	DeleteLinesParams,
	CreateFileParams,
	DeleteFileParams,
	RenameFileParams,
	GetOpenEditorsParams,
	EditFileParams
} from './fileTools/index.js';
import {
	IWorkspaceFoldersProvider,
	resolveFilePath,
	findMultilineText,
	countLines
} from './fileTools/fileUtils.js';
import { IEditorService } from '../../workbench/services/editor/common/editorService.js';
import { IChenilleDiffSessionService } from '../browser/diffSession/index.js';
import { INetworkToolsService } from '../common/networkTools.js';
import { IMarkerService, MarkerSeverity } from '../../platform/markers/common/markers.js';
import { generateUuid } from '../../base/common/uuid.js';

/**
 * 工具执行结果
 */
export interface IToolResult {
	success: boolean;
	content: string;
	error?: string;
}

/** 编排中的单步定义 */
interface IOrchestrationStep {
	readonly id: string;
	readonly prompt: string;
	readonly path?: string;
	readonly isolation: 'none' | 'worktree';
	readonly modelId?: string;
	readonly dependsOn: readonly string[];
}

/** 子代理会话的执行结果 */
interface IChildAgentResult {
	readonly sessionId: string;
	readonly title: string;
	readonly output: string;
	readonly workspacePath: string;
	readonly branch?: string;
}

interface IOrchestrationStepResult {
	readonly id: string;
	readonly status: 'success' | 'failed' | 'skipped';
	readonly sessionId?: string;
	readonly workspacePath?: string;
	readonly branch?: string;
	readonly output?: string;
	readonly error?: string;
}

/**
 * 工具调度器服务接口
 */
export const IChenilleToolDispatcher = createDecorator<IChenilleToolDispatcher>('chenilleToolDispatcher');

export interface IChenilleToolDispatcher extends IDisposable {
	readonly _serviceBrand: undefined;

	/**
	 * 是否启用 diff 模式（显示变更而不是直接写入）
	 */
	diffModeEnabled: boolean;

	/**
	 * 执行单个工具调用
	 * @param sessionContext 会话上下文（用于工具内联确认）
	 */
	dispatch(toolCall: ToolCall, token?: CancellationToken, sessionContext?: IChenilleSessionContext): Promise<IToolResult>;

	/**
	 * 批量执行工具调用
	 */
	dispatchAll(toolCalls: ToolCall[], token?: CancellationToken, sessionContext?: IChenilleSessionContext): Promise<IToolResult[]>;
}

/**
 * Chenille 自实现的文件工具列表
 */
const CHENILLE_FILE_TOOL_NAMES = new Set([
	'readFile',
	'getFileInfo',
	'checkFileExists',
	'listDirectory',
	'findFiles',
	'searchInFile',
	'searchInFiles',
	'replaceInFile',
	'insertInFile',
	'deleteLines',
	'createFile',
	'deleteFile',
	'renameFile',
	'getOpenEditors',
	'editFile',
	'notebookEdit',
	'getErrors'
]);

/**
 * 检查是否为 Chenille 自实现的文件工具
 */
export function isChenilleFileTool(toolName: string): boolean {
	return CHENILLE_FILE_TOOL_NAMES.has(toolName);
}

/**
 * Chenille 自实现的网络工具列表
 * webFetch 始终可用；deepseek* 仅在配置了官方 DeepSeek 模型时注入
 */
const CHENILLE_NETWORK_TOOL_NAMES = new Set([
	'webFetch',
	'deepseekSearch',
	'deepseekFetch'
]);

/**
 * 检查是否为 Chenille 自实现的网络工具
 */
export function isNetworkTool(toolName: string): boolean {
	return CHENILLE_NETWORK_TOOL_NAMES.has(toolName);
}

/**
 * Chenille 会话工具列表
 * 前两个只读；后三个会创建会话或向会话发送消息，执行时间可达数分钟。
 */
const CHENILLE_SESSION_TOOL_NAMES = new Set([
	'listSessions',
	'readSession',
	'sendToSession',
	'createSession',
	'orchestrate'
]);

/**
 * 会驱动其他代理会话的工具，需要比普通工具更长的超时。
 */
const CHENILLE_AGENT_SESSION_TOOL_NAMES = new Set([
	'sendToSession',
	'createSession',
	'orchestrate'
]);

/**
 * 检查是否为 Chenille 会话工具
 */
export function isSessionTool(toolName: string): boolean {
	return CHENILLE_SESSION_TOOL_NAMES.has(toolName);
}

export function isAgentSessionTool(toolName: string): boolean {
	return CHENILLE_AGENT_SESSION_TOOL_NAMES.has(toolName);
}

/**
 * 检查是否为 MCP 工具
 */
export function isMcpTool(toolName: string): boolean {
	return toolName.startsWith('mcp_');
}

/**
 * VS Code 内部工具 ID 映射
 * 这些工具通过 ILanguageModelToolsService 调用
 */
const VSCODE_TOOL_ID_MAP: Record<string, string> = {
	// 终端工具
	'runInTerminal': 'run_in_terminal',
	'getTerminalOutput': 'get_terminal_output',
	'getTerminalSelection': 'terminal_selection',
	'getTerminalLastCommand': 'terminal_last_command',
	'confirmTerminalCommand': 'vscode_get_terminal_confirmation',
	'sendToTerminal': 'send_to_terminal',
	'killTerminal': 'kill_terminal',

	// 任务工具
	'runTask': 'run_task',
	'getTaskOutput': 'get_task_output',
	'createAndRunTask': 'create_and_run_task',

	// 测试工具
	'runTests': 'runTests',
	'getTestFailures': 'testFailure',

	// 扩展工具
	'searchExtensions': 'vscode_searchExtensions_internal',
	'installExtensions': 'vscode_installExtensions',

	// 待办事项
	'manageTodoList': 'manage_todo_list',

	// 确认与提问工具
	'getConfirmation': 'vscode_get_confirmation',
	'askQuestions': 'vscode_askQuestions',

	// 语言服务工具
	'listCodeUsages': 'vscode_listCodeUsages',
	'renameSymbol': 'vscode_renameSymbol',

	// 子代理
	'runSubagent': 'runSubagent',
	// 注意：editFile 已移至 Chenille 文件工具
};

/**
 * 获取内部工具 ID
 */
export function getInternalToolId(toolName: string): string | undefined {
	return VSCODE_TOOL_ID_MAP[toolName];
}

/**
 * 获取所有工具名称
 */
export function getAllToolNames(): string[] {
	return [...CHENILLE_FILE_TOOL_NAMES, ...CHENILLE_NETWORK_TOOL_NAMES, ...CHENILLE_SESSION_TOOL_NAMES, ...Object.keys(VSCODE_TOOL_ID_MAP)];
}

/**
 * 截断过长的内容
 */
function truncateContent(content: string, maxLength: number): string {
	if (content.length <= maxLength) {
		return content;
	}
	return content.substring(0, maxLength) + '\n\n[内容已截断，共 ' + content.length + ' 字符，显示前 ' + maxLength + ' 字符]';
}

/**
 * 截断单条消息，保留提示说明
 */
function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.substring(0, maxLength) + `\n\n[已截断，原长度 ${text.length} 字符]`;
}

/**
 * 读取可选的整数参数并限制范围
 */
function readIntParam(value: unknown, defaultValue: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return defaultValue;
	}
	return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * 将时间戳格式化为本地时间
 */
function formatTimestamp(time: number): string {
	const date = new Date(time);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 工具执行超时时间（毫秒） */
const TOOL_TIMEOUT = 30000;

/** 子代理可能连续工作很久，单独给足时限 */
const AGENT_SESSION_TOOL_TIMEOUT = 45 * 60 * 1000;

/** 网络工具执行超时时间（毫秒），与主进程抓取超时保持一致 */
const NETWORK_TOOL_TIMEOUT = 90000;

/**
 * 带超时的 Promise 包装
 */
function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`工具 "${toolName}" 执行超时（${ms / 1000}秒）`)), ms)
		)
	]);
}

/**
 * 解析并验证工具调用参数
 */
function parseToolArguments<T extends object>(toolCall: ToolCall, requiredFields: (keyof T)[] = []): { success: true; data: T } | { success: false; error: string } {
	const argsString = toolCall.function.arguments;
	const toolName = toolCall.function.name ?? 'unknown';

	// 无参数时，如果没有必需字段则返回空对象
	if (!argsString || argsString.trim() === '') {
		if (requiredFields.length === 0) {
			// eslint-disable-next-line local/code-no-dangerous-type-assertions -- 空对象对于无必需参数的情况是安全的
			return { success: true, data: {} as T };
		}
		return {
			success: false,
			error: `工具 "${toolName}" 缺少必需参数: ${requiredFields.join(', ')}`
		};
	}

	try {
		const parsed: T = JSON.parse(argsString);

		// 验证必需字段
		const missingFields = requiredFields.filter(field => parsed[field] === undefined || parsed[field] === null);
		if (missingFields.length > 0) {
			return {
				success: false,
				error: `工具 "${toolName}" 缺少必需参数: ${missingFields.map(String).join(', ')}`
			};
		}

		return { success: true, data: parsed };
	} catch (e) {
		const parseError = e instanceof Error ? e.message : String(e);
		return {
			success: false,
			error: `工具 "${toolName}" 参数解析失败: ${parseError}。原始参数: ${argsString.substring(0, 200)}`
		};
	}
}

// ==================== 工具调度器实现 ====================

import { ILanguageModelToolsService, IToolInvocation } from '../../workbench/contrib/chat/common/tools/languageModelToolsService.js';

export class ChenilleToolDispatcher extends Disposable implements IChenilleToolDispatcher {
	readonly _serviceBrand: undefined;

	private _toolsService: ILanguageModelToolsService | undefined;
	private _mcpRuntimeService: IMcpRuntimeService | undefined;
	private _diffSessionService: IChenilleDiffSessionService | undefined;
	private _chatService: IChatService | undefined;
	private _gitWorktreeService: IGitWorktreeService | undefined;
	private _sessionsManagementService: ISessionsManagementService | undefined;
	private _sessionsManagementServiceResolved = false;

	/** 编排创建的子会话；用于阻止子代理再次发起编排造成递归 */
	private readonly childSessionResources = new Set<string>();

	/** 是否启用 diff 模式 */
	diffModeEnabled: boolean = true;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@ISearchService private readonly searchService: ISearchService,
		@IEditorService private readonly editorService: IEditorService,
		@INetworkToolsService private readonly networkToolsService: INetworkToolsService,
		@IMarkerService private readonly markerService: IMarkerService
	) {
		super();
	}

	/**
	 * 延迟获取 ILanguageModelToolsService 以避免循环依赖
	 */
	private get toolsService(): ILanguageModelToolsService {
		if (!this._toolsService) {
			this._toolsService = this.instantiationService.invokeFunction(accessor => accessor.get(ILanguageModelToolsService));
		}
		return this._toolsService;
	}

	/**
	 * 延迟获取 IMcpRuntimeService 以避免循环依赖
	 */
	private get mcpRuntimeService(): IMcpRuntimeService {
		if (!this._mcpRuntimeService) {
			this._mcpRuntimeService = this.instantiationService.invokeFunction(accessor => accessor.get(IMcpRuntimeService));
		}
		return this._mcpRuntimeService;
	}

	/**
	 * 延迟获取 IChenilleDiffSessionService 以避免循环依赖
	 */
	private get diffSessionService(): IChenilleDiffSessionService {
		if (!this._diffSessionService) {
			this._diffSessionService = this.instantiationService.invokeFunction(accessor => accessor.get(IChenilleDiffSessionService));
		}
		return this._diffSessionService;
	}

	/**
	 * 延迟获取 IChatService 以避免循环依赖
	 */
	private get chatService(): IChatService {
		if (!this._chatService) {
			this._chatService = this.instantiationService.invokeFunction(accessor => accessor.get(IChatService));
		}
		return this._chatService;
	}

	/**
	 * 延迟获取 IGitWorktreeService 以避免循环依赖
	 */
	private get gitWorktreeService(): IGitWorktreeService {
		if (!this._gitWorktreeService) {
			this._gitWorktreeService = this.instantiationService.invokeFunction(accessor => accessor.get(IGitWorktreeService));
		}
		return this._gitWorktreeService;
	}

	/**
	 * 延迟获取会话管理服务。普通 Chat 窗口可能没有注册该服务，
	 * 此时返回 undefined，由调用方退回直接使用本地聊天会话。
	 */
	private getSessionsManagementService(): ISessionsManagementService | undefined {
		if (!this._sessionsManagementServiceResolved) {
			this._sessionsManagementServiceResolved = true;
			try {
				this._sessionsManagementService = this.instantiationService.invokeFunction(accessor => accessor.get(ISessionsManagementService));
			} catch {
				this._sessionsManagementService = undefined;
			}
		}
		return this._sessionsManagementService;
	}

	/**
	 * 执行单个工具调用
	 */
	async dispatch(toolCall: ToolCall, token: CancellationToken = CancellationToken.None, sessionContext?: IChenilleSessionContext): Promise<IToolResult> {
		const toolName = toolCall.function.name;

		if (!toolName) {
			return {
				success: false,
				content: '',
				error: '工具名称是必需的'
			};
		}

		try {
			let result: IToolResult;

			// 检查是否为 MCP 工具
			if (isMcpTool(toolName)) {
				result = await withTimeout(
					this.dispatchMcpTool(toolName, toolCall),
					TOOL_TIMEOUT,
					toolName
				);
			}
			// 检查是否为 Chenille 自实现的网络工具
			else if (isNetworkTool(toolName)) {
				result = await withTimeout(
					this.dispatchNetworkTool(toolName, toolCall),
					NETWORK_TOOL_TIMEOUT,
					toolName
				);
			}
			// 检查是否为 Chenille 会话工具
			else if (isSessionTool(toolName)) {
				result = await withTimeout(
					this.dispatchSessionTool(toolName, toolCall, token, sessionContext),
					isAgentSessionTool(toolName) ? AGENT_SESSION_TOOL_TIMEOUT : TOOL_TIMEOUT,
					toolName
				);
			}
			// 检查是否为 Chenille 文件工具
			else if (isChenilleFileTool(toolName)) {
				result = await withTimeout(
					this.dispatchFileTools(toolName, toolCall, this.getWorkspaceProvider(sessionContext)),
					TOOL_TIMEOUT,
					toolName
				);
			} else {
				// 否则调用 VS Code 内部工具
				result = await withTimeout(
					this.dispatchVSCodeTool(toolName, toolCall, token, sessionContext),
					TOOL_TIMEOUT,
					toolName
				);
			}

			return result;

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: errorMessage
			};
		}
	}

	/**
	 * 按会话工作区构造文件工具使用的工作区视图。
	 * Agents 窗口中的会话可能绑定到与当前窗口不同的文件夹，相对路径必须基于会话工作区解析。
	 */
	private getWorkspaceProvider(sessionContext?: IChenilleSessionContext): IWorkspaceFoldersProvider {
		const root = sessionContext?.workspaceRoot ?? this.workspaceService.getWorkspace().folders[0]?.uri;
		if (!root) {
			return this.workspaceService;
		}
		return { getWorkspace: () => ({ folders: [{ uri: root }] }) };
	}

	/**
	 * 调度 Chenille 文件工具
	 */
	private async dispatchFileTools(toolName: string, toolCall: ToolCall, workspaceService: IWorkspaceFoldersProvider): Promise<IToolResult> {
		try {
			let result: FileToolResult<unknown>;

			switch (toolName) {
				case 'readFile': {
					const parsed = parseToolArguments<ReadFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await readFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'getFileInfo': {
					const parsed = parseToolArguments<GetFileInfoParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await getFileInfo(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'checkFileExists': {
					const parsed = parseToolArguments<CheckFileExistsParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await checkFileExists(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'listDirectory': {
					const parsed = parseToolArguments<ListDirectoryParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await listDirectory(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'findFiles': {
					const parsed = parseToolArguments<FindFilesParams>(toolCall, ['pattern']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await findFiles(parsed.data, this.fileService, workspaceService, this.searchService);
					break;
				}

				case 'searchInFile': {
					const parsed = parseToolArguments<SearchInFileParams>(toolCall, ['path', 'query']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await searchInFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'searchInFiles': {
					const parsed = parseToolArguments<SearchInFilesParams>(toolCall, ['query']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await searchInFiles(parsed.data, this.fileService, workspaceService, this.searchService);
					break;
				}

				case 'replaceInFile': {
					const parsed = parseToolArguments<ReplaceInFileParams>(toolCall, ['path', 'oldText', 'newText']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchReplaceWithDiff(parsed.data, workspaceService);
					}
					result = await replaceInFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'insertInFile': {
					const parsed = parseToolArguments<InsertInFileParams>(toolCall, ['path', 'line', 'content']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchInsertWithDiff(parsed.data, workspaceService);
					}
					result = await insertInFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'deleteLines': {
					const parsed = parseToolArguments<DeleteLinesParams>(toolCall, ['path', 'startLine', 'endLine']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchDeleteWithDiff(parsed.data, workspaceService);
					}
					result = await deleteLines(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'createFile': {
					const parsed = parseToolArguments<CreateFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled && parsed.data.content) {
						return await this.dispatchCreateWithDiff(parsed.data, workspaceService);
					}
					result = await createFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'deleteFile': {
					const parsed = parseToolArguments<DeleteFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 删除文件前，先清理对应的 diff session
					const deleteUri = resolveFilePath(parsed.data.path, workspaceService);
					const existingSession = this.diffSessionService.getSession(deleteUri);
					if (existingSession) {
						this.diffSessionService.endSession(deleteUri);
					}
					result = await deleteFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'renameFile': {
					const parsed = parseToolArguments<RenameFileParams>(toolCall, ['oldPath', 'newPath']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 重命名文件前，先清理旧路径的 diff session
					const oldUri = resolveFilePath(parsed.data.oldPath, workspaceService);
					const oldSession = this.diffSessionService.getSession(oldUri);
					if (oldSession) {
						this.diffSessionService.endSession(oldUri);
					}
					result = await renameFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'getOpenEditors': {
					const parsed = parseToolArguments<GetOpenEditorsParams>(toolCall);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await getOpenEditors(parsed.data, this.editorService, workspaceService);
					break;
				}

				case 'editFile': {
					const parsed = parseToolArguments<EditFileParams>(toolCall, ['path', 'content']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchEditWithDiff(parsed.data, workspaceService);
					}
					result = await editFile(parsed.data, this.fileService, workspaceService);
					break;
				}

				case 'notebookEdit': {
					const parsed = parseToolArguments<Record<string, unknown>>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}

					const uri = resolveFilePath(String(parsed.data.path ?? ''), workspaceService);
					let notebook: Record<string, unknown>;
					try {
						notebook = JSON.parse((await this.fileService.readFile(uri)).value.toString());
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return { success: false, content: '', error: `读取 Notebook 失败: ${message}` };
					}

					const cells = notebook.cells;
					if (!Array.isArray(cells)) {
						return { success: false, content: '', error: '不是有效的 Jupyter Notebook 文件（缺少 cells 数组）' };
					}

					const editMode = typeof parsed.data.editMode === 'string' ? parsed.data.editMode : 'replace';
					const cellId = typeof parsed.data.cellId === 'string' ? parsed.data.cellId : undefined;
					const newSource = typeof parsed.data.newSource === 'string' ? parsed.data.newSource : '';
					const requestedType = parsed.data.cellType === 'markdown' ? 'markdown' : parsed.data.cellType === 'code' ? 'code' : undefined;
					const index = cellId ? cells.findIndex((cell: { id?: string }) => cell?.id === cellId) : -1;
					if (cellId && index < 0) {
						return { success: false, content: '', error: `未找到单元格: ${cellId}` };
					}

					const nbformat = Number(notebook.nbformat ?? 4);
					const nbformatMinor = Number(notebook.nbformat_minor ?? 0);
					const supportsCellIds = nbformat > 4 || (nbformat === 4 && nbformatMinor >= 5);
					const toSourceLines = (source: string) => source.split(/\r\n|\r|\n/).map((line, i, arr) => i < arr.length - 1 ? `${line}\n` : line);
					const makeCell = (type: string, source: string, existing?: Record<string, unknown>) => {
						const cell = existing ?? { metadata: {} };
						cell.cell_type = type;
						cell.source = toSourceLines(source);
						cell.metadata ??= {};
						if (type === 'code') {
							cell.outputs ??= [];
							cell.execution_count ??= null;
						} else {
							delete cell.outputs;
							delete cell.execution_count;
						}
						if (supportsCellIds && !cell.id) {
							cell.id = generateUuid().replace(/-/g, '').slice(0, 8);
						}
						return cell;
					};

					let action: string;
					let resultCell: Record<string, unknown> | undefined;
					let resultIndex: number;

					switch (editMode) {
						case 'insert': {
							const cell = makeCell(requestedType ?? 'code', newSource);
							resultIndex = index >= 0 ? index + 1 : 0;
							cells.splice(resultIndex, 0, cell);
							resultCell = cell;
							action = '已插入';
							break;
						}
						case 'delete': {
							if (index < 0) {
								return { success: false, content: '', error: '删除单元格需要提供有效的 cellId' };
							}
							const [removed] = cells.splice(index, 1);
							resultIndex = index;
							resultCell = removed;
							action = '已删除';
							break;
						}
						case 'replace': {
							if (index < 0) {
								return { success: false, content: '', error: '替换单元格需要提供有效的 cellId' };
							}
							const existing = cells[index] as Record<string, unknown>;
							const cell = makeCell(requestedType ?? String(existing.cell_type ?? 'code'), newSource, existing);
							resultIndex = index;
							resultCell = cell;
							action = '已替换';
							break;
						}
						default:
							return { success: false, content: '', error: `不支持的编辑方式: ${editMode}` };
					}

					await this.fileService.writeFile(uri, VSBuffer.fromString(`${JSON.stringify(notebook, null, 1)}\n`));
					const cellLabel = resultCell?.id ? ` ${resultCell.id}` : ` #${resultIndex + 1}`;
					return {
						success: true,
						content: `${action}单元格${cellLabel}（${resultCell?.cell_type ?? '未知类型'}），当前共 ${cells.length} 个单元格。`
					};
				}

				case 'getErrors': {
					const parsed = parseToolArguments<Record<string, unknown>>(toolCall);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}

					const rawPath = typeof parsed.data.path === 'string' ? parsed.data.path.trim() : '';
					const maxResults = typeof parsed.data.maxResults === 'number'
						? Math.max(1, Math.min(1000, Math.floor(parsed.data.maxResults)))
						: 200;
					const resource = rawPath ? resolveFilePath(rawPath, workspaceService) : undefined;
					const markers = this.markerService.read({
						resource,
						severities: MarkerSeverity.Error | MarkerSeverity.Warning,
						take: maxResults
					});

					if (markers.length === 0) {
						return {
							success: true,
							content: rawPath ? `文件 "${rawPath}" 没有错误或警告。` : '工作区没有错误或警告。'
						};
					}

					const lines = markers.map(marker => {
						const severity = marker.severity === MarkerSeverity.Error ? '错误' : '警告';
						const source = marker.source ? ` (${marker.source})` : '';
						return `[${severity}] ${marker.resource.fsPath}:${marker.startLineNumber}:${marker.startColumn} ${marker.message}${source}`;
					});
					return {
						success: true,
						content: truncateContent(`共 ${markers.length} 条错误/警告：\n${lines.join('\n')}`, 60000)
					};
				}

				default:
					return {
						success: false,
						content: '',
						error: `未知的文件工具: ${toolName}。可用工具: ${[...CHENILLE_FILE_TOOL_NAMES].join(', ')}`
					};
			}

			// 转换结果
			return this.formatFileToolResult(toolName, result);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: errorMessage
			};
		}
	}

	/**
	 * 格式化文件工具结果，使其更易于 AI 理解
	 */
	private formatFileToolResult(toolName: string, result: FileToolResult<unknown>): IToolResult {
		if (!result.success) {
			// 失败情况：提取详细错误信息
			const errorData = result.data as Record<string, unknown> | undefined;
			let errorDetail = result.error ?? '未知错误';

			// 如果 data 中有更详细的错误信息（如 replaceInFile 的失败详情）
			if (errorData && typeof errorData === 'object') {
				const errorField = (errorData as { error?: unknown }).error;
				if (typeof errorField === 'string') {
					errorDetail = errorField;
				}
				const detailsField = (errorData as { details?: unknown }).details;
				if (detailsField && typeof detailsField === 'object') {
					const suggestion = (detailsField as { suggestion?: unknown }).suggestion;
					if (typeof suggestion === 'string') {
						errorDetail += `\n建议: ${suggestion}`;
					}
				}
			}

			return {
				success: false,
				content: result.data ? JSON.stringify(result.data, null, 2) : '',
				error: errorDetail
			};
		}

		// 成功情况：根据工具类型生成清晰的成功消息
		const data = result.data as Record<string, unknown>;
		let summary = '操作成功';

		switch (toolName) {
			case 'replaceInFile': {
				const replacedCount = data.replacedCount as number | undefined;
				const lineNumbers = data.lineNumbers as number[] | undefined;
				if (replacedCount !== undefined) {
					summary = `替换成功: 共替换 ${replacedCount} 处`;
					if (lineNumbers?.length) {
						summary += `，位于第 ${lineNumbers.join(', ')} 行`;
					}
				}
				break;
			}
			case 'insertInFile': {
				const insertedAt = data.insertedAt as number | undefined;
				const newLineCount = data.newLineCount as number | undefined;
				summary = `插入成功: 内容已插入到第 ${insertedAt ?? '?'} 行，文件现有 ${newLineCount ?? '?'} 行`;
				break;
			}
			case 'deleteLines': {
				const deletedLineCount = data.deletedLineCount as number | undefined;
				const newLineCount = data.newLineCount as number | undefined;
				summary = `删除成功: 已删除 ${deletedLineCount ?? '?'} 行，文件现有 ${newLineCount ?? '?'} 行`;
				break;
			}
			case 'createFile': {
				const lineCount = data.lineCount as number | undefined;
				summary = `文件创建成功，共 ${lineCount ?? 0} 行`;
				break;
			}
			case 'deleteFile': {
				const deleted = data.deleted as boolean | undefined;
				summary = deleted ? '文件已删除' : '文件不存在（无需删除）';
				break;
			}
			case 'renameFile': {
				summary = '文件重命名/移动成功';
				break;
			}
			case 'readFile': {
				const totalLines = data.totalLines as number | undefined;
				const readRange = data.readRange as [number, number] | undefined;
				if (readRange) {
					summary = `读取成功: 第 ${readRange[0]}-${readRange[1]} 行（共 ${totalLines ?? '?'} 行）`;
				}
				break;
			}
			case 'searchInFile':
			case 'searchInFiles': {
				const totalMatches = data.totalMatches as number | undefined;
				summary = `搜索完成: 找到 ${totalMatches ?? 0} 个匹配`;
				break;
			}
			case 'findFiles': {
				const totalFound = data.totalFound as number | undefined;
				summary = `搜索完成: 找到 ${totalFound ?? 0} 个文件`;
				break;
			}
			case 'listDirectory': {
				const totalCount = data.totalCount as number | undefined;
				summary = `列出完成: 共 ${totalCount ?? 0} 个条目`;
				break;
			}
			case 'checkFileExists': {
				const exists = data.exists as boolean | undefined;
				const type = data.type as string | undefined;
				summary = exists ? `存在 (${type ?? 'unknown'})` : '不存在';
				break;
			}
			case 'getFileInfo': {
				const exists = data.exists as boolean | undefined;
				summary = exists ? '文件信息获取成功' : '文件不存在';
				break;
			}
			case 'getOpenEditors': {
				const totalCount = data.totalCount as number | undefined;
				summary = `获取成功: 共 ${totalCount ?? 0} 个打开的编辑器`;
				break;
			}
			case 'editFile': {
				const created = data.created as boolean | undefined;
				const lineCount = data.lineCount as number | undefined;
				const originalLineCount = data.originalLineCount as number | undefined;
				if (created) {
					summary = `文件创建成功，共 ${lineCount ?? 0} 行`;
				} else {
					summary = `文件编辑成功: ${originalLineCount ?? '?'} 行 → ${lineCount ?? '?'} 行`;
				}
				break;
			}
		}

		// 构建最终内容：摘要 + 详细数据
		const content = JSON.stringify(result.data, null, 2);
		const truncatedContent = truncateContent(content, 50000);
		const finalContent = `${summary}\n\n${truncatedContent}`;

		return {
			success: true,
			content: finalContent
		};
	}

	/**
	 * 调度 MCP 工具
	 * 通过 IPC 在主进程中执行 MCP 工具调用
	 */
	private async dispatchMcpTool(toolName: string, toolCall: ToolCall): Promise<IToolResult> {
		try {
			// 解析参数
			const parsed = parseToolArguments<Record<string, unknown>>(toolCall);
			const args = parsed.success ? parsed.data : {};

			// 通过 IPC 调用主进程的 MCP Runtime 服务
			const result = await this.mcpRuntimeService.callToolByFullName(toolName, args);

			if (result.success) {
				// 格式化成功结果 - 将 MCP 内容转换为字符串
				let content = '';
				if (result.content && Array.isArray(result.content)) {
					content = result.content
						.map(c => {
							if (c.type === 'text') {
								return c.text;
							} else if (c.type === 'resource' && c.resource?.text) {
								return c.resource.text;
							} else if (c.type === 'image') {
								return `[图片: ${c.mimeType}]`;
							}
							return '';
						})
						.filter(s => s)
						.join('\n');
				}

				if (!content) {
					content = '工具执行成功';
				}

				return {
					success: true,
					content: truncateContent(content, 50000)
				};
			} else {
				return {
					success: false,
					content: '',
					error: result.error ?? '未知错误'
				};
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: `MCP 工具调用失败: ${errorMessage}`
			};
		}
	}

	/**
	 * 调度 Chenille 网络工具（自建抓取 / DeepSeek 搜索与抓取）
	 */
	private async dispatchNetworkTool(toolName: string, toolCall: ToolCall): Promise<IToolResult> {
		const parsed = parseToolArguments<Record<string, unknown>>(toolCall);
		if (!parsed.success) {
			return { success: false, content: '', error: parsed.error };
		}
		const params = parsed.data;
		const url = typeof params.url === 'string' ? params.url.trim() : '';
		const query = typeof params.query === 'string' ? params.query.trim() : '';

		try {
			switch (toolName) {
				case 'webFetch': {
					if (!url) {
						return { success: false, content: '', error: '缺少参数: url' };
					}
					const page = await this.networkToolsService.fetchWebPage(url);
					const lines = [
						page.title ? `# ${page.title}` : undefined,
						`URL: ${page.finalUrl}`,
						`状态: ${page.code} ${page.codeText}`,
						`大小: ${page.bytes} 字节，耗时: ${page.durationMs} ms`,
						'',
						page.content || '[页面没有可提取的文本内容]'
					].filter(line => line !== undefined);
					return { success: true, content: truncateContent(lines.join('\n'), 120000) };
				}

				case 'deepseekSearch': {
					if (!query) {
						return { success: false, content: '', error: '缺少参数: query' };
					}
					const count = typeof params.count === 'number' ? params.count : undefined;
					const needContent = params.needContent === true;
					const response = await this.networkToolsService.search(query, count, needContent);
					const results = response.results ?? [];
					if (results.length === 0) {
						return { success: true, content: `搜索 "${query}" 没有找到结果。` };
					}
					const blocks = results.map((item, index) => {
						const parts = [
							`## ${index + 1}. ${item.title || '(无标题)'}`,
							`- URL: ${item.url || '(未知)'}`,
							item.site_name ? `- 站点: ${item.site_name}` : undefined,
							item.date ? `- 发布时间: ${item.date}` : undefined,
							typeof item.authority === 'number' ? `- 权威度: ${item.authority}` : undefined,
							typeof item.rerank_score === 'number' ? `- 相关度: ${item.rerank_score}` : undefined,
							'',
							item.summary || item.snippet || '',
						];
						if (needContent && item.content) {
							parts.push('', item.content);
						}
						return parts.filter(part => part !== undefined).join('\n');
					});
					const header = `搜索 "${query}" 找到 ${results.length} 条结果：\n`;
					return { success: true, content: truncateContent(`${header}\n${blocks.join('\n\n---\n\n')}`, 120000) };
				}

				case 'deepseekFetch': {
					if (!url) {
						return { success: false, content: '', error: '缺少参数: url' };
					}
					const result = await this.networkToolsService.fetch(url);
					const header = result.title ? `# ${result.title}\nURL: ${url}\n` : `URL: ${url}\n`;
					return { success: true, content: truncateContent(`${header}\n${result.content || '[页面没有可提取的文本内容]'}`, 120000) };
				}

				default:
					return { success: false, content: '', error: `未知的网络工具: ${toolName}` };
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return { success: false, content: '', error: `${toolName} 执行失败: ${errorMessage}` };
		}
	}

	/**
	 * 调度只读会话工具
	 */
	private async dispatchSessionTool(
		toolName: string,
		toolCall: ToolCall,
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<IToolResult> {
		const parsed = parseToolArguments<Record<string, unknown>>(toolCall);
		if (!parsed.success) {
			return { success: false, content: '', error: parsed.error };
		}

		try {
			switch (toolName) {
				case 'listSessions':
					return await this.listSessions(parsed.data, sessionContext);
				case 'readSession':
					return await this.readSession(parsed.data, token, sessionContext);
				case 'sendToSession':
					return await this.sendToSession(parsed.data, token, sessionContext);
				case 'createSession':
					return await this.createSession(parsed.data, token, sessionContext);
				case 'orchestrate':
					return await this.orchestrate(parsed.data, token, sessionContext);
				default:
					return { success: false, content: '', error: `未知的会话工具: ${toolName}` };
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return { success: false, content: '', error: `${toolName} 执行失败: ${errorMessage}` };
		}
	}

	/**
	 * 列出本地历史会话
	 */
	private async listSessions(params: Record<string, unknown>, sessionContext?: IChenilleSessionContext): Promise<IToolResult> {
		const limit = readIntParam(params.limit, 20, 1, 50);
		const currentResource = sessionContext?.sessionResource.toString();

		const details = (await this.chatService.getLocalSessionHistory())
			.filter(detail => LocalChatSessionUri.isLocalSession(detail.sessionResource))
			.sort((a, b) => b.lastMessageDate - a.lastMessageDate);

		if (details.length === 0) {
			return { success: true, content: '本地没有任何历史会话。' };
		}

		const lines = details.slice(0, limit).map((detail, index) => {
			const id = LocalChatSessionUri.parseLocalSessionId(detail.sessionResource) ?? detail.sessionResource.toString();
			const isCurrent = currentResource === detail.sessionResource.toString();
			const status = [
				isCurrent ? '当前会话' : undefined,
				detail.isActive ? '运行中' : '空闲'
			].filter(Boolean).join('，');
			return [
				`${index + 1}. ${detail.title?.trim() || '(无标题)'}`,
				`   - ID: ${id}`,
				`   - 最近活动: ${formatTimestamp(detail.lastMessageDate)}`,
				`   - 状态: ${status}`
			].join('\n');
		});

		const header = details.length > limit
			? `共 ${details.length} 个会话（按最近活动排序，仅显示前 ${limit} 个）：`
			: `共 ${details.length} 个会话（按最近活动排序）：`;

		return { success: true, content: `${header}\n\n${lines.join('\n\n')}` };
	}

	/**
	 * 读取指定会话的最近对话
	 */
	private async readSession(
		params: Record<string, unknown>,
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<IToolResult> {
		const rawSessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
		if (!rawSessionId) {
			return { success: false, content: '', error: '缺少参数: sessionId' };
		}

		const limit = readIntParam(params.limit, 10, 1, 50);
		const maxCharsPerMessage = readIntParam(params.maxCharsPerMessage, 4000, 200, 20000);
		const resource = this.resolveSessionResource(rawSessionId);
		if (!resource) {
			return { success: false, content: '', error: `无法解析会话 ID: ${rawSessionId}。请使用 listSessions 返回的 ID。` };
		}

		const reference = await this.chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, token);
		if (!reference) {
			return { success: false, content: '', error: `未找到会话: ${rawSessionId}。请使用 listSessions 查看可用的会话 ID。` };
		}

		try {
			const model = reference.object;
			const requests = model.getRequests();
			const sessionId = LocalChatSessionUri.parseLocalSessionId(model.sessionResource) ?? model.sessionResource.toString();
			const title = model.title?.trim() || '(无标题)';
			const isCurrent = sessionContext?.sessionResource.toString() === model.sessionResource.toString();

			if (requests.length === 0) {
				return { success: true, content: `会话「${title}」(${sessionId}) 还没有对话内容。` };
			}

			const selected = requests.slice(-limit);
			const firstTurn = requests.length - selected.length + 1;
			const turns = selected.map((request, index) => {
				const userText = truncateText(request.message.text.trim(), maxCharsPerMessage);
				let assistantText = '';
				try {
					assistantText = request.response?.response.getFinalResponse()
						|| request.response?.response.getMarkdown()
						|| '';
				} catch {
					assistantText = '';
				}
				assistantText = truncateText(assistantText.trim(), maxCharsPerMessage);

				return [
					`### 第 ${firstTurn + index} 轮`,
					`**用户**\n${userText || '(空消息)'}`,
					assistantText ? `**助手**\n${assistantText}` : '**助手**\n(无文本回复，可能只有工具调用)'
				].join('\n\n');
			});

			const header = [
				`会话: ${title}`,
				`ID: ${sessionId}${isCurrent ? '（当前会话）' : ''}`,
				`共 ${requests.length} 轮，显示最近 ${selected.length} 轮`
			].join('\n');

			return {
				success: true,
				content: truncateContent(`${header}\n\n${turns.join('\n\n---\n\n')}`, 120000)
			};
		} finally {
			reference.dispose();
		}
	}

	/**
	 * 子代理会话不能再创建代理或向其他会话发消息，否则容易形成无限递归。
	 */
	private isChildSession(sessionContext?: IChenilleSessionContext): boolean {
		return !!sessionContext && this.childSessionResources.has(sessionContext.sessionResource.toString());
	}

	/**
	 * 向已有本地会话发送一条消息，并等待其回复。
	 */
	private async sendToSession(
		params: Record<string, unknown>,
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<IToolResult> {
		if (this.isChildSession(sessionContext)) {
			return { success: false, content: '', error: '子代理会话不能再向其他会话发送消息。' };
		}

		const rawSessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
		const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
		if (!rawSessionId) {
			return { success: false, content: '', error: '缺少参数: sessionId' };
		}
		if (!prompt) {
			return { success: false, content: '', error: '缺少参数: prompt' };
		}

		const resource = this.resolveSessionResource(rawSessionId);
		if (!resource) {
			return { success: false, content: '', error: `无法解析会话 ID: ${rawSessionId}。请使用 listSessions 返回的 ID。` };
		}
		if (sessionContext && resource.toString() === sessionContext.sessionResource.toString()) {
			return { success: false, content: '', error: '不能向当前会话自身发送消息，这会造成等待死锁。' };
		}

		const wait = params.wait !== false;
		const timeoutMs = readIntParam(params.timeoutSeconds, 300, 10, 1800) * 1000;

		const reference = await this.chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, token);
		if (!reference) {
			return { success: false, content: '', error: `未找到会话: ${rawSessionId}。请使用 listSessions 查看可用的会话 ID。` };
		}

		try {
			const model = reference.object;
			const requests = model.getRequests();
			const lastRequest = requests.length > 0 ? requests[requests.length - 1] : undefined;
			if (lastRequest && (!lastRequest.response || !lastRequest.response.isComplete)) {
				return { success: false, content: '', error: `目标会话正在运行中，请稍后再发送。` };
			}

			const sessionId = LocalChatSessionUri.parseLocalSessionId(model.sessionResource) ?? rawSessionId;
			const title = model.title?.trim() || '(无标题)';
			const modelId = (typeof params.modelId === 'string' ? params.modelId.trim() : '')
				|| lastRequest?.modelId
				|| model.inputModel.state.get()?.selectedModel?.identifier;

			const { output, title: responseTitle } = await this.sendToChatSession(resource, prompt, modelId, wait, timeoutMs, token);

			if (!wait) {
				return { success: true, content: `已向会话「${title}」(${sessionId}) 发送消息，当前不等待回复。` };
			}

			const shownTitle = responseTitle || title;
			const header = `会话「${shownTitle}」(${sessionId}) 的回复：`;
			return {
				success: true,
				content: output
					? truncateContent(`${header}\n\n${output}`, 100000)
					: `${header}\n\n(无文本回复，可能只有工具调用)`
			};
		} finally {
			reference.dispose();
		}
	}

	/**
	 * 新建一个绑定到指定文件夹的 Chenille 子会话，并执行首个任务。
	 */
	private async createSession(
		params: Record<string, unknown>,
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<IToolResult> {
		if (this.isChildSession(sessionContext)) {
			return { success: false, content: '', error: '子代理会话不能再创建新的代理会话。' };
		}

		const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
		if (!prompt) {
			return { success: false, content: '', error: '缺少参数: prompt' };
		}

		const isolation = params.isolation === 'worktree' ? 'worktree' : 'none';
		const rawPath = typeof params.path === 'string' ? params.path.trim() : '';
		const modelId = (typeof params.modelId === 'string' ? params.modelId.trim() : '')
			|| this.getInheritedModelId(sessionContext);
		const timeoutMs = readIntParam(params.timeoutSeconds, 600, 10, 1800) * 1000;

		let workspaceInfo: { workspace: URI; branch?: string } | undefined;
		try {
			workspaceInfo = await this.resolveStepWorkspace(undefined, rawPath, isolation, sessionContext);
			const result = await this.runChildAgent(workspaceInfo.workspace, prompt, modelId, timeoutMs, token);
			const lines = [
				`已创建子会话「${result.title || '(无标题)'}」(${result.sessionId})。`,
				`工作区: ${result.workspacePath}`,
				workspaceInfo.branch ? `worktree 分支: ${workspaceInfo.branch}` : undefined,
				'',
				result.output || '(无文本回复，可能只有工具调用)'
			].filter((line): line is string => line !== undefined);
			return { success: true, content: truncateContent(lines.join('\n'), 100000) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details = workspaceInfo
				? `（工作区: ${workspaceInfo.workspace.fsPath}${workspaceInfo.branch ? `，分支 ${workspaceInfo.branch}` : ''}）`
				: '';
			return { success: false, content: '', error: `创建会话失败${details}: ${message}` };
		}
	}

	/**
	 * 按依赖关系并行执行多个子代理步骤。
	 */
	private async orchestrate(
		params: Record<string, unknown>,
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<IToolResult> {
		if (this.isChildSession(sessionContext)) {
			return { success: false, content: '', error: '子代理会话不能再发起多代理编排。' };
		}

		const parsed = this.parseOrchestrationSteps(params.steps);
		if ('error' in parsed) {
			return { success: false, content: '', error: parsed.error };
		}
		const steps = parsed.steps;

		const levelsOrError = this.buildStepLevels(steps);
		if (typeof levelsOrError === 'string') {
			return { success: false, content: '', error: levelsOrError };
		}
		const levels = levelsOrError;

		const goal = typeof params.goal === 'string' ? params.goal.trim() || undefined : undefined;
		const maxConcurrency = readIntParam(params.maxConcurrency, 3, 1, 6);
		const timeoutMs = readIntParam(params.timeoutSeconds, 600, 10, 1800) * 1000;
		const defaultModelId = this.getInheritedModelId(sessionContext);

		// 留出一分钟余量，保证整个编排在调度器的外层超时之前收尾，避免遗留仍在运行的子会话。
		const deadline = Date.now() + AGENT_SESSION_TOOL_TIMEOUT - 60_000;

		const results = new Map<string, IOrchestrationStepResult>();
		let cancelled = false;

		for (const level of levels) {
			if (cancelled || token.isCancellationRequested) {
				cancelled = true;
				for (const step of level) {
					results.set(step.id, { id: step.id, status: 'skipped', error: '已取消' });
				}
				continue;
			}

			const runnable: IOrchestrationStep[] = [];
			for (const step of level) {
				const failedDependency = step.dependsOn.find(id => results.get(id)?.status !== 'success');
				if (failedDependency) {
					results.set(step.id, {
						id: step.id,
						status: 'skipped',
						error: `前置步骤 ${failedDependency} 未成功`
					});
				} else {
					runnable.push(step);
				}
			}

			for (let i = 0; i < runnable.length; i += maxConcurrency) {
				if (cancelled || token.isCancellationRequested) {
					cancelled = true;
					for (const step of runnable.slice(i)) {
						results.set(step.id, { id: step.id, status: 'skipped', error: '已取消' });
					}
					break;
				}

				const remaining = deadline - Date.now();
				if (remaining <= 0) {
					cancelled = true;
					for (const step of runnable.slice(i)) {
						results.set(step.id, { id: step.id, status: 'skipped', error: '编排总时长超限' });
					}
					break;
				}

				const batch = runnable.slice(i, i + maxConcurrency);
				const stepTimeout = Math.max(10_000, Math.min(timeoutMs, remaining));
				const batchResults = await Promise.all(batch.map(step => this.runOrchestrationStep(
					step,
					goal,
					results,
					defaultModelId,
					stepTimeout,
					token,
					sessionContext
				)));
				for (const result of batchResults) {
					results.set(result.id, result);
				}
			}
		}

		return this.formatOrchestrationResult(steps, results);
	}

	private parseOrchestrationSteps(raw: unknown): { steps: IOrchestrationStep[] } | { error: string } {
		if (!Array.isArray(raw) || raw.length === 0) {
			return { error: '缺少参数: steps（至少需要一个步骤）' };
		}
		if (raw.length > 8) {
			return { error: 'steps 最多支持 8 个步骤' };
		}

		const steps: IOrchestrationStep[] = [];
		const ids = new Set<string>();
		for (let index = 0; index < raw.length; index++) {
			const item = raw[index];
			if (!item || typeof item !== 'object') {
				return { error: `第 ${index + 1} 步格式无效` };
			}
			const record = item as Record<string, unknown>;
			const id = typeof record.id === 'string' ? record.id.trim() : '';
			if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) {
				return { error: `第 ${index + 1} 步的 id 无效（只允许字母、数字、下划线和短横线，最长 40）` };
			}
			if (ids.has(id)) {
				return { error: `步骤 id 重复: ${id}` };
			}
			ids.add(id);

			const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
			if (!prompt) {
				return { error: `步骤 ${id} 缺少 prompt` };
			}
			const rawDependsOn = Array.isArray(record.dependsOn) ? record.dependsOn : [];
			if (rawDependsOn.some(dep => typeof dep !== 'string')) {
				return { error: `步骤 ${id} 的 dependsOn 必须是字符串数组` };
			}
			const dependsOn = (rawDependsOn as string[]).map(dep => dep.trim()).filter(Boolean);
			if (dependsOn.includes(id)) {
				return { error: `步骤 ${id} 不能依赖自身` };
			}
			for (const dep of dependsOn) {
				if (!(raw as unknown[]).some(candidate => !!candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).id === dep)) {
					return { error: `步骤 ${id} 依赖了不存在的步骤 ${dep}` };
				}
			}

			steps.push({
				id,
				prompt,
				path: typeof record.path === 'string' && record.path.trim() ? record.path.trim() : undefined,
				isolation: record.isolation === 'worktree' ? 'worktree' : 'none',
				modelId: typeof record.modelId === 'string' && record.modelId.trim() ? record.modelId.trim() : undefined,
				dependsOn
			});
		}

		return { steps };
	}

	/**
	 * 按依赖关系分层；同一层内的步骤可以并行。
	 */
	private buildStepLevels(steps: readonly IOrchestrationStep[]): IOrchestrationStep[][] | string {
		const order = new Map(steps.map((step, index) => [step.id, index]));
		const byId = new Map(steps.map(step => [step.id, step]));
		const indegree = new Map(steps.map(step => [step.id, 0]));
		const dependents = new Map<string, string[]>();

		for (const step of steps) {
			for (const dependency of step.dependsOn) {
				indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
				const list = dependents.get(dependency) ?? [];
				list.push(step.id);
				dependents.set(dependency, list);
			}
		}

		let ready = steps.filter(step => step.dependsOn.length === 0);
		const levels: IOrchestrationStep[][] = [];
		let processed = 0;

		while (ready.length > 0) {
			ready.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
			levels.push(ready);
			processed += ready.length;

			const next: IOrchestrationStep[] = [];
			for (const step of ready) {
				for (const dependentId of dependents.get(step.id) ?? []) {
					const remaining = (indegree.get(dependentId) ?? 0) - 1;
					indegree.set(dependentId, remaining);
					if (remaining === 0) {
						const dependent = byId.get(dependentId);
						if (dependent) {
							next.push(dependent);
						}
					}
				}
			}
			ready = next;
		}

		if (processed !== steps.length) {
			return '步骤依赖存在循环，无法编排';
		}
		return levels;
	}

	private async runOrchestrationStep(
		step: IOrchestrationStep,
		goal: string | undefined,
		results: ReadonlyMap<string, IOrchestrationStepResult>,
		defaultModelId: string | undefined,
		timeoutMs: number,
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<IOrchestrationStepResult> {
		let workspacePath: string | undefined;
		let branch: string | undefined;
		try {
			const resolved = await this.resolveStepWorkspace(step.id, step.path, step.isolation, sessionContext);
			workspacePath = resolved.workspace.fsPath;
			branch = resolved.branch;
			const prompt = this.buildChildPrompt(step, goal, results, branch, step.isolation);
			const result = await this.runChildAgent(resolved.workspace, prompt, step.modelId ?? defaultModelId, timeoutMs, token, `编排 · ${step.id}`);
			return {
				id: step.id,
				status: 'success',
				sessionId: result.sessionId,
				workspacePath: result.workspacePath,
				branch,
				output: result.output
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { id: step.id, status: 'failed', error: message, workspacePath, branch };
		}
	}

	private buildChildPrompt(
		step: IOrchestrationStep,
		goal: string | undefined,
		results: ReadonlyMap<string, IOrchestrationStepResult>,
		branch: string | undefined,
		isolation: 'none' | 'worktree'
	): string {
		const parts: string[] = [
			'你是 Chenille 多代理编排中的子代理。请独立完成分配给你的任务，不要再把任务拆给其他代理，也不要向其他会话发消息。'
		];
		if (goal) {
			parts.push(`## 总体目标\n${goal}`);
		}
		parts.push(`## 你的任务（步骤 ${step.id}）\n${step.prompt}`);
		if (isolation === 'worktree' && branch) {
			parts.push(`## 工作区\n你工作在独立的 git worktree 中，分支为 ${branch}。可以放心修改文件，不会影响其他代理。`);
		}
		for (const dependency of step.dependsOn) {
			const result = results.get(dependency);
			if (result?.status === 'success' && result.output) {
				parts.push(`## 前置步骤 ${dependency} 的结果\n${truncateText(result.output, 6000)}`);
			}
		}
		parts.push('## 输出要求\n直接执行任务，完成后用简洁的文字总结：做了什么、结果如何、是否还有遗留问题。');
		return parts.join('\n\n');
	}

	private formatOrchestrationResult(
		steps: readonly IOrchestrationStep[],
		results: ReadonlyMap<string, IOrchestrationStepResult>
	): IToolResult {
		const all = steps.map(step => results.get(step.id) ?? { id: step.id, status: 'skipped' as const, error: '未执行' });
		const succeeded = all.filter(result => result.status === 'success').length;
		const failed = all.filter(result => result.status === 'failed').length;
		const skipped = all.filter(result => result.status === 'skipped').length;

		const blocks = all.map(result => {
			const lines = [`### [${result.status === 'success' ? '成功' : result.status === 'failed' ? '失败' : '跳过'}] ${result.id}`];
			if (result.sessionId) {
				lines.push(`- 会话: ${result.sessionId}`);
			}
			if (result.workspacePath) {
				lines.push(`- 工作区: ${result.workspacePath}${result.branch ? `（分支 ${result.branch}）` : ''}`);
			}
			if (result.error) {
				lines.push(`- 错误: ${result.error}`);
			}
			if (result.output) {
				lines.push(`- 输出:\n${truncateText(result.output, 6000)}`);
			}
			return lines.join('\n');
		});

		const header = `编排结束：共 ${all.length} 步，成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}。`;
		const worktrees = all
			.filter(result => result.branch && result.workspacePath)
			.map(result => `- ${result.id}: ${result.workspacePath}（分支 ${result.branch}）`);

		const sections = [header];
		if (worktrees.length > 0) {
			sections.push(`worktree 已保留，可在确认后手动清理：\n${worktrees.join('\n')}`);
		}
		sections.push(blocks.join('\n\n---\n\n'));

		return { success: true, content: truncateContent(sections.join('\n\n'), 120000) };
	}

	/**
	 * 解析步骤的工作区；worktree 隔离时为该步骤新建独立分支。
	 */
	private async resolveStepWorkspace(
		stepId: string | undefined,
		rawPath: string | undefined,
		isolation: 'none' | 'worktree',
		sessionContext?: IChenilleSessionContext
	): Promise<{ workspace: URI; branch?: string }> {
		const provider = this.getWorkspaceProvider(sessionContext);
		const workspace = rawPath
			? resolveFilePath(rawPath, provider)
			: provider.getWorkspace().folders[0]?.uri;

		if (!workspace) {
			throw new Error('无法确定工作区，请提供 path');
		}
		if (isolation !== 'worktree') {
			return { workspace };
		}
		if (workspace.scheme !== 'file') {
			throw new Error('worktree 隔离仅支持本地文件夹工作区');
		}

		const info = await this.gitWorktreeService.createWorktree(workspace.fsPath, stepId ?? 'session');
		return { workspace: URI.file(info.path), branch: info.branch };
	}

	/**
	 * 创建子会话并等待首轮回复。
	 */
	private async runChildAgent(
		workspace: URI,
		prompt: string,
		modelId: string | undefined,
		timeoutMs: number,
		token: CancellationToken,
		title?: string
	): Promise<IChildAgentResult> {
		const viaSessions = await this.tryRunChildAgentViaSessions(workspace, prompt, modelId, timeoutMs, token, title);
		if (viaSessions) {
			return viaSessions;
		}
		return this.runChildAgentViaLocalChat(workspace, prompt, modelId, timeoutMs, token);
	}

	/**
	 * 优先通过会话层创建子会话，使其出现在 Agents 窗口的会话列表中。
	 * 会话层未注册或 provider 不支持该工作区时返回 undefined，由调用方退回本地聊天会话。
	 *
	 * 这里直接调用 provider.createNewSession 而不是会话管理层的创建入口：
	 * 后者会校验工作区信任，导致 worktree 这类新建目录被拒绝；子会话的工作区来自
	 * 已受信任的当前项目，无需再次提示信任。
	 */
	private async tryRunChildAgentViaSessions(
		workspace: URI,
		prompt: string,
		modelId: string | undefined,
		timeoutMs: number,
		token: CancellationToken,
		title?: string
	): Promise<IChildAgentResult | undefined> {
		const management = this.getSessionsManagementService();
		if (!management) {
			return undefined;
		}

		let providersService: ISessionsProvidersService;
		try {
			providersService = this.instantiationService.invokeFunction(accessor => accessor.get(ISessionsProvidersService));
		} catch {
			return undefined;
		}
		const provider = providersService.getProvider(CHENILLE_PROVIDER_ID);
		if (!provider) {
			return undefined;
		}
		try {
			if (!provider.getSessionTypes(workspace).some(type => type.id === CHENILLE_SESSION_TYPE_ID)) {
				return undefined;
			}
		} catch {
			return undefined;
		}

		let session: ISession;
		try {
			session = provider.createNewSession(workspace, CHENILLE_SESSION_TYPE_ID, { modelId });
		} catch {
			return undefined;
		}

		let responseModel: IChatResponseModel | undefined;
		const chat = session.mainChat.get();
		const chatResource = chat.resource;
		this.childSessionResources.add(chatResource.toString());
		try {
			await management.sendRequest(session, chat, {
				query: prompt,
				background: true,
				title,
				onDidCreateResponse: response => {
					if (response) {
						responseModel = response;
					}
				},
			});

			// onDidCreateResponse 由 chatService 异步回调，发送返回时响应模型可能尚未创建。
			const response = await this.waitForCreatedResponse(chatResource, () => responseModel, timeoutMs, token, () => management.cancelCurrentRequest(session));
			await this.waitForResponseModel(response, timeoutMs, token, () => management.cancelCurrentRequest(session));
			const sessionId = LocalChatSessionUri.parseLocalSessionId(chatResource) ?? chatResource.toString();
			return {
				sessionId,
				title: session.title.get(),
				output: this.getResponseText(response),
				workspacePath: workspace.fsPath
			};
		} catch (error) {
			// 发送失败时清理仍处于草稿态的会话，避免残留在会话列表中。
			provider.deleteNewSession(session.sessionId);
			throw error;
		} finally {
			this.childSessionResources.delete(chatResource.toString());
		}
	}

	/**
	 * 直接创建本地聊天会话执行子任务（不经过 Agents 会话列表）。
	 */
	private async runChildAgentViaLocalChat(
		workspace: URI,
		prompt: string,
		modelId: string | undefined,
		timeoutMs: number,
		token: CancellationToken
	): Promise<IChildAgentResult> {
		const reference = this.chatService.startNewLocalSession(ChatAgentLocation.Chat);
		const resource = reference.object.sessionResource;
		const sessionId = LocalChatSessionUri.parseLocalSessionId(resource) ?? resource.toString();

		this.childSessionResources.add(resource.toString());
		try {
			reference.object.setWorkingDirectory(workspace);
			const { output, title } = await this.sendToChatSession(resource, prompt, modelId, true, timeoutMs, token);
			return {
				sessionId,
				title,
				output,
				workspacePath: workspace.fsPath
			};
		} finally {
			this.childSessionResources.delete(resource.toString());
			reference.dispose();
		}
	}

	/**
	 * 子会话默认继承当前请求的模型；请求未携带时退回会话输入框中的选择。
	 */
	private getInheritedModelId(sessionContext?: IChenilleSessionContext): string | undefined {
		if (sessionContext?.modelId) {
			return sessionContext.modelId;
		}
		if (!sessionContext) {
			return undefined;
		}
		return this.chatService.getSession(sessionContext.sessionResource)?.inputModel.state.get()?.selectedModel?.identifier;
	}

	private buildAgentSendOptions(modelId: string | undefined): IChatSendRequestOptions {
		return {
			location: ChatAgentLocation.Chat,
			userSelectedModelId: modelId,
			modeInfo: {
				kind: ChatModeKind.Agent,
				isBuiltin: true,
				modeInstructions: undefined,
				telemetryModeId: ChatModeKind.Agent,
				applyCodeBlockSuggestionId: undefined,
				permissionLevel: ChatPermissionLevel.Default,
			},
			agentIdSilent: CHENILLE_AGENT_ID,
		};
	}

	/**
	 * 向会话发送消息；(wait=true) 时等待响应完成并返回最终文本。
	 */
	private async sendToChatSession(
		resource: URI,
		prompt: string,
		modelId: string | undefined,
		wait: boolean,
		timeoutMs: number,
		token: CancellationToken
	): Promise<{ output: string; title: string }> {
		let responseModel: IChatResponseModel | undefined;
		const result = await this.chatService.sendRequest(resource, prompt, {
			...this.buildAgentSendOptions(modelId),
			onDidCreateResponse: response => {
				if (response) {
					responseModel = response;
				}
			},
		});

		if (result.kind === 'queued') {
			throw new Error('目标会话正在运行中，消息未发送');
		}
		if (result.kind === 'rejected') {
			throw new Error(`会话发送失败：${result.reason}`);
		}

		if (wait) {
			await this.waitForSessionCompletion(resource, result.data.responseCompletePromise, timeoutMs, token);
		}

		const model = this.chatService.getSession(resource);
		const output = wait
			? (responseModel ? this.getResponseText(responseModel) : this.getLastResponseText(resource))
			: '';
		return { output, title: model?.title?.trim() || '' };
	}

	private waitForSessionCompletion(
		resource: URI,
		completePromise: Promise<void>,
		timeoutMs: number,
		token: CancellationToken
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				cancelListener.dispose();
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			const timer = setTimeout(() => {
				void this.chatService.cancelCurrentRequestForSession(resource, 'Chenille 等待子会话超时');
				finish(new Error(`等待会话响应超时（${Math.round(timeoutMs / 1000)} 秒），已请求取消`));
			}, timeoutMs);
			const cancelListener = token.onCancellationRequested(() => {
				void this.chatService.cancelCurrentRequestForSession(resource, 'Chenille 请求已取消');
				finish(new Error('已取消'));
			});
			completePromise.then(
				() => finish(),
				error => finish(error instanceof Error ? error : new Error(String(error)))
			);
		});
	}

	/**
	 * 等待响应模型被创建。会话管理层的发送接口只保证请求已提交，
	 * 响应模型可能稍后才挂到聊天模型上。
	 */
	private async waitForCreatedResponse(
		chatResource: URI,
		getObserved: () => IChatResponseModel | undefined,
		timeoutMs: number,
		token: CancellationToken,
		onAbort: () => Promise<void> | void
	): Promise<IChatResponseModel> {
		const deadline = Date.now() + timeoutMs;
		for (; ;) {
			const response = getObserved() ?? this.getLastResponseModel(chatResource);
			if (response) {
				return response;
			}
			if (token.isCancellationRequested) {
				await Promise.resolve(onAbort()).catch(() => undefined);
				throw new Error('已取消');
			}
			if (Date.now() >= deadline) {
				await Promise.resolve(onAbort()).catch(() => undefined);
				throw new Error(`等待会话响应超时（${Math.round(timeoutMs / 1000)} 秒），已请求取消`);
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	/**
	 * 等待响应模型完成；超时或取消时通过 onAbort 取消该会话的请求。
	 */
	private waitForResponseModel(
		response: IChatResponseModel,
		timeoutMs: number,
		token: CancellationToken,
		onAbort: () => Promise<void> | void
	): Promise<void> {
		if (response.isComplete) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				changeListener.dispose();
				cancelListener.dispose();
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			const timer = setTimeout(() => {
				void Promise.resolve(onAbort()).catch(() => undefined);
				finish(new Error(`等待会话响应超时（${Math.round(timeoutMs / 1000)} 秒），已请求取消`));
			}, timeoutMs);
			const changeListener = response.onDidChange(() => {
				if (response.isComplete) {
					finish();
				}
			});
			const cancelListener = token.onCancellationRequested(() => {
				void Promise.resolve(onAbort()).catch(() => undefined);
				finish(new Error('已取消'));
			});
			// 监听器注册期间响应可能已经完成，补一次检查避免一直等到超时。
			if (response.isComplete) {
				finish();
			}
		});
	}

	private getLastResponseModel(resource: URI): IChatResponseModel | undefined {
		const requests = this.chatService.getSession(resource)?.getRequests() ?? [];
		const last = requests.length > 0 ? requests[requests.length - 1] : undefined;
		return last?.response;
	}

	private getResponseText(response: IChatResponseModel): string {
		try {
			return (response.entireResponse.getFinalResponse() || response.entireResponse.getMarkdown() || '').trim();
		} catch {
			return '';
		}
	}

	private getLastResponseText(resource: URI): string {
		const response = this.getLastResponseModel(resource);
		return response ? this.getResponseText(response) : '';
	}

	/**
	 * 将工具参数中的会话 ID 解析为本地聊天会话资源
	 */
	private resolveSessionResource(raw: string): URI | undefined {
		let value = raw;
		if (value.startsWith('chenille:')) {
			value = value.substring('chenille:'.length);
		}

		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
			let resource: URI;
			try {
				resource = URI.parse(value);
			} catch {
				return undefined;
			}
			return LocalChatSessionUri.isLocalSession(resource) ? resource : undefined;
		}

		return value ? LocalChatSessionUri.forSession(value) : undefined;
	}

	/**
	 * 调度 VS Code 内部工具
	 */
	private async dispatchVSCodeTool(
		toolName: string,
		toolCall: ToolCall,
		token: CancellationToken,
		sessionContext?: IChenilleSessionContext
	): Promise<IToolResult> {
		// 获取内部工具 ID
		const internalToolId = getInternalToolId(toolName);
		if (!internalToolId) {
			return {
				success: false,
				content: '',
				error: `未知工具: ${toolName}. 可用工具: ${getAllToolNames().join(', ')}`
			};
		}

		// 检查工具是否已注册
		const tools = this.toolsService.getTools(undefined);
		const toolData = [...tools].find(t => t.id === internalToolId);

		if (!toolData) {
			return {
				success: false,
				content: '',
				error: `工具未注册: ${internalToolId}. 该工具可能不可用。`
			};
		}

		// 解析参数
		const parsed = parseToolArguments<Record<string, unknown>>(toolCall);
		const parameters = parsed.success ? parsed.data : {};

		try {
			// 构建调用上下文（包含会话信息以启用内联确认）
			const invocation: IToolInvocation = {
				callId: `chenille-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
				toolId: internalToolId,
				parameters,
				tokenBudget: undefined,
				context: sessionContext ? {
					sessionResource: sessionContext.sessionResource,
					requestId: sessionContext.requestId,
				} : undefined,
				chatRequestId: sessionContext?.requestId,
				modelId: undefined,
				userSelectedTools: undefined,
			};

			// 调用工具
			const result = await this.toolsService.invokeTool(
				invocation,
				async () => 0, // countTokens callback
				token
			);

			// 提取结果内容
			const content = result.content
				.map((part) => {
					if (part.kind === 'text') {
						return part.value;
					} else if (part.kind === 'data') {
						return `[二进制数据: ${part.value.mimeType}]`;
					}
					return JSON.stringify(part);
				})
				.join('\n');

			return {
				success: true,
				content
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: errorMessage
			};
		}
	}

	/**
	 * 批量执行工具调用（顺序执行）
	 */
	async dispatchAll(toolCalls: ToolCall[], token: CancellationToken = CancellationToken.None, sessionContext?: IChenilleSessionContext): Promise<IToolResult[]> {
		const results: IToolResult[] = [];

		for (const toolCall of toolCalls) {
			if (token.isCancellationRequested) {
				results.push({
					success: false,
					content: '',
					error: '已取消'
				});
				continue;
			}

			const result = await this.dispatch(toolCall, token, sessionContext);
			results.push(result);
		}

		return results;
	}

	/**
	 * 列出所有可用的工具
	 */
	listAvailableTools(): string[] {
		const vsCodeTools = [...this.toolsService.getTools(undefined)].map(t => t.id);
		return [...CHENILLE_FILE_TOOL_NAMES, ...CHENILLE_NETWORK_TOOL_NAMES, ...CHENILLE_SESSION_TOOL_NAMES, ...vsCodeTools];
	}

	/**
	 * 检查工具是否可用
	 */
	isToolAvailable(toolName: string): boolean {
		// Chenille 文件工具、自建网络工具与只读会话工具始终可用
		if (isChenilleFileTool(toolName) || isNetworkTool(toolName) || isSessionTool(toolName)) {
			return true;
		}

		// 检查 VS Code 工具
		const internalToolId = getInternalToolId(toolName);
		if (!internalToolId) {
			return false;
		}

		const tools = this.toolsService.getTools(undefined);
		return [...tools].some(t => t.id === internalToolId);
	}

	// ==================== Diff 模式实现 ====================

	/**
	 * 使用 diff session 执行替换操作
	 */
	private async dispatchReplaceWithDiff(params: ReplaceInFileParams, workspaceService: IWorkspaceFoldersProvider): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, workspaceService);
			const expectedOccurrences = params.expectedOccurrences ?? 1;

			// 获取或创建 diff session
			let session = this.diffSessionService.getSession(uri);
			if (!session) {
				session = await this.diffSessionService.createSession(uri);
			}

			// 在修改后的模型中查找要替换的文本
			const content = session.modifiedModel.getValue();
			const locations = findMultilineText(content, params.oldText, true);

			// 检查匹配数量
			if (locations.length === 0) {
				const caseInsensitiveLocations = findMultilineText(content, params.oldText, false);
				let suggestion = '未找到要替换的文本。';
				if (caseInsensitiveLocations.length > 0) {
					suggestion += ` 找到 ${caseInsensitiveLocations.length} 个大小写不同的匹配。请检查大小写是否正确。`;
				}
				return {
					success: false,
					content: '',
					error: `未找到要替换的文本。${suggestion}`
				};
			}

			if (locations.length > 1 && expectedOccurrences === 1) {
				return {
					success: false,
					content: JSON.stringify({
						foundCount: locations.length,
						locations: locations.map(loc => ({
							line: loc.startLine,
							preview: loc.preview
						}))
					}, null, 2),
					error: `找到 ${locations.length} 个匹配，无法确定要替换哪一个。请提供更多上下文。`
				};
			}

			// 构建编辑操作
			const edits = locations.map(loc => {
				const startPos = session!.modifiedModel.getPositionAt(
					this.getOffsetFromLineColumn(content, loc.startLine, loc.startColumn)
				);
				const endPos = session!.modifiedModel.getPositionAt(
					this.getOffsetFromLineColumn(content, loc.startLine, loc.startColumn) + params.oldText.length
				);
				return EditOperation.replace(
					new Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
					params.newText
				);
			});

			// 应用编辑并更新 diff
			await session.applyEdits(edits);

			const pendingCount = session.getPendingCount();
			return {
				success: true,
				content: `替换成功: 共替换 ${locations.length} 处，位于第 ${locations.map(l => l.startLine).join(', ')} 行。\n` +
					`[Diff 模式] 变更已显示在编辑器中，等待确认。当前有 ${pendingCount} 个待处理的变更块。`
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: `替换失败: ${errorMessage}`
			};
		}
	}

	/**
	 * 使用 diff session 执行插入操作
	 */
	private async dispatchInsertWithDiff(params: InsertInFileParams, workspaceService: IWorkspaceFoldersProvider): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, workspaceService);

			// 获取或创建 diff session
			let session = this.diffSessionService.getSession(uri);
			if (!session) {
				session = await this.diffSessionService.createSession(uri);
			}

			const content = session.modifiedModel.getValue();
			const totalLines = countLines(content);

			// 验证行号
			if (params.line < 0) {
				return {
					success: false,
					content: '',
					error: '行号不能为负数'
				};
			}

			if (params.line > totalLines) {
				return {
					success: false,
					content: '',
					error: `行号 ${params.line} 超出文件范围（文件共 ${totalLines} 行）`
				};
			}

			// 构建编辑操作
			let edit;
			if (params.line <= 0) {
				// 在文件开头插入
				edit = EditOperation.insert(new Position(1, 1), params.content + '\n');
			} else if (params.line >= totalLines) {
				// 在文件末尾插入
				const lastLine = session.modifiedModel.getLineCount();
				const lastColumn = session.modifiedModel.getLineMaxColumn(lastLine);
				edit = EditOperation.insert(new Position(lastLine, lastColumn), '\n' + params.content);
			} else {
				// 在指定行后插入
				const lineContent = session.modifiedModel.getLineContent(params.line);
				edit = EditOperation.insert(
					new Position(params.line, lineContent.length + 1),
					'\n' + params.content
				);
			}

			// 应用编辑并更新 diff
			await session.applyEdits([edit]);

			const newLineCount = session.modifiedModel.getLineCount();
			const pendingCount = session.getPendingCount();

			return {
				success: true,
				content: `插入成功: 内容已插入到第 ${params.line + 1} 行，文件现有 ${newLineCount} 行。\n` +
					`[Diff 模式] 变更已显示在编辑器中，等待确认。当前有 ${pendingCount} 个待处理的变更块。`
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: `插入失败: ${errorMessage}`
			};
		}
	}

	/**
	 * 使用 diff session 执行删除操作
	 */
	private async dispatchDeleteWithDiff(params: DeleteLinesParams, workspaceService: IWorkspaceFoldersProvider): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, workspaceService);

			// 获取或创建 diff session
			let session = this.diffSessionService.getSession(uri);
			if (!session) {
				session = await this.diffSessionService.createSession(uri);
			}

			const totalLines = session.modifiedModel.getLineCount();

			// 验证行号
			if (params.startLine < 1 || params.startLine > totalLines) {
				return {
					success: false,
					content: '',
					error: `起始行号 ${params.startLine} 超出范围（文件共 ${totalLines} 行）`
				};
			}

			if (params.endLine < params.startLine) {
				return {
					success: false,
					content: '',
					error: `结束行号 ${params.endLine} 不能小于起始行号 ${params.startLine}`
				};
			}

			// 构建删除范围
			const actualEndLine = Math.min(params.endLine, totalLines);
			const endColumn = session.modifiedModel.getLineMaxColumn(actualEndLine);

			// 如果删除到文件末尾，需要包含前一行的换行符
			let range: Range;
			if (params.startLine === 1) {
				// 从第一行开始删除
				if (actualEndLine < totalLines) {
					range = new Range(1, 1, actualEndLine + 1, 1);
				} else {
					range = new Range(1, 1, actualEndLine, endColumn);
				}
			} else {
				// 从中间开始删除，包含前一行的换行符
				const prevLineEndColumn = session.modifiedModel.getLineMaxColumn(params.startLine - 1);
				if (actualEndLine < totalLines) {
					range = new Range(params.startLine - 1, prevLineEndColumn, actualEndLine, endColumn);
				} else {
					range = new Range(params.startLine - 1, prevLineEndColumn, actualEndLine, endColumn);
				}
			}

			const edit = EditOperation.delete(range);

			// 应用编辑并更新 diff
			await session.applyEdits([edit]);

			const deletedLineCount = actualEndLine - params.startLine + 1;
			const newLineCount = session.modifiedModel.getLineCount();
			const pendingCount = session.getPendingCount();

			return {
				success: true,
				content: `删除成功: 已删除 ${deletedLineCount} 行（第 ${params.startLine}-${actualEndLine} 行），文件现有 ${newLineCount} 行。\n` +
					`[Diff 模式] 变更已显示在编辑器中，等待确认。当前有 ${pendingCount} 个待处理的变更块。`
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: `删除失败: ${errorMessage}`
			};
		}
	}

	/**
	 * 使用 diff session 执行创建文件操作
	 */
	private async dispatchCreateWithDiff(params: CreateFileParams, workspaceService: IWorkspaceFoldersProvider): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, workspaceService);

			// 检查文件是否已存在
			try {
				await this.fileService.stat(uri);
				// 文件已存在，不使用 diff 模式，直接返回错误
				return {
					success: false,
					content: '',
					error: `文件已存在: ${params.path}。如需覆盖，请先删除或使用 replaceInFile。`
				};
			} catch {
				// 文件不存在，继续创建
			}

			// 创建空文件
			const content = params.content ?? '';
			await this.fileService.writeFile(uri, VSBuffer.fromString(''));

			// 创建 diff session
			const session = await this.diffSessionService.createSession(uri);

			// 监听 session 结束事件，如果用户撤销，则删除文件
			const disposable = session.onDidEnd(async (e) => {
				disposable.dispose();
				if (!e.accepted) {
					// 用户撤销，删除文件
					try {
						await this.fileService.del(uri);
					} catch {
						// 忽略删除失败
					}
				}
			});

			// 应用内容作为编辑
			const lines = content.split('\n');
			const edit = EditOperation.insert(new Position(1, 1), content);
			await session.applyEdits([edit]);

			const pendingCount = session.getPendingCount();
			return {
				success: true,
				content: `文件创建成功: ${params.path}，共 ${lines.length} 行。\n` +
					`[Diff 模式] 新文件内容已显示在编辑器中，等待确认。当前有 ${pendingCount} 个待处理的变更块。\n` +
					`提示: 如果撤销此变更，文件将被删除。`
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: `创建文件失败: ${errorMessage}`
			};
		}
	}

	/**
	 * 根据行号和列号计算字符偏移量
	 */
	private getOffsetFromLineColumn(content: string, line: number, column: number): number {
		const lines = content.split('\n');
		let offset = 0;
		for (let i = 0; i < line - 1 && i < lines.length; i++) {
			offset += lines[i].length + 1; // +1 for newline
		}
		return offset + column - 1;
	}

	/**
	 * 使用 diff session 执行全文编辑操作
	 */
	private async dispatchEditWithDiff(params: EditFileParams, workspaceService: IWorkspaceFoldersProvider): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, workspaceService);
			const newContent = params.content;

			// 检查文件是否存在
			let fileExists = true;
			try {
				await this.fileService.stat(uri);
			} catch {
				fileExists = false;
			}

			if (!fileExists) {
				// 文件不存在，创建新文件并使用 diff 模式
				await this.fileService.writeFile(uri, VSBuffer.fromString(''));

				// 创建 diff session
				const session = await this.diffSessionService.createSession(uri);

				// 监听 session 结束事件，如果用户撤销，则删除文件
				const disposable = session.onDidEnd(async (e) => {
					disposable.dispose();
					if (!e.accepted) {
						try {
							await this.fileService.del(uri);
						} catch {
							// 忽略删除失败
						}
					}
				});

				// 应用内容
				const edit = EditOperation.insert(new Position(1, 1), newContent);
				await session.applyEdits([edit]);

				const pendingCount = session.getPendingCount();
				const lineCount = countLines(newContent);
				return {
					success: true,
					content: `文件创建成功: ${params.path}，共 ${lineCount} 行。\n` +
						`[Diff 模式] 新文件内容已显示在编辑器中，等待确认。当前有 ${pendingCount} 个待处理的变更块。`
				};
			}

			// 文件存在，获取或创建 diff session
			let session = this.diffSessionService.getSession(uri);
			if (!session) {
				session = await this.diffSessionService.createSession(uri);
			}

			// 获取当前内容
			const currentContent = session.modifiedModel.getValue();
			const originalLineCount = countLines(currentContent);

			// 全文替换
			const fullRange = new Range(
				1, 1,
				session.modifiedModel.getLineCount(),
				session.modifiedModel.getLineMaxColumn(session.modifiedModel.getLineCount())
			);
			const edit = EditOperation.replace(fullRange, newContent);
			await session.applyEdits([edit]);

			const pendingCount = session.getPendingCount();
			const newLineCount = countLines(newContent);

			return {
				success: true,
				content: `文件编辑成功: ${params.path}\n` +
					`原文件: ${originalLineCount} 行 → 新文件: ${newLineCount} 行\n` +
					`[Diff 模式] 变更已显示在编辑器中，等待确认。当前有 ${pendingCount} 个待处理的变更块。`
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: '',
				error: `编辑文件失败: ${errorMessage}`
			};
		}
	}
}
