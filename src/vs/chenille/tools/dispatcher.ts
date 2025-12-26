/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ToolCall } from '../common/types.js';

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
 * 工具名称到内部工具 ID 的映射
 * 左边是 definitions.ts 中定义的简洁名称
 * 右边是 VS Code 内部注册的工具 ID
 */
const TOOL_NAME_TO_ID: Record<string, string> = {
	// 文件操作
	'editFile': 'vscode_editFile_internal',

	// 终端工具
	'runInTerminal': 'runInTerminal',
	'getTerminalOutput': 'get_terminal_output',
	'getTerminalSelection': 'terminal_selection',
	'getTerminalLastCommand': 'terminal_last_command',

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
	return TOOL_NAME_TO_ID[toolName];
}

/**
 * 获取所有工具映射
 */
export function getAllToolMappings(): Record<string, string> {
	return { ...TOOL_NAME_TO_ID };
}

// ==================== 工具调度器实现 ====================

import { ILanguageModelToolsService, IToolInvocation } from '../../workbench/contrib/chat/common/languageModelToolsService.js';

export class ChenilleToolDispatcher extends Disposable implements IChenilleToolDispatcher {
	readonly _serviceBrand: undefined;

	constructor(
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService
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

		// 获取内部工具 ID
		const internalToolId = getInternalToolId(toolName);
		if (!internalToolId) {
			return {
				success: false,
				content: '',
				error: `未知工具: ${toolName}. 可用工具: ${Object.keys(TOOL_NAME_TO_ID).join(', ')}`
			};
		}

		// 检查工具是否已注册
		const tools = this.toolsService.getTools();
		const toolData = [...tools].find(t => t.id === internalToolId);

		if (!toolData) {
			return {
				success: false,
				content: '',
				error: `工具未注册: ${internalToolId}. 在这种情况下，该工具可能不可用.`
			};
		}

		// 解析参数
		const parameters = parseToolArguments(toolCall);

		console.log(`[ChenilleToolDispatcher] Invoking tool: ${toolName} (${internalToolId})`, parameters);

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
				token
			);

			// 提取结果内容
			const content = result.content
				.map(part => {
					if (part.kind === 'text') {
						return part.value;
					} else if (part.kind === 'data') {
						return `[二进制数据: ${part.value.mimeType}]`;
					}
					return JSON.stringify(part);
				})
				.join('\n');

			console.log(`[ChenilleToolDispatcher] 工具 ${toolName} 已成功完成`);

			return {
				success: true,
				content
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[ChenilleToolDispatcher] 工具执行失败: ${toolName}`, error);

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
		const tools = this.toolsService.getTools();
		return [...tools].map(t => t.id);
	}

	/**
	 * 检查工具是否可用
	 */
	isToolAvailable(toolName: string): boolean {
		const internalToolId = getInternalToolId(toolName);
		if (!internalToolId) {
			return false;
		}

		const tools = this.toolsService.getTools();
		return [...tools].some(t => t.id === internalToolId);
	}
}
