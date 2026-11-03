/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { localize } from '../../../nls.js';
import { IAiModelStorageService } from '../../common/storageIpc.js';
import { AiModel } from '../../common/types.js';
import { IDeepSeekBalance, INetworkToolsService, isOfficialDeepSeekModel } from '../../common/networkTools.js';

/**
 * 搜索与抓取配置
 * 只允许选择已添加的官方 DeepSeek 模型；未选择时不注入 DeepSeek 工具。
 */
export class NetworkToolsPanel extends Disposable {
	private selectedModelName: string | undefined;
	private models: AiModel[] = [];
	private balanceContainer: HTMLElement | undefined;
	private statusText: HTMLElement | undefined;

	constructor(
		private readonly container: HTMLElement,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
		@INetworkToolsService private readonly networkToolsService: INetworkToolsService,
	) {
		super();
		this.render();
	}

	private render(): void {
		const header = append(this.container, $('.chenille-panel-header'));
		append(header, $('.chenille-panel-title')).textContent = localize('searchAndFetch', "搜索与抓取");

		const refreshBtn = append(header, $('button.chenille-btn.chenille-btn-secondary'));
		append(refreshBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.refresh)}`));
		append(refreshBtn, document.createTextNode(localize('refresh', "刷新")));
		refreshBtn.addEventListener('click', () => this.renderAsync());

		const hint = append(this.container, $('.chenille-panel-hint'));
		hint.textContent = localize('searchAndFetchHint',
			"选择一个已添加的官方 DeepSeek 模型，即可启用 DeepSeek 联网搜索与抓取。未选择时不会向 AI 注入 DeepSeek 工具，AI 只会使用 Chenille 自建的网页抓取。");
		hint.style.fontSize = '12px';
		hint.style.color = 'var(--vscode-descriptionForeground)';
		hint.style.padding = '0 16px 12px';
		hint.style.lineHeight = '1.6';

		const form = append(this.container, $('.chenille-form'));
		form.style.padding = '0 16px';

		const group = append(form, $('.chenille-form-group'));
		append(group, $('.chenille-form-label')).textContent = localize('deepseekModel', "DeepSeek 模型");

		const select = append(group, $('select.chenille-form-select')) as HTMLSelectElement;
		select.addEventListener('change', () => this.onSelectChange(select.value));

		const selectHint = append(group, $('.chenille-form-hint'));
		selectHint.textContent = localize('deepseekModelHint',
			"仅列出 Base URL 指向官方 api.deepseek.com 的模型；API Key 直接复用模型配置中的密钥。");

		this.statusText = append(this.container, $('.chenille-panel-hint'));
		this.statusText.style.fontSize = '12px';
		this.statusText.style.padding = '8px 16px';
		this.statusText.style.color = 'var(--vscode-descriptionForeground)';

		this.balanceContainer = append(this.container, $('.chenille-balance-container'));

		// 工具说明
		const toolSection = append(this.container, $('.chenille-section'));
		toolSection.style.padding = '16px';
		append(toolSection, $('.chenille-section-title')).textContent = localize('networkToolsTitle', "可用工具");
		const toolsHint = append(toolSection, $('.chenille-panel-hint'));
		toolsHint.style.fontSize = '12px';
		toolsHint.style.color = 'var(--vscode-descriptionForeground)';
		toolsHint.style.lineHeight = '1.7';
		toolsHint.textContent = localize('networkToolsList',
			"• webFetch：Chenille 自建网页抓取，始终可用，工具描述中会提示 AI 优先使用它。\n• deepseekSearch：DeepSeek 官方联网搜索，仅在已选择上方模型时注入。\n• deepseekFetch：DeepSeek 官方网页抓取，仅在已选择上方模型时注入，作为 webFetch 的备用方案。");

		this.renderAsync(select);
	}

	private async renderAsync(select?: HTMLSelectElement): Promise<void> {
		const [models, config] = await Promise.all([
			this.modelStorage.getAll(),
			this.networkToolsService.getDeepSeekConfig(),
		]);

		this.models = models.filter(isOfficialDeepSeekModel);
		this.selectedModelName = config.modelName;

		const selectElement = select ?? this.container.querySelector<HTMLSelectElement>('select.chenille-form-select');
		if (!selectElement) {
			return;
		}

		clearNode(selectElement);
		const emptyOption = append(selectElement, $('option')) as HTMLOptionElement;
		emptyOption.value = '';
		emptyOption.textContent = localize('deepseekNotUsed', "不使用（仅自建 webFetch）");

		for (const model of this.models) {
			const option = append(selectElement, $('option')) as HTMLOptionElement;
			option.value = model.name;
			option.textContent = `${model.name}（${model.model}）`;
		}

		// 配置中的模型已被删除或不再是官方 DeepSeek 时，重置选择
		if (this.selectedModelName && !this.models.some(model => model.name === this.selectedModelName)) {
			this.selectedModelName = undefined;
			await this.networkToolsService.setDeepSeekConfig({});
		}

		selectElement.value = this.selectedModelName ?? '';

		if (this.statusText) {
			this.statusText.textContent = this.models.length === 0
				? localize('noDeepSeekModels', "尚未添加官方 DeepSeek 模型，请先到「模型配置」中添加，Base URL 使用 https://api.deepseek.com。")
				: this.selectedModelName
					? localize('deepseekEnabled', "已启用 DeepSeek 搜索与抓取：{0}", this.selectedModelName)
					: localize('deepseekDisabled', "未启用 DeepSeek 搜索与抓取，AI 不会看到 DeepSeek 工具。");
		}

		await this.renderBalance();
	}

	private async onSelectChange(modelName: string): Promise<void> {
		this.selectedModelName = modelName || undefined;
		await this.networkToolsService.setDeepSeekConfig({ modelName: this.selectedModelName });

		if (this.statusText) {
			this.statusText.textContent = this.selectedModelName
				? localize('deepseekEnabled', "已启用 DeepSeek 搜索与抓取：{0}", this.selectedModelName)
				: localize('deepseekDisabled', "未启用 DeepSeek 搜索与抓取，AI 不会看到 DeepSeek 工具。");
		}

		await this.renderBalance();
	}

	private async renderBalance(): Promise<void> {
		if (!this.balanceContainer) {
			return;
		}
		clearNode(this.balanceContainer);

		if (!this.selectedModelName) {
			return;
		}

		const card = append(this.balanceContainer, $('.chenille-balance-card'));
		const headerRow = append(card, $('.chenille-balance-header'));
		const title = append(headerRow, $('.chenille-balance-title'));
		append(title, $(`span${ThemeIcon.asCSSSelector(Codicon.account)}`));
		append(title, document.createTextNode(localize('deepseekBalance', "DeepSeek 余额")));

		const refreshBtn = append(headerRow, $('button.chenille-btn.chenille-btn-secondary'));
		refreshBtn.textContent = localize('refresh', "刷新");
		refreshBtn.addEventListener('click', () => this.renderBalance());

		const body = append(card, $('.chenille-balance-body'));
		body.textContent = localize('balanceLoading', "正在查询余额…");

		try {
			const balance = await this.networkToolsService.getDeepSeekBalance(this.selectedModelName);
			clearNode(body);

			if (!balance) {
				body.textContent = localize('balanceUnavailable', "无法查询余额：所选模型不是官方 DeepSeek 模型。");
				return;
			}

			if (!balance.isAvailable) {
				const warning = append(body, $('.chenille-balance-warning'));
				warning.textContent = localize('balanceNotAvailable', "账户当前不可用（is_available = false），请检查账户状态。");
			}

			if (balance.infos.length === 0) {
				body.textContent = localize('balanceEmpty', "接口未返回余额信息。");
				return;
			}

			for (const info of balance.infos) {
				this.renderBalanceInfo(body, info.currency, info);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			body.textContent = localize('balanceError', "查询余额失败：{0}", message);
		}
	}

	private renderBalanceInfo(body: HTMLElement, currency: string, info: IDeepSeekBalance['infos'][number]): void {
		const row = append(body, $('.chenille-balance-row'));
		const currencyLabel = append(row, $('.chenille-balance-currency'));
		currencyLabel.textContent = currency === 'USD' ? '美元 (USD)' : '人民币 (CNY)';

		const total = append(row, $('.chenille-balance-total'));
		total.textContent = localize('balanceTotal', "总余额：{0}", info.totalBalance);

		const detail = append(row, $('.chenille-balance-detail'));
		detail.textContent = localize('balanceDetail',
			"赠送余额：{0}　充值余额：{1}",
			info.grantedBalance,
			info.toppedUpBalance);
	}
}
