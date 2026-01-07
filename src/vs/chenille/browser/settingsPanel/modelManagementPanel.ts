/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IAiModelStorageService } from '../../common/storageIpc.js';
import { AiModel, AiProvider, getFullEndpointUrl } from '../../common/types.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
	{ value: AiProvider.OPENAI, label: 'OpenAI (兼容)' },
	{ value: AiProvider.ANTHROPIC, label: 'Anthropic' },
	{ value: AiProvider.GOOGLE, label: 'Google' },
];

interface FormInputs {
	name: HTMLInputElement;
	provider: HTMLSelectElement;
	baseUrl: HTMLInputElement;
	baseUrlPreview: HTMLElement;
	apiKey: HTMLInputElement;
	model: HTMLInputElement;
	contextSize: HTMLInputElement;
	maxTokens: HTMLInputElement;
	temperature: HTMLInputElement;
	supportsVision: HTMLInputElement;
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
		const baseUrlGroup = append(this.formContainer, $('.chenille-form-group'));
		append(baseUrlGroup, $('.chenille-form-label')).textContent = localize('baseUrl', "Base URL");
		const baseUrlInput = append(baseUrlGroup, $('input.chenille-form-input')) as HTMLInputElement;
		baseUrlInput.type = 'text';
		baseUrlInput.value = model?.baseUrl ?? '';
		baseUrlInput.placeholder = 'https://api.openai.com';

		// URL 预览
		const baseUrlPreview = append(baseUrlGroup, $('.chenille-form-hint'));
		baseUrlPreview.style.fontSize = '12px';
		baseUrlPreview.style.color = 'var(--vscode-descriptionForeground)';
		baseUrlPreview.style.marginTop = '4px';
		baseUrlPreview.style.wordBreak = 'break-all';

		// 更新 URL 预览的函数
		const updateUrlPreview = () => {
			const provider = providerSelect.value as AiProvider;

			// 所有供应商都支持自定义 baseURL
			baseUrlInput.disabled = false;

			if (provider === AiProvider.GOOGLE) {
				baseUrlInput.placeholder = 'https://generativelanguage.googleapis.com';
				const baseUrl = baseUrlInput.value.trim();
				if (baseUrl) {
					baseUrlPreview.textContent = `→ ${baseUrl}/v1beta/models/{model}:generateContent`;
				} else {
					baseUrlPreview.textContent = localize('googleBaseUrlHint', "留空使用官方 API，或输入自定义地址");
				}
			} else {
				baseUrlInput.placeholder = 'https://api.openai.com';
				const baseUrl = baseUrlInput.value.trim();
				if (baseUrl) {
					const fullUrl = getFullEndpointUrl(baseUrl, provider);
					baseUrlPreview.textContent = `→ ${fullUrl}`;
				} else {
					baseUrlPreview.textContent = localize('baseUrlHint', "请输入 API 地址，将自动拼接端点路径");
				}
			}
		};

		// 监听变化
		baseUrlInput.addEventListener('input', updateUrlPreview);
		providerSelect.addEventListener('change', updateUrlPreview);
		updateUrlPreview(); // 初始化

		// ApiKey
		const apiKeyInput = this.createInputGroup(this.formContainer, localize('apiKey', "API Key"), 'password', model?.apiKey ?? '');

		// 模型
		const modelInput = this.createInputGroup(this.formContainer, localize('model', "模型"), 'text', model?.model ?? '');

		// 上下文大小
		const contextSizeInput = this.createInputGroup(this.formContainer, localize('contextSize', "上下文大小"), 'number', String(model?.contextSize ?? 128000));

		// 最大输出Token
		const maxTokensInput = this.createInputGroup(this.formContainer, localize('maxTokens', "最大输出Token"), 'number', String(model?.maxTokens ?? 8192));

		// 温度
		const temperatureInput = this.createInputGroup(this.formContainer, localize('temperature', "温度 (0-2)"), 'number', String(model?.temperature ?? 0.7));
		temperatureInput.step = '0.1';
		temperatureInput.min = '0';
		temperatureInput.max = '2';

		// 支持图像分析
		const visionGroup = append(this.formContainer, $('.chenille-form-group.chenille-form-group-checkbox'));
		const visionLabel = append(visionGroup, $('label.chenille-form-checkbox-label'));
		const visionInput = append(visionLabel, $('input.chenille-form-checkbox')) as HTMLInputElement;
		visionInput.type = 'checkbox';
		visionInput.checked = model?.supportsVision ?? false;
		append(visionLabel, document.createTextNode(localize('supportsVision', "支持图像分析")));
		const visionHint = append(visionGroup, $('.chenille-form-hint'));
		visionHint.textContent = localize('supportsVisionHint', "启用后可在聊天中粘贴或附加图片");

		this.formInputs = {
			name: nameInput,
			provider: providerSelect,
			baseUrl: baseUrlInput,
			baseUrlPreview: baseUrlPreview,
			apiKey: apiKeyInput,
			model: modelInput,
			contextSize: contextSizeInput,
			maxTokens: maxTokensInput,
			temperature: temperatureInput,
			supportsVision: visionInput,
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
			contextSize: parseInt(this.formInputs.contextSize.value) || 128000,
			maxTokens: parseInt(this.formInputs.maxTokens.value) || 8192,
			temperature: parseFloat(this.formInputs.temperature.value) || 0.7,
			supportsVision: this.formInputs.supportsVision.checked,
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
