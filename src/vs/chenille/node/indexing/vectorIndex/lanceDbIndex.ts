/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from '../../../../base/common/path.js';
import * as os from 'os';
import {
	generateUuid,
	type IVectorIndex,
	type IEmbeddingsProvider,
	type IIndexCache,
	type IndexTag,
	type RefreshIndexResults,
	type FileChangeItem,
	type CodeChunk,
	type VectorIndexRow,
	type RetrievalResult,
	type IndexProgressEvent,
	type ICancellationToken,
} from '../../../common/indexing/types.js';
import {
	IndexingError,
	IndexingErrorCode,
} from '../../../common/indexing/errors.js';

// LanceDB 类型使用 any 以适配实际 API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanceConnection = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanceTable = any;

/**
 * LanceDB 搜索结果结构
 */
interface LanceSearchResult {
	path: string;
	contents: string;
	startLine: number;
	endLine: number;
	language?: string;
	_distance: number;
}

/**
 * 获取 LanceDB 数据目录
 */
function getLanceDbPath(): string {
	const homeDir = os.homedir();
	return path.join(homeDir, '.chenille-ai', 'vector-index');
}

/**
 * 生成表名（包含模型标识，确保不同模型使用不同的表）
 */
function getTableName(tag: IndexTag): string {
	const dirHash = tag.directory.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
	const branchPart = tag.branch ? `_${tag.branch.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
	// 添加模型标识哈希，确保不同模型使用不同的表
	const modelHash = tag.artifactId.replace(/[^a-zA-Z0-9]/g, '_').slice(-20);
	return `cb_${dirHash}${branchPart}_${modelHash}`.slice(0, 100);
}

/**
 * LanceDB 向量索引实现
 */
export class LanceDbIndex implements IVectorIndex {
	private connection: LanceConnection | null = null;
	private initPromise: Promise<void> | null = null;

	constructor(
		private readonly embeddingsProvider: IEmbeddingsProvider,
		private readonly cache: IIndexCache,
	) { }

	/**
	 * 初始化 LanceDB 连接
	 */
	private async initialize(): Promise<void> {
		if (this.connection) {
			return;
		}

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this.connect();
		await this.initPromise;
	}

	private async connect(): Promise<void> {
		try {
			const lancedb = await import('@lancedb/lancedb');
			const dbPath = getLanceDbPath();

			console.log(`[LanceDbIndex] Connecting to ${dbPath}`);
			this.connection = await lancedb.connect(dbPath);
			console.log('[LanceDbIndex] Connected successfully');
		} catch (error) {
			console.error('[LanceDbIndex] Failed to connect:', error);
			throw new Error(`Failed to connect to LanceDB: ${error}`);
		}
	}

	/**
	 * 检查是否已取消
	 */
	private checkCancellation(token?: ICancellationToken): void {
		if (token?.isCancellationRequested) {
			throw new IndexingError(IndexingErrorCode.Cancelled);
		}
	}

	/**
	 * 更新索引
	 */
	async update(
		tag: IndexTag,
		results: RefreshIndexResults,
		getChunks: (items: FileChangeItem[]) => AsyncGenerator<CodeChunk>,
		onProgress?: (event: IndexProgressEvent) => void,
		token?: ICancellationToken,
		options?: { concurrency?: number },
	): Promise<void> {
		await this.initialize();

		if (!this.connection) {
			throw new IndexingError(IndexingErrorCode.VectorIndexFailed, null, 'LanceDB 未初始化');
		}

		const tableName = getTableName(tag);
		const totalItems = results.compute.length + results.del.length + results.addTag.length;
		let processedItems = 0;

		const reportProgress = (description: string, currentFile?: string) => {
			if (onProgress) {
				onProgress({
					progress: totalItems > 0 ? processedItems / totalItems : 0,
					description,
					currentFile,
					indexedCount: processedItems,
					totalCount: totalItems,
				});
			}
		};

		// 获取或创建表
		let table: LanceTable;
		const existingTables = await this.connection.tableNames();

		// 创建新表的辅助函数
		const createNewTable = async () => {
			const dummyRow: VectorIndexRow = {
				uuid: 'placeholder',
				path: '',
				cacheKey: '',
				vector: new Array(this.embeddingsProvider.dimensions).fill(0),
				startLine: 0,
				endLine: 0,
				contents: '',
				language: '',
			};
			const newTable = await this.connection!.createTable(tableName, [dummyRow]);
			await newTable.delete("uuid = 'placeholder'");
			return newTable;
		};

		if (existingTables.includes(tableName)) {
			table = await this.connection.openTable(tableName);

			// 检查表 schema 是否有 language 字段
			try {
				const schema = await table.schema();
				const fieldNames = schema.fields.map((f: { name: string }) => f.name);
				if (!fieldNames.includes('language')) {
					console.log(`[LanceDbIndex] 表 ${tableName} 缺少 language 字段，删除旧表重建...`);
					await this.connection.dropTable(tableName);
					table = await createNewTable();
				}
			} catch (err) {
				console.warn('[LanceDbIndex] 检查表 schema 失败，尝试重建表:', err);
				await this.connection.dropTable(tableName);
				table = await createNewTable();
			}
		} else {
			table = await createNewTable();
		}

		// 1. 处理删除
		reportProgress('正在删除旧文件...');
		for (const item of results.del) {
			this.checkCancellation(token);
			await this.deleteFromIndex(table, item.path);
			await this.cache.deleteCache(item.path, item.cacheKey);
			processedItems++;
		}

		// 2. 处理未变更的文件（复用缓存，缓存没有则重新计算）
		reportProgress('正在恢复缓存向量...');
		const needsRecompute: FileChangeItem[] = [];
		for (const item of results.addTag) {
			this.checkCancellation(token);
			const cachedRows = await this.cache.getCachedVectors(item.cacheKey, this.embeddingsProvider.embeddingId);
			if (cachedRows.length > 0) {
				await table.add(cachedRows);
			} else {
				// 缓存没有向量，需要重新计算
				needsRecompute.push(item);
			}
			processedItems++;
		}

		// 3. 处理需要计算的文件（批量处理）
		// 包括原本需要计算的 + 缓存缺失需要重新计算的
		const batchSize = 100;
		const computeItems = [...results.compute, ...needsRecompute];
		if (needsRecompute.length > 0) {
			console.log(`[LanceDbIndex] ${needsRecompute.length} files need recompute (cache miss)`);
		}

		let failedBatches = 0;
		for (let i = 0; i < computeItems.length; i += batchSize) {
			// 每批次开始前检查取消
			this.checkCancellation(token);

			const batch = computeItems.slice(i, i + batchSize);
			const batchNum = Math.floor(i / batchSize) + 1;
			const totalBatches = Math.ceil(computeItems.length / batchSize);
			console.log(`[LanceDbIndex] Processing batch ${batchNum}/${totalBatches}, ${batch.length} files`);
			reportProgress(`正在索引文件 (${i + 1}-${Math.min(i + batchSize, computeItems.length)}/${computeItems.length})...`);

			try {
				// 收集这批文件的所有代码块
				const allChunks: CodeChunk[] = [];
				for await (const chunk of getChunks(batch)) {
					allChunks.push(chunk);
				}

				if (allChunks.length === 0) {
					processedItems += batch.length;
					continue;
				}

				// 先删除这些文件的旧数据
				for (const item of batch) {
					await this.deleteFromIndex(table, item.path);
				}

				// 分批生成嵌入向量（并发控制）
				const embeddingBatchSize = 32; // 每批 32 个 chunks
				const concurrency = options?.concurrency ?? 3; // 使用配置的并发数，默认 3

				// 准备所有批次
				const batches: { chunkBatch: CodeChunk[]; batchIndex: number }[] = [];
				for (let j = 0; j < allChunks.length; j += embeddingBatchSize) {
					batches.push({
						chunkBatch: allChunks.slice(j, j + embeddingBatchSize),
						batchIndex: Math.floor(j / embeddingBatchSize),
					});
				}

				// 并发处理批次
				const processBatch = async (batchInfo: { chunkBatch: CodeChunk[]; batchIndex: number }) => {
					this.checkCancellation(token);
					const { chunkBatch, batchIndex } = batchInfo;
					const contents = chunkBatch.map(chunk => chunk.content);

					console.log(`[LanceDbIndex] Embedding batch ${batchIndex + 1}/${batches.length}, ${contents.length} chunks`);
					const vectors = await this.embeddingsProvider.embed(contents);
					console.log(`[LanceDbIndex] Embedding done, ${vectors.length} vectors`);

					// 构建索引行
					const rows: VectorIndexRow[] = chunkBatch.map((chunk, index) => ({
						uuid: generateUuid(),
						path: chunk.filepath,
						cacheKey: chunk.digest,
						vector: vectors[index],
						startLine: chunk.startLine,
						endLine: chunk.endLine,
						contents: chunk.content,
						language: chunk.language,
					}));

					return rows;
				};

				// 使用滑动窗口并发处理
				for (let j = 0; j < batches.length; j += concurrency) {
					this.checkCancellation(token);
					const concurrentBatches = batches.slice(j, j + concurrency);
					const results = await Promise.all(concurrentBatches.map(processBatch));

					// 按顺序写入 LanceDB 和缓存
					for (const rows of results) {
						if (rows.length > 0) {
							await table.add(rows);
							await this.cache.saveVectors(rows);
						}
					}
				}
			} catch (error) {
				// 单个批次失败不中断整个索引，继续处理下一批
				failedBatches++;
				console.error(`[LanceDbIndex] Batch ${batchNum}/${totalBatches} failed, continuing:`, error);
			}

			processedItems += batch.length;
		}

		if (failedBatches > 0) {
			console.warn(`[LanceDbIndex] Indexing completed with ${failedBatches} failed batches`);
		}

		// 确保最后进度为 1
		onProgress?.({ progress: 1, description: '索引完成' });
	}

	/**
	 * 从索引中删除文件
	 */
	private async deleteFromIndex(table: LanceTable, filePath: string): Promise<void> {
		try {
			// LanceDB 使用 SQL-like 的过滤语法
			await table.delete(`path = '${filePath.replace(/'/g, "''")}'`);
		} catch (error) {
			console.warn(`[LanceDbIndex] Failed to delete ${filePath}:`, error);
		}
	}

	/**
	 * 检索相似代码
	 */
	async retrieve(query: string, topK: number, tags: IndexTag[]): Promise<RetrievalResult[]> {
		await this.initialize();

		if (!this.connection) {
			throw new Error('LanceDB not initialized');
		}

		// 生成查询向量
		const queryVectors = await this.embeddingsProvider.embed([query]);
		const queryVector = queryVectors[0];

		const allResults: RetrievalResult[] = [];

		// 在所有相关表中搜索
		for (const tag of tags) {
			const tableName = getTableName(tag);
			const existingTables = await this.connection.tableNames();

			if (!existingTables.includes(tableName)) {
				continue;
			}

			try {
				const table = await this.connection.openTable(tableName);
				const results = await table
					.search(queryVector)
					.limit(topK)
					.toArray();

				for (const rawRow of results) {
					const row = rawRow as LanceSearchResult;
					allResults.push({
						filepath: row.path,
						content: row.contents,
						startLine: row.startLine,
						endLine: row.endLine,
						score: row._distance,
						language: row.language,
					});
				}
			} catch (error) {
				console.warn(`[LanceDbIndex] Failed to search in ${tableName}:`, error);
			}
		}

		// 按相似度排序并截取
		allResults.sort((a, b) => a.score - b.score);
		return allResults.slice(0, topK);
	}

	/**
	 * 删除索引
	 */
	async deleteIndex(tag: IndexTag): Promise<void> {
		await this.initialize();

		if (!this.connection) {
			throw new Error('LanceDB not initialized');
		}

		const tableName = getTableName(tag);
		const existingTables = await this.connection.tableNames();

		if (existingTables.includes(tableName)) {
			await this.connection.dropTable(tableName);
			console.log(`[LanceDbIndex] Deleted table: ${tableName}`);
		}
	}

	/**
	 * 检查索引是否存在
	 */
	async hasIndex(tag: IndexTag): Promise<boolean> {
		await this.initialize();

		if (!this.connection) {
			return false;
		}

		const tableName = getTableName(tag);
		const existingTables = await this.connection.tableNames();
		return existingTables.includes(tableName);
	}

	/**
	 * 获取索引统计信息（基础）
	 */
	async getIndexStats(tag: IndexTag): Promise<{ rowCount: number } | null> {
		await this.initialize();

		if (!this.connection) {
			return null;
		}

		const tableName = getTableName(tag);
		const existingTables = await this.connection.tableNames();

		if (!existingTables.includes(tableName)) {
			return null;
		}

		try {
			const table = await this.connection.openTable(tableName);
			const rowCount = await table.countRows();
			return { rowCount };
		} catch (error) {
			console.warn(`[LanceDbIndex] Failed to get stats for ${tableName}:`, error);
			return null;
		}
	}

	/**
	 * 获取索引详细统计
	 */
	async getDetailedStats(tag: IndexTag): Promise<{
		totalChunks: number;
		uniqueFiles: number;
		languageDistribution: Record<string, number>;
	} | null> {
		await this.initialize();

		if (!this.connection) {
			return null;
		}

		const tableName = getTableName(tag);
		const existingTables = await this.connection.tableNames();

		if (!existingTables.includes(tableName)) {
			return null;
		}

		try {
			const table = await this.connection.openTable(tableName);

			// 只查询 path 字段，兼容旧表（可能没有 language 字段）
			const results = await table
				.query()
				.select(['path'])
				.toArray();

			const totalChunks = results.length;
			const uniqueFiles = new Set(results.map((r: { path: string }) => r.path)).size;

			// 尝试获取语言分布（新表有 language 字段）
			const languageDistribution: Record<string, number> = {};
			try {
				const langResults = await table
					.query()
					.select(['language'])
					.toArray();
				for (const row of langResults) {
					const lang = (row as { language?: string }).language || 'unknown';
					languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
				}
			} catch {
				// 旧表没有 language 字段，忽略
				languageDistribution['unknown'] = totalChunks;
			}

			return {
				totalChunks,
				uniqueFiles,
				languageDistribution,
			};
		} catch (error) {
			console.warn(`[LanceDbIndex] Failed to get detailed stats for ${tableName}:`, error);
			return null;
		}
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		this.connection = null;
		this.initPromise = null;
	}
}

/**
 * 创建 LanceDB 索引
 */
export function createLanceDbIndex(
	embeddingsProvider: IEmbeddingsProvider,
	cache: IIndexCache,
): IVectorIndex {
	return new LanceDbIndex(embeddingsProvider, cache);
}
