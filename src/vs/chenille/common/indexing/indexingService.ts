/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import type { RetrievalResult, IndexProgressEvent, IndexingConfig } from './types.js';

/**
 * 索引请求参数
 */
export interface IIndexWorkspaceRequest {
	/** 工作区路径 */
	workspacePath: string;
	/** 配置覆盖 */
	config?: Partial<IndexingConfig>;
}

/**
 * 检索请求参数
 */
export interface IRetrieveRequest {
	/** 查询文本 */
	query: string;
	/** 工作区路径 */
	workspacePath: string;
	/** 返回数量 */
	topK?: number;
}

/**
 * 模型下载进度
 */
export interface IModelDownloadProgress {
	status: 'initiate' | 'download' | 'progress' | 'done';
	file?: string;
	progress?: number; // 0-100
	loaded?: number;
	total?: number;
}

/**
 * 索引状态
 */
export interface IIndexStatus {
	/** 是否已存在索引 */
	hasIndex: boolean;
	/** 是否正在索引 */
	isIndexing: boolean;
	/** 已索引文件数 */
	fileCount: number;
	/** 最后索引时间 */
	lastIndexedAt?: number;
	/** 等待中的任务数 */
	queuedTasks: number;
	/** 索引是否已启用 */
	isEnabled: boolean;
	/** 文件监听是否已启动 */
	isWatching: boolean;
	/** 嵌入模型名称（远程模型） */
	embeddingModelName?: string;
	/** 是否使用本地模型 */
	useLocalModel?: boolean;
	/** 错误信息（模型不可用等） */
	errorMessage?: string;
}

/**
 * 索引详细统计
 */
export interface IIndexStats {
	/** 索引条目总数（chunks） */
	totalChunks: number;
	/** 唯一文件数 */
	uniqueFiles: number;
	/** 各语言文件分布 */
	languageDistribution: Record<string, number>;
	/** 索引数据库大小（字节） */
	dbSizeBytes: number;
	/** 缓存大小（字节） */
	cacheSizeBytes: number;
	/** 平均每文件 chunks 数 */
	avgChunksPerFile: number;
	/** 索引创建时间 */
	createdAt?: number;
}

/**
 * 存储统计信息
 */
export interface IStorageStats {
	/** 总使用空间（字节） */
	totalSizeBytes: number;
	/** 索引数量 */
	indexCount: number;
	/** 各工作区存储详情 */
	workspaces: Array<{
		path: string;
		name: string;
		sizeBytes: number;
		lastIndexedAt?: number;
		isOrphaned: boolean;
	}>;
}

/**
 * 代码库索引服务接口
 */
export const IChenilleIndexingService = createDecorator<IChenilleIndexingService>('chenilleIndexingService');

export interface IChenilleIndexingService {
	readonly _serviceBrand: undefined;

	/** 索引进度事件 */
	readonly onIndexProgress: Event<IndexProgressEvent & { workspacePath: string }>;

	/** 索引状态变化事件 */
	readonly onIndexStatusChanged: Event<{ workspacePath: string; status: IIndexStatus }>;

	/** 模型下载进度事件 */
	readonly onModelDownloadProgress: Event<{ workspacePath: string; progress: IModelDownloadProgress }>;

	/**
	 * 索引工作区
	 * @param request 索引请求
	 * @param token 取消令牌
	 */
	indexWorkspace(request: IIndexWorkspaceRequest, token?: CancellationToken): Promise<void>;

	/**
	 * 检索相似代码
	 * @param request 检索请求
	 */
	retrieve(request: IRetrieveRequest): Promise<RetrievalResult[]>;

	/**
	 * 处理文件变更
	 * @param workspacePath 工作区路径
	 * @param changedFiles 变更的文件列表
	 */
	onFilesChanged(workspacePath: string, changedFiles: string[]): Promise<void>;

	/**
	 * 删除工作区索引
	 * @param workspacePath 工作区路径
	 */
	deleteIndex(workspacePath: string): Promise<void>;

	/**
	 * 获取索引状态
	 * @param workspacePath 工作区路径
	 */
	getIndexStatus(workspacePath: string): Promise<IIndexStatus>;

	/**
	 * 获取索引详细统计
	 * @param workspacePath 工作区路径
	 */
	getIndexStats(workspacePath: string): Promise<IIndexStats | null>;

	/**
	 * 检查索引服务是否可用
	 */
	isAvailable(): Promise<boolean>;

	/**
	 * 启用/禁用工作区索引
	 * @param workspacePath 工作区路径
	 * @param enabled 是否启用
	 */
	setIndexEnabled(workspacePath: string, enabled: boolean): Promise<void>;

	/**
	 * 设置工作区的嵌入模型
	 * @param workspacePath 工作区路径
	 * @param modelName 模型名称（来自模型管理）
	 */
	setEmbeddingModel(workspacePath: string, modelName: string): Promise<void>;

	/**
	 * 测试嵌入模型是否可用
	 * @param modelName 模型名称
	 */
	testEmbeddingModel(modelName: string): Promise<{ success: boolean; error?: string; dimensions?: number }>;

	/**
	 * 设置是否使用本地模型
	 * @param workspacePath 工作区路径
	 * @param useLocal 是否使用本地模型
	 */
	setUseLocalModel(workspacePath: string, useLocal: boolean): Promise<void>;

	/**
	 * 启动文件监听
	 * @param workspacePath 工作区路径
	 */
	startFileWatching(workspacePath: string): Promise<void>;

	/**
	 * 停止文件监听
	 * @param workspacePath 工作区路径
	 */
	stopFileWatching(workspacePath: string): Promise<void>;

	/**
	 * 获取存储统计信息（供管理页面使用）
	 */
	getStorageStats(): Promise<IStorageStats>;

	/**
	 * 激活工作区索引（打开工作区时调用）
	 * 如果该工作区已启用索引，会自动恢复索引功能
	 * @param workspacePath 工作区路径
	 */
	activateWorkspace(workspacePath: string): Promise<void>;
}

/**
 * IPC Channel 名称
 */
export const ChenilleIndexingChannelName = 'chenilleIndexing';

/**
 * IPC 服务端 Channel（主进程）
 */
export class ChenilleIndexingChannel implements IServerChannel {
	constructor(private readonly service: IChenilleIndexingService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onIndexProgress':
				return this.service.onIndexProgress as Event<T>;
			case 'onIndexStatusChanged':
				return this.service.onIndexStatusChanged as Event<T>;
			case 'onModelDownloadProgress':
				return this.service.onModelDownloadProgress as Event<T>;
		}
		throw new Error(`Invalid listen event: ${event}`);
	}

	call<T>(
		_context: unknown,
		command: string,
		args?: unknown[],
		token: CancellationToken = CancellationToken.None,
	): Promise<T> {
		switch (command) {
			case 'indexWorkspace':
				return this.service.indexWorkspace(args?.[0] as IIndexWorkspaceRequest, token) as Promise<T>;
			case 'retrieve':
				return this.service.retrieve(args?.[0] as IRetrieveRequest) as Promise<T>;
			case 'onFilesChanged':
				return this.service.onFilesChanged(
					args?.[0] as string,
					args?.[1] as string[],
				) as Promise<T>;
			case 'deleteIndex':
				return this.service.deleteIndex(args?.[0] as string) as Promise<T>;
			case 'getIndexStatus':
				return this.service.getIndexStatus(args?.[0] as string) as Promise<T>;
			case 'getIndexStats':
				return this.service.getIndexStats(args?.[0] as string) as Promise<T>;
			case 'isAvailable':
				return this.service.isAvailable() as Promise<T>;
			case 'setIndexEnabled':
				return this.service.setIndexEnabled(
					args?.[0] as string,
					args?.[1] as boolean,
				) as Promise<T>;
			case 'setEmbeddingModel':
				return this.service.setEmbeddingModel(
					args?.[0] as string,
					args?.[1] as string,
				) as Promise<T>;
			case 'testEmbeddingModel':
				return this.service.testEmbeddingModel(args?.[0] as string) as Promise<T>;
			case 'setUseLocalModel':
				return this.service.setUseLocalModel(
					args?.[0] as string,
					args?.[1] as boolean,
				) as Promise<T>;
			case 'startFileWatching':
				return this.service.startFileWatching(args?.[0] as string) as Promise<T>;
			case 'stopFileWatching':
				return this.service.stopFileWatching(args?.[0] as string) as Promise<T>;
			case 'getStorageStats':
				return this.service.getStorageStats() as Promise<T>;
			case 'activateWorkspace':
				return this.service.activateWorkspace(args?.[0] as string) as Promise<T>;
		}
		throw new Error(`Invalid call command: ${command}`);
	}
}

/**
 * IPC 客户端（渲染进程调用主进程）
 */
export class ChenilleIndexingChannelClient implements IChenilleIndexingService {
	declare readonly _serviceBrand: undefined;

	readonly onIndexProgress: Event<IndexProgressEvent & { workspacePath: string }>;
	readonly onIndexStatusChanged: Event<{ workspacePath: string; status: IIndexStatus }>;
	readonly onModelDownloadProgress: Event<{ workspacePath: string; progress: IModelDownloadProgress }>;

	constructor(private readonly channel: IChannel) {
		this.onIndexProgress = this.channel.listen<IndexProgressEvent & { workspacePath: string }>('onIndexProgress');
		this.onIndexStatusChanged = this.channel.listen<{ workspacePath: string; status: IIndexStatus }>('onIndexStatusChanged');
		this.onModelDownloadProgress = this.channel.listen<{ workspacePath: string; progress: IModelDownloadProgress }>('onModelDownloadProgress');
	}

	indexWorkspace(request: IIndexWorkspaceRequest, token?: CancellationToken): Promise<void> {
		return this.channel.call<void>('indexWorkspace', [request], token);
	}

	retrieve(request: IRetrieveRequest): Promise<RetrievalResult[]> {
		return this.channel.call<RetrievalResult[]>('retrieve', [request]);
	}

	onFilesChanged(workspacePath: string, changedFiles: string[]): Promise<void> {
		return this.channel.call<void>('onFilesChanged', [workspacePath, changedFiles]);
	}

	deleteIndex(workspacePath: string): Promise<void> {
		return this.channel.call<void>('deleteIndex', [workspacePath]);
	}

	getIndexStatus(workspacePath: string): Promise<IIndexStatus> {
		return this.channel.call<IIndexStatus>('getIndexStatus', [workspacePath]);
	}

	getIndexStats(workspacePath: string): Promise<IIndexStats | null> {
		return this.channel.call<IIndexStats | null>('getIndexStats', [workspacePath]);
	}

	isAvailable(): Promise<boolean> {
		return this.channel.call<boolean>('isAvailable');
	}

	setIndexEnabled(workspacePath: string, enabled: boolean): Promise<void> {
		return this.channel.call<void>('setIndexEnabled', [workspacePath, enabled]);
	}

	setEmbeddingModel(workspacePath: string, modelName: string): Promise<void> {
		return this.channel.call<void>('setEmbeddingModel', [workspacePath, modelName]);
	}

	testEmbeddingModel(modelName: string): Promise<{ success: boolean; error?: string; dimensions?: number }> {
		return this.channel.call('testEmbeddingModel', [modelName]);
	}

	setUseLocalModel(workspacePath: string, useLocal: boolean): Promise<void> {
		return this.channel.call<void>('setUseLocalModel', [workspacePath, useLocal]);
	}

	startFileWatching(workspacePath: string): Promise<void> {
		return this.channel.call<void>('startFileWatching', [workspacePath]);
	}

	stopFileWatching(workspacePath: string): Promise<void> {
		return this.channel.call<void>('stopFileWatching', [workspacePath]);
	}

	getStorageStats(): Promise<IStorageStats> {
		return this.channel.call<IStorageStats>('getStorageStats');
	}

	activateWorkspace(workspacePath: string): Promise<void> {
		return this.channel.call<void>('activateWorkspace', [workspacePath]);
	}
}
