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
	// ==================== 文件读取工具 ====================
	{
		type: 'function',
		function: {
			name: 'readFile',
			description: `读取文件内容，支持按行号范围读取。

⚠️ 限制说明：
- 默认最多返回 500 行，超过部分需分段读取
- 绝对上限 2000 行，即使指定更大范围也会截断
- 超过 100KB 的文件必须指定 startLine/endLine
- 过长的行（>500字符）会被截断

返回信息：
- content: 文件内容（可能包含继续读取的提示）
- totalLines: 文件总行数
- readRange: 实际读取的行范围 [start, end]

使用建议：
- 先用 getFileInfo 获取文件行数
- 大文件分段读取：startLine=1, endLine=500，然后 startLine=501...
- 只读取需要的部分，避免浪费 token`,
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '文件路径（相对于工作区或绝对路径）'
					},
					startLine: {
						type: 'number',
						description: '起始行号（1-based），默认为 1'
					},
					endLine: {
						type: 'number',
						description: '结束行号，-1 表示自动限制（最多500行），默认为 -1'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getFileInfo',
			description: '获取文件的元信息，包括是否存在、大小、行数、编码、最后修改时间等。在修改文件前建议先调用此工具了解文件状态。',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '文件路径'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'checkFileExists',
			description: '快速检查文件或目录是否存在，返回存在状态和类型（file/directory/none）。',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '要检查的路径'
					}
				},
				required: ['path']
			}
		}
	},

	// ==================== 目录工具 ====================
	{
		type: 'function',
		function: {
			name: 'listDirectory',
			description: `列出目录内容，支持递归遍历和模式过滤。

返回信息：
- entries: 文件/目录列表，包含 name、path、type、size
- truncated: 结果是否被截断（超过 500 条）
- totalCount: 总数量`,
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '目录路径'
					},
					recursive: {
						type: 'boolean',
						description: '是否递归遍历子目录，默认 false'
					},
					maxDepth: {
						type: 'number',
						description: '递归最大深度，默认 3'
					},
					pattern: {
						type: 'string',
						description: 'glob 过滤模式，如 "*.ts"'
					},
					includeHidden: {
						type: 'boolean',
						description: '是否包含隐藏文件（以 . 开头），默认 false'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'findFiles',
			description: `按 glob 模式搜索文件。

示例模式：
- "*.ts" - 当前目录下的 TypeScript 文件
- "**/*.ts" - 所有 TypeScript 文件
- "src/**/*.{ts,tsx}" - src 目录下的 TS/TSX 文件`,
			parameters: {
				type: 'object',
				properties: {
					pattern: {
						type: 'string',
						description: 'glob 搜索模式'
					},
					excludePattern: {
						type: 'string',
						description: '排除模式，如 "node_modules/**"'
					},
					maxResults: {
						type: 'number',
						description: '最大结果数，默认 100，最大 200'
					},
					cwd: {
						type: 'string',
						description: '搜索根目录，默认为工作区根目录'
					}
				},
				required: ['pattern']
			}
		}
	},

	// ==================== 搜索工具 ====================
	{
		type: 'function',
		function: {
			name: 'searchInFile',
			description: `在单个文件中搜索文本，返回所有匹配的行号、列号和上下文。

用于：
- 在修改前确认目标文本的位置
- 查找特定代码片段
- 验证 replaceInFile 的目标文本是否唯一`,
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '文件路径'
					},
					query: {
						type: 'string',
						description: '搜索文本或正则表达式'
					},
					isRegex: {
						type: 'boolean',
						description: '是否为正则表达式，默认 false'
					},
					caseSensitive: {
						type: 'boolean',
						description: '是否区分大小写，默认 true'
					},
					contextLines: {
						type: 'number',
						description: '返回匹配行的上下文行数，默认 2'
					}
				},
				required: ['path', 'query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'searchInFiles',
			description: `在多个文件中搜索文本（类似 grep）。

用于：
- 在整个项目中查找代码
- 查找函数/变量的使用位置
- 搜索特定模式的代码`,
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: '搜索文本或正则表达式'
					},
					filePattern: {
						type: 'string',
						description: '文件过滤模式，如 "*.ts"'
					},
					path: {
						type: 'string',
						description: '搜索目录，默认为工作区根目录'
					},
					isRegex: {
						type: 'boolean',
						description: '是否为正则表达式，默认 false'
					},
					caseSensitive: {
						type: 'boolean',
						description: '是否区分大小写，默认 true'
					},
					maxResults: {
						type: 'number',
						description: '最大结果数，默认 100'
					}
				},
				required: ['query']
			}
		}
	},

	// ==================== 文件修改工具（精细操作，推荐）====================
	{
		type: 'function',
		function: {
			name: 'replaceInFile',
			description: `【推荐】精确替换文件中的文本。这是修改现有文件的首选工具。

⚠️ 重要规则：
1. oldText 必须与文件中的内容完全匹配（包括空格、缩进）
2. 默认只替换唯一匹配，如果找到多个匹配会返回错误
3. 如需替换多个匹配，设置 expectedOccurrences 参数

成功返回：
- replacedCount: 替换次数
- lineNumbers: 替换发生的行号

失败返回：
- reason: NOT_FOUND | MULTIPLE_MATCHES | OCCURRENCE_MISMATCH
- locations: 所有匹配位置（行号+预览）
- suggestion: 修复建议

最佳实践：
1. 先用 readFile 查看目标区域
2. 用 searchInFile 确认要替换的文本唯一
3. 包含足够的上下文确保唯一性（如完整的函数签名）`,
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '文件路径'
					},
					oldText: {
						type: 'string',
						description: '要替换的原文本（必须精确匹配，包括空格和缩进）'
					},
					newText: {
						type: 'string',
						description: '替换后的新文本'
					},
					expectedOccurrences: {
						type: 'number',
						description: '期望的匹配次数，默认 1。设置大于 1 可替换多个匹配。'
					}
				},
				required: ['path', 'oldText', 'newText']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'insertInFile',
			description: `在文件的指定行后插入内容。

用于：
- 在特定位置添加新代码
- 在函数/类中添加新方法
- 添加 import 语句

参数说明：
- line=0 表示在文件开头插入
- line=N 表示在第 N 行之后插入`,
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '文件路径'
					},
					line: {
						type: 'number',
						description: '在此行之后插入（0 表示文件开头）'
					},
					content: {
						type: 'string',
						description: '要插入的内容'
					}
				},
				required: ['path', 'line', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'deleteLines',
			description: '删除文件中指定行范围的内容。返回被删除的内容（便于撤销）。',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '文件路径'
					},
					startLine: {
						type: 'number',
						description: '起始行号（1-based）'
					},
					endLine: {
						type: 'number',
						description: '结束行号（包含）'
					}
				},
				required: ['path', 'startLine', 'endLine']
			}
		}
	},

	// ==================== 文件管理工具 ====================
	{
		type: 'function',
		function: {
			name: 'createFile',
			description: '创建新文件。如果文件已存在，默认会失败（除非设置 overwrite=true）。',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '文件路径'
					},
					content: {
						type: 'string',
						description: '文件初始内容，默认为空'
					},
					overwrite: {
						type: 'boolean',
						description: '如果文件已存在是否覆盖，默认 false'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'deleteFile',
			description: '删除文件。如果文件不存在，操作会成功但 deleted=false。不能用于删除目录。',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: '要删除的文件路径'
					}
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
					oldPath: {
						type: 'string',
						description: '原文件路径'
					},
					newPath: {
						type: 'string',
						description: '新文件路径'
					},
					overwrite: {
						type: 'boolean',
						description: '如果目标已存在是否覆盖，默认 false'
					}
				},
				required: ['oldPath', 'newPath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'editFile',
			description: `【不推荐】全文覆盖文件内容。

⚠️ 仅在以下情况使用：
- 创建全新的文件
- 文件很小（<50行）需要完全重写
- 其他精细工具无法满足需求

对于修改现有文件，请优先使用：
- replaceInFile: 精确替换文本
- insertInFile: 插入新内容
- deleteLines: 删除行`,
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
			description: `在集成终端中执行命令。适用于运行 shell 命令、脚本、构建任务等。

命令执行：
- 使用 && 链接简单命令
- 优先使用管道 | 而非临时文件
- 除非明确要求，否则不要创建子 shell

目录管理：
- 必须使用绝对路径以避免导航问题
- 使用 $PWD 获取当前目录

后台进程：
- 对于长时间运行的任务（如服务器），设置 isBackground=true
- 返回终端 ID，可用于后续检查状态

输出管理：
- 输出超过 60KB 会自动截断
- 使用 head、tail、grep、awk 过滤和限制输出大小`,
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: '要执行的终端命令'
					},
					explanation: {
						type: 'string',
						description: '对命令的一句话描述，会在执行前显示给用户'
					},
					isBackground: {
						type: 'boolean',
						description: '是否为后台进程。如果为 true，命令将在后台运行，你不会看到输出。如果为 false，工具调用将阻塞直到命令完成。后台进程示例：watch 模式构建、启动服务器。'
					}
				},
				required: ['command', 'explanation', 'isBackground']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getTerminalOutput',
			description: '获取之前通过 runInTerminal 启动的终端命令的输出。',
			parameters: {
				type: 'object',
				properties: {
					id: {
						type: 'string',
						description: '要检查的终端 ID'
					}
				},
				required: ['id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'getTerminalSelection',
			description: '获取活动终端中当前选中的文本内容。',
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
			description: '获取活动终端中最后执行的命令及其输出。',
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
			name: 'confirmTerminalCommand',
			description: '在不执行命令的情况下获取用户对终端命令的明确确认。用于在执行潜在危险命令前验证用户批准。',
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: '要与用户确认的命令'
					},
					explanation: {
						type: 'string',
						description: '对命令功能的一句话描述，将在确认对话框中显示给用户'
					},
					isBackground: {
						type: 'boolean',
						description: '命令是否会启动后台进程，为确认提供上下文'
					}
				},
				required: ['command', 'explanation', 'isBackground']
			}
		}
	},

	// ==================== 任务工具 ====================
	{
		type: 'function',
		function: {
			name: 'runTask',
			description: `运行 Chenille 任务（tasks.json 中定义的任务）。

- 如果看到适合构建或运行代码的任务存在，优先使用此工具而非 runInTerminal
- 确保在运行测试或执行代码之前，适当的构建或 watch 任务正在运行
- 如果用户要求运行任务，使用此工具`,
			parameters: {
				type: 'object',
				properties: {
					id: {
						type: 'string',
						description: '要运行的任务 ID'
					},
					workspaceFolder: {
						type: 'string',
						description: '包含任务的工作区文件夹路径'
					}
				},
				required: ['id', 'workspaceFolder']
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
					id: {
						type: 'string',
						description: '要获取输出的任务 ID'
					},
					workspaceFolder: {
						type: 'string',
						description: '包含任务的工作区文件夹路径'
					}
				},
				required: ['id', 'workspaceFolder']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'createAndRunTask',
			description: `根据项目结构（如 package.json 或 README.md）创建并运行构建、运行或自定义任务。

- 如果用户要求构建、运行、启动，且没有 tasks.json 文件，使用此工具
- 如果用户要求创建或添加任务，使用此工具`,
			parameters: {
				type: 'object',
				properties: {
					workspaceFolder: {
						type: 'string',
						description: '将创建 tasks.json 文件的工作区文件夹绝对路径'
					},
					task: {
						type: 'object',
						description: '要添加到 tasks.json 的任务配置',
						properties: {
							label: {
								type: 'string',
								description: '任务标签'
							},
							type: {
								type: 'string',
								description: '任务类型，仅支持 shell',
								enum: ['shell']
							},
							command: {
								type: 'string',
								description: '要运行的 shell 命令'
							},
							args: {
								type: 'array',
								description: '传递给命令的参数',
								items: { type: 'string' }
							},
							isBackground: {
								type: 'boolean',
								description: '任务是否在后台运行'
							},
							problemMatcher: {
								type: 'array',
								description: '问题匹配器，如 $tsc、$eslint-stylish',
								items: { type: 'string' }
							},
							group: {
								type: 'string',
								description: '任务所属的组'
							}
						},
						required: ['label', 'type', 'command']
					}
				},
				required: ['workspaceFolder', 'task']
			}
		}
	},

	// ==================== 测试工具 ====================
	{
		type: 'function',
		function: {
			name: 'runTests',
			description: `运行单元测试。优先使用此工具而非终端工具来运行测试。

- 当用户要求运行测试或你想验证更改时使用
- 尽可能提供包含相关单元测试的 files 路径，以避免不必要的长时间测试运行
- 设置 mode="coverage" 来收集覆盖率，可选提供 coverageFiles 进行聚焦报告`,
			parameters: {
				type: 'object',
				properties: {
					files: {
						type: 'array',
						items: { type: 'string' },
						description: '测试文件的绝对路径数组。如果不提供，将运行所有测试文件。'
					},
					testNames: {
						type: 'array',
						items: { type: 'string' },
						description: '要运行的测试名称数组。可以是字符串或包含测试用例的函数/类名称。'
					},
					mode: {
						type: 'string',
						enum: ['run', 'coverage'],
						description: '执行模式：run（默认，正常运行）或 coverage（收集覆盖率）'
					},
					coverageFiles: {
						type: 'array',
						items: { type: 'string' },
						description: '当 mode=coverage 时，指定要包含详细覆盖率信息的文件绝对路径'
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
			description: `在扩展市场中搜索扩展。

- 当需要发现扩展或解析已知扩展的信息时使用
- 提供扩展类别、相关搜索关键词或已知扩展 ID
- 搜索结果可能包含误报，建议审查和过滤`,
			parameters: {
				type: 'object',
				properties: {
					category: {
						type: 'string',
						description: '要搜索的扩展类别'
					},
					keywords: {
						type: 'array',
						items: { type: 'string' },
						description: '搜索关键词'
					},
					ids: {
						type: 'array',
						items: { type: 'string' },
						description: '要搜索的扩展 ID'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'installExtensions',
			description: '安装指定的 Chenille 扩展。扩展标识符格式为 ${publisher}.${name}，例如：vscode.csharp',
			parameters: {
				type: 'object',
				properties: {
					ids: {
						type: 'array',
						items: { type: 'string' },
						description: '扩展 ID 数组，格式为 publisher.extensionName'
					}
				},
				required: ['ids']
			}
		}
	},

	// ==================== 网页抓取工具 ====================
	{
		type: 'function',
		function: {
			name: 'fetchWebPage',
			description: '获取网页的主要内容。用于总结或分析网页内容。支持 HTTP/HTTPS URL 和本地文件（包括图片）。',
			parameters: {
				type: 'object',
				properties: {
					urls: {
						type: 'array',
						items: { type: 'string' },
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
			description: `管理结构化的待办事项列表，用于跟踪进度和规划任务。

何时使用：
- 复杂的多步骤工作需要规划和跟踪
- 用户提供多个任务或请求时
- 收到需要多个步骤的新指令后
- 开始任何待办事项前（标记为 in-progress）
- 完成每个待办事项后立即（标记为 completed）

关键工作流程：
1. 通过写入待办列表来规划任务
2. 开始工作前将一个待办标记为 in-progress
3. 完成该待办的工作
4. 立即将该待办标记为 completed
5. 移至下一个待办并重复

待办状态：
- not-started: 尚未开始
- in-progress: 正在进行（一次限一个）
- completed: 成功完成`,
			parameters: {
				type: 'object',
				properties: {
					operation: {
						type: 'string',
						enum: ['write', 'read'],
						description: 'write: 替换整个待办列表。read: 获取当前待办列表。'
					},
					todoList: {
						type: 'array',
						description: '待办事项数组（write 操作必需）',
						items: {
							type: 'object',
							properties: {
								id: {
									type: 'number',
									description: '唯一标识符，从 1 开始的顺序数字'
								},
								title: {
									type: 'string',
									description: '简洁的行动导向标签（3-7 个词）'
								},
								description: {
									type: 'string',
									description: '详细上下文、要求或实现说明'
								},
								status: {
									type: 'string',
									enum: ['not-started', 'in-progress', 'completed'],
									description: '待办状态'
								}
							},
							required: ['id', 'title', 'status']
						}
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
			description: `启动一个子代理来自主处理复杂的多步骤任务。

- 子代理不会异步或在后台运行，你会等待代理的结果
- 代理完成后会返回一条消息给你，结果对用户不可见
- 每次代理调用是无状态的，你无法向代理发送额外消息
- 你的提示应包含高度详细的任务描述，让代理能够自主执行
- 代理的输出通常应该被信任
- 明确告诉代理你期望它写代码还是只做研究

适用场景：
- 研究复杂问题
- 搜索代码
- 执行多步骤任务
- 当你不确定能在前几次尝试中找到正确匹配时`,
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
