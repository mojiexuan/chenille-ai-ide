/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEmbeddingsProvider } from '../../../common/indexing/types.js';

/**
 * 模型下载进度回调
 */
export interface ModelDownloadProgress {
	status: 'initiate' | 'download' | 'progress' | 'done';
	name?: string;
	file?: string;
	progress?: number; // 0-100
	loaded?: number;
	total?: number;
}

export type ModelDownloadProgressCallback = (progress: ModelDownloadProgress) => void;

/**
 * 本地嵌入模型提供者（基于 Transformers.js）
 * 使用 ONNX Runtime 在本地运行嵌入模型，无需网络请求
 */
export class LocalEmbeddingsProvider implements IEmbeddingsProvider {
	readonly embeddingId: string;
	readonly maxChunkSize: number;
	readonly dimensions: number;

	private pipeline: unknown | null = null;
	private initPromise: Promise<void> | null = null;
	private progressCallback?: ModelDownloadProgressCallback;

	/**
	 * @param modelName 模型名称，如 'Xenova/all-MiniLM-L6-v2'
	 * @param progressCallback 模型下载进度回调
	 */
	constructor(
		private readonly modelName: string = 'Xenova/all-MiniLM-L6-v2',
		progressCallback?: ModelDownloadProgressCallback,
	) {
		this.embeddingId = modelName;
		// all-MiniLM-L6-v2 的配置
		this.maxChunkSize = 512;
		this.dimensions = 384;
		this.progressCallback = progressCallback;
	}

	/**
	 * 设置下载进度回调
	 */
	setProgressCallback(callback: ModelDownloadProgressCallback): void {
		this.progressCallback = callback;
	}

	/**
	 * 初始化模型
	 */
	private async initialize(): Promise<void> {
		if (this.pipeline) {
			return;
		}

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this.loadModel();
		await this.initPromise;
	}

	private async loadModel(): Promise<void> {
		try {
			// 动态导入 @xenova/transformers
			const { pipeline } = await import('@xenova/transformers');

			this.pipeline = await pipeline('feature-extraction', this.modelName, {
				quantized: true, // 使用量化版本，更小更快
				progress_callback: (progress: ModelDownloadProgress) => {
					// 调用外部回调
					if (this.progressCallback) {
						this.progressCallback(progress);
					}
				},
			});
		} catch (error) {
			console.error('[LocalEmbeddings] Failed to load model:', error);
			throw new Error(`Failed to load embedding model: ${error}`);
		}
	}

	/**
	 * 生成文本嵌入向量
	 */
	async embed(texts: string[]): Promise<number[][]> {
		await this.initialize();

		if (!this.pipeline) {
			throw new Error('Embedding model not initialized');
		}

		const results: number[][] = [];

		// 批量处理以避免内存问题
		const batchSize = 32;
		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			const batchResults = await this.embedBatch(batch);
			results.push(...batchResults);
		}

		return results;
	}

	private async embedBatch(texts: string[]): Promise<number[][]> {
		const pipelineFn = this.pipeline as (
			text: string | string[],
			options: { pooling: string; normalize: boolean }
		) => Promise<{ data: Float32Array; dims: number[] }>;

		const results: number[][] = [];

		for (const text of texts) {
			const output = await pipelineFn(text, {
				pooling: 'mean',
				normalize: true,
			});

			// 转换为普通数组
			results.push(Array.from(output.data));
		}

		return results;
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		this.pipeline = null;
		this.initPromise = null;
	}
}

/**
 * Jina Code 嵌入模型提供者（代码专用）
 * 提供更好的代码语义理解能力
 */
export class JinaCodeEmbeddingsProvider implements IEmbeddingsProvider {
	readonly embeddingId = 'jinaai/jina-embeddings-v2-base-code';
	readonly maxChunkSize = 8192; // 支持长上下文
	readonly dimensions = 768;

	private pipeline: unknown | null = null;
	private initPromise: Promise<void> | null = null;

	private async initialize(): Promise<void> {
		if (this.pipeline) {
			return;
		}

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this.loadModel();
		await this.initPromise;
	}

	private async loadModel(): Promise<void> {
		try {
			const { pipeline } = await import('@xenova/transformers');

			console.log('[JinaCodeEmbeddings] Loading model...');
			const startTime = Date.now();

			this.pipeline = await pipeline(
				'feature-extraction',
				'jinaai/jina-embeddings-v2-base-code',
				{ quantized: true },
			);

			const loadTime = Date.now() - startTime;
			console.log(`[JinaCodeEmbeddings] Model loaded in ${loadTime}ms`);
		} catch (error) {
			console.error('[JinaCodeEmbeddings] Failed to load model:', error);
			throw new Error(`Failed to load Jina code embedding model: ${error}`);
		}
	}

	async embed(texts: string[]): Promise<number[][]> {
		await this.initialize();

		if (!this.pipeline) {
			throw new Error('Jina code embedding model not initialized');
		}

		const pipelineFn = this.pipeline as (
			text: string,
			options: { pooling: string; normalize: boolean }
		) => Promise<{ data: Float32Array }>;

		const results: number[][] = [];

		for (const text of texts) {
			const output = await pipelineFn(text, {
				pooling: 'mean',
				normalize: true,
			});
			results.push(Array.from(output.data));
		}

		return results;
	}

	dispose(): void {
		this.pipeline = null;
		this.initPromise = null;
	}
}

/**
 * 创建嵌入模型提供者
 */
export function createEmbeddingsProvider(
	type: 'local' | 'jina-code' = 'local',
	modelName?: string,
): IEmbeddingsProvider {
	switch (type) {
		case 'jina-code':
			return new JinaCodeEmbeddingsProvider();
		case 'local':
		default:
			return new LocalEmbeddingsProvider(modelName);
	}
}
