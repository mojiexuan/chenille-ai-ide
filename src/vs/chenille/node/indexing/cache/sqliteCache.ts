/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from '../../../../base/common/path.js';
import * as os from 'os';
import type { IIndexCache, VectorIndexRow } from '../../../common/indexing/types.js';

/**
 * SQLite 数据库接口
 */
interface SqliteDatabase {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	close(): void;
}

/**
 * SQLite 语句接口
 */
interface SqliteStatement {
	run(...params: unknown[]): void;
	get(...params: unknown[]): unknown;
	all(...params: unknown[]): unknown[];
	finalize(): void;
}

/**
 * 获取缓存数据库路径
 */
function getCacheDbPath(): string {
	const homeDir = os.homedir();
	return path.join(homeDir, '.chenille-ai', 'index-cache.db');
}

/**
 * SQLite 向量缓存实现
 * 存储已计算的向量，避免重复计算
 */
export class SqliteIndexCache implements IIndexCache {
	private database: SqliteDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	constructor(
		private readonly artifactId: string,
	) { }

	/**
	 * 初始化数据库
	 */
	private async initialize(): Promise<void> {
		if (this.database) {
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
			// 使用 VS Code 内置的 SQLite
			const sqlite = await import('@vscode/sqlite3');
			const dbPath = getCacheDbPath();

			// 确保目录存在
			const fs = await import('fs');
			const dir = path.dirname(dbPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			console.log(`[SqliteCache] Opening database: ${dbPath}`);

			this.database = await new Promise<SqliteDatabase>((resolve, reject) => {
				const db = new sqlite.Database(dbPath, (err: Error | null) => {
					if (err) {
						reject(err);
					} else {
						resolve(db as unknown as SqliteDatabase);
					}
				});
			});

			// 创建表
			await this.createTables();

			console.log('[SqliteCache] Database initialized');
		} catch (error) {
			console.error('[SqliteCache] Failed to initialize:', error);
			throw new Error(`Failed to initialize SQLite cache: ${error}`);
		}
	}

	/**
	 * 创建数据表
	 */
	private async createTables(): Promise<void> {
		if (!this.database) {
			return;
		}

		const createTableSql = `
			CREATE TABLE IF NOT EXISTS vector_cache (
				uuid TEXT PRIMARY KEY,
				cache_key TEXT NOT NULL,
				path TEXT NOT NULL,
				artifact_id TEXT NOT NULL,
				vector TEXT NOT NULL,
				start_line INTEGER NOT NULL,
				end_line INTEGER NOT NULL,
				contents TEXT NOT NULL,
				language TEXT,
				created_at INTEGER DEFAULT (strftime('%s', 'now'))
			);

			CREATE INDEX IF NOT EXISTS idx_cache_key_artifact
				ON vector_cache(cache_key, artifact_id);

			CREATE INDEX IF NOT EXISTS idx_path
				ON vector_cache(path);
		`;

		await this.execAsync(createTableSql);
	}

	/**
	 * 异步执行 SQL
	 */
	private async execAsync(sql: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.database) {
				reject(new Error('Database not initialized'));
				return;
			}

			this.database.exec(sql);
			resolve();
		});
	}

	/**
	 * 获取缓存的向量
	 */
	async getCachedVectors(cacheKey: string, artifactId: string): Promise<VectorIndexRow[]> {
		await this.initialize();

		if (!this.database) {
			return [];
		}

		try {
			const sql = `
				SELECT uuid, cache_key, path, vector, start_line, end_line, contents, language
				FROM vector_cache
				WHERE cache_key = ? AND artifact_id = ?
			`;

			const stmt = this.database.prepare(sql);
			const rows = stmt.all(cacheKey, artifactId) as Array<{
				uuid: string;
				cache_key: string;
				path: string;
				vector: string;
				start_line: number;
				end_line: number;
				contents: string;
				language: string | null;
			}>;
			stmt.finalize();

			return rows.map(row => ({
				uuid: row.uuid,
				cacheKey: row.cache_key,
				path: row.path,
				vector: JSON.parse(row.vector),
				startLine: row.start_line,
				endLine: row.end_line,
				contents: row.contents,
				language: row.language || undefined,
			}));
		} catch (error) {
			console.warn('[SqliteCache] Failed to get cached vectors:', error);
			return [];
		}
	}

	/**
	 * 保存向量到缓存
	 */
	async saveVectors(rows: VectorIndexRow[]): Promise<void> {
		await this.initialize();

		if (!this.database || rows.length === 0) {
			return;
		}

		try {
			const sql = `
				INSERT OR REPLACE INTO vector_cache
				(uuid, cache_key, path, artifact_id, vector, start_line, end_line, contents, language)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`;

			const stmt = this.database.prepare(sql);

			for (const row of rows) {
				stmt.run(
					row.uuid,
					row.cacheKey,
					row.path,
					this.artifactId,
					JSON.stringify(row.vector),
					row.startLine,
					row.endLine,
					row.contents,
					row.language || null,
				);
			}

			stmt.finalize();
		} catch (error) {
			console.warn('[SqliteCache] Failed to save vectors:', error);
		}
	}

	/**
	 * 删除缓存
	 */
	async deleteCache(filePath: string, cacheKey: string): Promise<void> {
		await this.initialize();

		if (!this.database) {
			return;
		}

		try {
			const sql = `DELETE FROM vector_cache WHERE path = ? AND cache_key = ?`;
			const stmt = this.database.prepare(sql);
			stmt.run(filePath, cacheKey);
			stmt.finalize();
		} catch (error) {
			console.warn('[SqliteCache] Failed to delete cache:', error);
		}
	}

	/**
	 * 删除指定路径的所有缓存
	 */
	async deleteCacheByPath(filePath: string): Promise<void> {
		await this.initialize();

		if (!this.database) {
			return;
		}

		try {
			const sql = `DELETE FROM vector_cache WHERE path = ?`;
			const stmt = this.database.prepare(sql);
			stmt.run(filePath);
			stmt.finalize();
		} catch (error) {
			console.warn('[SqliteCache] Failed to delete cache by path:', error);
		}
	}

	/**
	 * 清空所有缓存
	 */
	async clear(): Promise<void> {
		await this.initialize();

		if (!this.database) {
			return;
		}

		try {
			await this.execAsync('DELETE FROM vector_cache');
			console.log('[SqliteCache] Cache cleared');
		} catch (error) {
			console.warn('[SqliteCache] Failed to clear cache:', error);
		}
	}

	/**
	 * 获取缓存统计
	 */
	async getStats(): Promise<{ totalRows: number; totalSize: number }> {
		await this.initialize();

		if (!this.database) {
			return { totalRows: 0, totalSize: 0 };
		}

		try {
			const countSql = 'SELECT COUNT(*) as count FROM vector_cache';
			const countStmt = this.database.prepare(countSql);
			const countResult = countStmt.get() as { count: number };
			countStmt.finalize();

			const sizeSql = 'SELECT SUM(LENGTH(vector) + LENGTH(contents)) as size FROM vector_cache';
			const sizeStmt = this.database.prepare(sizeSql);
			const sizeResult = sizeStmt.get() as { size: number | null };
			sizeStmt.finalize();

			return {
				totalRows: countResult.count,
				totalSize: sizeResult.size || 0,
			};
		} catch (error) {
			console.warn('[SqliteCache] Failed to get stats:', error);
			return { totalRows: 0, totalSize: 0 };
		}
	}

	/**
	 * 清理过期缓存（超过 30 天未使用）
	 */
	async cleanupExpired(maxAgeDays: number = 30): Promise<number> {
		await this.initialize();

		if (!this.database) {
			return 0;
		}

		try {
			const maxAgeSeconds = maxAgeDays * 24 * 60 * 60;
			const sql = `
				DELETE FROM vector_cache
				WHERE created_at < (strftime('%s', 'now') - ?)
			`;

			const stmt = this.database.prepare(sql);
			stmt.run(maxAgeSeconds);
			stmt.finalize();

			// 获取删除的行数（SQLite 的 changes() 函数）
			const changesSql = 'SELECT changes() as deleted';
			const changesStmt = this.database.prepare(changesSql);
			const result = changesStmt.get() as { deleted: number };
			changesStmt.finalize();

			if (result.deleted > 0) {
				console.log(`[SqliteCache] Cleaned up ${result.deleted} expired entries`);
			}

			return result.deleted;
		} catch (error) {
			console.warn('[SqliteCache] Failed to cleanup expired:', error);
			return 0;
		}
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		if (this.database) {
			this.database.close();
			this.database = null;
		}
		this.initPromise = null;
	}
}

/**
 * 创建 SQLite 缓存
 */
export function createIndexCache(artifactId: string): IIndexCache {
	return new SqliteIndexCache(artifactId);
}
