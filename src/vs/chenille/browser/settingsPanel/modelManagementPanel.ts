/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IAiModelStorageService } from '../../common/storageIpc.js';
import { AiModel, AiProvider } from '../../common/types.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
	{ value: AiProvider.OPENAI, label: 'OpenAI' },
	{ value: AiProvider.DEEPSEEK, label: 'DeepSeek' },
	{ value: AiProvider.ANTHROPIC, label: 'Anthropic' },
	{ value: AiProvider.GOOGLE, label: 'Google' },
];

interface FormInputs {
	name: HTMLInputElement;
	provider: HTMLSelectElement;
	baseUrl: HTMLInputElement;
	apiKey: HTMLInputElement;
	model: HTMLInputElement;
	contextSize: HTMLInputElement;
	maxTokens: HTMLInputElement;
	temperature: HTMLInputElement;
}

export class ModelManagementPanel extends Disposable {
	private container: HTMLElement;
	private listContainer: HTMLElement | undefined;
	private formContainer: HTMLElement | undefined;
	private editingModel: AiModel | undefined;
	private formInputs: FormInputs | undefined;

	constructor(
		parent: HTMLElement,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
	) {
		super();
		this.container = parent;
		this.render();
	}

	private render(): void {
		// 头
		const header = append(this.container, $('.chenille-panel-header'));
		append(header, $('.chenille-panel-title')).textContent = localize('modelManagement', "模型管理");

		const addBtn = append(header, $('button.chenille-btn.chenille-btn-primary'));
		append(addBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
		append(addBtn, document.createTextNode(localize('addModel', "添加模型")));
		addBtn.addEventListener('click', () => this.showForm());

		// 列表
		this.listContainer = append(this.container, $('.chenille-panel-list'));
		this.renderList();

		// 表单（最初隐藏）
		this.formContainer = append(this.container, $('.chenille-form'));
		this.formContainer.style.display = 'none';
	}

	private async renderList(): Promise<void> {
		if (!this.listContainer) {
			return;
		}
		clearNode(this.listContainer);

		const models = await this.modelStorage.getAll();

		if (models.length === 0) {
			const empty = append(this.listContainer, $('.chenille-empty-state'));
			empty.textContent = localize('noModels', "暂无模型，点击上方按钮添加");
			return;
		}

		for (const model of models) {
			const item = append(this.listContainer, $('.chenille-list-item'));

			const info = append(item, $('.chenille-list-item-info'));
			append(info, $('.chenille-list-item-name')).textContent = model.name;
			append(info, $('.chenille-list-item-desc')).textContent =
				`${this.getProviderLabel(model.provider)} | ${model.model}`;

			const actions = append(item, $('.chenille-list-item-actions'));

			const editBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
			append(editBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`));
			editBtn.title = localize('edit', "编辑");
			editBtn.addEventListener('click', () => this.showForm(model));

			const deleteBtn = append(actions, $('button.chenille-btn.chenille-btn-danger'));
			append(deleteBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.trash)}`));
			deleteBtn.title = localize('delete', "删除");
			deleteBtn.addEventListener('click', () => this.deleteModel(model.name));
		}
	}

	private showForm(model?: AiModel): void {
		if (!this.formContainer || !this.listContainer) {
			return;
		}

		this.editingModel = model;
		this.listContainer.style.display = 'none';
		this.formContainer.style.display = 'flex';

		clearNode(this.formContainer);

		// 名称
		const nameInput = this.createInputGroup(this.formContainer, localize('modelName', "名称"), 'text', model?.name ?? '');
		if (model) {
			nameInput.readOnly = true;
		}

		// 服务商
		const providerGroup = append(this.formContainer, $('.chenille-form-group'));
		append(providerGroup, $('.chenille-form-label')).textContent = localize('provider', "服务商");
		const providerSelect = append(providerGroup, $('select.chenille-form-select')) as HTMLSelectElement;
		for (const opt of PROVIDER_OPTIONS) {
			const option = append(providerSelect, $('option')) as HTMLOptionElement;
			option.value = opt.value;
			option.textContent = opt.label;
			if (model?.provider === opt.value) {
				option.selected = true;
			}
		}

		// BaseUrl
		const baseUrlInput = this.createInputGroup(this.formContainer, localize('baseUrl', "Base URL"), 'text', model?.baseUrl ?? '');

		// ApiKey
		const apiKeyInput = this.createInputGroup(this.formContainer, localize('apiKey', "API Key"), 'password', model?.apiKey ?? '');

		// 模型
		const modelInput = this.createInputGroup(this.formContainer, localize('model', "模型"), 'text', model?.model ?? '');

		// 上下文大小
		const contextSizeInput = this.createInputGroup(this.formContainer, localize('contextSize', "上下文大小"), 'number', String(model?.contextSize ?? 4096));

		// 最大输出Token
		const maxTokensInput = this.createInputGroup(this.formContainer, localize('maxTokens', "最大输出Token"), 'number', String(model?.maxTokens ?? 2048));

		// 温度
		const temperatureInput = this.createInputGroup(this.formContainer, localize('temperature', "温度 (0-2)"), 'number', String(model?.temperature ?? 0.7));
		temperatureInput.step = '0.1';
		temperatureInput.min = '0';
		temperatureInput.max = '2';

		this.formInputs = {
			name: nameInput,
			provider: providerSelect,
			baseUrl: baseUrlInput,
			apiKey: apiKeyInput,
			model: modelInput,
			contextSize: contextSizeInput,
			maxTokens: maxTokensInput,
			temperature: temperatureInput,
		};

		// 操作
		const actions = append(this.formContainer, $('.chenille-form-actions'));

		const saveBtn = append(actions, $('button.chenille-btn.chenille-btn-primary'));
		saveBtn.textContent = localize('save', "保存");
		saveBtn.addEventListener('click', () => this.saveModel());

		const cancelBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
		cancelBtn.textContent = localize('cancel', "取消");
		cancelBtn.addEventListener('click', () => this.hideForm());
	}

	private createInputGroup(parent: HTMLElement, label: string, type: string, value: string): HTMLInputElement {
		const group = append(parent, $('.chenille-form-group'));
		append(group, $('.chenille-form-label')).textContent = label;
		const input = append(group, $('input.chenille-form-input')) as HTMLInputElement;
		input.type = type;
		input.value = value;
		return input;
	}

	private hideForm(): void {
		if (!this.formContainer || !this.listContainer) {
			return;
		}

		this.editingModel = undefined;
		this.formInputs = undefined;
		this.formContainer.style.display = 'none';
		this.listContainer.style.display = 'flex';
		this.renderList();
	}

	private async saveModel(): Promise<void> {
		if (!this.formInputs) {
			return;
		}

		const model: AiModel = {
			name: this.formInputs.name.value,
			provider: this.formInputs.provider.value as AiProvider,
			baseUrl: this.formInputs.baseUrl.value,
			apiKey: this.formInputs.apiKey.value,
			model: this.formInputs.model.value,
			contextSize: parseInt(this.formInputs.contextSize.value) || 4096,
			maxTokens: parseInt(this.formInputs.maxTokens.value) || 2048,
			temperature: parseFloat(this.formInputs.temperature.value) || 0.7,
		};

		if (!model.name) {
			alert(localize('nameRequired', "名称不能为空"));
			return;
		}

		// 添加新时检查重复名称
		if (!this.editingModel && await this.modelStorage.get(model.name)) {
			alert(localize('nameDuplicate', "名称已存在"));
			return;
		}

		await this.modelStorage.save(model);
		this.hideForm();
	}

	private async deleteModel(name: string): Promise<void> {
		if (confirm(localize('confirmDelete', "确定要删除模型 '{0}' 吗？", name))) {
			await this.modelStorage.delete(name);
			this.renderList();
		}
	}

	private getProviderLabel(provider: AiProvider): string {
		return PROVIDER_OPTIONS.find(p => p.value === provider)?.label ?? provider;
	}
}
