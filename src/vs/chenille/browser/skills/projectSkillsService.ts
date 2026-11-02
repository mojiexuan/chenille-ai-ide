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
import { VSBuffer } from '../../../base/common/buffer.js';
import {
	SkillMetadata,
	SKILLS_DIR,
	SKILL_FILE_NAME,
	parseSkillFrontmatter,
	generateSkillTemplate,
} from '../../common/skills.js';

export const IProjectSkillsService = createDecorator<IProjectSkillsService>('projectSkillsService');

export interface IProjectSkillsService {
	readonly _serviceBrand: undefined;

	/**
	 * 获取项目 Skills 元数据列表
	 */
	getProjectSkills(): Promise<SkillMetadata[]>;

	/**
	 * 检查项目是否有 Skills
	 */
	hasProjectSkills(): Promise<boolean>;

	/**
	 * 创建项目 Skill
	 * @param name Skill 名称
	 * @returns 创建的 SKILL.md 文件 URI
	 */
	createProjectSkill(name: string): Promise<URI>;

	/**
	 * 清除缓存
	 */
	clearCache(): void;
}

export class ProjectSkillsService extends Disposable implements IProjectSkillsService {
	declare readonly _serviceBrand: undefined;

	private _cachedSkills: SkillMetadata[] | null = null;
	private _cacheWorkspaceUri: string | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getProjectSkills(): Promise<SkillMetadata[]> {
		const workspaceFolder = this.getWorkspaceFolder();
		if (!workspaceFolder) {
			return [];
		}

		// 检查缓存是否有效
		const workspaceUri = workspaceFolder.toString();
		if (this._cachedSkills !== null && this._cacheWorkspaceUri === workspaceUri) {
			return this._cachedSkills;
		}

		// 扫描 Skills
		this._cacheWorkspaceUri = workspaceUri;
		this._cachedSkills = await this.scanProjectSkills(workspaceFolder);
		return this._cachedSkills;
	}

	async hasProjectSkills(): Promise<boolean> {
		const skills = await this.getProjectSkills();
		return skills.length > 0;
	}

	async createProjectSkill(name: string): Promise<URI> {
		const workspaceFolder = this.getWorkspaceFolder();
		if (!workspaceFolder) {
			throw new Error('没有打开的工作区');
		}

		const skillsDir = URI.joinPath(workspaceFolder, SKILLS_DIR);
		const skillDir = URI.joinPath(skillsDir, name);
		const skillFile = URI.joinPath(skillDir, SKILL_FILE_NAME);

		// 检查是否已存在
		const exists = await this.fileService.exists(skillFile);
		if (exists) {
			throw new Error(`技能 "${name}" 已存在`);
		}

		// 创建目录和文件
		await this.fileService.createFolder(skillDir);
		const content = generateSkillTemplate(name);
		await this.fileService.writeFile(skillFile, VSBuffer.fromString(content));

		this.clearCache();
		this.logService.info(`[Chenille Skills] 创建项目技能: ${name}`);

		return skillFile;
	}

	clearCache(): void {
		this._cachedSkills = null;
		this._cacheWorkspaceUri = undefined;
	}

	private getWorkspaceFolder(): URI | undefined {
		const folders = this.workspaceService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri : undefined;
	}

	private async scanProjectSkills(workspaceFolder: URI): Promise<SkillMetadata[]> {
		const skills: SkillMetadata[] = [];

		try {
			const skillsDir = URI.joinPath(workspaceFolder, SKILLS_DIR);

			// 检查目录是否存在
			const dirExists = await this.fileService.exists(skillsDir);
			if (!dirExists) {
				this.logService.debug('[Chenille Skills] 项目 Skills 目录不存在:', skillsDir.fsPath);
				return [];
			}

			// 读取目录内容
			const stat = await this.fileService.resolve(skillsDir);
			if (!stat.children || stat.children.length === 0) {
				this.logService.debug('[Chenille Skills] 项目 Skills 目录为空');
				return [];
			}

			// 遍历子目录，查找 SKILL.md
			for (const child of stat.children) {
				if (!child.isDirectory) {
					continue;
				}

				const skillFile = URI.joinPath(child.resource, SKILL_FILE_NAME);
				try {
					const fileExists = await this.fileService.exists(skillFile);
					if (!fileExists) {
						continue;
					}

					const content = await this.fileService.readFile(skillFile);
					const text = content.value.toString();
					const frontmatter = parseSkillFrontmatter(text);

					if (frontmatter) {
						skills.push({
							id: `project:${frontmatter.name}`,
							name: frontmatter.name,
							description: frontmatter.description,
							source: 'project',
							relativePath: `.chenille/skills/${child.name}/`,
							skillFileUri: skillFile.toString(),
						});
					} else {
						this.logService.warn(`[Chenille Skills] 无法解析 SKILL.md: ${skillFile.fsPath}`);
					}
				} catch (error) {
					this.logService.warn(`[Chenille Skills] 读取 Skill 失败: ${child.name}`, error);
				}
			}

			this.logService.info(`[Chenille Skills] 已加载 ${skills.length} 个项目技能`);

		} catch (error) {
			this.logService.error('[Chenille Skills] 扫描项目 Skills 失败:', error);
		}

		return skills;
	}
}
