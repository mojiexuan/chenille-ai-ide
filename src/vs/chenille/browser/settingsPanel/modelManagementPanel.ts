/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IAiAgentStorageService, IAiModelStorageService } from '../../common/storageIpc.js';
import { AgentType, AiModel, AiProvider, getFullEndpointUrl } from '../../common/types.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IDeepSeekBalance, INetworkToolsService, isOfficialDeepSeekModel } from '../../common/networkTools.js';

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
	{ value: AiProvider.OPENAI, label: 'OpenAI (兼容)' },
	{ value: AiProvider.ANTHROPIC, label: 'Anthropic' },
	{ value: AiProvider.GOOGLE, label: 'Google' },
];

/** DeepSeek 预设：模型、地址和上下文窗口按官方文档预填，API Key 仍需用户填写 */
const DEEPSEEK_PRESET: Partial<AiModel> = {
	name: 'DeepSeek',
	provider: AiProvider.OPENAI,
	baseUrl: 'https://api.deepseek.com',
	model: 'deepseek-flash',
	contextSize: 1048576,
	maxTokens: 65536,
	temperature: 0.7,
	supportsVision: true,
};

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
	private addBtn: HTMLElement | undefined;
	private presetBtn: HTMLElement | undefined;
	private activeModelName: string | undefined;
	private headerActions: HTMLElement | undefined;
	private balanceContainer: HTMLElement | undefined;

	constructor(
		parent: HTMLElement,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
		@IAiAgentStorageService private readonly agentStorage: IAiAgentStorageService,
		@INetworkToolsService private readonly networkToolsService: INetworkToolsService,
	) {
		super();
		this.container = parent;
		this.render();
	}

	private render(): void {
		// 头
		const header = append(this.container, $('.chenille-panel-header'));
		append(header, $('.chenille-panel-title')).textContent = localize('modelManagement', "模型配置");

		// 右侧操作区域
		this.headerActions = append(header, $('.chenille-panel-header-actions'));

		this.presetBtn = append(this.headerActions, $('button.chenille-btn.chenille-btn-secondary'));
		append(this.presetBtn, document.createTextNode(localize('deepseekPreset', "DeepSeek 预设")));
		this.presetBtn.style.marginRight = '8px';
		this.presetBtn.addEventListener('click', () => this.showForm(undefined, DEEPSEEK_PRESET));

		this.addBtn = append(this.headerActions, $('button.chenille-btn.chenille-btn-primary'));
		append(this.addBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
		append(this.addBtn, document.createTextNode(localize('addModel', "添加模型")));
		this.addBtn.addEventListener('click', () => this.showForm());

		// 说明：所有智能体共用当前模型
		const hint = append(this.container, $('.chenille-panel-hint'));
		hint.textContent = localize('singleModelHint', "聊天、提交消息和代码补全统一使用当前模型，提示词已内置，无需额外配置。");
		hint.style.fontSize = '12px';
		hint.style.color = 'var(--vscode-descriptionForeground)';
		hint.style.padding = '0 16px 8px';

		// 官方 DeepSeek 余额（仅当前模型为官方 DeepSeek 时显示）
		this.balanceContainer = append(this.container, $('.chenille-balance-container'));
		this.balanceContainer.style.paddingTop = '4px';

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

		const [models, config] = await Promise.all([
			this.modelStorage.getAll(),
			this.agentStorage.get(AgentType.CODE_WRITER),
		]);
		const selected = config?.modelName ? models.find(model => model.name === config.modelName) : undefined;
		const activeModel = selected ?? models[0];
		this.activeModelName = activeModel?.name;

		this.renderBalance(activeModel);

		if (models.length === 0) {
			const empty = append(this.listContainer, $('.chenille-empty-state'));
			empty.textContent = localize('noModels', "暂无模型，点击「DeepSeek 预设」或「添加模型」开始配置");
			return;
		}

		for (const model of models) {
			const item = append(this.listContainer, $('.chenille-list-item'));

			const info = append(item, $('.chenille-list-item-info'));
			const nameRow = append(info, $('.chenille-list-item-name'));
			nameRow.textContent = model.name;
			if (model.name === this.activeModelName) {
				const badge = append(nameRow, $('span.chenille-model-badge'));
				badge.textContent = localize('activeModel', "当前");
				badge.style.marginLeft = '8px';
				badge.style.fontSize = '11px';
				badge.style.padding = '1px 6px';
				badge.style.borderRadius = '8px';
				badge.style.color = 'var(--vscode-badge-foreground)';
				badge.style.backgroundColor = 'var(--vscode-badge-background)';
			}
			append(info, $('.chenille-list-item-desc')).textContent =
				`${this.getProviderLabel(model.provider)} | ${model.model} | ${model.contextSize.toLocaleString()} 上下文`;

			const actions = append(item, $('.chenille-list-item-actions'));

			if (model.name !== this.activeModelName) {
				const activateBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
				append(activateBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.check)}`));
				append(activateBtn, document.createTextNode(localize('setActiveModel', "设为当前")));
				activateBtn.style.marginRight = '8px';
				activateBtn.addEventListener('click', () => this.setActiveModel(model.name));
			}

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

	/**
	 * 当前模型为官方 DeepSeek 时，直接显示账户余额
	 */
	private async renderBalance(model: AiModel | undefined): Promise<void> {
		if (!this.balanceContainer) {
			return;
		}
		clearNode(this.balanceContainer);

		if (!isOfficialDeepSeekModel(model)) {
			return;
		}

		const card = append(this.balanceContainer, $('.chenille-balance-card'));
		const headerRow = append(card, $('.chenille-balance-header'));
		const title = append(headerRow, $('.chenille-balance-title'));
		append(title, $(`span${ThemeIcon.asCSSSelector(Codicon.account)}`));
		append(title, document.createTextNode(localize('deepseekBalance', "DeepSeek 余额")));

		const refreshBtn = append(headerRow, $('button.chenille-btn.chenille-btn-secondary'));
		refreshBtn.textContent = localize('refresh', "刷新");
		refreshBtn.addEventListener('click', () => this.renderBalance(model));

		const body = append(card, $('.chenille-balance-body'));
		body.textContent = localize('balanceLoading', "正在查询余额…");

		try {
			const balance = await this.networkToolsService.getDeepSeekBalance(model.name);
			clearNode(body);

			if (!balance) {
				body.textContent = localize('balanceUnavailable', "无法查询余额：该模型不是官方 DeepSeek 模型。");
				return;
			}

			if (!balance.isAvailable) {
				append(body, $('.chenille-balance-warning')).textContent =
					localize('balanceNotAvailable', "账户当前不可用（is_available = false），请检查账户状态。");
			}

			if (balance.infos.length === 0) {
				append(body, document.createTextNode(localize('balanceEmpty', "接口未返回余额信息。")));
				return;
			}

			for (const info of balance.infos) {
				this.appendBalanceRow(body, info);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			body.textContent = localize('balanceError', "查询余额失败：{0}", message);
		}
	}

	private appendBalanceRow(body: HTMLElement, info: IDeepSeekBalance['infos'][number]): void {
		const row = append(body, $('.chenille-balance-row'));
		append(row, $('.chenille-balance-currency')).textContent = info.currency === 'USD' ? '美元 (USD)' : '人民币 (CNY)';
		append(row, $('.chenille-balance-total')).textContent = localize('balanceTotal', "总余额：{0}", info.totalBalance);
		append(row, $('.chenille-balance-detail')).textContent = localize('balanceDetail',
			"赠送余额：{0}　充值余额：{1}", info.grantedBalance, info.toppedUpBalance);
	}

	private async setActiveModel(name: string): Promise<void> {
		await this.agentStorage.save({ type: AgentType.CODE_WRITER, modelName: name });
		await this.renderList();
	}

	private showForm(model?: AiModel, preset?: Partial<AiModel>): void {
		if (!this.formContainer || !this.listContainer || !this.headerActions || !this.addBtn || !this.presetBtn) {
			return;
		}

		const initial: Partial<AiModel> = model ?? preset ?? {};
		this.editingModel = model;
		this.listContainer.style.display = 'none';
		this.formContainer.style.display = 'flex';

		// 隐藏添加按钮，显示保存/取消按钮
		this.addBtn.style.display = 'none';
		this.presetBtn.style.display = 'none';
		this.renderHeaderActions();

		clearNode(this.formContainer);

		// 名称
		const nameInput = this.createInputGroup(this.formContainer, localize('modelName', "名称"), 'text', initial.name ?? '');
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
			if (initial.provider === opt.value) {
				option.selected = true;
			}
		}

		// BaseUrl
		const baseUrlGroup = append(this.formContainer, $('.chenille-form-group'));
		append(baseUrlGroup, $('.chenille-form-label')).textContent = localize('baseUrl', "Base URL");
		const baseUrlInput = append(baseUrlGroup, $('input.chenille-form-input')) as HTMLInputElement;
		baseUrlInput.type = 'text';
		baseUrlInput.value = initial.baseUrl ?? '';
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
		const apiKeyInput = this.createInputGroup(this.formContainer, localize('apiKey', "API Key"), 'password', initial.apiKey ?? '');

		// 模型
		const modelInput = this.createInputGroup(this.formContainer, localize('model', "模型"), 'text', initial.model ?? '');

		// 上下文大小
		const contextSizeInput = this.createInputGroup(this.formContainer, localize('contextSize', "上下文大小"), 'number', String(initial.contextSize ?? 128000));

		// 最大输出Token
		const maxTokensInput = this.createInputGroup(this.formContainer, localize('maxTokens', "最大输出Token"), 'number', String(initial.maxTokens ?? 8192));

		// 温度
		const temperatureInput = this.createInputGroup(this.formContainer, localize('temperature', "温度 (0-2)"), 'number', String(initial.temperature ?? 0.7));
		temperatureInput.step = '0.1';
		temperatureInput.min = '0';
		temperatureInput.max = '2';

		// 支持图像分析
		const visionGroup = append(this.formContainer, $('.chenille-form-group.chenille-form-group-checkbox'));
		const visionLabel = append(visionGroup, $('label.chenille-form-checkbox-label'));
		const visionInput = append(visionLabel, $('input.chenille-form-checkbox')) as HTMLInputElement;
		visionInput.type = 'checkbox';
		visionInput.checked = initial.supportsVision ?? false;
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
	}

	private renderHeaderActions(): void {
		if (!this.headerActions || !this.addBtn || !this.presetBtn) {
			return;
		}

		// 清除保存/取消按钮，保留预设和添加按钮
		const children = Array.from(this.headerActions.children);
		for (const child of children) {
			if (child !== this.addBtn && child !== this.presetBtn) {
				child.remove();
			}
		}

		// 添加取消按钮
		const cancelBtn = append(this.headerActions, $('button.chenille-btn.chenille-btn-secondary'));
		append(cancelBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.close)}`));
		append(cancelBtn, document.createTextNode(localize('cancel', "取消")));
		cancelBtn.style.marginRight = '8px';
		cancelBtn.addEventListener('click', () => this.hideForm());

		// 添加保存按钮
		const saveBtn = append(this.headerActions, $('button.chenille-btn.chenille-btn-primary'));
		append(saveBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.check)}`));
		append(saveBtn, document.createTextNode(localize('save', "保存")));
		saveBtn.addEventListener('click', () => this.saveModel());
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
		if (!this.formContainer || !this.listContainer || !this.headerActions || !this.addBtn || !this.presetBtn) {
			return;
		}

		this.editingModel = undefined;
		this.formInputs = undefined;
		this.formContainer.style.display = 'none';
		this.listContainer.style.display = 'flex';

		// 恢复按钮，移除保存/取消按钮
		this.addBtn.style.display = '';
		this.presetBtn.style.display = '';
		const children = Array.from(this.headerActions.children);
		for (const child of children) {
			if (child !== this.addBtn && child !== this.presetBtn) {
				child.remove();
			}
		}

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

		if (!model.apiKey.trim()) {
			alert(localize('apiKeyRequired', "API Key 不能为空"));
			return;
		}

		await this.modelStorage.save(model);
		// 新保存的模型立即成为当前模型
		await this.agentStorage.save({ type: AgentType.CODE_WRITER, modelName: model.name });
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
