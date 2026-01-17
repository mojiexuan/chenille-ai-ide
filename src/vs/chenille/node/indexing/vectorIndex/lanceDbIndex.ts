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
				});
			}
		};

		// 获取或创建表
		let table: LanceTable;
		const existingTables = await this.connection.tableNames();

		if (existingTables.includes(tableName)) {
			table = await this.connection.openTable(tableName);
		} else {
			// 创建空表（需要至少一条数据）
			const dummyRow: VectorIndexRow = {
				uuid: 'placeholder',
				path: '',
				cacheKey: '',
				vector: new Array(this.embeddingsProvider.dimensions).fill(0),
				startLine: 0,
				endLine: 0,
				contents: '',
			};
			table = await this.connection.createTable(tableName, [dummyRow]);
			// 删除占位数据
			await table.delete("uuid = 'placeholder'");
		}

		// 1. 处理删除
		reportProgress('正在删除旧文件...');
		for (const item of results.del) {
			this.checkCancellation(token);
			await this.deleteFromIndex(table, item.path);
			await this.cache.deleteCache(item.path, item.cacheKey);
			processedItems++;
		}

		// 2. 处理未变更的文件（复用缓存）
		reportProgress('正在恢复缓存向量...');
		for (const item of results.addTag) {
			this.checkCancellation(token);
			const cachedRows = await this.cache.getCachedVectors(item.cacheKey, this.embeddingsProvider.embeddingId);
			if (cachedRows.length > 0) {
				await table.add(cachedRows);
			}
			processedItems++;
		}

		// 3. 处理需要计算的文件（批量处理）
		const batchSize = 100;
		const computeItems = results.compute;

		for (let i = 0; i < computeItems.length; i += batchSize) {
			// 每批次开始前检查取消
			this.checkCancellation(token);

			const batch = computeItems.slice(i, i + batchSize);
			reportProgress(`正在索引文件 (${i + 1}-${Math.min(i + batchSize, computeItems.length)}/${computeItems.length})...`);

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

			// 分批生成嵌入向量（控制内存使用）
			const embeddingBatchSize = 32; // 每批 32 个 chunks
			const allRows: VectorIndexRow[] = [];

			for (let j = 0; j < allChunks.length; j += embeddingBatchSize) {
				// 检查取消
				this.checkCancellation(token);

				const chunkBatch = allChunks.slice(j, j + embeddingBatchSize);
				const contents = chunkBatch.map(chunk => chunk.content);

				// 生成这批 chunks 的嵌入向量
				const vectors = await this.embeddingsProvider.embed(contents);

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

				allRows.push(...rows);

				// 每批写入后尝试释放内存
				// @ts-ignore - 帮助 GC
				vectors.length = 0;
			}

			// 写入新数据
			if (allRows.length > 0) {
				await table.add(allRows);
				await this.cache.saveVectors(allRows);
			}

			processedItems += batch.length;
		}

		reportProgress('索引完成', undefined);
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

			// 获取所有行的 path 和 language 字段
			const results = await table
				.query()
				.select(['path', 'language'])
				.toArray();

			const totalChunks = results.length;
			const uniqueFiles = new Set(results.map((r: { path: string }) => r.path)).size;

			// 统计语言分布
			const languageDistribution: Record<string, number> = {};
			for (const row of results) {
				const lang = (row as { language?: string }).language || 'unknown';
				languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
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
