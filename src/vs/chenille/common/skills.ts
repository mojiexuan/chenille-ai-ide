/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { Event } from '../../base/common/event.js';
import { URI } from '../../base/common/uri.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';

/** Skills 目录名称 */
export const SKILLS_DIR = '.chenille/skills';

/** Skill 文件名 */
export const SKILL_FILE_NAME = 'SKILL.md';

/** 默认 Skill 模板 */
export const DEFAULT_SKILL_TEMPLATE = `---
name: my-skill
description: 描述这个技能做什么，以及何时应该使用它。
---

# 技能名称

## 概述

简要描述这个技能的用途。

## 使用场景

- 场景 1
- 场景 2

## 执行步骤

1. 第一步
2. 第二步
3. 第三步

## 最佳实践

- 实践 1
- 实践 2

## 参考资源

如有额外资源文件，在此引用：
- [参考文档](./reference.md)
`;

/**
 * Skill 元数据（Level 1，轻量级，始终加载）
 */
export interface SkillMetadata {
	/** 唯一标识，如 "global:excel-report" 或 "project:api-design" */
	id: string;
	/** YAML 中的 name 字段 */
	name: string;
	/** YAML 中的 description 字段 */
	description: string;
	/** 来源：全局或项目 */
	source: 'global' | 'project';
	/** Skill 目录的相对路径（用于显示） */
	relativePath: string;
	/** SKILL.md 的完整 URI */
	skillFileUri: string;
}

/**
 * 全局 Skills 配置
 */
export interface IGlobalSkillsConfig {
	/** 是否启用全局 Skills */
	enabled: boolean;
	/** 全局 Skills 元数据列表 */
	skills: SkillMetadata[];
}

/** 默认全局 Skills 配置 */
export const DEFAULT_GLOBAL_SKILLS_CONFIG: IGlobalSkillsConfig = {
	enabled: false,
	skills: [],
};

// ============ Skill Service Interface ============

export const ISkillService = createDecorator<ISkillService>('skillService');

export interface ISkillService {
	readonly _serviceBrand: undefined;

	/**
	 * 获取所有可用 Skills 的元数据（全局 + 项目）
	 */
	getAvailableSkills(): Promise<SkillMetadata[]>;

	/**
	 * 获取项目 Skills 的元数据
	 */
	getProjectSkills(): Promise<SkillMetadata[]>;

	/**
	 * 生成注入 System Prompt 的 Skills 元数据文本
	 */
	getSkillsPrompt(): Promise<string | undefined>;

	/**
	 * 创建新 Skill
	 * @param name Skill 名称
	 * @param scope 存储位置：全局或项目
	 * @returns 创建的 SKILL.md 文件 URI
	 */
	createSkill(name: string, scope: 'global' | 'project'): Promise<URI>;

	/**
	 * 刷新 Skills 缓存
	 */
	refresh(): Promise<void>;
}

// ============ Global Skills Storage IPC ============

export const IGlobalSkillsStorageService = createDecorator<IGlobalSkillsStorageService>('globalSkillsStorageService');

export interface IGlobalSkillsStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSkills: Event<void>;

	/**
	 * 获取全局 Skills 配置
	 */
	get(): Promise<IGlobalSkillsConfig>;

	/**
	 * 保存全局 Skills 配置（主要是 enabled 状态）
	 */
	save(config: IGlobalSkillsConfig): Promise<void>;

	/**
	 * 扫描并返回全局 Skills 元数据
	 */
	scanSkills(): Promise<SkillMetadata[]>;

	/**
	 * 创建全局 Skill
	 */
	createSkill(name: string): Promise<string>;
}

export const GlobalSkillsStorageChannelName = 'chenille.globalSkillsStorage';

export class GlobalSkillsStorageChannel implements IServerChannel {
	constructor(private readonly service: IGlobalSkillsStorageService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onDidChangeSkills': return this.service.onDidChangeSkills as Event<T>;
		}
		throw new Error(`No event: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'get': return this.service.get() as Promise<T>;
			case 'save': return this.service.save(args?.[0] as IGlobalSkillsConfig) as Promise<T>;
			case 'scanSkills': return this.service.scanSkills() as Promise<T>;
			case 'createSkill': return this.service.createSkill(args?.[0] as string) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class GlobalSkillsStorageChannelClient implements IGlobalSkillsStorageService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeSkills: Event<void>;

	constructor(private readonly channel: IChannel) {
		this.onDidChangeSkills = this.channel.listen<void>('onDidChangeSkills');
	}

	get(): Promise<IGlobalSkillsConfig> {
		return this.channel.call('get');
	}

	save(config: IGlobalSkillsConfig): Promise<void> {
		return this.channel.call('save', [config]);
	}

	scanSkills(): Promise<SkillMetadata[]> {
		return this.channel.call('scanSkills');
	}

	createSkill(name: string): Promise<string> {
		return this.channel.call('createSkill', [name]);
	}
}

// ============ Helper Functions ============

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
export function parseSkillFrontmatter(content: string): { name: string; description: string } | undefined {
	const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) {
		return undefined;
	}

	const frontmatter = frontmatterMatch[1];
	const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
	const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

	if (!nameMatch || !descMatch) {
		return undefined;
	}

	return {
		name: nameMatch[1].trim(),
		description: descMatch[1].trim(),
	};
}

/**
 * 验证 Skill 名称是否合法
 * - 只能包含小写字母、数字、连字符
 * - 最大 64 字符
 */
export function isValidSkillName(name: string): boolean {
	if (!name || name.length > 64) {
		return false;
	}
	return /^[a-z0-9-]+$/.test(name);
}

/**
 * 生成 Skill 模板内容
 */
export function generateSkillTemplate(name: string, description: string = ''): string {
	return `---
name: ${name}
description: ${description || '描述这个技能做什么，以及何时应该使用它。'}
---

# ${name}

## 概述

简要描述这个技能的用途。

## 使用场景

- 场景 1
- 场景 2

## 执行步骤

1. 第一步
2. 第二步
3. 第三步

## 最佳实践

- 实践 1
- 实践 2
`;
}
