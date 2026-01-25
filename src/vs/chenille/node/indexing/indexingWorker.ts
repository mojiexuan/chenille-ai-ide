/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 索引 Utility Process 入口
 * 在独立进程中运行所有索引相关的重计算工作
 */

import {
	type WorkerRequest,
	type WorkerIndexStatus,
	type WorkerIndexStats,
	type WorkerDetailedStats,
	createSuccessResponse,
	createErrorResponse,
	createProgressResponse,
	createModelDownloadProgressResponse,
} from '../../common/indexing/workerProtocol.js';
import { IndexingErrorCode } from '../../common/indexing/errors.js';
import type { RetrievalResult, IEmbeddingsProvider } from '../../common/indexing/types.js';
import { AiProvider } from '../../common/types.js';
import { CodebaseIndexer } from './codebaseIndexer.js';
import { LocalEmbeddingsProvider } from './embeddings/localEmbeddings.js';
import { ApiEmbeddingsProvider } from './embeddings/apiEmbeddings.js';

interface MinimalEnvironmentService {
	cacheHome: { fsPath: string };
}

class IndexingWorker {
	private indexer: CodebaseIndexer | null = null;
	private environmentService: MinimalEnvironmentService | null = null;
	private indexingTasks: Map<string, { cancelled: boolean }> = new Map();

	constructor() {
		process.on('message', (message: WorkerRequest) => {
			this.handleMessage(message).catch(err => {
				console.error('[IndexingWorker] Unhandled error:', err);
			});
		});
		console.log('[IndexingWorker] Worker process started');
	}

	private send(response: unknown): void {
		if (process.send) {
			process.send(response);
		}
	}


	private async handleMessage(request: WorkerRequest): Promise<void> {
		const { id, type } = request;

		try {
			switch (type) {
				case 'init':
					await this.handleInit(id, request.data);
					break;
				case 'indexWorkspace':
					await this.handleIndexWorkspace(id, request.data);
					break;
				case 'cancelIndexing':
					this.handleCancelIndexing(id, request.data);
					break;
				case 'retrieve':
					await this.handleRetrieve(id, request.data);
					break;
				case 'onFilesChanged':
					await this.handleOnFilesChanged(id, request.data);
					break;
				case 'deleteIndex':
					await this.handleDeleteIndex(id, request.data);
					break;
				case 'getIndexStatus':
					await this.handleGetIndexStatus(id, request.data);
					break;
				case 'getIndexStats':
					await this.handleGetIndexStats(id, request.data);
					break;
				case 'getDetailedStats':
					await this.handleGetDetailedStats(id, request.data);
					break;
				case 'hasIndex':
					await this.handleHasIndex(id, request.data);
					break;
				case 'setEmbeddingsProvider':
					await this.handleSetEmbeddingsProvider(id, request.data);
					break;
				case 'dispose':
					this.handleDispose(id);
					break;
				default:
					this.send(createErrorResponse(id, 'UNKNOWN_REQUEST', `Unknown request type: ${type}`));
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorCode = (error as { code?: string }).code || 'UNKNOWN_ERROR';
			this.send(createErrorResponse(id, errorCode, errorMessage));
		}
	}

	private async handleInit(id: string, data: { cacheHome: string; config?: unknown }): Promise<void> {
		this.environmentService = {
			cacheHome: { fsPath: data.cacheHome },
		};

		this.indexer = new CodebaseIndexer(
			data.config as Partial<import('../../common/indexing/types.js').IndexingConfig>,
			this.environmentService as import('../../../platform/environment/common/environment.js').IEnvironmentService,
		);

		console.log('[IndexingWorker] Indexer initialized with cacheHome:', data.cacheHome);
		this.send(createSuccessResponse(id, { initialized: true }));
	}


	private async handleIndexWorkspace(
		id: string,
		data: {
			workspacePath: string;
			config?: unknown;
			embeddingModel?: { baseUrl: string; apiKey: string; modelId: string; modelName: string };
			useLocalModel?: boolean;
		},
	): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		const { workspacePath, embeddingModel, useLocalModel } = data;

		if (this.indexingTasks.has(workspacePath)) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.AlreadyIndexing), 'Already indexing'));
			return;
		}

		// Setup embeddings provider
		this.setupEmbeddingsProvider(embeddingModel, useLocalModel, workspacePath, id);

		const task = { cancelled: false };
		this.indexingTasks.set(workspacePath, task);

		try {
			const cancellationToken = {
				get isCancellationRequested() { return task.cancelled; },
				onCancellationRequested: () => ({ dispose: () => { } }),
			};

			await this.indexer.indexWorkspace(
				workspacePath,
				(event) => {
					this.send(createProgressResponse(id, workspacePath, event));
				},
				cancellationToken,
			);

			this.send(createSuccessResponse(id, { completed: true }));
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorCode = (error as { code?: string }).code || String(IndexingErrorCode.IndexFailed);

			if (errorCode === String(IndexingErrorCode.Cancelled)) {
				this.send(createSuccessResponse(id, { cancelled: true }));
			} else {
				this.send(createErrorResponse(id, errorCode, errorMessage));
			}
		} finally {
			this.indexingTasks.delete(workspacePath);
		}
	}

	private setupEmbeddingsProvider(
		embeddingModel: { baseUrl: string; apiKey: string; modelId: string; modelName: string } | undefined,
		useLocalModel: boolean | undefined,
		workspacePath: string,
		requestId: string,
	): void {
		if (!this.indexer) {
			return;
		}

		let provider: IEmbeddingsProvider;

		if (embeddingModel && !useLocalModel) {
			provider = new ApiEmbeddingsProvider(
				{
					name: embeddingModel.modelName,
					baseUrl: embeddingModel.baseUrl,
					apiKey: embeddingModel.apiKey,
					model: embeddingModel.modelId,
					provider: AiProvider.OPENAI,
					contextSize: 8192,
					maxTokens: 8192,
					temperature: 0,
				},
				embeddingModel.modelId,
			);
		} else {
			provider = new LocalEmbeddingsProvider('Xenova/all-MiniLM-L6-v2', (progress) => {
				this.send(createModelDownloadProgressResponse(requestId, workspacePath, {
					status: progress.status,
					file: progress.file,
					progress: progress.progress,
				}));
			});
		}

		this.indexer.setEmbeddingsProvider(provider);
	}


	private handleCancelIndexing(id: string, data: { workspacePath: string }): void {
		const task = this.indexingTasks.get(data.workspacePath);
		if (task) {
			task.cancelled = true;
		}
		this.send(createSuccessResponse(id, { cancelled: true }));
	}

	private async handleRetrieve(
		id: string,
		data: { query: string; workspacePath: string; topK?: number },
	): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		const results: RetrievalResult[] = await this.indexer.retrieve(data.query, data.workspacePath, data.topK);
		this.send(createSuccessResponse(id, results));
	}

	private async handleOnFilesChanged(
		id: string,
		data: { workspacePath: string; changedFiles: string[] },
	): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		await this.indexer.onFilesChanged(data.workspacePath, data.changedFiles);
		this.send(createSuccessResponse(id, { processed: data.changedFiles.length }));
	}

	private async handleDeleteIndex(id: string, data: { workspacePath: string }): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		await this.indexer.deleteWorkspaceIndex(data.workspacePath);
		this.send(createSuccessResponse(id, { deleted: true }));
	}

	private async handleGetIndexStatus(id: string, data: { workspacePath: string }): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		const status = this.indexer.getIndexStatus(data.workspacePath);
		const result: WorkerIndexStatus = {
			isIndexing: status.isIndexing,
			totalFileCount: status.totalFileCount,
			queuedTasks: status.queuedTasks,
		};
		this.send(createSuccessResponse(id, result));
	}

	private async handleGetIndexStats(id: string, data: { workspacePath: string }): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		const stats = await this.indexer.getIndexStats(data.workspacePath);
		const result: WorkerIndexStats | null = stats ? { rowCount: stats.rowCount } : null;
		this.send(createSuccessResponse(id, result));
	}

	private async handleGetDetailedStats(id: string, data: { workspacePath: string }): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		const stats = await this.indexer.getDetailedStats(data.workspacePath);
		const result: WorkerDetailedStats | null = stats ? {
			totalChunks: stats.totalChunks,
			uniqueFiles: stats.uniqueFiles,
			languageDistribution: stats.languageDistribution,
			dbSizeBytes: stats.dbSizeBytes,
			cacheSizeBytes: stats.cacheSizeBytes,
			avgChunksPerFile: stats.avgChunksPerFile,
		} : null;
		this.send(createSuccessResponse(id, result));
	}

	private async handleHasIndex(id: string, data: { workspacePath: string }): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		const hasIndex = await this.indexer.hasIndex(data.workspacePath);
		this.send(createSuccessResponse(id, hasIndex));
	}


	private async handleSetEmbeddingsProvider(
		id: string,
		data: {
			embeddingModel?: { baseUrl: string; apiKey: string; modelId: string; modelName: string };
			useLocalModel?: boolean;
			localModelName?: string;
		},
	): Promise<void> {
		if (!this.indexer) {
			this.send(createErrorResponse(id, String(IndexingErrorCode.InitFailed), 'Indexer not initialized'));
			return;
		}

		let provider: IEmbeddingsProvider;

		if (data.embeddingModel && !data.useLocalModel) {
			provider = new ApiEmbeddingsProvider(
				{
					name: data.embeddingModel.modelName,
					baseUrl: data.embeddingModel.baseUrl,
					apiKey: data.embeddingModel.apiKey,
					model: data.embeddingModel.modelId,
					provider: AiProvider.OPENAI,
					contextSize: 8192,
					maxTokens: 8192,
					temperature: 0,
				},
				data.embeddingModel.modelId,
			);
		} else {
			provider = new LocalEmbeddingsProvider(data.localModelName || 'Xenova/all-MiniLM-L6-v2');
		}

		this.indexer.setEmbeddingsProvider(provider);
		this.send(createSuccessResponse(id, { set: true }));
	}

	private handleDispose(id: string): void {
		if (this.indexer) {
			this.indexer.dispose();
			this.indexer = null;
		}

		this.send(createSuccessResponse(id, { disposed: true }));

		setTimeout(() => {
			process.exit(0);
		}, 100);
	}
}

// Start worker
new IndexingWorker();
