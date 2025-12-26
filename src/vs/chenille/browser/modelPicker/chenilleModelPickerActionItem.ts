/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../../base/common/actions.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import * as dom from '../../../base/browser/dom.js';
import { renderLabelWithIcons } from '../../../base/browser/ui/iconLabel/iconLabels.js';
import { ActionWidgetDropdownActionViewItem } from '../../../platform/actions/browser/actionWidgetDropdownActionViewItem.js';
import { IActionWidgetService } from '../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownActionProvider, IActionWidgetDropdownOptions } from '../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IActionProvider } from '../../../base/browser/ui/dropdown/dropdown.js';
import { IAiModelStorageService, IAiAgentStorageService } from '../../common/storageIpc.js';
import { AgentType, AiModel } from '../../common/types.js';
import { CHENILLE_SETTINGS_ACTION_ID } from '../settingsPanel/chenilleSettingsAction.js';

/** 每页显示的模型数量 */
const PAGE_SIZE = 8;

/** 分类配置 */
const CHENILLE_MODEL_CATEGORY = { label: localize('chenille.modelPicker.category', "Chenille 模型"), order: 0 };

/**
 * Chenille 模型选择器代理接口
 */
export interface IChenilleModelPickerDelegate {
	readonly onDidChangeModel: Event<string | undefined>;
	readonly onDidChangeModels: Event<void>;
	getCurrentModelName(): string | undefined;
	setModel(modelName: string): Promise<void>;
	getModels(): AiModel[];
	refresh(): Promise<void>;
}

/**
 * Chenille 模型选择器代理实现
 * 负责管理模型列表和当前选中的模型
 */
export class ChenilleModelPickerDelegate extends Disposable implements IChenilleModelPickerDelegate {
	private readonly _onDidChangeModel = this._register(new Emitter<string | undefined>());
	readonly onDidChangeModel = this._onDidChangeModel.event;

	private readonly _onDidChangeModels = this._register(new Emitter<void>());
	readonly onDidChangeModels = this._onDidChangeModels.event;

	private _currentModelName: string | undefined;
	private _models: AiModel[] = [];

	constructor(
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
		@IAiAgentStorageService private readonly agentStorage: IAiAgentStorageService,
	) {
		super();
		this.refresh();
	}

	async refresh(): Promise<void> {
		const [models, config] = await Promise.all([
			this.modelStorage.getAll(),
			this.agentStorage.get(AgentType.CODE_WRITER)
		]);
		this._models = models;
		this._currentModelName = config?.modelName;
		this._onDidChangeModels.fire();
		this._onDidChangeModel.fire(this._currentModelName);
	}

	getCurrentModelName(): string | undefined {
		return this._currentModelName;
	}

	getModels(): AiModel[] {
		return this._models;
	}

	async setModel(modelName: string): Promise<void> {
		const config = await this.agentStorage.get(AgentType.CODE_WRITER);
		await this.agentStorage.save({
			type: AgentType.CODE_WRITER,
			modelName: modelName,
			promptName: config?.promptName ?? '',
		});
		this._currentModelName = modelName;
		this._onDidChangeModel.fire(modelName);
	}
}


/**
 * 分页状态管理
 */
class PaginationState {
	private _currentPage = 0;

	constructor(private readonly pageSize: number) { }

	get currentPage(): number {
		return this._currentPage;
	}

	reset(): void {
		this._currentPage = 0;
	}

	canGoPrev(): boolean {
		return this._currentPage > 0;
	}

	canGoNext(totalItems: number): boolean {
		return (this._currentPage + 1) * this.pageSize < totalItems;
	}

	goPrev(): void {
		if (this.canGoPrev()) {
			this._currentPage--;
		}
	}

	goNext(totalItems: number): void {
		if (this.canGoNext(totalItems)) {
			this._currentPage++;
		}
	}

	getPageItems<T>(items: T[]): T[] {
		const start = this._currentPage * this.pageSize;
		return items.slice(start, start + this.pageSize);
	}

	getTotalPages(totalItems: number): number {
		return Math.ceil(totalItems / this.pageSize);
	}
}

/**
 * 创建模型列表的 Action Provider（带分页）
 */
function createModelActionsProvider(
	delegate: IChenilleModelPickerDelegate,
	commandService: ICommandService,
	pagination: PaginationState
): IActionWidgetDropdownActionProvider {
	return {
		getActions: () => {
			const models = delegate.getModels();
			const currentModelName = delegate.getCurrentModelName();

			// 无模型时显示"添加模型"
			if (models.length === 0) {
				return [{
					id: 'addModel',
					enabled: true,
					checked: false,
					category: CHENILLE_MODEL_CATEGORY,
					class: undefined,
					tooltip: localize('chenille.modelPicker.addModel.tooltip', "打开设置添加模型"),
					label: localize('chenille.modelPicker.addModel', "添加模型..."),
					run: () => {
						commandService.executeCommand(CHENILLE_SETTINGS_ACTION_ID);
					}
				}];
			}

			const actions: IActionWidgetDropdownAction[] = [];
			const needsPagination = models.length > PAGE_SIZE;

			// 上一页按钮
			if (needsPagination && pagination.canGoPrev()) {
				actions.push({
					id: 'prevPage',
					enabled: true,
					checked: false,
					category: CHENILLE_MODEL_CATEGORY,
					class: undefined,
					tooltip: localize('chenille.modelPicker.prevPage', "上一页"),
					label: `$(chevron-up) ${localize('chenille.modelPicker.prevPage', "上一页")}`,
					run: () => {
						pagination.goPrev();
					}
				});
			}

			// 当前页的模型
			const pageModels = pagination.getPageItems(models);
			for (const model of pageModels) {
				actions.push({
					id: model.name,
					enabled: true,
					checked: model.name === currentModelName,
					category: CHENILLE_MODEL_CATEGORY,
					class: undefined,
					tooltip: model.name,
					label: model.name,
					run: () => {
						delegate.setModel(model.name);
					}
				});
			}

			// 下一页按钮
			if (needsPagination && pagination.canGoNext(models.length)) {
				actions.push({
					id: 'nextPage',
					enabled: true,
					checked: false,
					category: CHENILLE_MODEL_CATEGORY,
					class: undefined,
					tooltip: localize('chenille.modelPicker.nextPage', "下一页"),
					label: `$(chevron-down) ${localize('chenille.modelPicker.nextPage', "下一页")}`,
					run: () => {
						pagination.goNext(models.length);
					}
				});
			}

			// 分页信息
			if (needsPagination) {
				const totalPages = pagination.getTotalPages(models.length);
				actions.push({
					id: 'pageInfo',
					enabled: false,
					checked: false,
					category: CHENILLE_MODEL_CATEGORY,
					class: undefined,
					tooltip: '',
					label: localize('chenille.modelPicker.pageInfo', "第 {0}/{1} 页", pagination.currentPage + 1, totalPages),
					run: () => { }
				});
			}

			return actions;
		}
	};
}

/**
 * 创建底部操作栏的 Action Provider
 */
function createActionBarProvider(commandService: ICommandService): IActionProvider {
	return {
		getActions: () => [{
			id: 'manageChenilleModels',
			label: localize('chenille.modelPicker.manage', "管理模型..."),
			enabled: true,
			tooltip: localize('chenille.modelPicker.manage.tooltip', "打开 Chenille 设置"),
			class: undefined,
			run: () => {
				commandService.executeCommand(CHENILLE_SETTINGS_ACTION_ID);
			}
		}]
	};
}


/**
 * Chenille 模型选择器 Action View Item
 * 显示当前 Code Writer Agent 配置的模型，点击可切换
 */
export class ChenilleModelPickerActionItem extends ActionWidgetDropdownActionViewItem {
	private _currentModelName: string | undefined;
	private readonly pagination: PaginationState;

	constructor(
		action: IAction,
		delegate: IChenilleModelPickerDelegate,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		const pagination = new PaginationState(PAGE_SIZE);
		const initialModelName = delegate.getCurrentModelName();

		const actionWithLabel: IAction = {
			...action,
			label: initialModelName ?? localize('chenille.modelPicker.noModel', "添加模型"),
			tooltip: localize('chenille.modelPicker.tooltip', "选择 AI 模型"),
			run: () => { }
		};

		const options: Omit<IActionWidgetDropdownOptions, 'label' | 'labelRenderer'> = {
			actionProvider: createModelActionsProvider(delegate, commandService, pagination),
			actionBarActionProvider: createActionBarProvider(commandService),
		};

		super(actionWithLabel, options, actionWidgetService, keybindingService, contextKeyService);

		this.pagination = pagination;
		this._currentModelName = initialModelName;

		// 监听模型变化
		this._register(delegate.onDidChangeModel(modelName => {
			this._currentModelName = modelName;
			if (this.element) {
				this.renderLabel(this.element);
			}
		}));

		// 模型列表变化时重置分页
		this._register(delegate.onDidChangeModels(() => {
			this.pagination.reset();
		}));
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		const label = this._currentModelName ?? localize('chenille.modelPicker.noModel', "添加模型");

		const domChildren = [
			dom.$('span.chat-model-label', undefined, label),
			...renderLabelWithIcons('$(chevron-down)')
		];

		dom.reset(element, ...domChildren);
		this.setAriaLabelAttributes(element);
		return null;
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('chat-modelPicker-item');
		container.classList.add('chenille-modelPicker-item');
	}
}
