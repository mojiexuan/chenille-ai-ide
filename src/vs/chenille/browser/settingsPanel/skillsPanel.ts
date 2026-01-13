/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { ISkillService, IGlobalSkillsStorageService, SkillMetadata } from '../../common/skills.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { URI } from '../../../base/common/uri.js';
import { CHENILLE_SETTINGS_ACTION_ID } from './constants.js';

type TabType = 'global' | 'project';

/**
 * 技能管理面板
 */
export class SkillsPanel extends Disposable {
	private container: HTMLElement;
	private contentContainer: HTMLElement | undefined;
	private currentTab: TabType = 'global';
	private tabElements: Map<TabType, HTMLElement> = new Map();

	// 全局技能开关
	private enabledCheckbox: HTMLInputElement | undefined;
	private globalEnabled: boolean = false;

	constructor(
		parent: HTMLElement,
		@ISkillService private readonly skillService: ISkillService,
		@IGlobalSkillsStorageService private readonly globalSkillsStorage: IGlobalSkillsStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.container = parent;
		this.render();
	}

	private render(): void {
		// 头部 - 标签栏
		const header = append(this.container, $('.chenille-panel-header'));

		const tabsContainer = append(header, $('.chenille-rules-tabs'));

		// 全局技能标签
		const globalTab = append(tabsContainer, $('.chenille-rules-tab.active'));
		globalTab.textContent = localize('globalSkills', '全局技能');
		this.tabElements.set('global', globalTab);
		this._register(addDisposableListener(globalTab, EventType.CLICK, () => this.switchTab('global')));

		// 项目技能标签
		const projectTab = append(tabsContainer, $('.chenille-rules-tab'));
		projectTab.textContent = localize('projectSkills', '项目技能');
		this.tabElements.set('project', projectTab);
		this._register(addDisposableListener(projectTab, EventType.CLICK, () => this.switchTab('project')));

		// 内容区域
		this.contentContainer = append(this.container, $('.chenille-panel-list'));

		// 默认显示全局技能
		this.loadGlobalConfig();
		this.renderGlobalSkillsContent();
	}

	private switchTab(tab: TabType): void {
		if (this.currentTab === tab) {
			return;
		}

		this.currentTab = tab;

		// 更新标签样式
		this.tabElements.forEach((element, key) => {
			element.classList.toggle('active', key === tab);
		});

		// 渲染对应内容
		if (tab === 'global') {
			this.renderGlobalSkillsContent();
		} else {
			this.renderProjectSkillsContent();
		}
	}

	private async loadGlobalConfig(): Promise<void> {
		try {
			const config = await this.globalSkillsStorage.get();
			this.globalEnabled = config.enabled;
		} catch (error) {
			this.globalEnabled = true;
		}
	}

	private async renderGlobalSkillsContent(): Promise<void> {
		if (!this.contentContainer) {
			return;
		}
		clearNode(this.contentContainer);

		// 启用开关
		const enableGroup = append(this.contentContainer, $('.chenille-form-group.chenille-form-group-checkbox'));
		const enableLabel = append(enableGroup, $('label.chenille-form-checkbox-label'));
		this.enabledCheckbox = append(enableLabel, $('input.chenille-form-checkbox')) as HTMLInputElement;
		this.enabledCheckbox.type = 'checkbox';
		this.enabledCheckbox.checked = this.globalEnabled;
		append(enableLabel, $('span')).textContent = localize('enableGlobalSkills', '启用全局技能');

		this._register(addDisposableListener(this.enabledCheckbox, EventType.CHANGE, async () => {
			this.globalEnabled = this.enabledCheckbox!.checked;
			try {
				await this.globalSkillsStorage.save({ enabled: this.globalEnabled, skills: [] });
			} catch (error) {
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('saveSkillsConfigError', '保存技能配置失败'),
				});
			}
		}));

		// 提示信息
		const hint = append(this.contentContainer, $('.chenille-form-hint'));
		hint.style.marginBottom = '16px';
		append(hint, document.createTextNode('全局技能存放在 '));
		const code = append(hint, $('code'));
		code.textContent = '~/.chenille/skills/';
		append(hint, document.createTextNode(' 目录下'));

		// 获取全局技能列表
		let globalSkills: SkillMetadata[] = [];
		try {
			globalSkills = await this.globalSkillsStorage.scanSkills();
		} catch (error) {
			this.logService?.warn('[Chenille Skills] 获取全局技能失败:', error);
		}

		if (globalSkills.length === 0) {
			// 空状态
			const emptyState = append(this.contentContainer, $('.chenille-empty-state'));
			emptyState.style.padding = '40px 20px';

			const emptyIcon = append(emptyState, $(`span${ThemeIcon.asCSSSelector(Codicon.lightbulb)}`));
			emptyIcon.style.fontSize = '48px';
			emptyIcon.style.opacity = '0.5';
			emptyIcon.style.display = 'block';
			emptyIcon.style.marginBottom = '16px';

			const emptyText = append(emptyState, $('p'));
			emptyText.textContent = localize('noGlobalSkills', '没有全局技能');
			emptyText.style.marginBottom = '20px';

			// 创建按钮
			const createBtn = append(emptyState, $('button.chenille-btn.chenille-btn-primary'));
			const btnIcon = append(createBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
			btnIcon.style.marginRight = '6px';
			append(createBtn, $('span')).textContent = localize('createGlobalSkill', '创建全局技能');

			this._register(addDisposableListener(createBtn, EventType.CLICK, () => {
				this.createSkill('global');
			}));
		} else {
			// 显示技能列表
			this.renderSkillsList(globalSkills, 'global');
		}
	}

	private async renderProjectSkillsContent(): Promise<void> {
		if (!this.contentContainer) {
			return;
		}
		clearNode(this.contentContainer);

		// 提示信息
		const hint = append(this.contentContainer, $('.chenille-form-hint'));
		hint.style.marginBottom = '16px';
		append(hint, document.createTextNode('项目技能存放在 '));
		const code = append(hint, $('code'));
		code.textContent = '.chenille/skills/';
		append(hint, document.createTextNode(' 目录下，点击可打开编辑'));

		// 获取项目技能列表
		let projectSkills: SkillMetadata[] = [];
		try {
			projectSkills = await this.skillService.getProjectSkills();
		} catch (error) {
			// 可能没有打开工作区
		}

		if (projectSkills.length === 0) {
			// 空状态
			const emptyState = append(this.contentContainer, $('.chenille-empty-state'));
			emptyState.style.padding = '40px 20px';

			const emptyIcon = append(emptyState, $(`span${ThemeIcon.asCSSSelector(Codicon.lightbulb)}`));
			emptyIcon.style.fontSize = '48px';
			emptyIcon.style.opacity = '0.5';
			emptyIcon.style.display = 'block';
			emptyIcon.style.marginBottom = '16px';

			const emptyText = append(emptyState, $('p'));
			emptyText.textContent = localize('noProjectSkills', '当前项目没有技能');
			emptyText.style.marginBottom = '20px';

			// 创建按钮
			const createBtn = append(emptyState, $('button.chenille-btn.chenille-btn-primary'));
			const btnIcon = append(createBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
			btnIcon.style.marginRight = '6px';
			append(createBtn, $('span')).textContent = localize('createProjectSkill', '创建项目技能');

			this._register(addDisposableListener(createBtn, EventType.CLICK, () => {
				this.createSkill('project');
			}));
		} else {
			// 显示技能列表
			this.renderSkillsList(projectSkills, 'project');
		}
	}

	private renderSkillsList(skills: SkillMetadata[], scope: 'global' | 'project'): void {
		if (!this.contentContainer) {
			return;
		}

		for (const skill of skills) {
			const item = append(this.contentContainer, $('.chenille-list-item'));

			const info = append(item, $('.chenille-list-item-info'));
			const nameContainer = append(info, $('.chenille-list-item-name-container'));
			const skillIcon = append(nameContainer, $(`span${ThemeIcon.asCSSSelector(Codicon.lightbulb)}`));
			skillIcon.style.marginRight = '8px';
			skillIcon.style.color = 'var(--vscode-textLink-foreground)';
			append(nameContainer, $('.chenille-list-item-name')).textContent = skill.name;

			// 描述
			const desc = append(info, $('.chenille-list-item-desc'));
			desc.textContent = skill.description;
			desc.style.marginTop = '4px';

			const actions = append(item, $('.chenille-list-item-actions'));

			// 打开文件按钮
			const openBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
			append(openBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.goToFile)}`));
			openBtn.title = localize('openSkillFile', '打开 SKILL.md');

			this._register(addDisposableListener(openBtn, EventType.CLICK, () => {
				this.openerService.open(URI.parse(skill.skillFileUri));
			}));

			// 点击整行也可以打开
			this._register(addDisposableListener(item, EventType.CLICK, (e) => {
				if (!(e.target as HTMLElement).closest('button')) {
					this.openerService.open(URI.parse(skill.skillFileUri));
				}
			}));
			item.style.cursor = 'pointer';
		}

		// 添加新技能按钮
		const addBtnContainer = append(this.contentContainer, $('div'));
		addBtnContainer.style.marginTop = '16px';

		const addBtn = append(addBtnContainer, $('button.chenille-btn.chenille-btn-secondary'));
		const addIcon = append(addBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
		addIcon.style.marginRight = '6px';
		append(addBtn, $('span')).textContent = scope === 'global'
			? localize('addGlobalSkill', '添加全局技能')
			: localize('addProjectSkill', '添加项目技能');

		this._register(addDisposableListener(addBtn, EventType.CLICK, () => {
			this.createSkill(scope);
		}));
	}

	private async createSkill(scope: 'global' | 'project'): Promise<void> {
		// 生成默认名称
		const timestamp = Date.now().toString(36);
		const defaultName = `skill-${timestamp}`;

		try {
			const uri = await this.skillService.createSkill(defaultName, scope);

			// 刷新缓存
			await this.skillService.refresh();

			// 项目技能创建后关闭设置面板，让用户直接编辑
			if (scope === 'project') {
				// 先关闭设置面板
				this.commandService.executeCommand(CHENILLE_SETTINGS_ACTION_ID);
				// 然后打开文件
				this.openerService.open(uri);
			} else {
				// 全局技能只打开文件，不关闭面板
				this.openerService.open(uri);
				// 刷新列表
				this.renderGlobalSkillsContent();
			}
		} catch (error) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: (error as Error).message || localize('createSkillError', '创建技能失败'),
			});
		}
	}

	// 用于日志（可选）
	private get logService(): { warn: (msg: string, ...args: unknown[]) => void } | undefined {
		return undefined;
	}
}
