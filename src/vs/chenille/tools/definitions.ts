/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AiTool } from '../common/types.js';

/**
 * Chenille 内置工具定义
 * 这些定义会发送给 AI，让 AI 知道可以调用哪些工具
 *
 * 工具来源：
 * - src/vs/workbench/contrib/chat/common/tools/ (核心工具)
 * - src/vs/workbench/contrib/terminalContrib/chatAgentTools/ (终端工具)
 * - src/vs/workbench/contrib/testing/common/testingChatAgentTool.ts (测试工具)
 * - src/vs/workbench/contrib/extensions/ (扩展工具)
 * - src/vs/workbench/contrib/chat/electron-browser/tools/ (网页抓取)
 */

export const CHENILLE_TOOLS: AiTool[] = [
	// ==================== 文件操作工具 ====================
	{
		type: 'function',
		function: {
			name: 'editFile',
			description: '编辑或创建文件。用于修改现有文件内容或创建新文件。',
			parameters: {
				type: 'object',
				properties: {
					uri: {
						type: 'string',
						description: '文件的完整路径或相对于工作区的路径'
					},
					code: {
						type: 'string',
						description: '要写入文件的完整代码内容'
					},
					explanation: {
						type: 'string',
						description: '对本次修改的简要说明'
					}
				},
				required: ['uri', 'code']
			}
		}
	},

	// ==================== 终端工具 ====================
	{
		type: 'function',
		function: {
			name: 'runInTerminal',
			description: '在集成终端中执行命令。适用于运行 shell 命令、脚本、构建任务等。',
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: '要执行的终端命令'
					},
					cwd: {
						type: 'string',
						description: '命令执行的工作目录（可选）'
					},
					isBackground: {
						type: 'boolean',
						description: '是否在后台运行（可选）'
					}
				},
				required: ['command']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getTerminalOutput',
			description: '获取终端的最近输出内容，用于查看命令执行结果。',
			parameters: {
				type: 'object',
				properties: {
					lines: {
						type: 'number',
						description: '要获取的输出行数，默认 50 行'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getTerminalSelection',
			description: '获取终端中当前选中的文本内容。',
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
			name: 'getTerminalLastCommand',
			description: '获取终端中最后执行的命令及其输出。',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		}
	},

	// ==================== 任务工具 ====================
	{
		type: 'function',
		function: {
			name: 'runTask',
			description: '运行 VS Code 中已配置的任务（tasks.json 中定义的任务）。',
			parameters: {
				type: 'object',
				properties: {
					taskName: {
						type: 'string',
						description: '任务名称'
					}
				},
				required: ['taskName']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getTaskOutput',
			description: '获取指定任务的输出结果。',
			parameters: {
				type: 'object',
				properties: {
					taskName: {
						type: 'string',
						description: '任务名称'
					}
				},
				required: ['taskName']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'createAndRunTask',
			description: '创建并立即运行一个临时任务。',
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: '要执行的命令'
					},
					label: {
						type: 'string',
						description: '任务标签/名称'
					},
					type: {
						type: 'string',
						description: '任务类型，如 shell、process'
					}
				},
				required: ['command']
			}
		}
	},

	// ==================== 测试工具 ====================
	{
		type: 'function',
		function: {
			name: 'runTests',
			description: '运行单元测试。可以指定测试文件或测试名称，支持收集代码覆盖率。优先使用此工具而非终端工具来运行测试。',
			parameters: {
				type: 'object',
				properties: {
					files: {
						type: 'array',
						description: '测试文件的绝对路径数组。如果不提供，将运行所有测试文件。'
					},
					testNames: {
						type: 'array',
						description: '要运行的测试名称数组。可以是字符串或包含测试用例的函数/类名称。'
					},
					mode: {
						type: 'string',
						description: '执行模式：run（默认，正常运行）或 coverage（收集覆盖率）'
					},
					coverageFiles: {
						type: 'array',
						description: '当 mode=coverage 时，指定要包含详细覆盖率信息的文件路径'
					}
				},
				required: []
			}
		}
	},

	// ==================== 扩展工具 ====================
	{
		type: 'function',
		function: {
			name: 'searchExtensions',
			description: '在扩展市场中搜索扩展。',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: '搜索关键词'
					}
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'installExtensions',
			description: '安装指定的 VS Code 扩展。',
			parameters: {
				type: 'object',
				properties: {
					extensionIds: {
						type: 'array',
						description: '扩展 ID 数组，格式为 publisher.extensionName'
					}
				},
				required: ['extensionIds']
			}
		}
	},

	// ==================== 网页抓取工具 ====================
	{
		type: 'function',
		function: {
			name: 'fetchWebPage',
			description: '获取网页的主要内容。用于总结或分析网页内容。支持 HTTP/HTTPS URL 和本地文件。',
			parameters: {
				type: 'object',
				properties: {
					urls: {
						type: 'array',
						description: '要获取内容的 URL 数组'
					}
				},
				required: ['urls']
			}
		}
	},

	// ==================== 待办事项工具 ====================
	{
		type: 'function',
		function: {
			name: 'manageTodoList',
			description: '管理结构化的待办事项列表，用于跟踪进度和规划任务。在复杂的多步骤工作中频繁使用此工具。',
			parameters: {
				type: 'object',
				properties: {
					operation: {
						type: 'string',
						description: 'write: 替换整个待办列表。read: 获取当前待办列表。'
					},
					todoList: {
						type: 'array',
						description: '待办事项数组（write 操作必需）。每个项目包含 id、title、description、status 字段。'
					}
				},
				required: ['operation']
			}
		}
	},

	// ==================== 确认工具 ====================
	{
		type: 'function',
		function: {
			name: 'getConfirmation',
			description: '显示确认对话框，获取用户确认。用于危险操作前的确认。',
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: '确认对话框标题'
					},
					message: {
						type: 'string',
						description: '确认对话框消息'
					},
					confirmationType: {
						type: 'string',
						description: '确认类型：basic（基本确认）或 terminal（终端命令确认）'
					},
					terminalCommand: {
						type: 'string',
						description: '终端命令（仅当 confirmationType 为 terminal 时使用）'
					}
				},
				required: ['title', 'message', 'confirmationType']
			}
		}
	},

	// ==================== 子代理工具 ====================
	{
		type: 'function',
		function: {
			name: 'runSubagent',
			description: '启动一个子代理来处理复杂的多步骤任务。子代理可以自主执行搜索、代码分析、文件读取等任务。当你不确定能在前几次尝试中找到正确匹配时，使用此工具进行搜索。',
			parameters: {
				type: 'object',
				properties: {
					prompt: {
						type: 'string',
						description: '给子代理的详细任务描述。应包含高度详细的任务说明，让子代理能够自主执行。'
					},
					description: {
						type: 'string',
						description: '任务的简短描述（3-5个词）'
					},
					agentName: {
						type: 'string',
						description: '可选，指定要调用的代理名称（区分大小写）'
					}
				},
				required: ['prompt', 'description']
			}
		}
	}
];

/**
 * 根据工具名称获取工具定义
 */
export function getToolByName(name: string): AiTool | undefined {
	return CHENILLE_TOOLS.find(tool => tool.function.name === name);
}

/**
 * 获取所有工具名称列表
 */
export function getToolNames(): string[] {
	return CHENILLE_TOOLS.map(tool => tool.function.name);
}

/**
 * 获取工具子集（按名称过滤）
 */
export function getToolsSubset(names: string[]): AiTool[] {
	return CHENILLE_TOOLS.filter(tool => names.includes(tool.function.name));
}
