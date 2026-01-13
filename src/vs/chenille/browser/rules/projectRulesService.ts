/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IGlobalRulesStorageService } from '../../common/globalRulesStorage.js';
import { VSBuffer } from '../../../base/common/buffer.js';

/** 规则目录名称 */
const RULES_DIR = '.chenille/rules';

/** 默认规则文件模板 */
const DEFAULT_RULE_TEMPLATE = `# 项目规则

<!-- 在此编写项目特定的 AI 规则 -->

## 代码风格
-

## 技术栈
-

## 其他约定
-
`;

export const IProjectRulesService = createDecorator<IProjectRulesService>('projectRulesService');

export interface IProjectRulesService {
	readonly _serviceBrand: undefined;

	/**
	 * 获取合并后的规则内容（全局规则 + 项目规则）
	 * @returns 合并后的规则内容，如果没有规则则返回 undefined
	 */
	getMergedRules(): Promise<string | undefined>;

	/**
	 * 获取项目规则内容
	 * @returns 项目规则内容，如果没有规则则返回 undefined
	 */
	getProjectRules(): Promise<string | undefined>;

	/**
	 * 检查项目是否有规则文件
	 */
	hasProjectRules(): Promise<boolean>;

	/**
	 * 创建项目规则目录和默认文件
	 * @returns true 如果创建了新文件，false 如果目录已存在且有规则
	 */
	createProjectRulesDirectory(): Promise<boolean>;
}

export class ProjectRulesService extends Disposable implements IProjectRulesService {
	declare readonly _serviceBrand: undefined;

	private _cachedRules: string | undefined | null = null; // null 表示未加载
	private _cacheWorkspaceUri: string | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IGlobalRulesStorageService private readonly globalRulesStorage: IGlobalRulesStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getMergedRules(): Promise<string | undefined> {
		const parts: string[] = [];

		// 1. 获取全局规则
		try {
			const globalRules = await this.globalRulesStorage.get();
			if (globalRules.enabled && globalRules.content.trim()) {
				parts.push(`<!-- 全局规则 -->\n${globalRules.content.trim()}`);
			}
		} catch (error) {
			this.logService.warn('[Chenille Rules] 获取全局规则失败:', error);
		}

		// 2. 获取项目规则
		const projectRules = await this.getProjectRules();
		if (projectRules) {
			parts.push(`<!-- 项目规则 -->\n${projectRules}`);
		}

		if (parts.length === 0) {
			return undefined;
		}

		// 3. 如果同时有全局和项目规则，添加冲突说明
		let merged = parts.join('\n\n---\n\n');
		if (parts.length > 1) {
			merged += '\n\n<!-- 注意：当项目规则与全局规则冲突时，以项目规则为准 -->';
		}

		return merged;
	}

	async getProjectRules(): Promise<string | undefined> {
		const workspaceFolder = this.getWorkspaceFolder();
		if (!workspaceFolder) {
			return undefined;
		}

		// 检查缓存是否有效
		const workspaceUri = workspaceFolder.toString();
		if (this._cachedRules !== null && this._cacheWorkspaceUri === workspaceUri) {
			return this._cachedRules;
		}

		// 加载规则
		this._cacheWorkspaceUri = workspaceUri;
		this._cachedRules = await this.loadRules(workspaceFolder);
		return this._cachedRules;
	}

	async hasProjectRules(): Promise<boolean> {
		const rules = await this.getProjectRules();
		return !!rules;
	}

	async createProjectRulesDirectory(): Promise<boolean> {
		const workspaceFolder = this.getWorkspaceFolder();
		if (!workspaceFolder) {
			throw new Error('没有打开的工作区');
		}

		const rulesDir = URI.joinPath(workspaceFolder, RULES_DIR);
		const defaultFile = URI.joinPath(rulesDir, 'my-rule.md');

		// 检查目录是否存在
		const dirExists = await this.fileService.exists(rulesDir);

		if (!dirExists) {
			// 创建目录和默认文件
			await this.fileService.createFolder(rulesDir);
			await this.fileService.writeFile(defaultFile, VSBuffer.fromString(DEFAULT_RULE_TEMPLATE));
			this.clearCache();
			return true;
		}

		// 目录存在，检查是否有 .md 文件
		const stat = await this.fileService.resolve(rulesDir);
		const hasMdFiles = stat.children?.some(child => !child.isDirectory && child.name.endsWith('.md'));

		if (!hasMdFiles) {
			// 没有规则文件，创建默认文件
			await this.fileService.writeFile(defaultFile, VSBuffer.fromString(DEFAULT_RULE_TEMPLATE));
			this.clearCache();
			return true;
		}

		return false;
	}

	private getWorkspaceFolder(): URI | undefined {
		const folders = this.workspaceService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri : undefined;
	}

	private async loadRules(workspaceFolder: URI): Promise<string | undefined> {
		try {
			const rulesDir = URI.joinPath(workspaceFolder, RULES_DIR);

			// 检查目录是否存在
			const dirExists = await this.fileService.exists(rulesDir);
			if (!dirExists) {
				this.logService.debug('[Chenille Rules] 规则目录不存在:', rulesDir.fsPath);
				return undefined;
			}

			// 读取目录内容
			const stat = await this.fileService.resolve(rulesDir);
			if (!stat.children || stat.children.length === 0) {
				this.logService.debug('[Chenille Rules] 规则目录为空');
				return undefined;
			}

			// 过滤 .md 文件并排序
			const mdFiles = stat.children
				.filter(child => !child.isDirectory && child.name.endsWith('.md'))
				.sort((a, b) => a.name.localeCompare(b.name));

			if (mdFiles.length === 0) {
				this.logService.debug('[Chenille Rules] 没有找到 .md 规则文件');
				return undefined;
			}

			// 读取并合并所有规则文件
			const rulesContent: string[] = [];

			for (const file of mdFiles) {
				try {
					const content = await this.fileService.readFile(file.resource);
					const text = content.value.toString().trim();
					if (text) {
						rulesContent.push(`<!-- ${file.name} -->\n${text}`);
					}
				} catch (error) {
					this.logService.warn(`[Chenille Rules] 读取规则文件失败: ${file.name}`, error);
				}
			}

			if (rulesContent.length === 0) {
				return undefined;
			}

			const mergedRules = rulesContent.join('\n\n---\n\n');
			this.logService.info(`[Chenille Rules] 已加载 ${mdFiles.length} 个规则文件`);

			return mergedRules;

		} catch (error) {
			this.logService.error('[Chenille Rules] 加载规则失败:', error);
			return undefined;
		}
	}

	/**
	 * 清除缓存（当规则文件变化时调用）
	 */
	clearCache(): void {
		this._cachedRules = null;
		this._cacheWorkspaceUri = undefined;
	}
}
