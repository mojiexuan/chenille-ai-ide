/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../base/common/path.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import {
	DEFAULT_INDEXING_CONFIG,
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
import {
	MerkleTree,
	TreeBuilder,
	TreeSerializer,
	createTreeBuilder,
	createTreeSerializer,
} from './fileTree/index.js';


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

	/** Merkle 文件树（每个工作区一棵） */
	private merkleTrees: Map<string, MerkleTree> = new Map();

	/** 树构建器 */
	private treeBuilder: TreeBuilder;

	/** 树序列化器 */
	private treeSerializer: TreeSerializer | undefined;

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

			// 初始化 Merkle 树组件
			this.treeBuilder = createTreeBuilder({
				includeExtensions: this.config.includeExtensions,
				excludePatterns: this.config.excludePatterns,
				maxFileSize: this.config.maxFileSize,
			});

			// 初始化持久化（如果有 environmentService）
			if (this.environmentService) {
				const cacheDir = path.join(
					this.environmentService.cacheHome.fsPath,
					'chenille',
					'index-cache',
				);
				this.treeSerializer = createTreeSerializer(cacheDir);
			}
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
	 * 获取或创建工作区的 Merkle 树
	 */
	private async getMerkleTree(workspacePath: string): Promise<MerkleTree> {
		// 先从内存缓存获取
		let tree = this.merkleTrees.get(workspacePath);
		if (tree) {
			return tree;
		}

		// 尝试从持久化存储加载
		if (this.treeSerializer) {
			const loadedTree = await this.treeSerializer.load(workspacePath);
			if (loadedTree) {
				this.merkleTrees.set(workspacePath, loadedTree as MerkleTree);
				return loadedTree as MerkleTree;
			}
		}

		// 创建新树
		tree = new MerkleTree(workspacePath);
		this.merkleTrees.set(workspacePath, tree);
		return tree;
	}

	/**
	 * 保存 Merkle 树到持久化存储
	 */
	private async saveMerkleTree(workspacePath: string): Promise<void> {
		if (!this.treeSerializer) {
			return;
		}

		const tree = this.merkleTrees.get(workspacePath);
		if (tree) {
			await this.treeSerializer.save(tree);
		}
	}

	/**
	 * 将 Merkle 树变更转换为索引结果格式
	 */
	private convertChangesToIndexResults(
		changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }>,
		merkleTree: MerkleTree,
	): RefreshIndexResults {
		const compute: FileChangeItem[] = [];
		const del: FileChangeItem[] = [];
		const addTag: FileChangeItem[] = [];

		for (const change of changes) {
			const node = merkleTree.getNode(change.path);
			const cacheKey = node?.hash || '';

			if (change.type === 'add' || change.type === 'modify') {
				compute.push({ path: change.path, cacheKey });
			} else if (change.type === 'delete') {
				del.push({ path: change.path, cacheKey });
			}
		}

		// 获取所有未变更的文件作为 addTag
		const allFiles = merkleTree.getAllFilePaths();
		const changedPaths = new Set(changes.map(c => c.path));
		for (const filePath of allFiles) {
			if (!changedPaths.has(filePath)) {
				const node = merkleTree.getNode(filePath);
				if (node) {
					addTag.push({ path: filePath, cacheKey: node.hash });
				}
			}
		}

		return { compute, del, addTag };
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

			// 1. 获取或创建 Merkle 树
			onProgress?.({ progress: 0, description: '正在加载文件树...' });
			const merkleTree = await this.getMerkleTree(workspacePath);
			const oldRootHash = merkleTree.rootHash;

			// 2. 扫描文件并更新 Merkle 树
			onProgress?.({ progress: 0.05, description: '正在扫描文件...' });
			const { changes } = await this.treeBuilder.fullScan(merkleTree);
			console.log(`[CodebaseIndexer] Merkle tree updated, ${changes.length} changes detected`);

			// 检查取消
			this.checkCancellation(token);

			if (changes.length === 0 && oldRootHash === merkleTree.rootHash) {
				onProgress?.({ progress: 1, description: '索引已是最新' });
				// 保存 Merkle 树
				await this.saveMerkleTree(workspacePath);
				return;
			}

			// 3. 转换变更为索引格式
			onProgress?.({ progress: 0.1, description: '正在计算变更...' });
			const results = this.convertChangesToIndexResults(changes, merkleTree);

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

				// 5. 保存 Merkle 树
				await this.saveMerkleTree(workspacePath);

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
	 * 处理文件变更（使用 Merkle 树增量更新）
	 */
	async onFilesChanged(
		workspacePath: string,
		changedFiles: string[],
	): Promise<void> {
		if (changedFiles.length === 0) {
			return;
		}

		console.log(`[CodebaseIndexer] Processing ${changedFiles.length} file changes via Merkle tree`);

		// 获取 Merkle 树
		const merkleTree = await this.getMerkleTree(workspacePath);

		// 使用 TreeBuilder 增量更新
		const { changes } = await this.treeBuilder.update(merkleTree, changedFiles);

		if (changes.length === 0) {
			return;
		}

		// 转换变更为索引格式
		const results = this.convertChangesToIndexResults(changes, merkleTree);

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

		// 保存 Merkle 树
		await this.saveMerkleTree(workspacePath);

		console.log(`[CodebaseIndexer] Incremental update: ${results.compute.length} compute, ${results.del.length} delete`);
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

		// 清理 Merkle 树缓存
		this.merkleTrees.delete(workspacePath);
		if (this.treeSerializer) {
			await this.treeSerializer.delete(workspacePath);
		}

		console.log(`[CodebaseIndexer] Deleted index for ${workspacePath}`);
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
	 * 获取索引状态
	 */
	getIndexStatus(workspacePath: string): {
		isIndexing: boolean;
		fileCount: number;
		queuedTasks: number;
	} {
		const tree = this.merkleTrees.get(workspacePath);
		return {
			isIndexing: this.indexingWorkspaces.has(workspacePath),
			fileCount: tree ? tree.getAllFilePaths().length : 0,
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
		this.merkleTrees.clear();
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
