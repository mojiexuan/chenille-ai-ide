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
	return [...CHENILLE_FILE_TOOL_NAMES, ...CHENILLE_NETWORK_TOOL_NAMES, ...Object.keys(VSCODE_TOOL_ID_MAP)];
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

/** 工具执行超时时间（毫秒） */
const TOOL_TIMEOUT = 30000;

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
			// 检查是否为 Chenille 文件工具
			else if (isChenilleFileTool(toolName)) {
				result = await withTimeout(
					this.dispatchFileTools(toolName, toolCall),
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
	 * 调度 Chenille 文件工具
	 */
	private async dispatchFileTools(toolName: string, toolCall: ToolCall): Promise<IToolResult> {
		try {
			let result: FileToolResult<unknown>;

			switch (toolName) {
				case 'readFile': {
					const parsed = parseToolArguments<ReadFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await readFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'getFileInfo': {
					const parsed = parseToolArguments<GetFileInfoParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await getFileInfo(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'checkFileExists': {
					const parsed = parseToolArguments<CheckFileExistsParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await checkFileExists(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'listDirectory': {
					const parsed = parseToolArguments<ListDirectoryParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await listDirectory(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'findFiles': {
					const parsed = parseToolArguments<FindFilesParams>(toolCall, ['pattern']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await findFiles(parsed.data, this.fileService, this.workspaceService, this.searchService);
					break;
				}

				case 'searchInFile': {
					const parsed = parseToolArguments<SearchInFileParams>(toolCall, ['path', 'query']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await searchInFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'searchInFiles': {
					const parsed = parseToolArguments<SearchInFilesParams>(toolCall, ['query']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await searchInFiles(parsed.data, this.fileService, this.workspaceService, this.searchService);
					break;
				}

				case 'replaceInFile': {
					const parsed = parseToolArguments<ReplaceInFileParams>(toolCall, ['path', 'oldText', 'newText']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchReplaceWithDiff(parsed.data);
					}
					result = await replaceInFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'insertInFile': {
					const parsed = parseToolArguments<InsertInFileParams>(toolCall, ['path', 'line', 'content']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchInsertWithDiff(parsed.data);
					}
					result = await insertInFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'deleteLines': {
					const parsed = parseToolArguments<DeleteLinesParams>(toolCall, ['path', 'startLine', 'endLine']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchDeleteWithDiff(parsed.data);
					}
					result = await deleteLines(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'createFile': {
					const parsed = parseToolArguments<CreateFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled && parsed.data.content) {
						return await this.dispatchCreateWithDiff(parsed.data);
					}
					result = await createFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'deleteFile': {
					const parsed = parseToolArguments<DeleteFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 删除文件前，先清理对应的 diff session
					const deleteUri = resolveFilePath(parsed.data.path, this.workspaceService);
					const existingSession = this.diffSessionService.getSession(deleteUri);
					if (existingSession) {
						this.diffSessionService.endSession(deleteUri);
					}
					result = await deleteFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'renameFile': {
					const parsed = parseToolArguments<RenameFileParams>(toolCall, ['oldPath', 'newPath']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 重命名文件前，先清理旧路径的 diff session
					const oldUri = resolveFilePath(parsed.data.oldPath, this.workspaceService);
					const oldSession = this.diffSessionService.getSession(oldUri);
					if (oldSession) {
						this.diffSessionService.endSession(oldUri);
					}
					result = await renameFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'getOpenEditors': {
					const parsed = parseToolArguments<GetOpenEditorsParams>(toolCall);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await getOpenEditors(parsed.data, this.editorService, this.workspaceService);
					break;
				}

				case 'editFile': {
					const parsed = parseToolArguments<EditFileParams>(toolCall, ['path', 'content']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					// 如果启用 diff 模式，使用 diff session
					if (this.diffModeEnabled) {
						return await this.dispatchEditWithDiff(parsed.data);
					}
					result = await editFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'notebookEdit': {
					const parsed = parseToolArguments<Record<string, unknown>>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}

					const uri = resolveFilePath(String(parsed.data.path ?? ''), this.workspaceService);
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
					const resource = rawPath ? resolveFilePath(rawPath, this.workspaceService) : undefined;
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
		return [...CHENILLE_FILE_TOOL_NAMES, ...CHENILLE_NETWORK_TOOL_NAMES, ...vsCodeTools];
	}

	/**
	 * 检查工具是否可用
	 */
	isToolAvailable(toolName: string): boolean {
		// Chenille 文件工具与自建网络工具始终可用
		if (isChenilleFileTool(toolName) || isNetworkTool(toolName)) {
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
	private async dispatchReplaceWithDiff(params: ReplaceInFileParams): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, this.workspaceService);
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
	private async dispatchInsertWithDiff(params: InsertInFileParams): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, this.workspaceService);

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
	private async dispatchDeleteWithDiff(params: DeleteLinesParams): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, this.workspaceService);

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
	private async dispatchCreateWithDiff(params: CreateFileParams): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, this.workspaceService);

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
	private async dispatchEditWithDiff(params: EditFileParams): Promise<IToolResult> {
		try {
			const uri = resolveFilePath(params.path, this.workspaceService);
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
