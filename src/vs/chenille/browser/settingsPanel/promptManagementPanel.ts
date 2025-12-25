/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IAiPromptStorageService } from '../../common/promptStorage.js';
import { AiPrompt } from '../../common/types.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';

interface FormInputs {
	name: HTMLInputElement;
	description: HTMLInputElement;
	content: HTMLTextAreaElement;
}

export class PromptManagementPanel extends Disposable {
	private container: HTMLElement;
	private listContainer: HTMLElement | undefined;
	private formContainer: HTMLElement | undefined;
	private isEditing = false;
	private editingPrompt: AiPrompt | undefined;
	private formInputs: FormInputs | undefined;

	constructor(
		parent: HTMLElement,
		@IAiPromptStorageService private readonly promptStorage: IAiPromptStorageService,
	) {
		super();
		this.container = parent;
		this.render();

		this._register(this.promptStorage.onDidChangePrompts(() => {
			if (!this.isEditing) {
				this.renderList();
			}
		}));
	}

	private render(): void {
		// 头
		const header = append(this.container, $('.chenille-panel-header'));
		append(header, $('.chenille-panel-title')).textContent = localize('promptManagement', "提示词管理");

		const addBtn = append(header, $('button.chenille-btn.chenille-btn-primary'));
		append(addBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
		append(addBtn, document.createTextNode(localize('addPrompt', "添加提示词")));
		addBtn.addEventListener('click', () => this.showForm());

		// 列表
		this.listContainer = append(this.container, $('.chenille-panel-list'));
		this.renderList();

		// 表单（初始隐藏）
		this.formContainer = append(this.container, $('.chenille-form'));
		this.formContainer.style.display = 'none';
	}

	private renderList(): void {
		if (!this.listContainer) {
			return;
		}
		clearNode(this.listContainer);

		const prompts = this.promptStorage.getAll();

		if (prompts.length === 0) {
			const empty = append(this.listContainer, $('.chenille-empty-state'));
			empty.textContent = localize('noPrompts', "暂无提示词，点击上方按钮添加");
			return;
		}

		for (const prompt of prompts) {
			const item = append(this.listContainer, $('.chenille-list-item'));

			const info = append(item, $('.chenille-list-item-info'));
			append(info, $('.chenille-list-item-name')).textContent = prompt.name;
			append(info, $('.chenille-list-item-desc')).textContent =
				prompt.description || localize('noDescription', "无描述");

			const actions = append(item, $('.chenille-list-item-actions'));

			const editBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
			append(editBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`));
			editBtn.title = localize('edit', "编辑");
			editBtn.addEventListener('click', () => this.showForm(prompt));

			const deleteBtn = append(actions, $('button.chenille-btn.chenille-btn-danger'));
			append(deleteBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.trash)}`));
			deleteBtn.title = localize('delete', "删除");
			deleteBtn.addEventListener('click', () => this.deletePrompt(prompt.name));
		}
	}

	private showForm(prompt?: AiPrompt): void {
		if (!this.formContainer || !this.listContainer) {
			return;
		}

		this.isEditing = true;
		this.editingPrompt = prompt;
		this.listContainer.style.display = 'none';
		this.formContainer.style.display = 'flex';

		clearNode(this.formContainer);

		// 名称
		const nameGroup = append(this.formContainer, $('.chenille-form-group'));
		append(nameGroup, $('.chenille-form-label')).textContent = localize('promptName', "名称");
		const nameInput = append(nameGroup, $('input.chenille-form-input')) as HTMLInputElement;
		nameInput.value = prompt?.name ?? '';
		if (prompt) {
			nameInput.readOnly = true;
		}

		// 描述
		const descGroup = append(this.formContainer, $('.chenille-form-group'));
		append(descGroup, $('.chenille-form-label')).textContent = localize('description', "描述");
		const descInput = append(descGroup, $('input.chenille-form-input')) as HTMLInputElement;
		descInput.value = prompt?.description ?? '';

		// 内容
		const contentGroup = append(this.formContainer, $('.chenille-form-group'));
		append(contentGroup, $('.chenille-form-label')).textContent = localize('content', "内容");
		const contentInput = append(contentGroup, $('textarea.chenille-form-textarea')) as HTMLTextAreaElement;
		contentInput.value = prompt?.content ?? '';
		contentInput.placeholder = localize('promptContentPlaceholder', "输入提示词内容...");

		this.formInputs = {
			name: nameInput,
			description: descInput,
			content: contentInput,
		};

		// 活动
		const actions = append(this.formContainer, $('.chenille-form-actions'));

		const saveBtn = append(actions, $('button.chenille-btn.chenille-btn-primary'));
		saveBtn.textContent = localize('save', "保存");
		saveBtn.addEventListener('click', () => this.savePrompt());

		const cancelBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
		cancelBtn.textContent = localize('cancel', "取消");
		cancelBtn.addEventListener('click', () => this.hideForm());
	}

	private hideForm(): void {
		if (!this.formContainer || !this.listContainer) {
			return;
		}

		this.isEditing = false;
		this.editingPrompt = undefined;
		this.formInputs = undefined;
		this.formContainer.style.display = 'none';
		this.listContainer.style.display = 'flex';
		this.renderList();
	}

	private savePrompt(): void {
		if (!this.formInputs) {
			return;
		}

		const prompt: AiPrompt = {
			name: this.formInputs.name.value,
			description: this.formInputs.description.value,
			content: this.formInputs.content.value,
		};

		if (!prompt.name) {
			alert(localize('nameRequired', "名称不能为空"));
			return;
		}

		// 添加新时检查重复名称
		if (!this.editingPrompt && this.promptStorage.get(prompt.name)) {
			alert(localize('nameDuplicate', "名称已存在"));
			return;
		}

		this.promptStorage.save(prompt);
		this.hideForm();
	}

	private deletePrompt(name: string): void {
		if (confirm(localize('confirmDeletePrompt', "确定要删除提示词 '{0}' 吗？", name))) {
			this.promptStorage.delete(name);
		}
	}
}
