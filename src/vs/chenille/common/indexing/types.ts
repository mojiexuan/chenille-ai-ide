/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 代码块（Chunk）- 索引的基本单位
 */
export interface CodeChunk {
	/** 文件路径（相对于工作区） */
	filepath: string;
	/** 代码内容 */
	content: string;
	/** 起始行号（1-based） */
	startLine: number;
	/** 结束行号（1-based） */
	endLine: number;
	/** 内容摘要（用于增量更新判断） */
	digest: string;
	/** 语言标识 */
	language?: string;
}

/**
 * 向量索引行 - LanceDB 存储结构
 */
export interface VectorIndexRow {
	/** 唯一标识符 */
	uuid: string;
	/** 文件路径 */
	path: string;
	/** 缓存键（文件内容哈希，用于增量更新） */
	cacheKey: string;
	/** 嵌入向量 */
	vector: number[];
	/** 代码块起始行 */
	startLine: number;
	/** 代码块结束行 */
	endLine: number;
	/** 代码块内容 */
	contents: string;
	/** 语言标识 */
	language?: string;
}

/**
 * 索引标签 - 区分不同工作区/分支
 */
export interface IndexTag {
	/** 工作区路径 */
	directory: string;
	/** Git 分支（可选） */
	branch?: string;
	/** 嵌入模型 ID */
	artifactId: string;
}

/**
 * 增量更新结果类型
 */
export enum IndexResultType {
	/** 需要计算向量（新增/修改） */
	Compute = 'compute',
	/** 需要删除 */
	Delete = 'delete',
	/** 只需添加标签（未变更，复用缓存） */
	AddTag = 'addTag',
}

/**
 * 文件变更项
 */
export interface FileChangeItem {
	/** 文件路径 */
	path: string;
	/** 缓存键（文件内容哈希） */
	cacheKey: string;
}

/**
 * 增量更新计算结果
 */
export interface RefreshIndexResults {
	/** 需要计算向量的文件 */
	compute: FileChangeItem[];
	/** 需要删除的文件 */
	del: FileChangeItem[];
	/** 只需添加标签的文件（复用缓存） */
	addTag: FileChangeItem[];
}

/**
 * 索引进度事件
 */
export interface IndexProgressEvent {
	/** 进度百分比 (0-1) */
	progress: number;
	/** 描述信息 */
	description: string;
	/** 当前处理的文件 */
	currentFile?: string;
}

/**
 * 检索结果
 */
export interface RetrievalResult {
	/** 文件路径 */
	filepath: string;
	/** 代码内容 */
	content: string;
	/** 起始行号 */
	startLine: number;
	/** 结束行号 */
	endLine: number;
	/** 相似度分数（距离，越小越相似） */
	score: number;
	/** 语言标识 */
	language?: string;
}

/**
 * 嵌入模型提供者接口
 */
export interface IEmbeddingsProvider {
	/** 模型唯一标识（用于缓存键） */
	readonly embeddingId: string;
	/** 最大 chunk 大小（tokens） */
	readonly maxChunkSize: number;
	/** 向量维度 */
	readonly dimensions: number;

	/**
	 * 生成文本嵌入向量
	 * @param texts 文本数组
	 * @returns 向量数组
	 */
	embed(texts: string[]): Promise<number[][]>;
}

/**
 * 取消令牌接口（简化版，避免循环依赖）
 */
export interface ICancellationToken {
	/** 是否已请求取消 */
	readonly isCancellationRequested: boolean;
}

/**
 * 向量索引接口
 */
export interface IVectorIndex {
	/**
	 * 更新索引
	 * @param tag 索引标签
	 * @param results 增量更新结果
	 * @param getChunks 获取代码块的函数
	 * @param onProgress 进度回调
	 * @param token 取消令牌
	 */
	update(
		tag: IndexTag,
		results: RefreshIndexResults,
		getChunks: (items: FileChangeItem[]) => AsyncGenerator<CodeChunk>,
		onProgress?: (event: IndexProgressEvent) => void,
		token?: ICancellationToken,
	): Promise<void>;

	/**
	 * 检索相似代码
	 * @param query 查询文本
	 * @param topK 返回数量
	 * @param tags 索引标签
	 */
	retrieve(query: string, topK: number, tags: IndexTag[]): Promise<RetrievalResult[]>;

	/**
	 * 删除索引
	 * @param tag 索引标签
	 */
	deleteIndex(tag: IndexTag): Promise<void>;

	/**
	 * 检查索引是否存在
	 * @param tag 索引标签
	 */
	hasIndex(tag: IndexTag): Promise<boolean>;

	/**
	 * 获取索引统计信息
	 * @param tag 索引标签
	 */
	getIndexStats(tag: IndexTag): Promise<{ rowCount: number } | null>;

	/**
	 * 获取索引详细统计
	 * @param tag 索引标签
	 */
	getDetailedStats?(tag: IndexTag): Promise<{
		totalChunks: number;
		uniqueFiles: number;
		languageDistribution: Record<string, number>;
	} | null>;
}

/**
 * 代码切分器接口
 */
export interface ICodeChunker {
	/**
	 * 将代码切分为多个块
	 * @param filepath 文件路径
	 * @param content 文件内容
	 * @param maxChunkSize 最大块大小（tokens）
	 */
	chunk(filepath: string, content: string, maxChunkSize: number): AsyncGenerator<CodeChunk>;
}

/**
 * 索引缓存接口
 */
export interface IIndexCache {
	/**
	 * 获取缓存的向量
	 * @param cacheKey 缓存键（文件哈希）
	 * @param artifactId 模型标识
	 */
	getCachedVectors(cacheKey: string, artifactId: string): Promise<VectorIndexRow[]>;

	/**
	 * 保存向量到缓存
	 * @param rows 向量行
	 */
	saveVectors(rows: VectorIndexRow[]): Promise<void>;

	/**
	 * 删除缓存
	 * @param path 文件路径
	 * @param cacheKey 缓存键
	 */
	deleteCache(path: string, cacheKey: string): Promise<void>;

	/**
	 * 清空所有缓存
	 */
	clear(): Promise<void>;
}

/**
 * 代码库索引器接口
 */
export interface ICodebaseIndexer {
	/**
	 * 索引工作区
	 * @param workspacePath 工作区路径
	 * @param onProgress 进度回调
	 * @param token 取消令牌
	 */
	indexWorkspace(
		workspacePath: string,
		onProgress?: (event: IndexProgressEvent) => void,
		token?: ICancellationToken,
	): Promise<void>;

	/**
	 * 检索相似代码
	 * @param query 查询文本
	 * @param workspacePath 工作区路径
	 * @param topK 返回数量
	 */
	retrieve(query: string, workspacePath: string, topK?: number): Promise<RetrievalResult[]>;

	/**
	 * 处理文件变更
	 * @param workspacePath 工作区路径
	 * @param changedFiles 变更的文件路径列表
	 */
	onFilesChanged(workspacePath: string, changedFiles: string[]): Promise<void>;

	/**
	 * 删除工作区索引
	 * @param workspacePath 工作区路径
	 */
	deleteWorkspaceIndex(workspacePath: string): Promise<void>;
}

/**
 * 索引配置
 */
export interface IndexingConfig {
	/** 嵌入模型 */
	embeddingsProvider: 'local' | 'openai' | 'voyage';
	/** 本地模型名称 */
	localModelName?: string;
	/** 最大 chunk 大小（tokens） */
	maxChunkSize?: number;
	/** 批处理大小（文件数） */
	batchSize?: number;
	/** 排除的文件模式 */
	excludePatterns?: string[];
	/** 包含的文件扩展名 */
	includeExtensions?: string[];
	/** 最大文件大小（字节），超过则跳过 */
	maxFileSize?: number;
	/** 嵌入批次大小（控制内存使用） */
	embeddingBatchSize?: number;
}

/**
 * 默认索引配置
 */
export const DEFAULT_INDEXING_CONFIG: IndexingConfig = {
	embeddingsProvider: 'local',
	localModelName: 'Xenova/all-MiniLM-L6-v2',
	maxChunkSize: 512,
	batchSize: 100,
	maxFileSize: 1024 * 1024,      // 1MB - 超过则跳过
	embeddingBatchSize: 32,        // 每批嵌入 32 个 chunks，控制内存
	excludePatterns: [
		'**/node_modules/**',
		'**/.git/**',
		'**/dist/**',
		'**/build/**',
		'**/*.min.js',
		'**/*.map',
		'**/package-lock.json',
		'**/yarn.lock',
		'**/pnpm-lock.yaml',
	],
	includeExtensions: [
		'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
		'.py', '.pyw',
		'.java', '.kt', '.kts',
		'.go',
		'.rs',
		'.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
		'.cs',
		'.rb',
		'.php',
		'.swift',
		'.scala',
		'.vue', '.svelte',
		'.md', '.mdx',
		'.json', '.yaml', '.yml', '.toml',
		'.sql',
		'.sh', '.bash', '.zsh',
		'.css', '.scss', '.less',
		'.html', '.htm',
	],
};

/**
 * 支持的语言到 Tree-sitter 语法的映射
 */
export const LANGUAGE_TO_GRAMMAR: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'tsx',
	'.js': 'javascript',
	'.jsx': 'javascript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.py': 'python',
	'.pyw': 'python',
	'.java': 'java',
	'.go': 'go',
	'.rs': 'rust',
	'.c': 'c',
	'.cpp': 'cpp',
	'.cc': 'cpp',
	'.cxx': 'cpp',
	'.h': 'c',
	'.hpp': 'cpp',
	'.cs': 'c_sharp',
	'.rb': 'ruby',
	'.php': 'php',
	'.swift': 'swift',
	'.kt': 'kotlin',
	'.kts': 'kotlin',
	'.scala': 'scala',
	'.md': 'markdown',
	'.mdx': 'markdown',
	'.json': 'json',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.html': 'html',
	'.htm': 'html',
	'.css': 'css',
	'.scss': 'scss',
	'.sql': 'sql',
	'.sh': 'bash',
	'.bash': 'bash',
	'.zsh': 'bash',
};

/**
 * 生成文件内容的哈希值（用作 cacheKey）
 * 使用 SHA-256 确保唯一性
 */
export function generateContentHash(content: string): string {
	// 使用简单但有效的哈希算法（cyrb53）
	// 比 Java hashCode 更好，碰撞概率更低
	// 生产环境可以切换到 crypto.createHash('sha256')
	const seed = 0;
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < content.length; i++) {
		const ch = content.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	// 返回 53-bit 哈希的十六进制表示
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * 生成 UUID
 */
export function generateUuid(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
		const random = Math.random() * 16 | 0;
		const value = char === 'x' ? random : (random & 0x3 | 0x8);
		return value.toString(16);
	});
}
