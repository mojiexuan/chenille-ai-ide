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

/** 规则目录名称 */
const RULES_DIR = '.chenille/rules';

export const IProjectRulesService = createDecorator<IProjectRulesService>('projectRulesService');

export interface IProjectRulesService {
	readonly _serviceBrand: undefined;

	/**
	 * 获取项目规则内容
	 * 读取 .chenille/rules/*.md 文件并合并
	 * @returns 合并后的规则内容，如果没有规则则返回 undefined
	 */
	getProjectRules(): Promise<string | undefined>;

	/**
	 * 检查项目是否有规则文件
	 */
	hasProjectRules(): Promise<boolean>;
}

export class ProjectRulesService extends Disposable implements IProjectRulesService {
	declare readonly _serviceBrand: undefined;

	private _cachedRules: string | undefined | null = null; // null 表示未加载
	private _cacheWorkspaceUri: string | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
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
