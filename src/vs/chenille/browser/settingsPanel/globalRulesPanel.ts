/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IGlobalRulesStorageService, IGlobalRulesConfig, DEFAULT_MAX_LENGTH } from '../../common/globalRulesStorage.js';
import { IProjectRulesService } from '../rules/projectRulesService.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';

/**
 * 全局规则管理面板
 */
export class GlobalRulesPanel extends Disposable {
	private container: HTMLElement;
	private textarea: HTMLTextAreaElement | undefined;
	private enabledCheckbox: HTMLInputElement | undefined;
	private charCountElement: HTMLElement | undefined;
	private currentData: IGlobalRulesConfig = { content: '', enabled: true, maxLength: DEFAULT_MAX_LENGTH };

	constructor(
		parent: HTMLElement,
		@IGlobalRulesStorageService private readonly globalRulesStorage: IGlobalRulesStorageService,
		@IProjectRulesService private readonly projectRulesService: IProjectRulesService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.container = append(parent, $('.chenille-global-rules-panel'));
		this.render();
		this.loadData();
	}

	private render(): void {
		// 头部
		const header = append(this.container, $('.chenille-panel-header'));
		append(header, $('.chenille-panel-title')).textContent = localize('globalRules', '全局规则');

		// 表单区域
		const form = append(this.container, $('.chenille-form'));

		// 启用开关
		const enableGroup = append(form, $('.chenille-form-group.chenille-form-group-checkbox'));
		const enableLabel = append(enableGroup, $('label.chenille-form-checkbox-label'));
		this.enabledCheckbox = append(enableLabel, $('input.chenille-form-checkbox')) as HTMLInputElement;
		this.enabledCheckbox.type = 'checkbox';
		this.enabledCheckbox.checked = true;
		append(enableLabel, $('span')).textContent = localize('enableGlobalRules', '启用全局规则');

		this._register(addDisposableListener(this.enabledCheckbox, EventType.CHANGE, () => {
			this.currentData.enabled = this.enabledCheckbox!.checked;
			this.saveData();
		}));

		// 规则内容
		const contentGroup = append(form, $('.chenille-form-group'));
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
			this.saveData();
		}));

		// 提示信息
		const hint = append(contentGroup, $('.chenille-form-hint'));
		hint.textContent = localize('rulesHint', '全局规则将在新会话开始时自动注入。当项目规则与全局规则冲突时，以项目规则为准。');

		// 分隔线
		append(form, $('.chenille-form-divider'));

		// 项目规则区域
		const projectSection = append(form, $('.chenille-form-group'));
		const projectLabel = append(projectSection, $('label.chenille-form-label'));
		projectLabel.textContent = localize('projectRules', '项目规则');

		const projectHint = append(projectSection, $('.chenille-form-hint'));
		projectHint.innerHTML = localize('projectRulesHint', '项目规则存放在 <code>.chenille/rules/*.md</code> 目录下，每个项目可以有独立的规则。');

		// 创建项目规则目录按钮
		const createBtn = append(projectSection, $('button.chenille-btn.chenille-btn-secondary'));
		createBtn.style.marginTop = '12px';
		const btnIcon = append(createBtn, $('span.codicon.codicon-new-folder'));
		btnIcon.style.marginRight = '6px';
		append(createBtn, $('span')).textContent = localize('createProjectRulesDir', '创建项目规则目录');

		this._register(addDisposableListener(createBtn, EventType.CLICK, () => {
			this.createProjectRulesDirectory();
		}));
	}

	private updateCharCount(): void {
		if (this.charCountElement && this.textarea) {
			const current = this.textarea.value.length;
			this.charCountElement.textContent = `${current} / ${DEFAULT_MAX_LENGTH}`;
			this.charCountElement.classList.toggle('chenille-char-count-warning', current > DEFAULT_MAX_LENGTH * 0.9);
		}
	}

	private async loadData(): Promise<void> {
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

	private async saveData(): Promise<void> {
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
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('projectRulesDirCreated', '项目规则目录已创建：.chenille/rules/my-rule.md'),
				});
			} else {
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('projectRulesDirExists', '项目规则目录已存在'),
				});
			}
		} catch (error) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('createProjectRulesDirError', '创建项目规则目录失败'),
			});
		}
	}
}
