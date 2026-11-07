/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../base/common/uri.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';

/** 记忆目录名称（位于全局数据目录下） */
export const MEMORY_DIR_NAME = 'memory';

/** 记忆索引文件名 */
export const MEMORY_INDEX_FILE_NAME = 'MEMORY.md';

/** 注入上下文时的索引行数上限 */
export const MAX_MEMORY_INDEX_LINES = 200;

/** 注入上下文时的索引字节上限 */
export const MAX_MEMORY_INDEX_BYTES = 25 * 1024;

/**
 * 当前项目的记忆上下文。
 * 索引内容缺失表示项目还没有任何记忆，仍应向 Agent 提供目录与索引路径。
 */
export interface IChenilleMemoryContext {
	/** 项目记忆目录 */
	readonly memoryDir: URI;
	/** MEMORY.md 索引路径 */
	readonly indexPath: URI;
	/** 索引内容；不存在时为 undefined */
	readonly indexContent?: string;
}

export const IMemoryService = createDecorator<IMemoryService>('chenilleMemoryService');

export interface IMemoryService {
	readonly _serviceBrand: undefined;

	/**
	 * 获取指定工作目录对应的记忆目录。
	 * 没有工作目录或不是本地文件路径时返回 undefined。
	 */
	getMemoryDir(workspaceRoot: URI | undefined): Promise<URI | undefined>;

	/**
	 * 获取指定工作目录对应的记忆上下文。
	 * 没有工作目录或不是本地文件路径时返回 undefined。
	 */
	getMemoryContext(workspaceRoot: URI | undefined): Promise<IChenilleMemoryContext | undefined>;
}

/**
 * 由工作目录生成项目键，规则对齐 Claude Code 的项目目录编码：
 * 转为小写，并把非字母数字字符替换为 `-`。
 * 例如 `D:\Project\chenille-ai-ide` → `d--project-chenille-ai-ide`。
 */
export function getProjectKey(workspaceRoot: URI): string {
	return workspaceRoot.fsPath
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '-')
		.replace(/-+$/, '');
}
