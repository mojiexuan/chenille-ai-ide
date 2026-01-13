/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IGlobalRulesStorageService, IGlobalRulesConfig, DEFAULT_MAX_LENGTH } from '../../common/globalRulesStorage.js';
import { IProjectRulesService } from '../rules/projectRulesService.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { CHENILLE_SETTINGS_ACTION_ID } from './constants.js';

type TabType = 'global' | 'project';

/**
 * 规则管理面板
 */
export class GlobalRulesPanel extends Disposable {
	private container: HTMLElement;
	private contentContainer: HTMLElement | undefined;
	private currentTab: TabType = 'global';
	private tabElements: Map<TabType, HTMLElement> = new Map();

	// 全局规则相关
	private textarea: HTMLTextAreaElement | undefined;
	private enabledCheckbox: HTMLInputElement | undefined;
	private charCountElement: HTMLElement | undefined;
	private currentData: IGlobalRulesConfig = { content: '', enabled: false, maxLength: DEFAULT_MAX_LENGTH };

	constructor(
		parent: HTMLElement,
		@IGlobalRulesStorageService private readonly globalRulesStorage: IGlobalRulesStorageService,
		@IProjectRulesService private readonly projectRulesService: IProjectRulesService,
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

		// 全局规则标签
		const globalTab = append(tabsContainer, $('.chenille-rules-tab.active'));
		globalTab.textContent = localize('globalRules', '全局规则');
		this.tabElements.set('global', globalTab);
		this._register(addDisposableListener(globalTab, EventType.CLICK, () => this.switchTab('global')));

		// 项目规则标签
		const projectTab = append(tabsContainer, $('.chenille-rules-tab'));
		projectTab.textContent = localize('projectRules', '项目规则');
		this.tabElements.set('project', projectTab);
		this._register(addDisposableListener(projectTab, EventType.CLICK, () => this.switchTab('project')));

		// 内容区域
		this.contentContainer = append(this.container, $('.chenille-panel-list'));

		// 默认显示全局规则
		this.renderGlobalRulesContent();
		this.loadGlobalRulesData();
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
			this.renderGlobalRulesContent();
			this.loadGlobalRulesData();
		} else {
			this.renderProjectRulesContent();
		}
	}

	private renderGlobalRulesContent(): void {
		if (!this.contentContainer) {
			return;
		}
		clearNode(this.contentContainer);

		// 启用开关
		const enableGroup = append(this.contentContainer, $('.chenille-form-group.chenille-form-group-checkbox'));
		const enableLabel = append(enableGroup, $('label.chenille-form-checkbox-label'));
		this.enabledCheckbox = append(enableLabel, $('input.chenille-form-checkbox')) as HTMLInputElement;
		this.enabledCheckbox.type = 'checkbox';
		this.enabledCheckbox.checked = this.currentData.enabled;
		append(enableLabel, $('span')).textContent = localize('enableGlobalRules', '启用全局规则');

		this._register(addDisposableListener(this.enabledCheckbox, EventType.CHANGE, () => {
			this.currentData.enabled = this.enabledCheckbox!.checked;
			this.saveGlobalRulesData();
		}));

		// 规则内容
		const contentGroup = append(this.contentContainer, $('.chenille-form-group'));
		contentGroup.style.maxWidth = '600px';
		const contentLabel = append(contentGroup, $('label.chenille-form-label'));
		contentLabel.textContent = localize('rulesContent', '规则内容（Markdown 格式）');

		this.textarea = append(contentGroup, $('textarea.chenille-form-textarea.chenille-rules-textarea')) as HTMLTextAreaElement;
		this.textarea.placeholder = localize('rulesPlaceholder', '在此输入全局规则，这些规则将在每次新会话时自动应用...');
		this.textarea.maxLength = DEFAULT_MAX_LENGTH;

		// 字数统计
		this.charCountElement = append(contentGroup, $('.chenille-char-count'));
		this.updateCharCount();

		this._register(addDisposableListener(this.textarea, EventType.INPUT, () => {
			this.currentData.content = this.textarea!.value;
			this.updateCharCount();
		}));

		// 失去焦点时保存
		this._register(addDisposableListener(this.textarea, EventType.BLUR, () => {
			this.saveGlobalRulesData();
		}));

		// 提示信息
		const hint = append(contentGroup, $('.chenille-form-hint'));
		hint.textContent = localize('rulesHint', '全局规则将在新会话开始时自动注入。当项目规则与全局规则冲突时，以项目规则为准。');
	}

	private async renderProjectRulesContent(): Promise<void> {
		if (!this.contentContainer) {
			return;
		}
		clearNode(this.contentContainer);

		// 获取项目规则文件列表
		const ruleFiles = await this.projectRulesService.getProjectRuleFiles();

		if (ruleFiles.length === 0) {
			// 空状态
			const emptyState = append(this.contentContainer, $('.chenille-empty-state'));
			emptyState.style.padding = '40px 20px';

			const emptyIcon = append(emptyState, $(`span${ThemeIcon.asCSSSelector(Codicon.file)}`));
			emptyIcon.style.fontSize = '48px';
			emptyIcon.style.opacity = '0.5';
			emptyIcon.style.display = 'block';
			emptyIcon.style.marginBottom = '16px';

			const emptyText = append(emptyState, $('p'));
			emptyText.textContent = localize('noProjectRules', '当前项目没有规则文件');
			emptyText.style.marginBottom = '8px';

			// 使用安全的 DOM 操作代替 innerHTML
			const emptyHint = append(emptyState, $('p'));
			emptyHint.style.fontSize = '12px';
			emptyHint.style.color = 'var(--vscode-descriptionForeground)';
			emptyHint.style.marginBottom = '20px';
			append(emptyHint, document.createTextNode('项目规则存放在 '));
			const code1 = append(emptyHint, $('code'));
			code1.textContent = '.chenille/rules/*.md';
			append(emptyHint, document.createTextNode(' 目录下'));

			// 创建按钮
			const createBtn = append(emptyState, $('button.chenille-btn.chenille-btn-primary'));
			const btnIcon = append(createBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.newFolder)}`));
			btnIcon.style.marginRight = '6px';
			append(createBtn, $('span')).textContent = localize('createProjectRulesDir', '创建项目规则');

			this._register(addDisposableListener(createBtn, EventType.CLICK, () => {
				this.createProjectRulesDirectory();
			}));
		} else {
			// 显示规则文件列表 - 使用安全的 DOM 操作
			const hint = append(this.contentContainer, $('.chenille-form-hint'));
			hint.style.marginBottom = '16px';
			append(hint, document.createTextNode('项目规则存放在 '));
			const code2 = append(hint, $('code'));
			code2.textContent = '.chenille/rules/';
			append(hint, document.createTextNode(' 目录下，点击文件名可打开编辑'));

			for (const file of ruleFiles) {
				const item = append(this.contentContainer, $('.chenille-list-item'));

				const info = append(item, $('.chenille-list-item-info'));
				const nameContainer = append(info, $('.chenille-list-item-name-container'));
				const fileIcon = append(nameContainer, $(`span${ThemeIcon.asCSSSelector(Codicon.markdown)}`));
				fileIcon.style.marginRight = '8px';
				fileIcon.style.color = 'var(--vscode-textLink-foreground)';
				append(nameContainer, $('.chenille-list-item-name')).textContent = file.name;

				const actions = append(item, $('.chenille-list-item-actions'));

				// 打开文件按钮
				const openBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
				append(openBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.goToFile)}`));
				openBtn.title = localize('openFile', '打开文件');

				this._register(addDisposableListener(openBtn, EventType.CLICK, () => {
					this.openerService.open(file.uri);
				}));

				// 点击整行也可以打开
				this._register(addDisposableListener(item, EventType.CLICK, (e) => {
					if (!(e.target as HTMLElement).closest('button')) {
						this.openerService.open(file.uri);
					}
				}));
				item.style.cursor = 'pointer';
			}

			// 添加新规则按钮
			const addBtnContainer = append(this.contentContainer, $('div'));
			addBtnContainer.style.marginTop = '16px';

			const addBtn = append(addBtnContainer, $('button.chenille-btn.chenille-btn-secondary'));
			const addIcon = append(addBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
			addIcon.style.marginRight = '6px';
			append(addBtn, $('span')).textContent = localize('addProjectRule', '添加规则文件');

			this._register(addDisposableListener(addBtn, EventType.CLICK, () => {
				this.createProjectRulesDirectory();
			}));
		}
	}

	private updateCharCount(): void {
		if (this.charCountElement && this.textarea) {
			const current = this.textarea.value.length;
			this.charCountElement.textContent = `${current} / ${DEFAULT_MAX_LENGTH}`;
			this.charCountElement.classList.toggle('chenille-char-count-warning', current > DEFAULT_MAX_LENGTH * 0.9);
		}
	}

	private async loadGlobalRulesData(): Promise<void> {
		try {
			this.currentData = await this.globalRulesStorage.get();
			if (this.textarea) {
				this.textarea.value = this.currentData.content;
			}
			if (this.enabledCheckbox) {
				this.enabledCheckbox.checked = this.currentData.enabled;
			}
			this.updateCharCount();
		} catch (error) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('loadRulesError', '加载全局规则失败'),
			});
		}
	}

	private async saveGlobalRulesData(): Promise<void> {
		try {
			await this.globalRulesStorage.save(this.currentData);
		} catch (error) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('saveRulesError', '保存全局规则失败'),
			});
		}
	}

	private async createProjectRulesDirectory(): Promise<void> {
		try {
			const created = await this.projectRulesService.createProjectRulesDirectory();
			if (created) {
				// 关闭设置面板，让用户直接编辑
				this.commandService.executeCommand(CHENILLE_SETTINGS_ACTION_ID);
				// 打开创建的文件
				const ruleFiles = await this.projectRulesService.getProjectRuleFiles();
				if (ruleFiles.length > 0) {
					this.openerService.open(ruleFiles[0].uri);
				}
			}
		} catch (error) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('createProjectRulesDirError', '创建项目规则目录失败'),
			});
		}
	}
}
