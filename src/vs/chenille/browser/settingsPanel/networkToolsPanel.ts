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
import { INetworkToolsService, isOfficialDeepSeekModel } from '../../common/networkTools.js';

/**
 * 搜索与抓取配置
 * 只允许选择已添加的官方 DeepSeek 模型；未选择时不注入 DeepSeek 工具。
 */
export class NetworkToolsPanel extends Disposable {
	private selectedModelName: string | undefined;
	private models: AiModel[] = [];

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

		const form = append(this.container, $('.chenille-form'));
		form.style.padding = '0 16px';

		const group = append(form, $('.chenille-form-group'));
		append(group, $('.chenille-form-label')).textContent = localize('deepseekModel', "DeepSeek 模型");

		const select = append(group, $('select.chenille-form-select')) as HTMLSelectElement;
		select.addEventListener('change', () => this.onSelectChange(select.value));

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
	}

	private async onSelectChange(modelName: string): Promise<void> {
		this.selectedModelName = modelName || undefined;
		await this.networkToolsService.setDeepSeekConfig({ modelName: this.selectedModelName });
	}
}
