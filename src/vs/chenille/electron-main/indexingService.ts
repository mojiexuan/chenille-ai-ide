/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 主进程索引服务实现
 * 使用 Utility Process 隔离索引工作，避免阻塞主进程
 */

import * as fs from 'fs';
import * as path from '../../base/common/path.js';
import { Emitter, Event } from '../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../base/common/lifecycle.js';
import type { CancellationToken } from '../../base/common/cancellation.js';
import { IEnvironmentMainService } from '../../platform/environment/electron-main/environmentMainService.js';
import { Throttler } from '../../base/common/async.js';
import type {
	IChenilleIndexingService,
	IIndexWorkspaceRequest,
	IRetrieveRequest,
	IIndexStatus,
	IIndexStats,
	IStorageStats,
	IModelDownloadProgress,
} from '../common/indexing/indexingService.js';
import { DEFAULT_INDEXING_CONFIG, type RetrievalResult, type IndexProgressEvent } from '../common/indexing/types.js';
import { IndexingErrorCode, wrapError } from '../common/indexing/errors.js';
import { IStateService } from '../../platform/state/node/state.js';
import { IndexConfigStorageService, type IWorkspaceIndexConfig } from './indexConfigStorage.js';
import { IAiModelStorageService } from '../common/storageIpc.js';
import { IndexingWorkerHost } from './indexingWorkerHost.js';
import { ApiEmbeddingsProvider } from '../node/indexing/embeddings/apiEmbeddings.js';


/**
 * 工作区索引配置（内存中的运行时状态）
 */
interface WorkspaceIndexConfig {
	/** 是否启用索引 */
	enabled: boolean;
	/** 文件监听器 */
	watcher?: DisposableStore;
	/** 是否有已存在的索引 */
	hasIndex: boolean;
	/** 嵌入模型名称（远程模型） */
	embeddingModelName?: string;
	/** 是否使用本地模型 */
	useLocalModel?: boolean;
	/** 错误信息 */
	errorMessage?: string;
}

/**
 * 主进程索引服务实现
 * 所有索引工作都委托给 Utility Process 执行
 */
export class ChenilleIndexingService extends Disposable implements IChenilleIndexingService {
	declare readonly _serviceBrand: undefined;

	private readonly _onIndexProgress = this._register(
		new Emitter<IndexProgressEvent & { workspacePath: string }>()
	);
	readonly onIndexProgress: Event<IndexProgressEvent & { workspacePath: string }> = this._onIndexProgress.event;

	private readonly _onIndexStatusChanged = this._register(
		new Emitter<{ workspacePath: string; status: IIndexStatus }>()
	);
	readonly onIndexStatusChanged: Event<{ workspacePath: string; status: IIndexStatus }> = this._onIndexStatusChanged.event;

	private readonly _onModelDownloadProgress = this._register(
		new Emitter<{ workspacePath: string; progress: IModelDownloadProgress }>()
	);
	readonly onModelDownloadProgress: Event<{ workspacePath: string; progress: IModelDownloadProgress }> = this._onModelDownloadProgress.event;

	/** Worker 宿主 */
	private workerHost: IndexingWorkerHost | null = null;

	/** 最后索引时间缓存 */
	private lastIndexedTimes: Map<string, number> = new Map();

	/** 工作区配置（内存中） */
	private workspaceConfigs: Map<string, WorkspaceIndexConfig> = new Map();

	/** 配置存储服务 */
	private readonly configStorage: IndexConfigStorageService;

	/** 已从存储加载的工作区 */
	private loadedWorkspaces: Set<string> = new Set();

	/** 正在索引的工作区 */
	private indexingWorkspaces: Set<string> = new Set();

	/** 清理定时器 */
	private cleanupTimer: ReturnType<typeof setInterval> | undefined;

	/** 过期阈值（30天） */
	private static readonly EXPIRY_DAYS = 30;

	constructor(
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@IStateService stateService: IStateService,
		@IAiModelStorageService private readonly modelStorageService: IAiModelStorageService,
	) {
		super();
		this.configStorage = this._register(new IndexConfigStorageService(stateService));
		console.log('[ChenilleIndexingService] 索引服务已初始化（使用 Utility Process）');

		// 延迟启动后台清理
		setTimeout(() => this.startBackgroundCleanup(), 60000);
	}

	/**
	 * 获取或创建 Worker 宿主
	 */
	private async getWorkerHost(): Promise<IndexingWorkerHost> {
		if (!this.workerHost) {
			this.workerHost = new IndexingWorkerHost({
				cacheHome: path.join(this.environmentService.cacheHome.fsPath, 'chenille', 'index-cache'),
			});

			// 转发进度事件
			this._register(this.workerHost.onIndexProgress((e) => {
				this._onIndexProgress.fire({
					...e.event,
					workspacePath: e.workspacePath,
				});
			}));

			// 转发模型下载进度
			this._register(this.workerHost.onModelDownloadProgress((e) => {
				this._onModelDownloadProgress.fire(e);
			}));

			// 监听 Worker 错误
			this._register(this.workerHost.onWorkerError((err) => {
				console.error('[ChenilleIndexingService] Worker error:', err);
			}));
		}
		return this.workerHost;
	}


	/**
	 * 启动后台清理任务
	 */
	private startBackgroundCleanup(): void {
		this.cleanupOrphanedIndexes().catch(err => {
			console.error('[ChenilleIndexingService] 后台清理失败:', err);
		});

		this.cleanupTimer = setInterval(() => {
			this.cleanupOrphanedIndexes().catch(err => {
				console.error('[ChenilleIndexingService] 定时清理失败:', err);
			});
		}, 24 * 60 * 60 * 1000);
	}

	/**
	 * 清理孤立和过期的索引
	 */
	private async cleanupOrphanedIndexes(): Promise<void> {
		if (this.indexingWorkspaces.size > 0) {
			return;
		}

		console.log('[ChenilleIndexingService] 开始检查孤立/过期索引...');

		try {
			const allConfigs = await this.configStorage.getAllWorkspaces();
			const now = Date.now();
			const expiryThreshold = ChenilleIndexingService.EXPIRY_DAYS * 24 * 60 * 60 * 1000;

			for (const config of allConfigs) {
				const wsPath = config.workspacePath;
				const pathExists = fs.existsSync(wsPath);

				if (!pathExists) {
					console.log(`[ChenilleIndexingService] 发现孤立索引，正在清理: ${wsPath}`);
					await this.deleteIndexAndConfig(wsPath);
					continue;
				}

				if (!config.enabled && config.lastIndexedAt) {
					const age = now - config.lastIndexedAt;
					if (age > expiryThreshold) {
						console.log(`[ChenilleIndexingService] 发现过期索引，正在清理: ${wsPath}`);
						await this.deleteIndexAndConfig(wsPath);
					}
				}
			}
		} catch (error) {
			console.error('[ChenilleIndexingService] 清理检查出错:', error);
		}
	}

	/**
	 * 删除索引和配置
	 */
	private async deleteIndexAndConfig(workspacePath: string): Promise<void> {
		try {
			const worker = await this.getWorkerHost();
			await worker.deleteIndex(workspacePath);
			await this.configStorage.deleteWorkspaceConfig(workspacePath);

			this.workspaceConfigs.delete(workspacePath);
			this.loadedWorkspaces.delete(workspacePath);
			this.lastIndexedTimes.delete(workspacePath);
		} catch (error) {
			console.error(`[ChenilleIndexingService] 删除索引失败: ${workspacePath}`, error);
		}
	}

	/**
	 * 获取或创建工作区配置
	 */
	private getWorkspaceConfig(workspacePath: string): WorkspaceIndexConfig {
		let config = this.workspaceConfigs.get(workspacePath);
		if (!config) {
			config = { enabled: false, hasIndex: false };
			this.workspaceConfigs.set(workspacePath, config);
		}
		return config;
	}

	/**
	 * 从持久化存储加载工作区配置
	 */
	private async loadWorkspaceConfig(workspacePath: string): Promise<void> {
		if (this.loadedWorkspaces.has(workspacePath)) {
			return;
		}

		const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);
		const wsConfig = this.getWorkspaceConfig(workspacePath);

		wsConfig.enabled = savedConfig.enabled;
		wsConfig.embeddingModelName = savedConfig.embeddingModelName;
		wsConfig.useLocalModel = savedConfig.useLocalModel;

		if (savedConfig.lastIndexedAt) {
			this.lastIndexedTimes.set(workspacePath, savedConfig.lastIndexedAt);
		}

		this.loadedWorkspaces.add(workspacePath);

		if (savedConfig.enabled && savedConfig.autoWatch) {
			await this.startFileWatching(workspacePath);
		}
	}

	/**
	 * 保存工作区配置
	 */
	private async saveWorkspaceConfig(workspacePath: string): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);

		const configToSave: IWorkspaceIndexConfig = {
			workspacePath,
			enabled: wsConfig.enabled,
			autoWatch: !!wsConfig.watcher,
			lastIndexedAt: this.lastIndexedTimes.get(workspacePath),
			embeddingModelName: wsConfig.embeddingModelName,
			useLocalModel: wsConfig.useLocalModel,
		};

		await this.configStorage.saveWorkspaceConfig(configToSave);
	}

	/**
	 * 触发状态变更事件
	 */
	private async fireStatusChanged(workspacePath: string): Promise<void> {
		const status = await this.getIndexStatus(workspacePath);
		this._onIndexStatusChanged.fire({ workspacePath, status });
	}


	/**
	 * 索引工作区（委托给 Worker）
	 */
	async indexWorkspace(request: IIndexWorkspaceRequest, token?: CancellationToken): Promise<void> {
		const { workspacePath, config } = request;
		console.log(`[ChenilleIndexingService] 开始索引工作区: ${workspacePath}`);

		this.indexingWorkspaces.add(workspacePath);

		try {
			const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);
			const wsConfig = this.getWorkspaceConfig(workspacePath);

			// 准备嵌入模型配置
			let embeddingModel: { baseUrl: string; apiKey: string; modelId: string; modelName: string } | undefined;
			const useRemoteModel = !wsConfig.useLocalModel && wsConfig.embeddingModelName;

			if (useRemoteModel) {
				const model = await this.modelStorageService.get(wsConfig.embeddingModelName!);
				if (model) {
					embeddingModel = {
						baseUrl: model.baseUrl,
						apiKey: model.apiKey,
						modelId: model.model,
						modelName: model.name,
					};
				} else {
					throw new Error(`无法加载远程模型: ${wsConfig.embeddingModelName}`);
				}
			}

			const worker = await this.getWorkerHost();

			// 监听取消
			if (token) {
				const cancelListener = token.onCancellationRequested(() => {
					worker.cancelIndexing(workspacePath).catch(() => { });
				});
				try {
					await worker.indexWorkspace(
						workspacePath,
						{ ...config, embeddingConcurrency: savedConfig.embeddingConcurrency ?? 3 },
						embeddingModel,
						wsConfig.useLocalModel,
					);
				} finally {
					cancelListener.dispose();
				}
			} else {
				await worker.indexWorkspace(
					workspacePath,
					{ ...config, embeddingConcurrency: savedConfig.embeddingConcurrency ?? 3 },
					embeddingModel,
					wsConfig.useLocalModel,
				);
			}

			this.lastIndexedTimes.set(workspacePath, Date.now());
			await this.saveWorkspaceConfig(workspacePath);
		} catch (error) {
			const indexingError = wrapError(error);
			if (indexingError.code === IndexingErrorCode.Cancelled) {
				console.log(`[ChenilleIndexingService] 索引已取消: ${workspacePath}`);
			} else {
				console.error(`[ChenilleIndexingService] 索引失败: ${indexingError.message}`);
			}
			throw indexingError;
		} finally {
			this.indexingWorkspaces.delete(workspacePath);
		}
	}

	/**
	 * 检索相似代码
	 */
	async retrieve(request: IRetrieveRequest): Promise<RetrievalResult[]> {
		const { query, workspacePath, topK } = request;
		console.log(`[ChenilleIndexingService] 检索: "${query.slice(0, 50)}..."`);

		try {
			const worker = await this.getWorkerHost();
			return await worker.retrieve(query, workspacePath, topK);
		} catch (error) {
			const indexingError = wrapError(error, IndexingErrorCode.RetrieveFailed);
			console.error(`[ChenilleIndexingService] 检索失败: ${indexingError.message}`);
			throw indexingError;
		}
	}

	/**
	 * 处理文件变更
	 */
	async onFilesChanged(workspacePath: string, changedFiles: string[]): Promise<void> {
		if (changedFiles.length === 0) {
			return;
		}

		console.log(`[ChenilleIndexingService] 文件变更: ${changedFiles.length} 个文件`);

		try {
			const worker = await this.getWorkerHost();
			await worker.onFilesChanged(workspacePath, changedFiles);
			this.lastIndexedTimes.set(workspacePath, Date.now());
		} catch (error) {
			const indexingError = wrapError(error);
			console.error(`[ChenilleIndexingService] 文件变更处理失败: ${indexingError.message}`);
			throw indexingError;
		}
	}

	/**
	 * 删除工作区索引
	 */
	async deleteIndex(workspacePath: string): Promise<void> {
		console.log(`[ChenilleIndexingService] 删除索引: ${workspacePath}`);

		try {
			const worker = await this.getWorkerHost();
			await worker.deleteIndex(workspacePath);
			this.lastIndexedTimes.delete(workspacePath);
		} catch (error) {
			const indexingError = wrapError(error);
			console.error(`[ChenilleIndexingService] 删除索引失败: ${indexingError.message}`);
			throw indexingError;
		}
	}


	/**
	 * 获取索引状态
	 */
	async getIndexStatus(workspacePath: string): Promise<IIndexStatus> {
		await this.loadWorkspaceConfig(workspacePath);
		const wsConfig = this.getWorkspaceConfig(workspacePath);

		try {
			const worker = await this.getWorkerHost();

			// 设置正确的嵌入提供者
			if (wsConfig.embeddingModelName && !wsConfig.useLocalModel) {
				const model = await this.modelStorageService.get(wsConfig.embeddingModelName);
				if (model) {
					await worker.setEmbeddingsProvider({
						baseUrl: model.baseUrl,
						apiKey: model.apiKey,
						modelId: model.model,
						modelName: model.name,
					}, false);
				}
			}

			const status = await worker.getIndexStatus(workspacePath);
			const hasIndex = await worker.hasIndex(workspacePath);
			wsConfig.hasIndex = hasIndex;

			let indexedFileCount = 0;
			if (hasIndex) {
				const stats = await worker.getIndexStats(workspacePath);
				if (stats) {
					indexedFileCount = stats.rowCount;
				}
			}

			let isLocalModelReady: boolean | undefined;
			if (wsConfig.useLocalModel) {
				isLocalModelReady = await worker.isLocalModelCached();
			}

			const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);

			return {
				hasIndex,
				isIndexing: status.isIndexing || this.indexingWorkspaces.has(workspacePath),
				fileCount: indexedFileCount,
				lastIndexedAt: this.lastIndexedTimes.get(workspacePath),
				queuedTasks: status.queuedTasks,
				isEnabled: wsConfig.enabled,
				isWatching: !!wsConfig.watcher,
				embeddingModelName: wsConfig.embeddingModelName,
				useLocalModel: wsConfig.useLocalModel,
				isLocalModelReady,
				errorMessage: wsConfig.errorMessage,
				indexedFileCount,
				totalFileCount: status.totalFileCount,
				embeddingConcurrency: savedConfig.embeddingConcurrency ?? 3,
			};
		} catch (error) {
			console.error(`[ChenilleIndexingService] 获取索引状态失败:`, error);
			return {
				hasIndex: false,
				isIndexing: this.indexingWorkspaces.has(workspacePath),
				fileCount: 0,
				lastIndexedAt: undefined,
				queuedTasks: 0,
				isEnabled: wsConfig.enabled,
				isWatching: false,
				embeddingModelName: wsConfig.embeddingModelName,
				useLocalModel: wsConfig.useLocalModel,
				isLocalModelReady: undefined,
				errorMessage: wsConfig.errorMessage,
			};
		}
	}

	/**
	 * 获取索引详细统计
	 */
	async getIndexStats(workspacePath: string): Promise<IIndexStats | null> {
		try {
			const worker = await this.getWorkerHost();
			const stats = await worker.getDetailedStats(workspacePath);

			if (!stats) {
				return null;
			}

			return {
				totalChunks: stats.totalChunks,
				uniqueFiles: stats.uniqueFiles,
				languageDistribution: stats.languageDistribution,
				dbSizeBytes: stats.dbSizeBytes,
				cacheSizeBytes: stats.cacheSizeBytes,
				avgChunksPerFile: stats.avgChunksPerFile,
				createdAt: this.lastIndexedTimes.get(workspacePath),
			};
		} catch (error) {
			console.error('[ChenilleIndexingService] 获取索引统计失败:', error);
			return null;
		}
	}

	/**
	 * 检查索引服务是否可用
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await this.getWorkerHost();
			return true;
		} catch (error) {
			console.error('[ChenilleIndexingService] 索引服务不可用:', error);
			return false;
		}
	}


	/**
	 * 启用/禁用工作区索引
	 */
	async setIndexEnabled(workspacePath: string, enabled: boolean): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);
		const wasEnabled = wsConfig.enabled;

		wsConfig.errorMessage = undefined;

		if (enabled) {
			if (!wsConfig.useLocalModel) {
				if (!wsConfig.embeddingModelName) {
					wsConfig.errorMessage = '请先选择嵌入模型或启用本地模型';
					wsConfig.enabled = false;
					await this.saveWorkspaceConfig(workspacePath);
					await this.fireStatusChanged(workspacePath);
					return;
				}

				try {
					const testResult = await this.testEmbeddingModel(wsConfig.embeddingModelName);
					if (!testResult.success) {
						wsConfig.errorMessage = `模型不可用: ${testResult.error}`;
						wsConfig.enabled = false;
						await this.saveWorkspaceConfig(workspacePath);
						await this.fireStatusChanged(workspacePath);
						return;
					}
				} catch (error) {
					wsConfig.errorMessage = `模型测试失败: ${error instanceof Error ? error.message : String(error)}`;
					wsConfig.enabled = false;
					await this.saveWorkspaceConfig(workspacePath);
					await this.fireStatusChanged(workspacePath);
					return;
				}
			}
		}

		wsConfig.enabled = enabled;

		if (enabled && !wasEnabled) {
			if (!wsConfig.hasIndex) {
				this.indexWorkspace({ workspacePath }).catch(err => {
					wsConfig.errorMessage = `索引失败: ${err.message || '未知错误'}`;
					this.saveWorkspaceConfig(workspacePath).catch(() => { });
					this.fireStatusChanged(workspacePath).catch(() => { });
				});
			}
			this.startFileWatching(workspacePath).catch(() => { });
		} else if (!enabled && wasEnabled) {
			await this.stopFileWatching(workspacePath).catch(() => { });
		}

		await this.saveWorkspaceConfig(workspacePath);
		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 设置工作区的嵌入模型
	 */
	async setEmbeddingModel(workspacePath: string, modelName: string): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);
		wsConfig.embeddingModelName = modelName;
		wsConfig.errorMessage = undefined;

		await this.saveWorkspaceConfig(workspacePath);
		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 测试嵌入模型是否可用
	 */
	async testEmbeddingModel(modelName: string): Promise<{ success: boolean; error?: string; dimensions?: number }> {
		try {
			const model = await this.modelStorageService.get(modelName);
			if (!model) {
				return { success: false, error: `模型 "${modelName}" 不存在` };
			}

			// 简单测试：尝试获取嵌入
			const provider = new ApiEmbeddingsProvider(model);
			return await provider.test();
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : '未知错误',
			};
		}
	}

	/**
	 * 设置是否使用本地模型
	 */
	async setUseLocalModel(workspacePath: string, useLocal: boolean): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);
		wsConfig.useLocalModel = useLocal;
		wsConfig.errorMessage = undefined;

		await this.saveWorkspaceConfig(workspacePath);
		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 设置 Embedding 并发数
	 */
	async setEmbeddingConcurrency(workspacePath: string, concurrency: number): Promise<void> {
		const validConcurrency = Math.max(1, Math.min(1000, concurrency));

		const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);
		savedConfig.embeddingConcurrency = validConcurrency;
		await this.configStorage.saveWorkspaceConfig(savedConfig);

		await this.fireStatusChanged(workspacePath);
	}


	/**
	 * 启动文件监听
	 */
	async startFileWatching(workspacePath: string): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);

		if (wsConfig.watcher) {
			return;
		}

		console.log(`[ChenilleIndexingService] 启动文件监听: ${workspacePath}`);

		wsConfig.watcher = new DisposableStore();

		const throttler = new Throttler();
		const pendingChanges: Set<string> = new Set();
		let flushTimeout: ReturnType<typeof setTimeout> | undefined;

		const flushChanges = () => {
			if (pendingChanges.size === 0 || !wsConfig.enabled) {
				return;
			}

			const changes = Array.from(pendingChanges);
			pendingChanges.clear();

			throttler.queue(async () => {
				try {
					await this.onFilesChanged(workspacePath, changes);
				} catch (err) {
					console.error('[ChenilleIndexingService] 处理文件变更失败:', err);
				}
			});
		};

		const excludePatterns = DEFAULT_INDEXING_CONFIG.excludePatterns || [];
		const includeExtensions = new Set(DEFAULT_INDEXING_CONFIG.includeExtensions || []);

		const shouldIndex = (filename: string): boolean => {
			const ext = path.extname(filename).toLowerCase();
			if (!includeExtensions.has(ext)) {
				return false;
			}

			for (const pattern of excludePatterns) {
				if (pattern.includes('node_modules') && filename.includes('node_modules')) {
					return false;
				}
				if (pattern.includes('.git') && filename.includes('.git')) {
					return false;
				}
				if (pattern.includes('dist') && filename.includes('dist')) {
					return false;
				}
			}

			return true;
		};

		try {
			const watcher = fs.watch(
				workspacePath,
				{ recursive: true },
				(eventType, filename) => {
					if (!filename || !wsConfig.enabled) {
						return;
					}

					if (!shouldIndex(filename)) {
						return;
					}

					pendingChanges.add(filename);

					if (flushTimeout) {
						clearTimeout(flushTimeout);
					}
					flushTimeout = setTimeout(flushChanges, 500);
				}
			);

			wsConfig.watcher.add(toDisposable(() => {
				watcher.close();
				if (flushTimeout) {
					clearTimeout(flushTimeout);
				}
			}));
		} catch (error) {
			console.error(`[ChenilleIndexingService] 启动文件监听失败:`, error);
			wsConfig.watcher.dispose();
			wsConfig.watcher = undefined;
		}

		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 停止文件监听
	 */
	async stopFileWatching(workspacePath: string): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);

		if (!wsConfig.watcher) {
			return;
		}

		wsConfig.watcher.dispose();
		wsConfig.watcher = undefined;

		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 激活工作区索引
	 */
	async activateWorkspace(workspacePath: string): Promise<void> {
		console.log(`[ChenilleIndexingService] 激活工作区: ${workspacePath}`);

		try {
			const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);

			if (!savedConfig.enabled) {
				return;
			}

			const wsConfig = this.getWorkspaceConfig(workspacePath);
			wsConfig.enabled = true;
			wsConfig.useLocalModel = savedConfig.useLocalModel;
			wsConfig.embeddingModelName = savedConfig.embeddingModelName;

			if (savedConfig.lastIndexedAt) {
				this.lastIndexedTimes.set(workspacePath, savedConfig.lastIndexedAt);
			}

			this.loadedWorkspaces.add(workspacePath);

			if (!wsConfig.embeddingModelName && !wsConfig.useLocalModel) {
				wsConfig.useLocalModel = true;
			}

			try {
				const worker = await this.getWorkerHost();
				const hasIndex = await worker.hasIndex(workspacePath);
				wsConfig.hasIndex = hasIndex;

				if (savedConfig.autoWatch) {
					this.startFileWatching(workspacePath).catch(() => { });
				}

				this.indexWorkspace({ workspacePath }).then(() => {
					wsConfig.errorMessage = undefined;
					this.fireStatusChanged(workspacePath).catch(() => { });
				}).catch(err => {
					wsConfig.errorMessage = err.message || '索引失败';
					this.fireStatusChanged(workspacePath).catch(() => { });
				});
			} catch (error) {
				wsConfig.errorMessage = `索引检查失败: ${error instanceof Error ? error.message : String(error)}`;
			}
		} catch (error) {
			console.error(`[ChenilleIndexingService] 激活工作区失败:`, error);
		}
	}

	/**
	 * 获取存储统计信息
	 */
	async getStorageStats(): Promise<IStorageStats> {
		const allConfigs = await this.configStorage.getAllWorkspaces();
		const workspaces: IStorageStats['workspaces'] = [];
		let totalSizeBytes = 0;

		for (const config of allConfigs) {
			const wsPath = config.workspacePath;
			const isOrphaned = !fs.existsSync(wsPath);

			let sizeBytes = 0;
			if (!isOrphaned) {
				try {
					const worker = await this.getWorkerHost();
					const stats = await worker.getIndexStats(wsPath);
					if (stats) {
						sizeBytes = stats.rowCount * 1024;
					}
				} catch { }
			}

			totalSizeBytes += sizeBytes;

			workspaces.push({
				path: wsPath,
				name: path.basename(wsPath),
				sizeBytes,
				lastIndexedAt: config.lastIndexedAt,
				isOrphaned,
			});
		}

		workspaces.sort((a, b) => b.sizeBytes - a.sizeBytes);

		return { totalSizeBytes, indexCount: workspaces.length, workspaces };
	}

	override dispose(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}

		for (const [, config] of this.workspaceConfigs) {
			config.watcher?.dispose();
		}
		this.workspaceConfigs.clear();
		this.lastIndexedTimes.clear();

		if (this.workerHost) {
			this.workerHost.dispose();
			this.workerHost = null;
		}

		super.dispose();
	}
}
