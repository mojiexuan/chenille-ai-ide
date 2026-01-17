/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../base/common/path.js';
import { match as globMatch } from '../../../base/common/glob.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import {
	DEFAULT_INDEXING_CONFIG,
	generateContentHash,
	type ICodebaseIndexer,
	type IVectorIndex,
	type ICodeChunker,
	type IEmbeddingsProvider,
	type IIndexCache,
	type IndexTag,
	type RefreshIndexResults,
	type FileChangeItem,
	type CodeChunk,
	type RetrievalResult,
	type IndexProgressEvent,
	type IndexingConfig,
	type ICancellationToken,
} from '../../common/indexing/types.js';
import {
	IndexingError,
	IndexingErrorCode,
	wrapError,
} from '../../common/indexing/errors.js';
import { createEmbeddingsProvider } from './embeddings/localEmbeddings.js';
import { createCodeChunker } from './chunk/codeChunker.js';
import { createLanceDbIndex } from './vectorIndex/lanceDbIndex.js';
import { createIndexCache } from './cache/sqliteCache.js';


/**
 * 文件信息缓存（用于增量更新判断）
 */
interface FileInfo {
	path: string;
	cacheKey: string;
	mtime: number;
}

/**
 * 简单的异步互斥锁
 * 确保嵌入计算等资源密集型操作串行执行
 */
class AsyncMutex {
	private locked: boolean = false;
	private waitQueue: Array<() => void> = [];

	/**
	 * 获取锁
	 */
	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}

		// 等待锁释放
		return new Promise<void>((resolve) => {
			this.waitQueue.push(resolve);
		});
	}

	/**
	 * 释放锁
	 */
	release(): void {
		if (this.waitQueue.length > 0) {
			// 唤醒下一个等待者
			const next = this.waitQueue.shift()!;
			next();
		} else {
			this.locked = false;
		}
	}

	/**
	 * 获取等待队列长度
	 */
	get waiting(): number {
		return this.waitQueue.length;
	}
}

/**
 * 代码库索引器
 * 整合嵌入模型、代码切分、向量索引和缓存
 */
export class CodebaseIndexer implements ICodebaseIndexer {
	private embeddingsProvider: IEmbeddingsProvider;
	private readonly codeChunker: ICodeChunker;
	private vectorIndex: IVectorIndex;
	private cache: IIndexCache;
	private readonly config: IndexingConfig;

	/** 文件信息缓存（内存中） */
	private fileInfoCache: Map<string, Map<string, FileInfo>> = new Map();

	/** 当前正在索引的工作区 */
	private indexingWorkspaces: Set<string> = new Set();

	/** 互斥锁（确保嵌入计算串行执行，避免 OOM） */
	private indexingMutex: AsyncMutex = new AsyncMutex();

	constructor(
		config: Partial<IndexingConfig> = {},
		private readonly environmentService?: IEnvironmentService,
		embeddingsProvider?: IEmbeddingsProvider,
	) {
		this.config = { ...DEFAULT_INDEXING_CONFIG, ...config };

		try {
			// 初始化组件
			this.embeddingsProvider = embeddingsProvider || createEmbeddingsProvider(
				'local',
				this.config.localModelName,
			);
			this.codeChunker = createCodeChunker(this.environmentService);
			this.cache = createIndexCache(this.embeddingsProvider.embeddingId);
			this.vectorIndex = createLanceDbIndex(this.embeddingsProvider, this.cache);
		} catch (error) {
			throw new IndexingError(
				IndexingErrorCode.InitFailed,
				error,
				'索引服务初始化失败，请检查依赖是否安装正确',
			);
		}
	}

	/**
	 * 更换嵌入提供者（切换模型时使用）
	 */
	setEmbeddingsProvider(provider: IEmbeddingsProvider): void {
		this.embeddingsProvider = provider;
		this.cache = createIndexCache(provider.embeddingId);
		this.vectorIndex = createLanceDbIndex(provider, this.cache);
	}

	/**
	 * 设置本地模型下载进度回调
	 */
	setModelDownloadProgressCallback(callback: (progress: { status: string; file?: string; progress?: number }) => void): void {
		// 如果是 LocalEmbeddingsProvider，设置进度回调
		if (this.embeddingsProvider && 'setProgressCallback' in this.embeddingsProvider) {
			(this.embeddingsProvider as { setProgressCallback: (cb: typeof callback) => void }).setProgressCallback(callback);
		}
	}

	/**
	 * 获取当前嵌入提供者 ID
	 */
	getEmbeddingId(): string {
		return this.embeddingsProvider.embeddingId;
	}

	/**
	 * 检查是否已取消，如果已取消则抛出异常
	 */
	private checkCancellation(token?: ICancellationToken): void {
		if (token?.isCancellationRequested) {
			throw new IndexingError(IndexingErrorCode.Cancelled);
		}
	}

	/**
	 * 索引工作区
	 */
	async indexWorkspace(
		workspacePath: string,
		onProgress?: (event: IndexProgressEvent) => void,
		token?: ICancellationToken,
	): Promise<void> {
		// 防止重复索引
		if (this.indexingWorkspaces.has(workspacePath)) {
			throw new IndexingError(
				IndexingErrorCode.AlreadyIndexing,
				{ workspacePath },
			);
		}

		// 检查工作区是否存在
		try {
			await fs.promises.access(workspacePath);
		} catch {
			throw new IndexingError(
				IndexingErrorCode.WorkspaceNotFound,
				{ workspacePath },
			);
		}

		this.indexingWorkspaces.add(workspacePath);

		try {
			console.log(`[CodebaseIndexer] Starting to index ${workspacePath}`);
			const startTime = Date.now();

			// 检查取消
			this.checkCancellation(token);

			// 1. 扫描文件
			onProgress?.({ progress: 0, description: '正在扫描文件...' });
			const files = await this.scanFiles(workspacePath);
			console.log(`[CodebaseIndexer] Found ${files.length} files to index`);

			// 检查取消
			this.checkCancellation(token);

			if (files.length === 0) {
				onProgress?.({ progress: 1, description: '没有需要索引的文件' });
				return;
			}

			// 2. 计算增量更新
			onProgress?.({ progress: 0.1, description: '正在计算变更...' });
			const results = await this.calculateChanges(workspacePath, files);

			// 检查取消
			this.checkCancellation(token);

			const totalChanges = results.compute.length + results.del.length + results.addTag.length;
			console.log(`[CodebaseIndexer] Changes: ${results.compute.length} new/modified, ${results.del.length} deleted, ${results.addTag.length} unchanged`);

			if (totalChanges === 0) {
				onProgress?.({ progress: 1, description: '索引已是最新' });
				return;
			}

			// 3. 获取互斥锁（确保嵌入计算串行执行）
			const waitingCount = this.indexingMutex.waiting;
			if (waitingCount > 0) {
				onProgress?.({ progress: 0.15, description: `等待其他索引任务完成（队列中有 ${waitingCount} 个任务）...` });
				console.log(`[CodebaseIndexer] Waiting for mutex, ${waitingCount} tasks in queue`);
			}

			await this.indexingMutex.acquire();

			try {
				// 检查取消（在获取锁后再次检查）
				this.checkCancellation(token);

				// 4. 更新索引（传递取消令牌）
				const tag: IndexTag = {
					directory: workspacePath,
					artifactId: this.embeddingsProvider.embeddingId,
				};

				await this.vectorIndex.update(
					tag,
					results,
					(items) => this.getChunksForFiles(workspacePath, items),
					(event) => {
						// 调整进度范围到 0.2 - 1.0
						const adjustedProgress = 0.2 + event.progress * 0.8;
						onProgress?.({
							...event,
							progress: adjustedProgress,
						});
					},
					token, // 传递取消令牌
				);

				// 5. 更新文件信息缓存
				this.updateFileInfoCache(workspacePath, files);

				const duration = Date.now() - startTime;
				console.log(`[CodebaseIndexer] Indexing completed in ${duration}ms`);

				onProgress?.({
					progress: 1,
					description: `已索引 ${results.compute.length} 个文件，耗时 ${Math.round(duration / 1000)} 秒`,
				});
			} finally {
				// 释放互斥锁
				this.indexingMutex.release();
			}
		} finally {
			this.indexingWorkspaces.delete(workspacePath);
		}
	}

	/**
	 * 检索相似代码
	 */
	async retrieve(
		query: string,
		workspacePath: string,
		topK: number = 10,
	): Promise<RetrievalResult[]> {
		// 检查查询长度
		if (query.length > 10000) {
			throw new IndexingError(
				IndexingErrorCode.QueryTooLong,
				{ length: query.length, maxLength: 10000 },
			);
		}

		try {
			const tag: IndexTag = {
				directory: workspacePath,
				artifactId: this.embeddingsProvider.embeddingId,
			};

			return await this.vectorIndex.retrieve(query, topK, [tag]);
		} catch (error) {
			throw wrapError(error, IndexingErrorCode.RetrieveFailed);
		}
	}

	/**
	 * 处理文件变更
	 */
	async onFilesChanged(
		workspacePath: string,
		changedFiles: string[],
	): Promise<void> {
		if (changedFiles.length === 0) {
			return;
		}

		console.log(`[CodebaseIndexer] Processing ${changedFiles.length} file changes`);

		// 获取变更文件的信息
		const fileInfos: FileInfo[] = [];
		for (const filePath of changedFiles) {
			const fullPath = path.join(workspacePath, filePath);

			try {
				const stat = await fs.promises.stat(fullPath);
				const content = await fs.promises.readFile(fullPath, 'utf-8');
				fileInfos.push({
					path: filePath,
					cacheKey: generateContentHash(content),
					mtime: stat.mtimeMs,
				});
			} catch {
				// 文件可能已被删除，标记为删除
				fileInfos.push({
					path: filePath,
					cacheKey: '',
					mtime: 0,
				});
			}
		}

		// 计算变更
		const results = await this.calculateChanges(workspacePath, fileInfos);

		if (results.compute.length === 0 && results.del.length === 0) {
			return;
		}

		// 更新索引
		const tag: IndexTag = {
			directory: workspacePath,
			artifactId: this.embeddingsProvider.embeddingId,
		};

		await this.vectorIndex.update(
			tag,
			results,
			(items) => this.getChunksForFiles(workspacePath, items),
		);

		// 更新文件信息缓存
		this.updateFileInfoCache(workspacePath, fileInfos);
	}

	/**
	 * 删除工作区索引
	 */
	async deleteWorkspaceIndex(workspacePath: string): Promise<void> {
		const tag: IndexTag = {
			directory: workspacePath,
			artifactId: this.embeddingsProvider.embeddingId,
		};

		await this.vectorIndex.deleteIndex(tag);
		this.fileInfoCache.delete(workspacePath);

		console.log(`[CodebaseIndexer] Deleted index for ${workspacePath}`);
	}

	/**
	 * 扫描工作区文件
	 */
	private async scanFiles(workspacePath: string): Promise<FileInfo[]> {
		const extensions = new Set(this.config.includeExtensions || []);
		const excludePatterns = this.config.excludePatterns || [];

		const files: FileInfo[] = [];

		// 检查文件是否应被排除
		const shouldExclude = (relativePath: string): boolean => {
			for (const pattern of excludePatterns) {
				if (globMatch(pattern, relativePath)) {
					return true;
				}
			}
			return false;
		};

		// 递归扫描目录
		const scanDir = async (dir: string, relativeDir: string): Promise<void> => {
			try {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true });

				for (const entry of entries) {
					const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
					const fullPath = path.join(dir, entry.name);

					// 检查排除模式
					if (shouldExclude(relativePath)) {
						continue;
					}

					if (entry.isDirectory()) {
						await scanDir(fullPath, relativePath);
					} else if (entry.isFile()) {
						const ext = path.extname(entry.name).toLowerCase();
						if (extensions.has(ext)) {
							try {
								const stat = await fs.promises.stat(fullPath);
								const content = await fs.promises.readFile(fullPath, 'utf-8');

								files.push({
									path: relativePath,
									cacheKey: generateContentHash(content),
									mtime: stat.mtimeMs,
								});
							} catch (error) {
								console.warn(`[CodebaseIndexer] Failed to read ${relativePath}:`, error);
							}
						}
					}
				}
			} catch (error) {
				console.warn(`[CodebaseIndexer] Failed to scan directory ${dir}:`, error);
			}
		};

		await scanDir(workspacePath, '');

		return files;
	}

	/**
	 * 计算增量更新
	 */
	private async calculateChanges(
		workspacePath: string,
		currentFiles: FileInfo[],
	): Promise<RefreshIndexResults> {
		const cachedFiles = this.fileInfoCache.get(workspacePath) || new Map();
		const currentFileMap = new Map(currentFiles.map(f => [f.path, f]));

		const compute: FileChangeItem[] = [];
		const del: FileChangeItem[] = [];
		const addTag: FileChangeItem[] = [];

		// 检查新增/修改的文件
		for (const file of currentFiles) {
			const cached = cachedFiles.get(file.path);

			if (!cached) {
				// 新文件
				compute.push({ path: file.path, cacheKey: file.cacheKey });
			} else if (cached.cacheKey !== file.cacheKey) {
				// 文件已修改
				compute.push({ path: file.path, cacheKey: file.cacheKey });
			} else {
				// 文件未变更，可以复用缓存
				addTag.push({ path: file.path, cacheKey: file.cacheKey });
			}
		}

		// 检查删除的文件
		for (const [filePath, info] of cachedFiles) {
			if (!currentFileMap.has(filePath)) {
				del.push({ path: filePath, cacheKey: info.cacheKey });
			}
		}

		return { compute, del, addTag };
	}

	/**
	 * 获取文件的代码块（带内存优化）
	 */
	private async *getChunksForFiles(
		workspacePath: string,
		items: FileChangeItem[],
	): AsyncGenerator<CodeChunk> {
		const maxFileSize = this.config.maxFileSize || 1024 * 1024; // 默认 1MB

		for (const item of items) {
			const fullPath = path.join(workspacePath, item.path);

			try {
				// 检查文件大小，跳过过大的文件
				const stat = await fs.promises.stat(fullPath);
				if (stat.size > maxFileSize) {
					console.warn(`[CodebaseIndexer] 跳过大文件 ${item.path} (${Math.round(stat.size / 1024)}KB > ${Math.round(maxFileSize / 1024)}KB)`);
					continue;
				}

				let content: string | null = await fs.promises.readFile(fullPath, 'utf-8');

				for await (const chunk of this.codeChunker.chunk(
					item.path,
					content,
					this.config.maxChunkSize || 512,
				)) {
					yield chunk;
				}

				// 释放大字符串引用，帮助 GC
				content = null;
			} catch (error) {
				console.warn(`[CodebaseIndexer] Failed to chunk ${item.path}:`, error);
			}
		}
	}

	/**
	 * 更新文件信息缓存
	 */
	private updateFileInfoCache(workspacePath: string, files: FileInfo[]): void {
		const cache = new Map<string, FileInfo>();

		for (const file of files) {
			if (file.cacheKey) {
				// 只缓存有效文件（非删除）
				cache.set(file.path, file);
			}
		}

		this.fileInfoCache.set(workspacePath, cache);
	}

	/**
	 * 获取索引状态
	 */
	getIndexStatus(workspacePath: string): {
		isIndexing: boolean;
		fileCount: number;
		queuedTasks: number;
	} {
		const cached = this.fileInfoCache.get(workspacePath);
		return {
			isIndexing: this.indexingWorkspaces.has(workspacePath),
			fileCount: cached?.size || 0,
			queuedTasks: this.indexingMutex.waiting,
		};
	}

	/**
	 * 检查是否有已存在的索引
	 */
	async hasIndex(workspacePath: string): Promise<boolean> {
		const tag: IndexTag = {
			directory: workspacePath,
			artifactId: this.embeddingsProvider.embeddingId,
		};
		return this.vectorIndex.hasIndex(tag);
	}

	/**
	 * 获取索引统计信息（基础）
	 */
	async getIndexStats(workspacePath: string): Promise<{ rowCount: number } | null> {
		const tag: IndexTag = {
			directory: workspacePath,
			artifactId: this.embeddingsProvider.embeddingId,
		};
		return this.vectorIndex.getIndexStats(tag);
	}

	/**
	 * 获取索引详细统计
	 */
	async getDetailedStats(workspacePath: string): Promise<{
		totalChunks: number;
		uniqueFiles: number;
		languageDistribution: Record<string, number>;
		dbSizeBytes: number;
		cacheSizeBytes: number;
		avgChunksPerFile: number;
	} | null> {
		const tag: IndexTag = {
			directory: workspacePath,
			artifactId: this.embeddingsProvider.embeddingId,
		};

		// 获取详细统计（如果支持）
		if (!this.vectorIndex.getDetailedStats) {
			// 降级到基础统计
			const basicStats = await this.vectorIndex.getIndexStats(tag);
			if (!basicStats) {
				return null;
			}
			return {
				totalChunks: basicStats.rowCount,
				uniqueFiles: 0,
				languageDistribution: {},
				dbSizeBytes: basicStats.rowCount * 1024,
				cacheSizeBytes: 0,
				avgChunksPerFile: 0,
			};
		}

		const lanceStats = await this.vectorIndex.getDetailedStats(tag);
		if (!lanceStats) {
			return null;
		}

		// 计算数据库大小（近似）
		const dbSizeBytes = lanceStats.totalChunks * 1024; // 假设每条记录约 1KB

		return {
			totalChunks: lanceStats.totalChunks,
			uniqueFiles: lanceStats.uniqueFiles,
			languageDistribution: lanceStats.languageDistribution,
			dbSizeBytes,
			cacheSizeBytes: 0,
			avgChunksPerFile: lanceStats.uniqueFiles > 0
				? Math.round(lanceStats.totalChunks / lanceStats.uniqueFiles * 10) / 10
				: 0,
		};
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		this.fileInfoCache.clear();
		this.indexingWorkspaces.clear();

		const tryDispose = (obj: unknown): void => {
			if (obj && typeof obj === 'object' && typeof (obj as { dispose?: unknown }).dispose === 'function') {
				(obj as { dispose: () => void }).dispose();
			}
		};

		tryDispose(this.embeddingsProvider);
		tryDispose(this.codeChunker);
		tryDispose(this.vectorIndex);
		tryDispose(this.cache);
	}
}

/**
 * 单例实例
 */
let indexerInstance: CodebaseIndexer | null = null;
let indexerEnvironmentService: IEnvironmentService | undefined = undefined;

/**
 * 获取索引器实例
 * @param config 索引配置
 * @param environmentService 环境服务，用于正确解析 WASM 路径
 */
export function getCodebaseIndexer(
	config?: Partial<IndexingConfig>,
	environmentService?: IEnvironmentService,
): CodebaseIndexer {
	// 如果 environmentService 变化了，需要重建实例
	if (indexerInstance && environmentService && environmentService !== indexerEnvironmentService) {
		indexerInstance.dispose();
		indexerInstance = null;
	}

	if (!indexerInstance) {
		indexerInstance = new CodebaseIndexer(config, environmentService);
		indexerEnvironmentService = environmentService;
	}
	return indexerInstance;
}

/**
 * 重置索引器实例（用于测试）
 */
export function resetCodebaseIndexer(): void {
	if (indexerInstance) {
		indexerInstance.dispose();
		indexerInstance = null;
		indexerEnvironmentService = undefined;
	}
}
