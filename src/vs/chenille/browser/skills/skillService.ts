/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../../platform/log/common/log.js';
import {
	ISkillService,
	IGlobalSkillsStorageService,
	SkillMetadata,
} from '../../common/skills.js';
import { IProjectSkillsService } from './projectSkillsService.js';

/**
 * Skill 服务 - 合并全局和项目 Skills
 */
export class SkillService extends Disposable implements ISkillService {
	declare readonly _serviceBrand: undefined;

	private _cachedSkills: SkillMetadata[] | null = null;

	constructor(
		@IProjectSkillsService private readonly projectSkillsService: IProjectSkillsService,
		@IGlobalSkillsStorageService private readonly globalSkillsStorage: IGlobalSkillsStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// 监听全局 Skills 变化
		this._register(this.globalSkillsStorage.onDidChangeSkills(() => {
			this._cachedSkills = null;
		}));
	}

	async getAvailableSkills(): Promise<SkillMetadata[]> {
		if (this._cachedSkills !== null) {
			return this._cachedSkills;
		}

		const skills: SkillMetadata[] = [];
		const seenNames = new Set<string>();

		// 1. 先加载项目 Skills（优先级高）
		try {
			const projectSkills = await this.projectSkillsService.getProjectSkills();
			for (const skill of projectSkills) {
				skills.push(skill);
				seenNames.add(skill.name);
			}
		} catch (error) {
			this.logService.warn('[Chenille Skills] 加载项目 Skills 失败:', error);
		}

		// 2. 加载全局 Skills（同名的被项目覆盖）
		try {
			const globalConfig = await this.globalSkillsStorage.get();
			if (globalConfig.enabled) {
				const globalSkills = await this.globalSkillsStorage.scanSkills();
				for (const skill of globalSkills) {
					if (!seenNames.has(skill.name)) {
						skills.push(skill);
						seenNames.add(skill.name);
					} else {
						this.logService.debug(`[Chenille Skills] 全局技能 "${skill.name}" 被项目技能覆盖`);
					}
				}
			}
		} catch (error) {
			this.logService.warn('[Chenille Skills] 加载全局 Skills 失败:', error);
		}

		this._cachedSkills = skills;
		return skills;
	}

	async getProjectSkills(): Promise<SkillMetadata[]> {
		return this.projectSkillsService.getProjectSkills();
	}

	async getSkillsPrompt(): Promise<string | undefined> {
		const skills = await this.getAvailableSkills();
		if (skills.length === 0) {
			return undefined;
		}

		const skillsList = skills.map(s => {
			const location = s.source === 'global'
				? `~/.chenille/skills/${s.name}/`
				: `.chenille/skills/${s.name}/`;
			return `• ${s.name} [${location}]\n  ${s.description}`;
		}).join('\n\n');

		return `<available_skills>
以下技能可帮助你完成专业任务。根据用户请求判断是否需要使用某个技能。

${skillsList}

使用技能的方式：
1. 根据用户请求判断是否匹配某个技能的描述
2. 如匹配，读取该技能目录下的 SKILL.md 获取完整指令
3. 按照 SKILL.md 中的步骤和规范执行任务
4. 如 SKILL.md 中引用了其他文件，按需读取
</available_skills>`;
	}

	async createSkill(name: string, scope: 'global' | 'project'): Promise<URI> {
		if (scope === 'project') {
			return this.projectSkillsService.createProjectSkill(name);
		} else {
			const uriString = await this.globalSkillsStorage.createSkill(name);
			return URI.parse(uriString);
		}
	}

	async refresh(): Promise<void> {
		this._cachedSkills = null;
		this.projectSkillsService.clearCache();
	}
}
