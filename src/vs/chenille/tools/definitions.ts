/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AiTool, AiFunctionDefinitionParameter, AiFunctionDefinitionParameterProperty } from '../common/types.js';

/**
 * Chenille 工具定义
 *
 * 工具分为两类：
 * 1. Chenille 文件工具 - Chenille 自己实现的文件操作工具
 * 2. VS Code 内置工具 - 直接使用 VS Code 的工具服务
 *
 * VS Code 内置工具来源：
 * - src/vs/workbench/contrib/chat/common/tools/ (核心工具)
 * - src/vs/workbench/contrib/terminalContrib/chatAgentTools/ (终端工具)
 * - src/vs/workbench/contrib/testing/common/testingChatAgentTool.ts (测试工具)
 * - src/vs/workbench/contrib/extensions/ (扩展工具)
 * - src/vs/workbench/contrib/chat/electron-browser/tools/ (网页抓取)
 */

// ==================== Chenille 文件工具（自己实现）====================

/**
 * Chenille 自己实现的文件工具
 * 这些工具由 Chenille 的 dispatcher 执行
 */
export const CHENILLE_FILE_TOOLS: AiTool[] = [
	// 文件读取
	{
		type: 'function',
		function: {
			name: 'readFile',
			description: `读取文件内容，支持按行号范围读取。
⚠️ 限制：默认最多返回 500 行，超过 100KB 必须指定行范围。
返回：content、totalLines、readRange [start, end]`,
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' },
					startLine: { type: 'number', description: '起始行号（1-based）' },
					endLine: { type: 'number', description: '结束行号，-1 表示自动限制' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getFileInfo',
			description: '获取文件元信息：是否存在、大小、行数、编码、修改时间等。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'checkFileExists',
			description: '检查文件或目录是否存在，返回类型（file/directory/none）。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '路径' }
				},
				required: ['path']
			}
		}
	},

	// 目录操作
	{
		type: 'function',
		function: {
			name: 'listDirectory',
			description: '列出目录内容，支持递归和 glob 过滤。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '目录路径' },
					recursive: { type: 'boolean', description: '是否递归' },
					maxDepth: { type: 'number', description: '最大深度' },
					pattern: { type: 'string', description: 'glob 过滤' },
					includeHidden: { type: 'boolean', description: '包含隐藏文件' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'findFiles',
			description: '按 glob 模式搜索文件。如 "**/*.ts"',
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'glob 模式' },
					excludePattern: { type: 'string', description: '排除模式' },
					maxResults: { type: 'number', description: '最大结果数' },
					cwd: { type: 'string', description: '搜索根目录' }
				},
				required: ['pattern']
			}
		}
	},

	// 搜索
	{
		type: 'function',
		function: {
			name: 'searchInFile',
			description: '在单个文件中搜索文本，返回行号和上下文。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' },
					query: { type: 'string', description: '搜索文本或正则' },
					isRegex: { type: 'boolean', description: '是否正则' },
					caseSensitive: { type: 'boolean', description: '区分大小写' },
					contextLines: { type: 'number', description: '上下文行数' }
				},
				required: ['path', 'query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'searchInFiles',
			description: '在多个文件中搜索文本（类似 grep）。',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: '搜索文本或正则' },
					filePattern: { type: 'string', description: '文件过滤，如 "*.ts"' },
					path: { type: 'string', description: '搜索目录' },
					isRegex: { type: 'boolean', description: '是否正则' },
					caseSensitive: { type: 'boolean', description: '区分大小写' },
					maxResults: { type: 'number', description: '最大结果数' }
				},
				required: ['query']
			}
		}
	},

	// 文件修改（精细操作）
	{
		type: 'function',
		function: {
			name: 'replaceInFile',
			description: `【推荐】精确替换文件中的文本。oldText 必须完全匹配，默认只替换唯一匹配。`,
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' },
					oldText: { type: 'string', description: '要替换的原文本（必须精确匹配）' },
					newText: { type: 'string', description: '替换后的新文本' },
					expectedOccurrences: { type: 'number', description: '期望匹配次数，默认 1' }
				},
				required: ['path', 'oldText', 'newText']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'insertInFile',
			description: '在指定行后插入内容。line=0 表示文件开头。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' },
					line: { type: 'number', description: '在此行之后插入' },
					content: { type: 'string', description: '要插入的内容' }
				},
				required: ['path', 'line', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'deleteLines',
			description: '删除指定行范围的内容。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' },
					startLine: { type: 'number', description: '起始行号' },
					endLine: { type: 'number', description: '结束行号' }
				},
				required: ['path', 'startLine', 'endLine']
			}
		}
	},

	// 文件管理
	{
		type: 'function',
		function: {
			name: 'createFile',
			description: '创建新文件。已存在时默认失败。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' },
					content: { type: 'string', description: '初始内容' },
					overwrite: { type: 'boolean', description: '是否覆盖' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'deleteFile',
			description: '删除文件。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'renameFile',
			description: '重命名或移动文件。',
			parameters: {
				type: 'object',
				properties: {
					oldPath: { type: 'string', description: '原路径' },
					newPath: { type: 'string', description: '新路径' },
					overwrite: { type: 'boolean', description: '是否覆盖' }
				},
				required: ['oldPath', 'newPath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getOpenEditors',
			description: '获取当前打开的编辑器列表。',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'editFile',
			description: '全文覆盖编辑文件。如果文件不存在则创建。适用于需要完全重写文件内容的场景。对于局部修改，优先使用 replaceInFile/insertInFile。',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: '文件路径' },
					content: { type: 'string', description: '新的文件内容（完整内容）' },
					explanation: { type: 'string', description: '修改说明（可选）' }
				},
				required: ['path', 'content']
			}
		}
	}
];

// ==================== VS Code 内置工具映射 ====================

/**
 * VS Code 内置工具定义
 * 这些工具由 VS Code 的 ILanguageModelToolsService 提供
 */
export interface VSCodeToolDefinition {
	/** Chenille 使用的工具名称 */
	chenilleName: string;
	/** VS Code 内部工具 ID */
	vsCodeToolId: string;
	/** 工具描述（发送给 AI） */
	description: string;
	/** 参数定义 - 使用 AiFunctionDefinitionParameter 类型 */
	parameters: AiFunctionDefinitionParameter;
}

/**
 * VS Code 内置工具列表
 */
export const VSCODE_TOOL_DEFINITIONS: VSCodeToolDefinition[] = [
	// 终端工具
	{
		chenilleName: 'runInTerminal',
		vsCodeToolId: 'run_in_terminal',
		description: '在终端中执行命令。返回终端 ID，可用于 getTerminalOutput。',
		parameters: {
			type: 'object',
			properties: {
				command: { type: 'string', description: '要执行的命令' },
				explanation: { type: 'string', description: '命令说明' },
				isBackground: { type: 'boolean', description: '是否后台运行' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['command', 'explanation', 'isBackground']
		}
	},
	{
		chenilleName: 'getTerminalOutput',
		vsCodeToolId: 'get_terminal_output',
		description: '获取终端命令的输出。需要提供 runInTerminal 返回的终端 ID。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '终端 ID（从 runInTerminal 返回值获取）' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['id']
		}
	},
	{
		chenilleName: 'getTerminalSelection',
		vsCodeToolId: 'terminal_selection',
		description: '获取终端中选中的文本。需要用户在终端中选中文本。',
		parameters: { type: 'object', properties: {} as AiFunctionDefinitionParameterProperty, required: [] }
	},
	{
		chenilleName: 'getTerminalLastCommand',
		vsCodeToolId: 'terminal_last_command',
		description: '获取终端最后执行的命令及输出。需要终端保持活动状态。',
		parameters: { type: 'object', properties: {} as AiFunctionDefinitionParameterProperty, required: [] }
	},

	// 任务工具（需要 VS Code 任务系统支持）
	{
		chenilleName: 'runTask',
		vsCodeToolId: 'run_task',
		description: '运行 tasks.json 中定义的任务。⚠️ 需要工作区配置了任务。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '任务 ID' },
				workspaceFolder: { type: 'string', description: '工作区路径' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['id', 'workspaceFolder']
		}
	},
	{
		chenilleName: 'getTaskOutput',
		vsCodeToolId: 'get_task_output',
		description: '获取任务的输出。⚠️ 需要先运行任务。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '任务 ID' },
				workspaceFolder: { type: 'string', description: '工作区路径' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['id', 'workspaceFolder']
		}
	},
	{
		chenilleName: 'createAndRunTask',
		vsCodeToolId: 'create_and_run_task',
		description: '创建并运行临时任务。⚠️ 需要 VS Code 任务系统支持。',
		parameters: {
			type: 'object',
			properties: {
				workspaceFolder: { type: 'string', description: '工作区路径' },
				task: { type: 'object', description: '任务配置对象' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['workspaceFolder', 'task']
		}
	},

	// 测试工具（需要测试扩展支持）
	{
		chenilleName: 'runTests',
		vsCodeToolId: 'runTests',
		description: '运行单元测试。⚠️ 需要安装测试扩展（如 Test Explorer）。',
		parameters: {
			type: 'object',
			properties: {
				files: { type: 'array', items: { type: 'string' }, description: '测试文件路径' },
				testNames: { type: 'array', items: { type: 'string' }, description: '测试名称' },
				mode: { type: 'string', enum: ['run', 'coverage'], description: '执行模式' },
				coverageFiles: { type: 'array', items: { type: 'string' }, description: '覆盖率文件' }
			} as AiFunctionDefinitionParameterProperty,
			required: []
		}
	},

	// 扩展工具
	{
		chenilleName: 'searchExtensions',
		vsCodeToolId: 'vscode_searchExtensions_internal',
		description: '在扩展市场搜索扩展。',
		parameters: {
			type: 'object',
			properties: {
				category: { type: 'string', description: '扩展类别' },
				keywords: { type: 'array', items: { type: 'string' }, description: '搜索关键词' },
				ids: { type: 'array', items: { type: 'string' }, description: '扩展 ID' }
			} as AiFunctionDefinitionParameterProperty,
			required: []
		}
	},
	{
		chenilleName: 'installExtensions',
		vsCodeToolId: 'vscode_installExtensions',
		description: '安装扩展。⚠️ 需要扩展市场可用。',
		parameters: {
			type: 'object',
			properties: {
				ids: { type: 'array', items: { type: 'string' }, description: '扩展 ID 列表' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['ids']
		}
	},

	// 网页抓取
	{
		chenilleName: 'fetchWebPage',
		vsCodeToolId: 'vscode_fetchWebPage_internal',
		description: '获取网页内容。支持 HTTP/HTTPS 和本地文件。',
		parameters: {
			type: 'object',
			properties: {
				urls: { type: 'array', items: { type: 'string' }, description: 'URL 列表' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['urls']
		}
	},

	// 待办事项
	{
		chenilleName: 'manageTodoList',
		vsCodeToolId: 'manage_todo_list',
		description: '管理待办事项列表。operation: write/read',
		parameters: {
			type: 'object',
			properties: {
				operation: { type: 'string', enum: ['write', 'read'], description: '操作类型' },
				todoList: {
					type: 'array',
					description: '待办列表',
					items: {
						type: 'object',
						properties: {
							id: { type: 'number' },
							title: { type: 'string' },
							description: { type: 'string' },
							status: { type: 'string', enum: ['not-started', 'in-progress', 'completed'] }
						},
						required: ['id', 'title', 'status']
					}
				}
			} as AiFunctionDefinitionParameterProperty,
			required: ['operation']
		}
	},

	// 子代理
	{
		chenilleName: 'runSubagent',
		vsCodeToolId: 'runSubagent',
		description: '启动子代理处理复杂任务。',
		parameters: {
			type: 'object',
			properties: {
				prompt: { type: 'string', description: '任务描述' },
				description: { type: 'string', description: '简短描述（3-5词）' },
				agentName: { type: 'string', description: '指定代理名称' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['prompt', 'description']
		}
	},

	// 交互式终端补充
	{
		chenilleName: 'sendToTerminal',
		vsCodeToolId: 'send_to_terminal',
		description: '向正在运行的终端执行发送输入。需要 runInTerminal 返回的终端 ID。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '终端执行 ID（从 runInTerminal 返回值获取）' },
				command: { type: 'string', description: '发送给终端的文本，自动追加回车；空字符串表示仅发送回车' },
				waitForOutput: { type: 'boolean', description: '是否等待终端输出稳定后再返回' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['id', 'command']
		}
	},
	{
		chenilleName: 'killTerminal',
		vsCodeToolId: 'kill_terminal',
		description: '关闭不再需要的终端。需要 runInTerminal 返回的终端 ID。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '终端执行 ID（从 runInTerminal 返回值获取）' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['id']
		}
	},

	// 测试失败详情
	{
		chenilleName: 'getTestFailures',
		vsCodeToolId: 'testFailure',
		description: '获取最近一次测试运行的失败详情。没有失败信息时先调用 runTests。',
		parameters: { type: 'object', properties: {} as AiFunctionDefinitionParameterProperty, required: [] }
	},

	// 向用户提问
	{
		chenilleName: 'askQuestions',
		vsCodeToolId: 'vscode_askQuestions',
		description: '在继续执行前向用户提出澄清问题，支持单选、多选与自由输入。',
		parameters: {
			type: 'object',
			properties: {
				questions: {
					type: 'array',
					description: '要询问用户的问题列表',
					items: {
						type: 'object',
						properties: {
							header: { type: 'string', description: '问题的简短标识，需唯一' },
							question: { type: 'string', description: '展示给用户的问题文本' },
							message: { type: 'string', description: '可选的补充说明（Markdown）' },
							multiSelect: { type: 'boolean', description: '是否允许多选' },
							allowFreeformInput: { type: 'boolean', description: '是否允许自由输入，默认 true' },
							options: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										label: { type: 'string', description: '选项显示文本' },
										description: { type: 'string', description: '选项的补充说明' },
										recommended: { type: 'boolean', description: '是否为推荐选项' }
									},
									required: ['label']
								}
							}
						},
						required: ['header', 'question']
					}
				}
			} as AiFunctionDefinitionParameterProperty,
			required: ['questions']
		}
	},

	// 语言服务：引用与重命名
	{
		chenilleName: 'listCodeUsages',
		vsCodeToolId: 'vscode_listCodeUsages',
		description: '查找符号在工作区中的引用、定义与实现。需要符号名、文件与所在行内容。',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: '要查找的符号名称' },
				uri: { type: 'string', description: '符号所在文件的完整 URI（与 filePath 二选一）' },
				filePath: { type: 'string', description: '符号所在文件的相对路径（与 uri 二选一）' },
				lineContent: { type: 'string', description: '符号所在行的真实文本片段' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['symbol', 'lineContent']
		}
	},
	{
		chenilleName: 'renameSymbol',
		vsCodeToolId: 'vscode_renameSymbol',
		description: '通过语言服务语义化重命名符号，并更新工作区内的所有引用。',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: '符号当前名称' },
				newName: { type: 'string', description: '符号的新名称' },
				uri: { type: 'string', description: '符号所在文件的完整 URI（与 filePath 二选一）' },
				filePath: { type: 'string', description: '符号所在文件的相对路径（与 uri 二选一）' },
				lineContent: { type: 'string', description: '符号所在行的真实文本片段' }
			} as AiFunctionDefinitionParameterProperty,
			required: ['symbol', 'newName', 'lineContent']
		}
	}
	// 注意：editFile 已移至 Chenille 文件工具，不再使用 VS Code 内置版本
];

// ==================== 工具辅助函数 ====================

/**
 * 获取 Chenille 文件工具名称集合
 */
export function getChenilleFileToolNames(): Set<string> {
	return new Set(CHENILLE_FILE_TOOLS.map(t => t.function.name));
}

/**
 * 根据工具名称获取 VS Code 工具 ID
 */
export function getVSCodeToolId(chenilleName: string): string | undefined {
	const def = VSCODE_TOOL_DEFINITIONS.find(d => d.chenilleName === chenilleName);
	return def?.vsCodeToolId;
}

/**
 * 构建发送给 AI 的工具定义
 * 合并 Chenille 文件工具和可用的 VS Code 内置工具
 */
export function buildToolDefinitionsForAI(availableVSCodeToolIds: Set<string>): AiTool[] {
	const tools: AiTool[] = [];

	// 添加 Chenille 文件工具
	tools.push(...CHENILLE_FILE_TOOLS);

	// 添加可用的 VS Code 内置工具
	for (const def of VSCODE_TOOL_DEFINITIONS) {
		if (availableVSCodeToolIds.has(def.vsCodeToolId)) {
			tools.push({
				type: 'function',
				function: {
					name: def.chenilleName,
					description: def.description,
					parameters: def.parameters
				}
			});
		}
	}

	return tools;
}

/**
 * 获取所有工具名称（用于 AI）
 */
export function getAllToolNames(): string[] {
	const fileToolNames = CHENILLE_FILE_TOOLS.map(t => t.function.name);
	const vsCodeToolNames = VSCODE_TOOL_DEFINITIONS.map(d => d.chenilleName);
	return [...fileToolNames, ...vsCodeToolNames];
}

/**
 * 根据工具名称获取工具定义
 */
export function getToolByName(name: string): AiTool | undefined {
	// 先查找 Chenille 文件工具
	const fileTool = CHENILLE_FILE_TOOLS.find(t => t.function.name === name);
	if (fileTool) {
		return fileTool;
	}

	// 再查找 VS Code 工具
	const vsCodeDef = VSCODE_TOOL_DEFINITIONS.find(d => d.chenilleName === name);
	if (vsCodeDef) {
		return {
			type: 'function',
			function: {
				name: vsCodeDef.chenilleName,
				description: vsCodeDef.description,
				parameters: vsCodeDef.parameters
			}
		};
	}

	return undefined;
}

// ==================== 兼容性导出 ====================

/**
 * @deprecated 使用 buildToolDefinitionsForAI 代替
 * 保留用于兼容性
 */
export const CHENILLE_TOOLS: AiTool[] = [
	...CHENILLE_FILE_TOOLS,
	...VSCODE_TOOL_DEFINITIONS.map(def => ({
		type: 'function' as const,
		function: {
			name: def.chenilleName,
			description: def.description,
			parameters: def.parameters
		}
	}))
];
