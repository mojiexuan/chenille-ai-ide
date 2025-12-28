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
	GetOpenEditorsParams
} from './fileTools/index.js';
import { IEditorService } from '../../workbench/services/editor/common/editorService.js';

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
	 * 执行单个工具调用
	 */
	dispatch(toolCall: ToolCall, token?: CancellationToken): Promise<IToolResult>;

	/**
	 * 批量执行工具调用
	 */
	dispatchAll(toolCalls: ToolCall[], token?: CancellationToken): Promise<IToolResult[]>;
}

/**
 * Chenille 自实现的文件工具列表
 */
const CHENILLE_FILE_TOOLS = new Set([
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
	'getOpenEditors'
]);

/**
 * VS Code 内部工具 ID 映射
 * 这些工具通过 ILanguageModelToolsService 调用
 */
const VSCODE_TOOL_ID_MAP: Record<string, string> = {
	// 文件操作（VS Code 内置）
	'editFile': 'vscode_editFile_internal',

	// 终端工具
	'runInTerminal': 'run_in_terminal',
	'getTerminalOutput': 'get_terminal_output',
	'getTerminalSelection': 'terminal_selection',
	'getTerminalLastCommand': 'terminal_last_command',
	'confirmTerminalCommand': 'vscode_get_terminal_confirmation',

	// 任务工具
	'runTask': 'run_task',
	'getTaskOutput': 'get_task_output',
	'createAndRunTask': 'create_and_run_task',

	// 测试工具
	'runTests': 'runTests',

	// 扩展工具
	'searchExtensions': 'vscode_searchExtensions_internal',
	'installExtensions': 'vscode_installExtensions',

	// 网页抓取
	'fetchWebPage': 'vscode_fetchWebPage_internal',

	// 待办事项
	'manageTodoList': 'manage_todo_list',

	// 确认工具
	'getConfirmation': 'vscode_get_confirmation',

	// 子代理
	'runSubagent': 'runSubagent',
};

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

/**
 * 获取内部工具 ID
 */
export function getInternalToolId(toolName: string): string | undefined {
	return VSCODE_TOOL_ID_MAP[toolName];
}

/**
 * 检查是否为 Chenille 自实现的文件工具
 */
export function isChenilleFileTool(toolName: string): boolean {
	return CHENILLE_FILE_TOOLS.has(toolName);
}

/**
 * 获取所有工具名称
 */
export function getAllToolNames(): string[] {
	return [...CHENILLE_FILE_TOOLS, ...Object.keys(VSCODE_TOOL_ID_MAP)];
}

// ==================== 工具调度器实现 ====================

import { ILanguageModelToolsService, IToolInvocation } from '../../workbench/contrib/chat/common/languageModelToolsService.js';

export class ChenilleToolDispatcher extends Disposable implements IChenilleToolDispatcher {
	readonly _serviceBrand: undefined;

	private _toolsService: ILanguageModelToolsService | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@ISearchService private readonly searchService: ISearchService,
		@IEditorService private readonly editorService: IEditorService
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
	 * 执行单个工具调用
	 */
	async dispatch(toolCall: ToolCall, token: CancellationToken = CancellationToken.None): Promise<IToolResult> {
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

			// 检查是否为 Chenille 文件工具
			if (isChenilleFileTool(toolName)) {
				result = await withTimeout(
					this.dispatchFileTools(toolName, toolCall),
					TOOL_TIMEOUT,
					toolName
				);
			} else {
				// 否则调用 VS Code 内部工具
				result = await withTimeout(
					this.dispatchVSCodeTool(toolName, toolCall, token),
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
					result = await replaceInFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'insertInFile': {
					const parsed = parseToolArguments<InsertInFileParams>(toolCall, ['path', 'line', 'content']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await insertInFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'deleteLines': {
					const parsed = parseToolArguments<DeleteLinesParams>(toolCall, ['path', 'startLine', 'endLine']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await deleteLines(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'createFile': {
					const parsed = parseToolArguments<CreateFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await createFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'deleteFile': {
					const parsed = parseToolArguments<DeleteFileParams>(toolCall, ['path']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
					}
					result = await deleteFile(parsed.data, this.fileService, this.workspaceService);
					break;
				}

				case 'renameFile': {
					const parsed = parseToolArguments<RenameFileParams>(toolCall, ['oldPath', 'newPath']);
					if (!parsed.success) {
						return { success: false, content: '', error: parsed.error };
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

				default:
					return {
						success: false,
						content: '',
						error: `未知的文件工具: ${toolName}。可用工具: ${[...CHENILLE_FILE_TOOLS].join(', ')}`
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
	 * 调度 VS Code 内部工具
	 */
	private async dispatchVSCodeTool(
		toolName: string,
		toolCall: ToolCall,
		token: CancellationToken
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
		const tools = this.toolsService.getTools();
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
			// 构建调用上下文
			const invocation: IToolInvocation = {
				callId: `chenille-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
				toolId: internalToolId,
				parameters,
				tokenBudget: undefined,
				context: undefined,
				chatRequestId: undefined,
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
	async dispatchAll(toolCalls: ToolCall[], token: CancellationToken = CancellationToken.None): Promise<IToolResult[]> {
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

			const result = await this.dispatch(toolCall, token);
			results.push(result);
		}

		return results;
	}

	/**
	 * 列出所有可用的工具
	 */
	listAvailableTools(): string[] {
		const vsCodeTools = [...this.toolsService.getTools()].map(t => t.id);
		return [...CHENILLE_FILE_TOOLS, ...vsCodeTools];
	}

	/**
	 * 检查工具是否可用
	 */
	isToolAvailable(toolName: string): boolean {
		// Chenille 文件工具始终可用
		if (isChenilleFileTool(toolName)) {
			return true;
		}

		// 检查 VS Code 工具
		const internalToolId = getInternalToolId(toolName);
		if (!internalToolId) {
			return false;
		}

		const tools = this.toolsService.getTools();
		return [...tools].some(t => t.id === internalToolId);
	}
}
