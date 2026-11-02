/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from '../../base/common/path.js';
import { IStateService } from '../../platform/state/node/state.js';
import { IEnvironmentMainService } from '../../platform/environment/electron-main/environmentMainService.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { Emitter, Event } from '../../base/common/event.js';
import { ILogService } from '../../platform/log/common/log.js';
import {
	IGlobalSkillsStorageService,
	IGlobalSkillsConfig,
	DEFAULT_GLOBAL_SKILLS_CONFIG,
	SkillMetadata,
	SKILL_FILE_NAME,
	parseSkillFrontmatter,
	generateSkillTemplate,
} from '../common/skills.js';

const STORAGE_KEY = 'chenille.globalSkills';
const SKILLS_DIR_NAME = 'skills';

/**
 * 全局 Skills 存储服务（主进程实现）
 */
export class GlobalSkillsStorageMainService extends Disposable implements IGlobalSkillsStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSkills = this._register(new Emitter<void>());
	readonly onDidChangeSkills: Event<void> = this._onDidChangeSkills.event;

	private readonly skillsDir: string;

	constructor(
		@IStateService private readonly stateService: IStateService,
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// ~/.chenille/skills/
		this.skillsDir = join(this.environmentService.userHome.fsPath, '.chenille', SKILLS_DIR_NAME);
	}

	async get(): Promise<IGlobalSkillsConfig> {
		const data = this.stateService.getItem<string>(STORAGE_KEY);
		if (!data) {
			return { ...DEFAULT_GLOBAL_SKILLS_CONFIG };
		}
		try {
			const config = JSON.parse(data) as IGlobalSkillsConfig;
			return { ...DEFAULT_GLOBAL_SKILLS_CONFIG, ...config };
		} catch {
			return { ...DEFAULT_GLOBAL_SKILLS_CONFIG };
		}
	}

	async save(config: IGlobalSkillsConfig): Promise<void> {
		// 只保存 enabled 状态，skills 列表是动态扫描的
		const toSave: IGlobalSkillsConfig = {
			enabled: config.enabled,
			skills: [], // 不持久化 skills 列表
		};
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(toSave));
		this._onDidChangeSkills.fire();
	}

	async scanSkills(): Promise<SkillMetadata[]> {
		const skills: SkillMetadata[] = [];

		try {
			// 检查目录是否存在
			if (!fs.existsSync(this.skillsDir)) {
				this.logService.debug('[Chenille Skills] 全局 Skills 目录不存在:', this.skillsDir);
				return [];
			}

			// 读取目录内容
			const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}

				const skillFile = join(this.skillsDir, entry.name, SKILL_FILE_NAME);

				try {
					if (!fs.existsSync(skillFile)) {
						continue;
					}

					const content = fs.readFileSync(skillFile, 'utf-8');
					const frontmatter = parseSkillFrontmatter(content);

					if (frontmatter) {
						skills.push({
							id: `global:${frontmatter.name}`,
							name: frontmatter.name,
							description: frontmatter.description,
							source: 'global',
							relativePath: `~/.chenille/skills/${entry.name}/`,
							skillFileUri: `file://${skillFile.replace(/\\/g, '/')}`,
						});
					} else {
						this.logService.warn(`[Chenille Skills] 无法解析全局 SKILL.md: ${skillFile}`);
					}
				} catch (error) {
					this.logService.warn(`[Chenille Skills] 读取全局 Skill 失败: ${entry.name}`, error);
				}
			}

			this.logService.info(`[Chenille Skills] 已扫描 ${skills.length} 个全局技能`);

		} catch (error) {
			this.logService.error('[Chenille Skills] 扫描全局 Skills 失败:', error);
		}

		return skills;
	}

	async createSkill(name: string): Promise<string> {
		const skillDir = join(this.skillsDir, name);
		const skillFile = join(skillDir, SKILL_FILE_NAME);

		// 检查是否已存在
		if (fs.existsSync(skillFile)) {
			throw new Error(`技能 "${name}" 已存在`);
		}

		// 确保目录存在
		fs.mkdirSync(skillDir, { recursive: true });

		// 创建 SKILL.md
		const content = generateSkillTemplate(name);
		fs.writeFileSync(skillFile, content, 'utf-8');

		this.logService.info(`[Chenille Skills] 创建全局技能: ${name}`);
		this._onDidChangeSkills.fire();

		return `file://${skillFile.replace(/\\/g, '/')}`;
	}
}
