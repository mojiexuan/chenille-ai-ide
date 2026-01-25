/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Utility Process 与主进程之间的 IPC 消息协议
 */

import type { IndexingConfig, IndexProgressEvent } from './types.js';
import type { IModelDownloadProgress } from './indexingService.js';

// ============ 请求消息类型 ============

export type WorkerRequestType =
	| 'init'
	| 'indexWorkspace'
	| 'cancelIndexing'
	| 'retrieve'
	| 'onFilesChanged'
	| 'deleteIndex'
	| 'getIndexStatus'
	| 'getIndexStats'
	| 'getDetailedStats'
	| 'hasIndex'
	| 'setEmbeddingsProvider'
	| 'dispose';

export interface WorkerRequestBase {
	id: string;
	type: WorkerRequestType;
}

export interface InitRequest extends WorkerRequestBase {
	type: 'init';
	data: {
		cacheHome: string;
		config?: Partial<IndexingConfig>;
	};
}

export interface IndexWorkspaceRequest extends WorkerRequestBase {
	type: 'indexWorkspace';
	data: {
		workspacePath: string;
		config?: Partial<IndexingConfig>;
		/** 嵌入模型配置（远程 API 模型） */
		embeddingModel?: {
			baseUrl: string;
			apiKey: string;
			modelId: string;
			modelName: string;
		};
		/** 是否使用本地模型 */
		useLocalModel?: boolean;
	};
}

export interface CancelIndexingRequest extends WorkerRequestBase {
	type: 'cancelIndexing';
	data: {
		workspacePath: string;
	};
}

export interface RetrieveRequest extends WorkerRequestBase {
	type: 'retrieve';
	data: {
		query: string;
		workspacePath: string;
		topK?: number;
	};
}

export interface OnFilesChangedRequest extends WorkerRequestBase {
	type: 'onFilesChanged';
	data: {
		workspacePath: string;
		changedFiles: string[];
	};
}

export interface DeleteIndexRequest extends WorkerRequestBase {
	type: 'deleteIndex';
	data: {
		workspacePath: string;
	};
}

export interface GetIndexStatusRequest extends WorkerRequestBase {
	type: 'getIndexStatus';
	data: {
		workspacePath: string;
	};
}

export interface GetIndexStatsRequest extends WorkerRequestBase {
	type: 'getIndexStats';
	data: {
		workspacePath: string;
	};
}

export interface GetDetailedStatsRequest extends WorkerRequestBase {
	type: 'getDetailedStats';
	data: {
		workspacePath: string;
	};
}

export interface HasIndexRequest extends WorkerRequestBase {
	type: 'hasIndex';
	data: {
		workspacePath: string;
	};
}

export interface SetEmbeddingsProviderRequest extends WorkerRequestBase {
	type: 'setEmbeddingsProvider';
	data: {
		/** 远程 API 模型配置 */
		embeddingModel?: {
			baseUrl: string;
			apiKey: string;
			modelId: string;
			modelName: string;
		};
		/** 是否使用本地模型 */
		useLocalModel?: boolean;
		/** 本地模型名称 */
		localModelName?: string;
	};
}

export interface DisposeRequest extends WorkerRequestBase {
	type: 'dispose';
}

export type WorkerRequest =
	| InitRequest
	| IndexWorkspaceRequest
	| CancelIndexingRequest
	| RetrieveRequest
	| OnFilesChangedRequest
	| DeleteIndexRequest
	| GetIndexStatusRequest
	| GetIndexStatsRequest
	| GetDetailedStatsRequest
	| HasIndexRequest
	| SetEmbeddingsProviderRequest
	| DisposeRequest;

// ============ 响应消息类型 ============

export type WorkerResponseType = 'success' | 'error' | 'progress' | 'modelDownloadProgress';

export interface WorkerResponseBase {
	id: string;
	type: WorkerResponseType;
}

export interface SuccessResponse<T = unknown> extends WorkerResponseBase {
	type: 'success';
	data: T;
}

export interface ErrorResponse extends WorkerResponseBase {
	type: 'error';
	error: {
		code: string;
		message: string;
		details?: unknown;
	};
}

export interface ProgressResponse extends WorkerResponseBase {
	type: 'progress';
	data: {
		workspacePath: string;
		event: IndexProgressEvent;
	};
}

export interface ModelDownloadProgressResponse extends WorkerResponseBase {
	type: 'modelDownloadProgress';
	data: {
		workspacePath: string;
		progress: IModelDownloadProgress;
	};
}

export type WorkerResponse =
	| SuccessResponse
	| ErrorResponse
	| ProgressResponse
	| ModelDownloadProgressResponse;

// ============ 状态类型 ============

export interface WorkerIndexStatus {
	isIndexing: boolean;
	totalFileCount: number;
	queuedTasks: number;
}

export interface WorkerIndexStats {
	rowCount: number;
}

export interface WorkerDetailedStats {
	totalChunks: number;
	uniqueFiles: number;
	languageDistribution: Record<string, number>;
	dbSizeBytes: number;
	cacheSizeBytes: number;
	avgChunksPerFile: number;
}

// ============ 辅助函数 ============

let requestIdCounter = 0;

export function createRequestId(): string {
	return `req_${Date.now()}_${++requestIdCounter}`;
}

export function createSuccessResponse<T>(id: string, data: T): SuccessResponse<T> {
	return { id, type: 'success', data };
}

export function createErrorResponse(id: string, code: string, message: string, details?: unknown): ErrorResponse {
	return { id, type: 'error', error: { code, message, details } };
}

export function createProgressResponse(id: string, workspacePath: string, event: IndexProgressEvent): ProgressResponse {
	return { id, type: 'progress', data: { workspacePath, event } };
}

export function createModelDownloadProgressResponse(
	id: string,
	workspacePath: string,
	progress: IModelDownloadProgress,
): ModelDownloadProgressResponse {
	return { id, type: 'modelDownloadProgress', data: { workspacePath, progress } };
}

// ============ 类型守卫 ============

export function isSuccessResponse(response: WorkerResponse): response is SuccessResponse {
	return response.type === 'success';
}

export function isErrorResponse(response: WorkerResponse): response is ErrorResponse {
	return response.type === 'error';
}

export function isProgressResponse(response: WorkerResponse): response is ProgressResponse {
	return response.type === 'progress';
}

export function isModelDownloadProgressResponse(response: WorkerResponse): response is ModelDownloadProgressResponse {
	return response.type === 'modelDownloadProgress';
}
