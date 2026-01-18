/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { Button } from '../../../base/browser/ui/button/button.js';
import { Checkbox } from '../../../base/browser/ui/toggle/toggle.js';
import { defaultCheckboxStyles } from '../../../platform/theme/browser/defaultStyles.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../platform/workspace/common/workspace.js';
import { IChenilleIndexingService, IIndexStatus, IIndexStats } from '../../common/indexing/indexingService.js';
import { IAiModelStorageService } from '../../common/storageIpc.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import type { AiModel } from '../../common/types.js';
import * as path from '../../../base/common/path.js';

/**
 * 单个工作区的 UI 状态
 */
interface WorkspaceUIState {
	container: HTMLElement;
	statusContainer: HTMLElement;
	statsContainer: HTMLElement;
	actionsContainer: HTMLElement;
	progressBar?: HTMLElement;
	progressText?: HTMLElement;
	status?: IIndexStatus;
	stats?: IIndexStats | null;
	disposables: DisposableStore;
}

/**
 * 索引管理面板
 * 支持多工作区的代码索引管理
 */
export class IndexManagementPanel extends Disposable {
	private container: HTMLElement;
	private workspaceListContainer: HTMLElement | undefined;

	/** 工作区路径列表 */
	private workspacePaths: string[] = [];

	/** 每个工作区的 UI 状态 */
	private workspaceUIStates: Map<string, WorkspaceUIState> = new Map();

	/** 模型列表缓存 */
	private models: AiModel[] = [];

	constructor(
		parent: HTMLElement,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IChenilleIndexingService private readonly indexingService: IChenilleIndexingService,
		@IAiModelStorageService private readonly modelStorageService: IAiModelStorageService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super();
		this.container = append(parent, $('.index-management-panel'));

		// 获取所有工作区路径
		const workspace = this.workspaceContextService.getWorkspace();
		this.workspacePaths = workspace.folders.map((folder: IWorkspaceFolder) => folder.uri.fsPath);

		this.render();
		this.loadAllStatus();

		// 监听状态变化（所有工作区）
		this._register(this.indexingService.onIndexStatusChanged(event => {
			const uiState = this.workspaceUIStates.get(event.workspacePath);
			if (uiState) {
				uiState.status = event.status;
				this.updateWorkspaceStatus(event.workspacePath);
			}
		}));

		// 监听进度事件（所有工作区）
		this._register(this.indexingService.onIndexProgress(event => {
			this.updateWorkspaceProgress(event.workspacePath, event.progress, event.description, event.indexedCount, event.totalCount);
		}));

		// 监听模型下载进度事件
		this._register(this.indexingService.onModelDownloadProgress(event => {
			this.updateModelDownloadProgress(event.workspacePath, event.progress);
		}));
	}

	private render(): void {
		// 标题
		const header = append(this.container, $('.index-panel-header'));
		append(header, $('h2')).textContent = localize('indexManagement', '索引管理');
		append(header, $('p.description')).textContent = localize(
			'indexDescriptionMulti',
			'管理工作区的代码索引。开启后可在对话中使用 @codebase 检索代码。'
		);

		// 工作区数量提示
		if (this.workspacePaths.length > 1) {
			const multiInfo = append(header, $('p.multi-workspace-info'));
			multiInfo.textContent = localize(
				'multiWorkspaceCount',
				'当前打开了 {0} 个工作区',
				this.workspacePaths.length
			);
		}

		// 工作区列表容器
		this.workspaceListContainer = append(this.container, $('.workspace-list'));

		if (this.workspacePaths.length === 0) {
			this.renderNoWorkspace();
			return;
		}

		// 为每个工作区创建卡片
		for (const wsPath of this.workspacePaths) {
			this.createWorkspaceCard(wsPath);
		}
	}

	/**
	 * 为单个工作区创建卡片 UI
	 */
	private createWorkspaceCard(workspacePath: string): void {
		if (!this.workspaceListContainer) {
			return;
		}

		const card = append(this.workspaceListContainer, $('.workspace-card'));

		// 卡片头部：工作区名称
		const cardHeader = append(card, $('.workspace-card-header'));
		const folderName = path.basename(workspacePath);
		append(cardHeader, $('h3.workspace-name')).textContent = folderName;
		append(cardHeader, $('span.workspace-path')).textContent = workspacePath;

		// 状态区域
		const statusContainer = append(card, $('.workspace-status'));

		// 统计区域
		const statsContainer = append(card, $('.workspace-stats'));

		// 操作区域
		const actionsContainer = append(card, $('.workspace-actions'));

		// 保存 UI 状态
		const uiState: WorkspaceUIState = {
			container: card,
			statusContainer,
			statsContainer,
			actionsContainer,
			disposables: this._register(new DisposableStore()),
		};
		this.workspaceUIStates.set(workspacePath, uiState);
	}

	/**
	 * 加载所有工作区的状态
	 */
	private async loadAllStatus(): Promise<void> {
		const loadPromises = this.workspacePaths.map(async (wsPath) => {
			try {
				const status = await this.indexingService.getIndexStatus(wsPath);
				const uiState = this.workspaceUIStates.get(wsPath);
				if (uiState) {
					uiState.status = status;
					this.updateWorkspaceStatus(wsPath);

					// 如果有索引，加载详细统计
					if (status.hasIndex) {
						uiState.stats = await this.indexingService.getIndexStats(wsPath);
						this.renderWorkspaceStats(wsPath);
					}
				}
			} catch (error) {
				console.error(`[IndexManagementPanel] 加载工作区状态失败: ${wsPath}`, error);
			}
		});

		await Promise.all(loadPromises);
	}

	/**
	 * 更新单个工作区的状态显示
	 */
	private updateWorkspaceStatus(workspacePath: string): void {
		const uiState = this.workspaceUIStates.get(workspacePath);
		if (!uiState || !uiState.status) {
			return;
		}

		const { statusContainer, disposables } = uiState;
		const status = uiState.status;

		clearNode(statusContainer);
		disposables.clear();

		// 本地模型开关行
		const localModelRow = append(statusContainer, $('.status-row.local-model-row'));
		const localModelLabel = append(localModelRow, $('span.label'));
		localModelLabel.textContent = localize('useLocalModel', '使用本地模型');

		const localModelCheckbox = disposables.add(new Checkbox(
			status.useLocalModel ? '已启用' : '未启用',
			!!status.useLocalModel,
			defaultCheckboxStyles
		));
		append(localModelRow, localModelCheckbox.domNode);

		// 本地模型状态提示
		if (status.useLocalModel) {
			const localModelHint = append(statusContainer, $('.status-row.hint-row'));
			const hint = append(localModelHint, $('span.hint'));
			if (status.isLocalModelReady) {
				hint.textContent = localize('localModelReady', '✓ 本地模型已准备就绪');
				hint.classList.add('ready');
			} else {
				hint.textContent = localize('localModelHint', '首次使用时将从 HuggingFace 下载模型（约 23MB），请保持网络畅通！');
			}
		}

		// 嵌入模型选择行
		const modelRow = append(statusContainer, $('.status-row.model-row'));
		append(modelRow, $('span.label')).textContent = localize('embeddingModel', '远程模型');

		const modelSelect = append(modelRow, $('select.model-select')) as HTMLSelectElement;
		// 默认选项
		const defaultOption = append(modelSelect, $('option')) as HTMLOptionElement;
		defaultOption.value = '';
		defaultOption.textContent = localize('selectModel', '-- 请选择模型 --');

		// 加载模型列表
		this.loadModelsToSelect(modelSelect, status.embeddingModelName);

		// 根据本地模型状态禁用/启用远程模型选择
		modelSelect.disabled = !!status.useLocalModel;
		if (status.useLocalModel) {
			modelRow.classList.add('disabled');
		}

		// 本地模型开关变更处理
		let isLocalModelUpdating = false;
		disposables.add(localModelCheckbox.onChange(async () => {
			if (isLocalModelUpdating) {
				return;
			}
			isLocalModelUpdating = true;
			try {
				const useLocal = localModelCheckbox.checked;
				// 如果已有索引且切换模式，弹窗确认
				if (status.hasIndex) {
					const confirmed = await this.dialogService.confirm({
						message: localize('confirmModelModeChange', '切换模型模式'),
						detail: localize('confirmModelModeChangeDetail', '切换模型模式后将删除该工作区的已有索引。是否继续？'),
						primaryButton: localize('confirm', '确认'),
						cancelButton: localize('cancel', '取消'),
					});

					if (!confirmed.confirmed) {
						localModelCheckbox.checked = !useLocal;
						return;
					}

					await this.indexingService.deleteIndex(workspacePath);
				}

				await this.indexingService.setUseLocalModel(workspacePath, useLocal);
			} finally {
				isLocalModelUpdating = false;
			}
		}));

		// 模型选择变更处理
		disposables.add({
			dispose: () => modelSelect.removeEventListener('change', onModelChange)
		});
		const previousModel = status.embeddingModelName || '';
		const onModelChange = async () => {
			const selectedModel = modelSelect.value;
			if (!selectedModel || selectedModel === previousModel) {
				return;
			}

			// 如果已有索引，弹窗确认
			if (status.hasIndex) {
				const confirmed = await this.dialogService.confirm({
					message: localize('confirmModelChange', '切换嵌入模型'),
					detail: localize('confirmModelChangeDetail', '切换模型后将删除该工作区的已有索引，需要重新建立索引。是否继续？'),
					primaryButton: localize('confirm', '确认切换'),
					cancelButton: localize('cancel', '取消'),
				});

				if (!confirmed.confirmed) {
					// 用户取消，恢复原选项
					modelSelect.value = previousModel;
					return;
				}

				// 删除旧索引
				await this.indexingService.deleteIndex(workspacePath);
			}

			// 设置新模型
			await this.indexingService.setEmbeddingModel(workspacePath, selectedModel);
		};
		modelSelect.addEventListener('change', onModelChange);

		// 错误信息显示
		if (status.errorMessage) {
			const errorRow = append(statusContainer, $('.status-row.error-row'));
			const errorMsg = append(errorRow, $('span.error-message'));
			errorMsg.textContent = `⚠ ${status.errorMessage}`;
		}

		// 索引开关行
		const toggleRow = append(statusContainer, $('.status-row.toggle-row'));
		append(toggleRow, $('span.label')).textContent = localize('indexEnabled', '启用索引');

		const checkbox = disposables.add(new Checkbox(
			status.isEnabled ? '关闭索引' : '开启索引',
			status.isEnabled,
			defaultCheckboxStyles
		));
		append(toggleRow, checkbox.domNode);

		// 防止循环：只在用户主动点击时触发
		let isUpdating = false;
		disposables.add(checkbox.onChange(async () => {
			if (isUpdating) {
				return;
			}
			isUpdating = true;
			try {
				await this.indexingService.setIndexEnabled(workspacePath, checkbox.checked);
			} finally {
				isUpdating = false;
			}
		}));

		// 并发配置行
		const concurrencyRow = append(statusContainer, $('.status-row.concurrency-row'));
		append(concurrencyRow, $('span.label')).textContent = localize('embeddingConcurrency', 'Embedding 并发数');

		const concurrencyWrapper = append(concurrencyRow, $('.concurrency-wrapper'));
		const concurrencyInput = append(concurrencyWrapper, $('input.chenille-form-input.concurrency-input')) as HTMLInputElement;
		concurrencyInput.type = 'number';
		concurrencyInput.min = '1';
		concurrencyInput.max = '1000';
		concurrencyInput.value = String(status.embeddingConcurrency ?? 3);
		concurrencyInput.title = localize('concurrencyHint', '设置 Embedding API 并发请求数（1-1000），重启后生效');
		concurrencyInput.placeholder = '3';

		const concurrencyHint = append(concurrencyWrapper, $('span.hint'));
		concurrencyHint.textContent = localize('restartRequired', '重启生效');

		const onConcurrencyChange = async () => {
			let value = parseInt(concurrencyInput.value, 10);
			// 验证输入范围
			if (isNaN(value) || value < 1 || value > 1000) {
				value = 3; // 意外输入重置为默认值
				concurrencyInput.value = '3';
			}
			await this.indexingService.setEmbeddingConcurrency(workspacePath, value);
		};
		concurrencyInput.addEventListener('change', onConcurrencyChange);
		disposables.add({
			dispose: () => concurrencyInput.removeEventListener('change', onConcurrencyChange)
		});

		// 状态网格
		const statusGrid = append(statusContainer, $('.status-grid'));

		// 索引状态
		this.renderStatusItem(statusGrid, localize('indexStatus', '状态'), () => {
			const value = document.createElement('span');
			value.className = 'value';
			if (status.isIndexing) {
				value.textContent = localize('indexing', '正在索引...');
				value.classList.add('indexing');
			} else if (status.hasIndex) {
				value.textContent = localize('indexed', '已建立');
				value.classList.add('success');
			} else {
				value.textContent = localize('notIndexed', '未建立');
				value.classList.add('warning');
			}
			return value;
		});

		// 索引进度（已索引/总文件数）
		this.renderStatusItem(statusGrid, localize('indexProgress', '进度'), () => {
			const value = document.createElement('span');
			value.className = 'value';
			value.setAttribute('data-progress-value', 'true');
			const indexed = status.indexedFileCount ?? 0;
			const total = status.totalFileCount ?? 0;
			if (total > 0) {
				value.textContent = `${indexed}/${total}`;
				if (indexed >= total) {
					value.classList.add('success');
				} else {
					value.classList.add('indexing');
				}
			} else {
				value.textContent = '0';
			}
			return value;
		});

		// 文件监听
		this.renderStatusItem(statusGrid, localize('fileWatching', '监听'), () => {
			const value = document.createElement('span');
			value.className = 'value';
			if (status.isWatching) {
				value.textContent = '✓';
				value.classList.add('success');
			} else {
				value.textContent = '✗';
			}
			return value;
		});

		// 最后更新
		if (status.lastIndexedAt) {
			this.renderStatusItem(statusGrid, localize('lastUpdate', '更新'), () => {
				const value = document.createElement('span');
				value.className = 'value';
				value.textContent = this.formatTime(status.lastIndexedAt!);
				return value;
			});
		}

		// 进度条（如果正在索引）
		if (status.isIndexing) {
			const progressContainer = append(statusContainer, $('.progress-container'));
			uiState.progressBar = append(progressContainer, $('.progress-bar'));
			// 使用已索引/总文件数作为进度
			const indexed = status.indexedFileCount ?? 0;
			const total = status.totalFileCount ?? 1;
			const progress = total > 0 ? (indexed / total) : 0.05;
			uiState.progressBar.style.width = `${progress * 100}%`;
			uiState.progressText = append(progressContainer, $('span.progress-text'));
			uiState.progressText.textContent = total > 0
				? `${indexed}/${total} 文件`
				: localize('indexingProgress', '正在索引...');
		} else {
			uiState.progressBar = undefined;
			uiState.progressText = undefined;
		}

		// 更新操作按钮
		this.renderWorkspaceActions(workspacePath);
	}

	private renderStatusItem(container: HTMLElement, label: string, createValue: () => HTMLElement): void {
		const item = append(container, $('.status-item'));
		append(item, $('span.label')).textContent = label;
		item.appendChild(createValue());
	}

	/**
	 * 渲染工作区操作按钮
	 */
	private renderWorkspaceActions(workspacePath: string): void {
		const uiState = this.workspaceUIStates.get(workspacePath);
		if (!uiState || !uiState.status) {
			return;
		}

		const { actionsContainer, disposables } = uiState;
		const status = uiState.status;

		clearNode(actionsContainer);

		// 建立索引按钮
		if (!status.hasIndex && !status.isIndexing && status.isEnabled) {
			const buildBtn = disposables.add(new Button(actionsContainer, {
				title: localize('buildIndex', '建立索引'),
			}));
			buildBtn.label = localize('buildIndex', '建立索引');
			buildBtn.element.classList.add('primary', 'small');

			disposables.add(buildBtn.onDidClick(async () => {
				console.log(`[IndexManagementPanel] 建立索引按钮点击: ${workspacePath}`);
				buildBtn.enabled = false;
				buildBtn.label = localize('indexing', '索引中...');

				// 立即更新状态为"正在索引"
				if (uiState.status) {
					uiState.status.isIndexing = true;
					this.updateWorkspaceStatus(workspacePath);
				}

				try {
					await this.indexingService.indexWorkspace({ workspacePath });
					console.log(`[IndexManagementPanel] 索引请求已发送: ${workspacePath}`);
				} catch (error) {
					console.error(`[IndexManagementPanel] 索引失败:`, error);
					// 恢复状态
					if (uiState.status) {
						uiState.status.isIndexing = false;
						this.updateWorkspaceStatus(workspacePath);
					}
				}
			}));
		}

		// 重建索引按钮
		if (status.hasIndex && !status.isIndexing) {
			const rebuildBtn = disposables.add(new Button(actionsContainer, {
				title: localize('rebuildIndex', '重建'),
			}));
			rebuildBtn.label = localize('rebuildIndex', '重建');
			rebuildBtn.element.classList.add('secondary', 'small');

			disposables.add(rebuildBtn.onDidClick(async () => {
				await this.indexingService.deleteIndex(workspacePath);
				await this.indexingService.indexWorkspace({ workspacePath });
			}));
		}

		// 删除索引按钮
		if (status.hasIndex && !status.isIndexing) {
			const deleteBtn = disposables.add(new Button(actionsContainer, {
				title: localize('deleteIndex', '删除'),
			}));
			deleteBtn.label = localize('deleteIndex', '删除');
			deleteBtn.element.classList.add('danger', 'small');

			disposables.add(deleteBtn.onDidClick(async () => {
				await this.indexingService.deleteIndex(workspacePath);
				// 刷新状态
				const newStatus = await this.indexingService.getIndexStatus(workspacePath);
				uiState.status = newStatus;
				uiState.stats = null;
				this.updateWorkspaceStatus(workspacePath);
				clearNode(uiState.statsContainer);
			}));
		}
	}

	/**
	 * 渲染工作区统计信息
	 */
	private renderWorkspaceStats(workspacePath: string): void {
		const uiState = this.workspaceUIStates.get(workspacePath);
		if (!uiState || !uiState.stats) {
			return;
		}

		const { statsContainer } = uiState;
		const stats = uiState.stats;

		clearNode(statsContainer);

		// 紧凑的统计显示
		const statsRow = append(statsContainer, $('.compact-stats'));

		// 文件数
		const filesStat = append(statsRow, $('.stat-badge'));
		append(filesStat, $('span.stat-icon.codicon.codicon-file'));
		append(filesStat, $('span.stat-text')).textContent = `${stats.uniqueFiles} 文件`;

		// 条目数
		const chunksStat = append(statsRow, $('.stat-badge'));
		append(chunksStat, $('span.stat-icon.codicon.codicon-symbol-snippet'));
		append(chunksStat, $('span.stat-text')).textContent = `${stats.totalChunks} 条目`;

		// 大小
		const sizeStat = append(statsRow, $('.stat-badge'));
		append(sizeStat, $('span.stat-icon.codicon.codicon-database'));
		append(sizeStat, $('span.stat-text')).textContent = this.formatBytes(stats.dbSizeBytes);

		// 语言分布（前3个）
		const langs = Object.entries(stats.languageDistribution)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3);

		if (langs.length > 0) {
			const langStat = append(statsRow, $('.stat-badge.langs'));
			append(langStat, $('span.stat-icon.codicon.codicon-code'));
			append(langStat, $('span.stat-text')).textContent = langs.map(([l]) => l).join(', ');
		}
	}

	/**
	 * 更新工作区进度
	 */
	private updateWorkspaceProgress(workspacePath: string, progress: number, description: string, indexedCount?: number, totalCount?: number): void {
		const uiState = this.workspaceUIStates.get(workspacePath);
		if (!uiState) {
			return;
		}

		// 如果进度条不存在，动态创建
		if (!uiState.progressBar && progress < 1) {
			const progressContainer = append(uiState.statusContainer, $('.progress-container'));
			uiState.progressBar = append(progressContainer, $('.progress-bar'));
			uiState.progressText = append(progressContainer, $('span.progress-text'));
		}

		if (uiState.progressBar) {
			uiState.progressBar.style.width = `${progress * 100}%`;
		}
		if (uiState.progressText) {
			// 如果有计数则显示，否则显示描述
			uiState.progressText.textContent = (indexedCount !== undefined && totalCount !== undefined)
				? `${indexedCount}/${totalCount} 文件`
				: description;
		}

		// 同时更新状态栏中的进度显示
		if (uiState.status && indexedCount !== undefined && totalCount !== undefined) {
			uiState.status.indexedFileCount = indexedCount;
			uiState.status.totalFileCount = totalCount;
			this.updateStatusGridProgress(workspacePath, indexedCount, totalCount);
		}

		// 索引完成时刷新状态
		if (progress >= 1) {
			setTimeout(async () => {
				const status = await this.indexingService.getIndexStatus(workspacePath);
				uiState.status = status;
				this.updateWorkspaceStatus(workspacePath);

				if (status.hasIndex) {
					uiState.stats = await this.indexingService.getIndexStats(workspacePath);
					this.renderWorkspaceStats(workspacePath);
				}
			}, 500);
		}
	}

	/**
	 * 更新状态栏中的进度数字
	 */
	private updateStatusGridProgress(workspacePath: string, indexedCount: number, totalCount: number): void {
		const uiState = this.workspaceUIStates.get(workspacePath);
		if (!uiState) {
			return;
		}

		// 查找状态栏中的进度值元素（使用 data 属性标记）
		const progressValue = uiState.statusContainer.querySelector('[data-progress-value]') as HTMLElement | null;
		if (progressValue) {
			progressValue.textContent = `${indexedCount}/${totalCount}`;
		}
	}

	/**
	 * 更新模型下载进度
	 */
	private updateModelDownloadProgress(workspacePath: string, progress: { status: string; file?: string; progress?: number }): void {
		const uiState = this.workspaceUIStates.get(workspacePath);
		if (!uiState) {
			return;
		}

		// 找到或创建模型下载进度显示区域
		let downloadRow = uiState.statusContainer.querySelector('.model-download-row') as HTMLElement | null;
		if (!downloadRow) {
			// 在本地模型提示后创建
			const hintRow = uiState.statusContainer.querySelector('.hint-row');
			if (hintRow) {
				downloadRow = document.createElement('div');
				downloadRow.className = 'status-row model-download-row';
				hintRow.after(downloadRow);
			} else {
				return;
			}
		}

		if (progress.status === 'done') {
			// 下载完成，移除进度显示
			downloadRow.remove();
			return;
		}

		if (progress.status === 'progress' && progress.file && progress.progress !== undefined) {
			const fileName = progress.file.split('/').pop() || progress.file;
			const percent = Math.round(progress.progress);
			downloadRow.innerHTML = `
				<span class="download-label">下载 ${fileName}</span>
				<div class="download-progress-bar">
					<div class="download-progress-fill" style="width: ${percent}%"></div>
				</div>
				<span class="download-percent">${percent}%</span>
			`;
		} else if (progress.status === 'initiate') {
			downloadRow.innerHTML = `<span class="download-label">正在初始化模型...</span>`;
		} else if (progress.status === 'download') {
			const fileName = progress.file?.split('/').pop() || '模型文件';
			downloadRow.innerHTML = `<span class="download-label">开始下载 ${fileName}...</span>`;
		}
	}

	/**
	 * 加载模型列表到下拉框
	 */
	private async loadModelsToSelect(select: HTMLSelectElement, currentModelName?: string): Promise<void> {
		try {
			this.models = await this.modelStorageService.getAll();

			for (const model of this.models) {
				const option = document.createElement('option');
				option.value = model.name;
				option.textContent = `${model.name} (${model.model})`;
				if (model.name === currentModelName) {
					option.selected = true;
				}
				select.appendChild(option);
			}

			if (this.models.length === 0) {
				const noModelOption = document.createElement('option');
				noModelOption.value = '';
				noModelOption.textContent = localize('noModels', '-- 请先在模型管理中添加模型 --');
				noModelOption.disabled = true;
				select.appendChild(noModelOption);
			}
		} catch (error) {
			console.error('[IndexManagementPanel] 加载模型列表失败:', error);
		}
	}

	private formatTime(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) {
			return localize('justNow', '刚刚');
		}
		if (minutes < 60) {
			return localize('minutesAgo', '{0}分钟前', minutes);
		}
		if (hours < 24) {
			return localize('hoursAgo', '{0}小时前', hours);
		}
		return localize('daysAgo', '{0}天前', days);
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		if (bytes < 1024 * 1024) {
			return `${(bytes / 1024).toFixed(1)} KB`;
		}
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	private renderNoWorkspace(): void {
		if (!this.workspaceListContainer) {
			return;
		}

		clearNode(this.workspaceListContainer);
		const message = append(this.workspaceListContainer, $('.no-workspace-message'));
		append(message, $('span.codicon.codicon-warning'));
		append(message, $('span')).textContent = localize('openWorkspaceFirst', '请先打开一个工作区');
	}

	override dispose(): void {
		for (const [, uiState] of this.workspaceUIStates) {
			uiState.disposables.dispose();
		}
		this.workspaceUIStates.clear();
		super.dispose();
	}
}
