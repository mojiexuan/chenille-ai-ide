/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEmbeddingsProvider } from '../../../common/indexing/types.js';
import type { AiModel } from '../../../common/types.js';

/**
 * OpenAI 兼容的嵌入 API 响应
 */
interface EmbeddingResponse {
	object: 'list';
	data: Array<{
		object: 'embedding';
		embedding: number[];
		index: number;
	}>;
	model: string;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

/**
 * API 嵌入模型提供者
 * 使用 OpenAI 兼容的 /v1/embeddings 端点
 */
export class ApiEmbeddingsProvider implements IEmbeddingsProvider {
	readonly embeddingId: string;
	readonly maxChunkSize: number;
	private _dimensions: number;

	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly modelId: string;

	/**
	 * @param model AI 模型配置
	 * @param embeddingModel 嵌入模型 ID（如 text-embedding-3-small），默认使用配置的模型
	 */
	constructor(
		model: AiModel,
		embeddingModel?: string,
	) {
		this.baseUrl = model.baseUrl.replace(/\/+$/, '');
		this.apiKey = model.apiKey;
		this.modelId = embeddingModel || model.model;
		this.embeddingId = `api:${model.name}:${this.modelId}`;

		// 根据模型设置默认配置
		this.maxChunkSize = 8192;
		this._dimensions = this.getDefaultDimensions(this.modelId);
	}

	get dimensions(): number {
		return this._dimensions;
	}

	/**
	 * 根据模型名称获取默认向量维度
	 */
	private getDefaultDimensions(modelId: string): number {
		const lower = modelId.toLowerCase();

		// OpenAI 模型
		if (lower.includes('text-embedding-3-large')) {
			return 3072;
		}
		if (lower.includes('text-embedding-3-small')) {
			return 1536;
		}
		if (lower.includes('text-embedding-ada')) {
			return 1536;
		}

		// 其他常见嵌入模型
		if (lower.includes('bge-large')) {
			return 1024;
		}
		if (lower.includes('bge-base') || lower.includes('bge-small')) {
			return 768;
		}

		// 默认维度
		return 1536;
	}

	/** 单个文本最大字符数（约 2000 tokens，留余量给 8192 限制）*/
	private static readonly MAX_TEXT_LENGTH = 8000;
	/** 每批最大总字符数（约 4000 tokens，为 8192 限制留足够余量）*/
	private static readonly MAX_BATCH_CHARS = 16000;

	/**
	 * 将长文本分割成多个小块
	 */
	private splitLongText(text: string): string[] {
		if (text.length <= ApiEmbeddingsProvider.MAX_TEXT_LENGTH) {
			return [text];
		}

		const chunks: string[] = [];
		let start = 0;
		while (start < text.length) {
			chunks.push(text.substring(start, start + ApiEmbeddingsProvider.MAX_TEXT_LENGTH));
			start += ApiEmbeddingsProvider.MAX_TEXT_LENGTH;
		}
		console.log(`[ApiEmbeddings] Split long text (${text.length} chars) into ${chunks.length} chunks`);
		return chunks;
	}

	/**
	 * 生成文本嵌入向量
	 */
	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}

		// 展开长文本为多个小块，记录原始索引映射
		const expandedTexts: { text: string; originalIndex: number; chunkIndex: number; totalChunks: number }[] = [];
		for (let i = 0; i < texts.length; i++) {
			const chunks = this.splitLongText(texts[i]);
			for (let j = 0; j < chunks.length; j++) {
				expandedTexts.push({
					text: chunks[j],
					originalIndex: i,
					chunkIndex: j,
					totalChunks: chunks.length,
				});
			}
		}

		// 对展开后的文本进行批次处理
		const expandedResults: number[][] = [];
		let batchStart = 0;
		while (batchStart < expandedTexts.length) {
			let batchChars = 0;
			let batchEnd = batchStart;

			while (batchEnd < expandedTexts.length) {
				const textLength = expandedTexts[batchEnd].text.length;
				if (batchChars + textLength > ApiEmbeddingsProvider.MAX_BATCH_CHARS && batchEnd > batchStart) {
					break;
				}
				batchChars += textLength;
				batchEnd++;
			}

			const batch = expandedTexts.slice(batchStart, batchEnd).map(e => e.text);
			const batchResults = await this.embedBatch(batch);
			expandedResults.push(...batchResults);
			batchStart = batchEnd;
		}

		// 合并分割文本的向量（取平均值）
		const results: number[][] = new Array(texts.length);
		const chunkVectors: Map<number, number[][]> = new Map();

		for (let i = 0; i < expandedTexts.length; i++) {
			const { originalIndex } = expandedTexts[i];
			if (!chunkVectors.has(originalIndex)) {
				chunkVectors.set(originalIndex, []);
			}
			chunkVectors.get(originalIndex)!.push(expandedResults[i]);
		}

		// 对每个原始文本的向量取平均
		for (let i = 0; i < texts.length; i++) {
			const vectors = chunkVectors.get(i)!;
			if (vectors.length === 1) {
				results[i] = vectors[0];
			} else {
				// 多个块的向量取平均
				const dim = vectors[0].length;
				const avgVector = new Array(dim).fill(0);
				for (const vec of vectors) {
					for (let d = 0; d < dim; d++) {
						avgVector[d] += vec[d];
					}
				}
				for (let d = 0; d < dim; d++) {
					avgVector[d] /= vectors.length;
				}
				results[i] = avgVector;
			}
		}

		return results;
	}

	/** 最大重试次数 */
	private static readonly MAX_RETRIES = 3;
	/** 重试延迟（毫秒） */
	private static readonly RETRY_DELAY = 1000;

	/**
	 * 批量嵌入（带重试机制）
	 */
	private async embedBatch(texts: string[]): Promise<number[][]> {
		// 记录有效文本及其原始索引
		const validEntries: { index: number; text: string }[] = [];
		for (let i = 0; i < texts.length; i++) {
			const text = texts[i];
			if (text && text.trim().length > 0) {
				validEntries.push({ index: i, text });
			}
		}

		// 如果没有有效文本，返回零向量
		if (validEntries.length === 0) {
			return texts.map(() => new Array(this._dimensions).fill(0));
		}

		// 带重试的 API 调用
		for (let attempt = 1; attempt <= ApiEmbeddingsProvider.MAX_RETRIES; attempt++) {
			try {
				return await this.doEmbedBatch(texts, validEntries);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.warn(`[ApiEmbeddings] Attempt ${attempt}/${ApiEmbeddingsProvider.MAX_RETRIES} failed:`, errorMsg);

				if (attempt < ApiEmbeddingsProvider.MAX_RETRIES) {
					// 指数退避
					const delay = ApiEmbeddingsProvider.RETRY_DELAY * Math.pow(2, attempt - 1);
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}

		// 所有重试都失败，返回零向量而不是抛出错误（允许继续处理其他批次）
		console.error(`[ApiEmbeddings] All retries failed, returning zero vectors for ${texts.length} texts`);
		return texts.map(() => new Array(this._dimensions).fill(0));
	}

	/**
	 * 实际执行嵌入请求
	 */
	private async doEmbedBatch(
		texts: string[],
		validEntries: { index: number; text: string }[],
	): Promise<number[][]> {
		// 处理 baseUrl，避免重复 /v1
		let url = this.baseUrl;
		if (url.endsWith('/v1') || url.endsWith('/v1/')) {
			url = url.replace(/\/+$/, '') + '/embeddings';
		} else {
			url = url.replace(/\/+$/, '') + '/v1/embeddings';
		}

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.modelId,
				input: validEntries.map(e => e.text),
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Embedding API error (${response.status}): ${errorText}`);
		}

		const data = await response.json() as EmbeddingResponse;

		// 更新实际维度
		if (data.data.length > 0) {
			this._dimensions = data.data[0].embedding.length;
		}

		// 构建结果数组，空文本位置填充零向量
		const results: number[][] = texts.map(() => new Array(this._dimensions).fill(0));
		const sortedEmbeddings = data.data.sort((a, b) => a.index - b.index);

		for (let i = 0; i < sortedEmbeddings.length; i++) {
			const originalIndex = validEntries[i].index;
			results[originalIndex] = sortedEmbeddings[i].embedding;
		}

		return results;
	}

	/**
	 * 测试 API 连接和模型可用性
	 */
	async test(): Promise<{ success: boolean; error?: string; dimensions?: number }> {
		try {
			const testResult = await this.embed(['test']);
			if (testResult.length > 0 && testResult[0].length > 0) {
				return {
					success: true,
					dimensions: testResult[0].length,
				};
			}
			return {
				success: false,
				error: '嵌入结果为空',
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : '未知错误',
			};
		}
	}
}

/**
 * 创建 API 嵌入模型提供者
 */
export function createApiEmbeddingsProvider(
	model: AiModel,
	embeddingModel?: string,
): ApiEmbeddingsProvider {
	return new ApiEmbeddingsProvider(model, embeddingModel);
}
