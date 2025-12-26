/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../base/common/lifecycle.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
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
	FileToolResult
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
 * 解析工具调用参数
 */
function parseToolArguments(toolCall: ToolCall): Record<string, unknown> {
	const argsString = toolCall.function.arguments;
	if (!argsString) {
		return {};
	}

	try {
		return JSON.parse(argsString);
	} catch {
		console.error('[ChenilleToolDispatcher] 解析工具参数失败:', argsString);
		return {};
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

	constructor(
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@ISearchService private readonly searchService: ISearchService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();
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

		// 解析参数
		const parameters = parseToolArguments(toolCall);

		console.log(`[ChenilleToolDispatcher] 调用工具: ${toolName}`, parameters);

		// 检查是否为 Chenille 文件工具
		if (isChenilleFileTool(toolName)) {
			return this.dispatchFileTools(toolName, parameters);
		}

		// 否则调用 VS Code 内部工具
		return this.dispatchVSCodeTool(toolName, parameters, token);
	}

	/**
	 * 调度 Chenille 文件工具
	 */
	private async dispatchFileTools(toolName: string, params: Record<string, unknown>): Promise<IToolResult> {
		try {
			let result: FileToolResult<unknown>;

			switch (toolName) {
				case 'readFile':
					result = await readFile(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'getFileInfo':
					result = await getFileInfo(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'checkFileExists':
					result = await checkFileExists(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'listDirectory':
					result = await listDirectory(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'findFiles':
					result = await findFiles(
						params as any,
						this.fileService,
						this.workspaceService,
						this.searchService
					);
					break;

				case 'searchInFile':
					result = await searchInFile(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'searchInFiles':
					result = await searchInFiles(
						params as any,
						this.fileService,
						this.workspaceService,
						this.searchService
					);
					break;

				case 'replaceInFile':
					result = await replaceInFile(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'insertInFile':
					result = await insertInFile(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'deleteLines':
					result = await deleteLines(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'createFile':
					result = await createFile(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'deleteFile':
					result = await deleteFile(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'renameFile':
					result = await renameFile(
						params as any,
						this.fileService,
						this.workspaceService
					);
					break;

				case 'getOpenEditors':
					result = await getOpenEditors(
						params as any,
						this.editorService,
						this.workspaceService
					);
					break;

				default:
					return {
						success: false,
						content: '',
						error: `未知的文件工具: ${toolName}`
					};
			}

			// 转换结果
			if (result.success) {
				return {
					success: true,
					content: JSON.stringify(result.data, null, 2)
				};
			} else {
				return {
					success: false,
					content: result.data ? JSON.stringify(result.data, null, 2) : '',
					error: result.error
				};
			}

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[ChenilleToolDispatcher] 文件工具执行失败: ${toolName}`, error);

			return {
				success: false,
				content: '',
				error: errorMessage
			};
		}
	}

	/**
	 * 调度 VS Code 内部工具
	 */
	private async dispatchVSCodeTool(
		toolName: string,
		parameters: Record<string, unknown>,
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

			// 调用工具（注意：可能需要根据实际 API 调整参数）
			const result = await this.toolsService.invokeTool(
				invocation,
				async () => 0, // countTokens callback
				token
			);

			// 提取结果内容
			const content = result.content
				.map((part: any) => {
					if (part.kind === 'text') {
						return part.value;
					} else if (part.kind === 'data') {
						return `[二进制数据: ${part.value.mimeType}]`;
					}
					return JSON.stringify(part);
				})
				.join('\n');

			console.log(`[ChenilleToolDispatcher] 工具 ${toolName} 执行成功`);

			return {
				success: true,
				content
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[ChenilleToolDispatcher] VS Code 工具执行失败: ${toolName}`, error);

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
