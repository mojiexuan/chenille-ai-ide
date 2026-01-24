/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import {
	IndexingErrorCode,
	wrapError,
} from '../common/indexing/errors.js';
import { getCodebaseIndexer } from '../node/indexing/codebaseIndexer.js';
import { IStateService } from '../../platform/state/node/state.js';
import { IndexConfigStorageService, type IWorkspaceIndexConfig } from './indexConfigStorage.js';
import { IAiModelStorageService } from '../common/storageIpc.js';
import { ApiEmbeddingsProvider } from '../node/indexing/embeddings/apiEmbeddings.js';
import { LocalEmbeddingsProvider } from '../node/indexing/embeddings/localEmbeddings.js';

/**
 * 工作区索引配置
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
		console.log('[ChenilleIndexingService] 索引服务已初始化');

		// 延迟启动后台清理（避免与启动时的索引操作冲突）
		setTimeout(() => this.startBackgroundCleanup(), 60000);
	}

	/**
	 * 启动后台清理任务
	 */
	private startBackgroundCleanup(): void {
		// 立即执行一次清理
		this.cleanupOrphanedIndexes().catch(err => {
			console.error('[ChenilleIndexingService] 后台清理失败:', err);
		});

		// 每 24 小时检查一次
		this.cleanupTimer = setInterval(() => {
			this.cleanupOrphanedIndexes().catch(err => {
				console.error('[ChenilleIndexingService] 定时清理失败:', err);
			});
		}, 24 * 60 * 60 * 1000);
	}

	/**
	 * 清理孤立和过期的索引（后台静默执行）
	 */
	private async cleanupOrphanedIndexes(): Promise<void> {
		// 如果有任何工作区正在索引，跳过清理
		if (this.indexingWorkspaces.size > 0) {
			console.log('[ChenilleIndexingService] 有工作区正在索引，跳过清理检查');
			return;
		}

		console.log('[ChenilleIndexingService] 开始检查孤立/过期索引...');

		try {
			const allConfigs = await this.configStorage.getAllWorkspaces();
			const now = Date.now();
			const expiryThreshold = ChenilleIndexingService.EXPIRY_DAYS * 24 * 60 * 60 * 1000;

			for (const config of allConfigs) {
				const wsPath = config.workspacePath;

				// 检查路径是否存在
				const pathExists = fs.existsSync(wsPath);

				if (!pathExists) {
					// 孤立索引：路径不存在，删除
					console.log(`[ChenilleIndexingService] 发现孤立索引，正在清理: ${wsPath}`);
					await this.deleteIndexAndConfig(wsPath);
					continue;
				}

				// 检查是否过期（未启用且超过30天未更新）
				if (!config.enabled && config.lastIndexedAt) {
					const age = now - config.lastIndexedAt;
					if (age > expiryThreshold) {
						console.log(`[ChenilleIndexingService] 发现过期索引，正在清理: ${wsPath}`);
						await this.deleteIndexAndConfig(wsPath);
					}
				}
			}

			console.log('[ChenilleIndexingService] 索引清理检查完成');
		} catch (error) {
			console.error('[ChenilleIndexingService] 清理检查出错:', error);
		}
	}

	/**
	 * 删除索引和配置
	 */
	private async deleteIndexAndConfig(workspacePath: string): Promise<void> {
		try {
			// 删除 LanceDB 索引
			const indexer = getCodebaseIndexer(undefined, this.environmentService);
			await indexer.deleteWorkspaceIndex(workspacePath);

			// 删除配置
			await this.configStorage.deleteWorkspaceConfig(workspacePath);

			// 清理内存状态
			this.workspaceConfigs.delete(workspacePath);
			this.loadedWorkspaces.delete(workspacePath);
			this.lastIndexedTimes.delete(workspacePath);
		} catch (error) {
			console.error(`[ChenilleIndexingService] 删除索引失败: ${workspacePath}`, error);
		}
	}

	/**
	 * 获取或创建工作区配置（内存中的运行时配置）
	 */
	private getWorkspaceConfig(workspacePath: string): WorkspaceIndexConfig {
		let config = this.workspaceConfigs.get(workspacePath);
		if (!config) {
			config = {
				enabled: false,  // 默认关闭
				hasIndex: false,
			};
			this.workspaceConfigs.set(workspacePath, config);
		}
		return config;
	}

	/**
	 * 从持久化存储加载工作区配置
	 */
	private async loadWorkspaceConfig(workspacePath: string): Promise<void> {
		if (this.loadedWorkspaces.has(workspacePath)) {
			return; // 已加载
		}

		const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);
		const wsConfig = this.getWorkspaceConfig(workspacePath);

		// 同步保存的配置到内存
		wsConfig.enabled = savedConfig.enabled;
		wsConfig.embeddingModelName = savedConfig.embeddingModelName;
		wsConfig.useLocalModel = savedConfig.useLocalModel;

		// 同步最后索引时间
		if (savedConfig.lastIndexedAt) {
			this.lastIndexedTimes.set(workspacePath, savedConfig.lastIndexedAt);
		}

		this.loadedWorkspaces.add(workspacePath);

		console.log(`[ChenilleIndexingService] 已加载工作区配置: ${workspacePath}, enabled=${savedConfig.enabled}, model=${savedConfig.embeddingModelName || 'none'}`);

		// 如果启用了索引且启用了自动监听，则启动文件监听
		if (savedConfig.enabled && savedConfig.autoWatch) {
			await this.startFileWatching(workspacePath);
		}
	}

	/**
	 * 保存工作区配置到持久化存储
	 */
	private async saveWorkspaceConfig(workspacePath: string): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);

		const configToSave: IWorkspaceIndexConfig = {
			workspacePath,
			enabled: wsConfig.enabled,
			autoWatch: !!wsConfig.watcher, // 如果有 watcher，说明自动监听开启
			lastIndexedAt: this.lastIndexedTimes.get(workspacePath),
			embeddingModelName: wsConfig.embeddingModelName,
			useLocalModel: wsConfig.useLocalModel,
		};

		await this.configStorage.saveWorkspaceConfig(configToSave);
		console.log(`[ChenilleIndexingService] 已保存工作区配置: ${workspacePath}`);
	}

	/**
	 * 触发状态变更事件
	 */
	private async fireStatusChanged(workspacePath: string): Promise<void> {
		const status = await this.getIndexStatus(workspacePath);
		this._onIndexStatusChanged.fire({ workspacePath, status });
	}

	/**
	 * 索引工作区
	 */
	async indexWorkspace(
		request: IIndexWorkspaceRequest,
		token?: CancellationToken,
	): Promise<void> {
		const { workspacePath, config } = request;

		console.log(`[ChenilleIndexingService] 开始索引工作区: ${workspacePath}`);

		// 标记为正在索引
		this.indexingWorkspaces.add(workspacePath);

		try {
			// 从存储读取并发配置
			const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);
			const mergedConfig = {
				...config,
				embeddingConcurrency: savedConfig.embeddingConcurrency ?? 3,
			};

			const indexer = getCodebaseIndexer(mergedConfig, this.environmentService);

			// 根据工作区配置设置嵌入提供者
			const wsConfig = this.getWorkspaceConfig(workspacePath);
			const useRemoteModel = !wsConfig.useLocalModel && wsConfig.embeddingModelName;

			if (useRemoteModel) {
				// 使用远程 API 模型
				const model = await this.modelStorageService.get(wsConfig.embeddingModelName!);
				if (model) {
					const apiProvider = new ApiEmbeddingsProvider(model);
					indexer.setEmbeddingsProvider(apiProvider);
					console.log(`[ChenilleIndexingService] 使用远程模型: ${wsConfig.embeddingModelName}`);
				} else {
					throw new Error(`无法加载远程模型: ${wsConfig.embeddingModelName}`);
				}
			} else {
				// 使用本地模型，设置下载进度回调
				console.log(`[ChenilleIndexingService] 使用本地模型`);
				indexer.setModelDownloadProgressCallback((progress) => {
					this._onModelDownloadProgress.fire({
						workspacePath,
						progress: {
							status: progress.status as IModelDownloadProgress['status'],
							file: progress.file,
							progress: progress.progress,
						},
					});
				});
			}

			// 直接传递取消令牌到底层，支持批次级别的取消
			await indexer.indexWorkspace(
				workspacePath,
				(event) => {
					// 发送进度事件
					this._onIndexProgress.fire({
						...event,
						workspacePath,
					});
				},
				token, // 传递取消令牌
			);

			// 记录最后索引时间
			this.lastIndexedTimes.set(workspacePath, Date.now());
			console.log(`[ChenilleIndexingService] 索引完成: ${workspacePath}`);

			// 保存配置（包括 lastIndexedAt）
			await this.saveWorkspaceConfig(workspacePath);
		} catch (error) {
			const indexingError = wrapError(error);
			// 取消不算错误，只是静默终止
			if (indexingError.code === IndexingErrorCode.Cancelled) {
				console.log(`[ChenilleIndexingService] 索引已取消: ${workspacePath}`);
			} else {
				console.error(`[ChenilleIndexingService] 索引失败: ${indexingError.message}`);
			}
			throw indexingError;
		} finally {
			// 无论成功失败，移除索引标记
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
			const indexer = getCodebaseIndexer(undefined, this.environmentService);
			return await indexer.retrieve(query, workspacePath, topK);
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
			const indexer = getCodebaseIndexer(undefined, this.environmentService);
			await indexer.onFilesChanged(workspacePath, changedFiles);

			// 更新最后索引时间
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
			const indexer = getCodebaseIndexer(undefined, this.environmentService);
			await indexer.deleteWorkspaceIndex(workspacePath);

			this.lastIndexedTimes.delete(workspacePath);
			console.log(`[ChenilleIndexingService] 索引已删除: ${workspacePath}`);
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
		// 先从持久化存储加载配置（如果还没加载）
		await this.loadWorkspaceConfig(workspacePath);

		const wsConfig = this.getWorkspaceConfig(workspacePath);

		try {
			const indexer = getCodebaseIndexer(undefined, this.environmentService);

			// 根据配置设置正确的嵌入提供者（用于检查正确的索引表）
			if (wsConfig.embeddingModelName) {
				const model = await this.modelStorageService.get(wsConfig.embeddingModelName);
				if (model) {
					indexer.setEmbeddingsProvider(new ApiEmbeddingsProvider(model));
				}
			}

			const status = indexer.getIndexStatus(workspacePath);

			// 真正检查 LanceDB 是否有索引（使用正确的嵌入模型）
			const hasIndex = await indexer.hasIndex(workspacePath);
			wsConfig.hasIndex = hasIndex;

			// 获取已索引的文件数（从 LanceDB stats）
			let indexedFileCount = 0;
			if (hasIndex) {
				const stats = await indexer.getIndexStats(workspacePath);
				if (stats) {
					indexedFileCount = stats.rowCount;
				}
			}

			// 检查本地模型状态
			let isLocalModelReady: boolean | undefined;
			if (wsConfig.useLocalModel) {
				isLocalModelReady = await LocalEmbeddingsProvider.isModelCached();
			}

			// 获取保存的并发配置
			const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);

			return {
				hasIndex,
				isIndexing: status.isIndexing,
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
				isIndexing: false,
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
			const indexer = getCodebaseIndexer(undefined, this.environmentService);
			const stats = await indexer.getDetailedStats(workspacePath);

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
			// 尝试初始化索引器
			getCodebaseIndexer(undefined, this.environmentService);
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

		// 清除之前的错误
		wsConfig.errorMessage = undefined;

		if (enabled) {
			// 如果不是本地模型，检查远程模型配置
			if (!wsConfig.useLocalModel) {
				if (!wsConfig.embeddingModelName) {
					wsConfig.errorMessage = '请先选择嵌入模型或启用本地模型';
					wsConfig.enabled = false;
					console.log(`[ChenilleIndexingService] 启用失败，未配置嵌入模型: ${workspacePath}`);
					await this.saveWorkspaceConfig(workspacePath);
					await this.fireStatusChanged(workspacePath);
					return;
				}

				// 测试远程模型是否可用
				try {
					const testResult = await this.testEmbeddingModel(wsConfig.embeddingModelName);
					if (!testResult.success) {
						wsConfig.errorMessage = `模型不可用: ${testResult.error}`;
						wsConfig.enabled = false;
						console.log(`[ChenilleIndexingService] 启用失败，模型不可用: ${workspacePath}`);
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
			// 本地模型不需要预先测试，会在索引时下载
		}

		wsConfig.enabled = enabled;
		console.log(`[ChenilleIndexingService] 索引${enabled ? '已启用' : '已禁用'}: ${workspacePath}`);

		if (enabled && !wasEnabled) {
			// 刚启用：检查是否需要建立索引，启动文件监听
			if (!wsConfig.hasIndex) {
				// 自动开始索引（异步，不阻塞）
				this.indexWorkspace({ workspacePath }).catch(err => {
					console.error('[ChenilleIndexingService] 自动索引失败:', err);
					// 保留启用状态，只记录错误（用户可以重试）
					wsConfig.errorMessage = `索引失败: ${err.message || '未知错误'}`;
					this.saveWorkspaceConfig(workspacePath).catch(() => { });
					this.fireStatusChanged(workspacePath).catch(() => { });
				});
			}
			// 启动文件监听（捕获错误）
			this.startFileWatching(workspacePath).catch(err => {
				console.error('[ChenilleIndexingService] 启动文件监听失败:', err);
			});
		} else if (!enabled && wasEnabled) {
			// 刚禁用：停止文件监听（但保留索引）
			await this.stopFileWatching(workspacePath).catch(err => {
				console.error('[ChenilleIndexingService] 停止文件监听失败:', err);
			});
		}

		// 保存配置到持久化存储
		await this.saveWorkspaceConfig(workspacePath);

		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 设置工作区的嵌入模型
	 */
	async setEmbeddingModel(workspacePath: string, modelName: string): Promise<void> {
		const wsConfig = this.getWorkspaceConfig(workspacePath);
		wsConfig.embeddingModelName = modelName;
		wsConfig.errorMessage = undefined; // 清除之前的错误

		console.log(`[ChenilleIndexingService] 设置嵌入模型: ${workspacePath} -> ${modelName}`);

		// 保存配置到持久化存储
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
		wsConfig.errorMessage = undefined; // 清除之前的错误

		console.log(`[ChenilleIndexingService] 设置本地模型: ${workspacePath} -> ${useLocal}`);

		// 保存配置到持久化存储
		await this.saveWorkspaceConfig(workspacePath);

		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 设置 Embedding 并发数
	 */
	async setEmbeddingConcurrency(workspacePath: string, concurrency: number): Promise<void> {
		// 验证范围
		const validConcurrency = Math.max(1, Math.min(1000, concurrency));

		console.log(`[ChenilleIndexingService] 设置并发数: ${workspacePath} -> ${validConcurrency} (重启生效)`);

		// 保存到配置存储
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
			console.log(`[ChenilleIndexingService] 文件监听已在运行: ${workspacePath}`);
			return;
		}

		console.log(`[ChenilleIndexingService] 启动文件监听: ${workspacePath}`);

		wsConfig.watcher = new DisposableStore();

		// 使用节流器避免频繁触发索引更新
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

		// 获取排除和包含模式
		const excludePatterns = DEFAULT_INDEXING_CONFIG.excludePatterns || [];
		const includeExtensions = new Set(DEFAULT_INDEXING_CONFIG.includeExtensions || []);

		// 检查文件是否应该被索引
		const shouldIndex = (filename: string): boolean => {
			// 检查扩展名
			const ext = path.extname(filename).toLowerCase();
			if (!includeExtensions.has(ext)) {
				return false;
			}

			// 检查排除模式（简化检查）
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
			// 使用 fs.watch 监听目录变化
			const watcher = fs.watch(
				workspacePath,
				{ recursive: true },
				(eventType, filename) => {
					if (!filename || !wsConfig.enabled) {
						return;
					}

					// 过滤不需要索引的文件
					if (!shouldIndex(filename)) {
						return;
					}

					console.log(`[ChenilleIndexingService] 文件${eventType === 'rename' ? '新增/删除' : '修改'}: ${filename}`);
					pendingChanges.add(filename);

					// 防抖：500ms 内的变更合并处理
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

			console.log(`[ChenilleIndexingService] 文件监听已启动: ${workspacePath}`);
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

		console.log(`[ChenilleIndexingService] 停止文件监听: ${workspacePath}`);

		wsConfig.watcher.dispose();
		wsConfig.watcher = undefined;

		await this.fireStatusChanged(workspacePath);
	}

	/**
	 * 激活工作区索引（打开工作区时调用）
	 * 如果该工作区已启用索引，会自动恢复索引功能
	 */
	async activateWorkspace(workspacePath: string): Promise<void> {
		console.log(`[ChenilleIndexingService] 激活工作区: ${workspacePath}`);

		try {
			// 加载保存的配置
			const savedConfig = await this.configStorage.getWorkspaceConfig(workspacePath);

			if (!savedConfig.enabled) {
				console.log(`[ChenilleIndexingService] 工作区索引未启用，跳过: ${workspacePath}`);
				return;
			}

			// 同步配置到内存
			const wsConfig = this.getWorkspaceConfig(workspacePath);
			wsConfig.enabled = true;
			wsConfig.useLocalModel = savedConfig.useLocalModel;
			wsConfig.embeddingModelName = savedConfig.embeddingModelName;

			// 同步最后索引时间
			if (savedConfig.lastIndexedAt) {
				this.lastIndexedTimes.set(workspacePath, savedConfig.lastIndexedAt);
			}

			this.loadedWorkspaces.add(workspacePath);

			// 检查模型配置
			const useRemoteModel = !wsConfig.useLocalModel && wsConfig.embeddingModelName;
			if (!useRemoteModel && !wsConfig.useLocalModel) {
				// 既没有选择远程模型，也没有启用本地模型
				// 默认使用本地模型
				wsConfig.useLocalModel = true;
				console.log(`[ChenilleIndexingService] 未配置模型，默认使用本地模型: ${workspacePath}`);
			}

			// 检查索引完整性并自动修复
			try {
				const indexer = getCodebaseIndexer(undefined, this.environmentService);
				const hasIndex = await indexer.hasIndex(workspacePath);
				wsConfig.hasIndex = hasIndex;

				// 启动文件监听（无论索引是否存在）
				if (savedConfig.autoWatch) {
					this.startFileWatching(workspacePath).catch(err => {
						console.error('[ChenilleIndexingService] 启动文件监听失败:', err);
					});
				}

				// 无论是否有索引，都调用 indexWorkspace 进行增量检查
				// 这样可以处理：
				// 1. 索引不存在 → 建立索引
				// 2. 索引存在但不完整 → 继续索引
				// 3. 索引已是最新 → 快速返回
				console.log(`[ChenilleIndexingService] 检查并更新索引: ${workspacePath}`);
				this.indexWorkspace({ workspacePath }).then(() => {
					// 索引成功，清除错误信息
					wsConfig.errorMessage = undefined;
					this.fireStatusChanged(workspacePath).catch(() => { });
				}).catch(err => {
					console.error('[ChenilleIndexingService] 后台索引失败:', err);
					// 保存错误信息并触发状态更新
					wsConfig.errorMessage = err.message || '索引失败';
					this.fireStatusChanged(workspacePath).catch(() => { });
				});
			} catch (error) {
				console.error(`[ChenilleIndexingService] 激活工作区索引检查失败:`, error);
				wsConfig.errorMessage = `索引检查失败: ${error instanceof Error ? error.message : String(error)}`;
			}
		} catch (error) {
			console.error(`[ChenilleIndexingService] 激活工作区失败:`, error);
			// 不抛出异常，避免影响其他功能
		}
	}

	/**
	 * 获取存储统计信息（供管理页面使用）
	 */
	async getStorageStats(): Promise<IStorageStats> {
		const allConfigs = await this.configStorage.getAllWorkspaces();
		const workspaces: IStorageStats['workspaces'] = [];
		let totalSizeBytes = 0;

		for (const config of allConfigs) {
			const wsPath = config.workspacePath;
			const isOrphaned = !fs.existsSync(wsPath);

			// 获取索引大小（近似）
			let sizeBytes = 0;
			if (!isOrphaned) {
				try {
					const indexer = getCodebaseIndexer(undefined, this.environmentService);
					const stats = await indexer.getIndexStats(wsPath);
					if (stats) {
						sizeBytes = stats.rowCount * 1024; // 假设每条记录约 1KB
					}
				} catch {
					// 忽略错误
				}
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

		// 按大小排序
		workspaces.sort((a, b) => b.sizeBytes - a.sizeBytes);

		return {
			totalSizeBytes,
			indexCount: workspaces.length,
			workspaces,
		};
	}

	override dispose(): void {
		// 清理定时器
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}

		// 清理所有文件监听器
		for (const [, config] of this.workspaceConfigs) {
			config.watcher?.dispose();
		}
		this.workspaceConfigs.clear();
		this.lastIndexedTimes.clear();
		super.dispose();
	}
}
