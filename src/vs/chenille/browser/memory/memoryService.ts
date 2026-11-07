/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IPathService } from '../../../platform/path/common/pathService.js';
import { CHENILLE_HOME_DIR_NAME } from '../../common/commitMessageRules.js';
import {
	IChenilleMemoryContext,
	IMemoryService,
	MAX_MEMORY_INDEX_BYTES,
	MAX_MEMORY_INDEX_LINES,
	MEMORY_DIR_NAME,
	MEMORY_INDEX_FILE_NAME,
	getProjectKey,
} from '../../common/memory.js';

/**
 * 基于文件的记忆服务。
 * 记忆存放在用户主目录下，按会话工作目录隔离：~/.chenille/memory/<project-key>/
 */
export class ChenilleMemoryService extends Disposable implements IMemoryService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IPathService private readonly pathService: IPathService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getMemoryDir(workspaceRoot: URI | undefined): Promise<URI | undefined> {
		if (!workspaceRoot || workspaceRoot.scheme !== 'file') {
			return undefined;
		}

		const projectKey = getProjectKey(workspaceRoot);
		if (!projectKey) {
			return undefined;
		}

		try {
			const userHome = await this.pathService.userHome();
			return URI.joinPath(userHome, CHENILLE_HOME_DIR_NAME, MEMORY_DIR_NAME, projectKey);
		} catch (error) {
			this.logService.warn('[Chenille Memory] 解析记忆目录失败:', error);
			return undefined;
		}
	}

	async getMemoryContext(workspaceRoot: URI | undefined): Promise<IChenilleMemoryContext | undefined> {
		const memoryDir = await this.getMemoryDir(workspaceRoot);
		if (!memoryDir) {
			return undefined;
		}

		// 提前创建记忆目录，Agent 可以直接写文件而不必先运行 mkdir。
		try {
			if (!await this.fileService.exists(memoryDir)) {
				await this.fileService.createFolder(memoryDir);
			}
		} catch (error) {
			this.logService.warn('[Chenille Memory] 创建记忆目录失败:', error);
		}

		const indexPath = URI.joinPath(memoryDir, MEMORY_INDEX_FILE_NAME);
		const indexContent = await this.readIndex(indexPath);
		return { memoryDir, indexPath, indexContent };
	}

	private async readIndex(indexPath: URI): Promise<string | undefined> {
		try {
			if (!await this.fileService.exists(indexPath)) {
				return undefined;
			}

			const contents = await this.fileService.readFile(indexPath);
			const text = contents.value.toString().trim();
			if (!text) {
				return undefined;
			}
			return this.truncate(text);
		} catch (error) {
			this.logService.warn('[Chenille Memory] 读取记忆索引失败:', error);
			return undefined;
		}
	}

	private truncate(content: string): string {
		let result = content;
		let truncated = false;

		const lines = result.split(/\r?\n/);
		if (lines.length > MAX_MEMORY_INDEX_LINES) {
			result = lines.slice(0, MAX_MEMORY_INDEX_LINES).join('\n');
			truncated = true;
		}

		const buffer = VSBuffer.fromString(result);
		if (buffer.byteLength > MAX_MEMORY_INDEX_BYTES) {
			result = buffer.slice(0, MAX_MEMORY_INDEX_BYTES).toString();
			truncated = true;
		}

		return truncated
			? `${result}\n\n（索引过长，已截断；其余记忆未自动加载。）`
			: result;
	}
}
