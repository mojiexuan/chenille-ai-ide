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

	/**
	 * 生成文本嵌入向量
	 */
	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}

		const results: number[][] = [];

		// 批量处理，避免单次请求过大
		const batchSize = 100;
		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			const batchResults = await this.embedBatch(batch);
			results.push(...batchResults);
		}

		return results;
	}

	/**
	 * 批量嵌入
	 */
	private async embedBatch(texts: string[]): Promise<number[][]> {
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
				input: texts,
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

		// 按 index 排序并提取嵌入向量
		return data.data
			.sort((a, b) => a.index - b.index)
			.map(item => item.embedding);
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
