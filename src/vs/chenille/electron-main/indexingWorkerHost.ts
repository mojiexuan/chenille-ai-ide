/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 索引 Worker 宿主
 * 在主进程中管理 Utility Process，与 Worker 通信
 */

import { UtilityProcess, utilityProcess } from 'electron';
import * as path from '../../base/common/path.js';
import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { FileAccess } from '../../base/common/network.js';
import type {
	WorkerRequest,
	WorkerResponse,
	WorkerIndexStatus,
	WorkerIndexStats,
	WorkerDetailedStats,
} from '../common/indexing/workerProtocol.js';
import {
	createRequestId,
	isSuccessResponse,
	isErrorResponse,
	isProgressResponse,
	isModelDownloadProgressResponse,
} from '../common/indexing/workerProtocol.js';
import type { IndexProgressEvent, RetrievalResult, IndexingConfig } from '../common/indexing/types.js';
import type { IModelDownloadProgress } from '../common/indexing/indexingService.js';
import { IndexingError, IndexingErrorCode } from '../common/indexing/errors.js';

/**
 * 待处理的请求
 */
interface PendingRequest<T = unknown> {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * 索引 Worker 宿主配置
 */
export interface IndexingWorkerHostOptions {
	/** 缓存目录 */
	cacheHome: string;
	/** 索引配置 */
	config?: Partial<IndexingConfig>;
	/** 请求超时（毫秒） */
	requestTimeout?: number;
}

/**
 * 索引 Worker 宿主
 */
export class IndexingWorkerHost extends Disposable {
	private worker: UtilityProcess | null = null;
	private pendingRequests: Map<string, PendingRequest> = new Map();
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	private readonly options: IndexingWorkerHostOptions & { requestTimeout: number };

	/** 默认请求超时：5 分钟 */
	private static readonly DEFAULT_TIMEOUT = 5 * 60 * 1000;

	/** 索引请求超时：30 分钟（大型项目可能需要很长时间） */
	private static readonly INDEX_TIMEOUT = 30 * 60 * 1000;

	private readonly _onIndexProgress = this._register(new Emitter<{ workspacePath: string; event: IndexProgressEvent }>());
	readonly onIndexProgress: Event<{ workspacePath: string; event: IndexProgressEvent }> = this._onIndexProgress.event;

	private readonly _onModelDownloadProgress = this._register(new Emitter<{ workspacePath: string; progress: IModelDownloadProgress }>());
	readonly onModelDownloadProgress: Event<{ workspacePath: string; progress: IModelDownloadProgress }> = this._onModelDownloadProgress.event;

	private readonly _onWorkerError = this._register(new Emitter<Error>());
	readonly onWorkerError: Event<Error> = this._onWorkerError.event;

	constructor(options: IndexingWorkerHostOptions) {
		super();
		this.options = {
			requestTimeout: IndexingWorkerHost.DEFAULT_TIMEOUT,
			...options,
		};
	}

	/**
	 * 确保 Worker 已初始化
	 */
	private async ensureInitialized(): Promise<void> {
		if (this.initialized) {
			return;
		}

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this.initialize();
		await this.initPromise;
	}

	/**
	 * 初始化 Worker
	 */
	private async initialize(): Promise<void> {
		console.log('[IndexingWorkerHost] Starting utility process...');

		// 获取 Worker 脚本路径
		const workerPath = this.getWorkerPath();
		console.log('[IndexingWorkerHost] Worker path:', workerPath);

		// 创建 Utility Process
		this.worker = utilityProcess.fork(workerPath, [], {
			serviceName: 'chenille-indexing-worker',
			stdio: 'pipe',
		});

		// 监听消息
		this.worker.on('message', (message: WorkerResponse) => {
			this.handleWorkerMessage(message);
		});

		// 监听错误
		this.worker.on('spawn', () => {
			console.log('[IndexingWorkerHost] Worker process spawned');
		});

		this.worker.on('exit', (code) => {
			console.log('[IndexingWorkerHost] Worker process exited with code:', code);
			this.worker = null;
			this.initialized = false;
			this.initPromise = null;

			// 拒绝所有待处理的请求
			for (const [, pending] of this.pendingRequests) {
				clearTimeout(pending.timeout);
				pending.reject(new IndexingError(IndexingErrorCode.WorkerCrashed, { exitCode: code }));
			}
			this.pendingRequests.clear();
		});

		// 发送初始化请求
		await this.sendRequest<{ initialized: boolean }>({
			id: createRequestId(),
			type: 'init',
			data: {
				cacheHome: this.options.cacheHome,
				config: this.options.config,
			},
		});

		this.initialized = true;
		console.log('[IndexingWorkerHost] Worker initialized');
	}

	/**
	 * 获取 Worker 脚本路径
	 */
	private getWorkerPath(): string {
		// 在开发环境和生产环境中路径可能不同
		// 使用 FileAccess 来获取正确的路径
		try {
			const uri = FileAccess.asFileUri('vs/chenille/node/indexing/indexingWorker.js');
			return uri.fsPath;
		} catch {
			// 回退到相对路径
			return path.join(__dirname, '../node/indexing/indexingWorker.js');
		}
	}

	/**
	 * 处理来自 Worker 的消息
	 */
	private handleWorkerMessage(response: WorkerResponse): void {
		// 处理进度消息（不需要匹配请求）
		if (isProgressResponse(response)) {
			this._onIndexProgress.fire({
				workspacePath: response.data.workspacePath,
				event: response.data.event,
			});
			return;
		}

		// 处理模型下载进度
		if (isModelDownloadProgressResponse(response)) {
			this._onModelDownloadProgress.fire({
				workspacePath: response.data.workspacePath,
				progress: response.data.progress,
			});
			return;
		}

		// 查找对应的请求
		const pending = this.pendingRequests.get(response.id);
		if (!pending) {
			console.warn('[IndexingWorkerHost] Received response for unknown request:', response.id);
			return;
		}

		// 清理
		clearTimeout(pending.timeout);
		this.pendingRequests.delete(response.id);

		// 处理响应
		if (isSuccessResponse(response)) {
			pending.resolve(response.data);
		} else if (isErrorResponse(response)) {
			const error = new IndexingError(
				(parseInt(response.error.code) || IndexingErrorCode.Unknown) as IndexingErrorCode,
				response.error.details,
				response.error.message,
			);
			pending.reject(error);
		}
	}

	/**
	 * 发送请求到 Worker
	 */
	private sendRequest<T>(request: WorkerRequest, timeout?: number): Promise<T> {
		return new Promise((resolve, reject) => {
			if (!this.worker) {
				reject(new IndexingError(IndexingErrorCode.WorkerNotReady));
				return;
			}

			const timeoutMs = timeout ?? this.options.requestTimeout;
			const timeoutHandle = setTimeout(() => {
				this.pendingRequests.delete(request.id);
				reject(new IndexingError(IndexingErrorCode.Timeout, { requestId: request.id }));
			}, timeoutMs);

			this.pendingRequests.set(request.id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeout: timeoutHandle,
			});

			this.worker.postMessage(request);
		});
	}

	// ============ 公共 API ============

	/**
	 * 索引工作区
	 */
	async indexWorkspace(
		workspacePath: string,
		config?: Partial<IndexingConfig>,
		embeddingModel?: {
			baseUrl: string;
			apiKey: string;
			modelId: string;
			modelName: string;
		},
		useLocalModel?: boolean,
	): Promise<{ completed?: boolean; cancelled?: boolean }> {
		await this.ensureInitialized();

		return this.sendRequest<{ completed?: boolean; cancelled?: boolean }>(
			{
				id: createRequestId(),
				type: 'indexWorkspace',
				data: {
					workspacePath,
					config,
					embeddingModel,
					useLocalModel,
				},
			},
			IndexingWorkerHost.INDEX_TIMEOUT,
		);
	}

	/**
	 * 取消索引
	 */
	async cancelIndexing(workspacePath: string): Promise<void> {
		await this.ensureInitialized();

		await this.sendRequest({
			id: createRequestId(),
			type: 'cancelIndexing',
			data: { workspacePath },
		});
	}

	/**
	 * 检索
	 */
	async retrieve(query: string, workspacePath: string, topK?: number): Promise<RetrievalResult[]> {
		await this.ensureInitialized();

		return this.sendRequest<RetrievalResult[]>({
			id: createRequestId(),
			type: 'retrieve',
			data: { query, workspacePath, topK },
		});
	}

	/**
	 * 处理文件变更
	 */
	async onFilesChanged(workspacePath: string, changedFiles: string[]): Promise<void> {
		await this.ensureInitialized();

		await this.sendRequest({
			id: createRequestId(),
			type: 'onFilesChanged',
			data: { workspacePath, changedFiles },
		});
	}

	/**
	 * 删除索引
	 */
	async deleteIndex(workspacePath: string): Promise<void> {
		await this.ensureInitialized();

		await this.sendRequest({
			id: createRequestId(),
			type: 'deleteIndex',
			data: { workspacePath },
		});
	}

	/**
	 * 获取索引状态
	 */
	async getIndexStatus(workspacePath: string): Promise<WorkerIndexStatus> {
		await this.ensureInitialized();

		return this.sendRequest<WorkerIndexStatus>({
			id: createRequestId(),
			type: 'getIndexStatus',
			data: { workspacePath },
		});
	}

	/**
	 * 获取索引统计
	 */
	async getIndexStats(workspacePath: string): Promise<WorkerIndexStats | null> {
		await this.ensureInitialized();

		return this.sendRequest<WorkerIndexStats | null>({
			id: createRequestId(),
			type: 'getIndexStats',
			data: { workspacePath },
		});
	}

	/**
	 * 获取详细统计
	 */
	async getDetailedStats(workspacePath: string): Promise<WorkerDetailedStats | null> {
		await this.ensureInitialized();

		return this.sendRequest<WorkerDetailedStats | null>({
			id: createRequestId(),
			type: 'getDetailedStats',
			data: { workspacePath },
		});
	}

	/**
	 * 检查是否有索引
	 */
	async hasIndex(workspacePath: string): Promise<boolean> {
		await this.ensureInitialized();

		return this.sendRequest<boolean>({
			id: createRequestId(),
			type: 'hasIndex',
			data: { workspacePath },
		});
	}

	/**
	 * 设置嵌入提供者
	 */
	async setEmbeddingsProvider(
		embeddingModel?: {
			baseUrl: string;
			apiKey: string;
			modelId: string;
			modelName: string;
		},
		useLocalModel?: boolean,
		localModelName?: string,
	): Promise<void> {
		await this.ensureInitialized();

		await this.sendRequest({
			id: createRequestId(),
			type: 'setEmbeddingsProvider',
			data: { embeddingModel, useLocalModel, localModelName },
		});
	}

	/**
	 * 检查本地模型是否已缓存
	 */
	async isLocalModelCached(): Promise<boolean> {
		// 这个检查可以在主进程中完成，不需要发送到 Worker
		try {
			const os = await import('os');
			const fs = await import('fs');
			const pathModule = await import('path');

			const modelName = 'Xenova/all-MiniLM-L6-v2';
			const cacheDir = pathModule.join(os.homedir(), '.cache', 'huggingface', 'hub');
			const modelDir = pathModule.join(cacheDir, `models--${modelName.replace('/', '--')}`);

			const stat = await fs.promises.stat(modelDir);
			if (stat.isDirectory()) {
				const snapshotsDir = pathModule.join(modelDir, 'snapshots');
				const snapshotsStat = await fs.promises.stat(snapshotsDir);
				return snapshotsStat.isDirectory();
			}
			return false;
		} catch {
			return false;
		}
	}

	/**
	 * 释放资源
	 */
	override dispose(): void {
		if (this.worker) {
			// 发送 dispose 请求（不等待响应）
			this.worker.postMessage({
				id: createRequestId(),
				type: 'dispose',
			});

			// 给 Worker 一点时间来清理
			setTimeout(() => {
				if (this.worker) {
					this.worker.kill();
					this.worker = null;
				}
			}, 500);
		}

		// 清理待处理的请求
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new IndexingError(IndexingErrorCode.Disposed));
		}
		this.pendingRequests.clear();

		super.dispose();
	}
}

