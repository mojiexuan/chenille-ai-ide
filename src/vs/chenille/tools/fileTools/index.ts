/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chenille 文件工具模块
 *
 * 提供精细的文件操作能力，专为 AI 编程助手设计：
 * - 读取类：readFile, getFileInfo, checkFileExists
 * - 目录类：listDirectory, findFiles
 * - 搜索类：searchInFile, searchInFiles
 * - 修改类：replaceInFile, insertInFile, deleteLines
 * - 管理类：createFile, deleteFile, renameFile
 * - 编辑器类：getOpenEditors
 */

// 类型导出
export * from './types.js';

// 工具函数导出
export * from './fileUtils.js';

// 读取工具
export { readFile, getFileInfo, checkFileExists } from './readFile.js';

// 目录工具
export { listDirectory, findFiles } from './directoryTools.js';

// 搜索工具
export { searchInFile, searchInFiles } from './searchFile.js';

// 修改工具
export {
	replaceInFile,
	insertInFile,
	deleteLines,
	createFile,
	deleteFile,
	renameFile,
	editFile
} from './modifyFile.js';

// 编辑器工具
export { getOpenEditors } from './editorTools.js';
