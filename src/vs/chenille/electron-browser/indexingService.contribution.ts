/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { IChenilleIndexingService } from '../common/indexing/indexingService.js';
import { createIndexingServiceClient } from './indexingService.js';

/**
 * 渲染进程的索引服务实现（代理到主进程）
 */
class ChenilleIndexingServiceImpl implements IChenilleIndexingService {
	declare readonly _serviceBrand: undefined;

	private _delegate: IChenilleIndexingService | undefined;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
	) { }

	private get delegate(): IChenilleIndexingService {
		if (!this._delegate) {
			this._delegate = createIndexingServiceClient(this.mainProcessService);
		}
		return this._delegate;
	}

	// 代理所有事件
	get onIndexStatusChanged() { return this.delegate.onIndexStatusChanged; }
	get onIndexProgress() { return this.delegate.onIndexProgress; }
	get onModelDownloadProgress() { return this.delegate.onModelDownloadProgress; }

	indexWorkspace(options: Parameters<IChenilleIndexingService['indexWorkspace']>[0]) {
		return this.delegate.indexWorkspace(options);
	}

	getIndexStatus(workspacePath: string) {
		return this.delegate.getIndexStatus(workspacePath);
	}

	getIndexStats(workspacePath: string) {
		return this.delegate.getIndexStats(workspacePath);
	}

	setIndexEnabled(workspacePath: string, enabled: boolean) {
		return this.delegate.setIndexEnabled(workspacePath, enabled);
	}

	setEmbeddingModel(workspacePath: string, modelName: string) {
		return this.delegate.setEmbeddingModel(workspacePath, modelName);
	}

	testEmbeddingModel(modelName: string) {
		return this.delegate.testEmbeddingModel(modelName);
	}

	setUseLocalModel(workspacePath: string, useLocal: boolean) {
		return this.delegate.setUseLocalModel(workspacePath, useLocal);
	}

	setEmbeddingConcurrency(workspacePath: string, concurrency: number) {
		return this.delegate.setEmbeddingConcurrency(workspacePath, concurrency);
	}

	retrieve(options: Parameters<IChenilleIndexingService['retrieve']>[0]) {
		return this.delegate.retrieve(options);
	}

	deleteIndex(workspacePath: string) {
		return this.delegate.deleteIndex(workspacePath);
	}

	onFilesChanged(workspacePath: string, changedFiles: string[]) {
		return this.delegate.onFilesChanged(workspacePath, changedFiles);
	}

	isAvailable() {
		return this.delegate.isAvailable();
	}

	startFileWatching(workspacePath: string) {
		return this.delegate.startFileWatching(workspacePath);
	}

	stopFileWatching(workspacePath: string) {
		return this.delegate.stopFileWatching(workspacePath);
	}

	getStorageStats() {
		return this.delegate.getStorageStats();
	}

	activateWorkspace(workspacePath: string) {
		return this.delegate.activateWorkspace(workspacePath);
	}
}

// 注册索引服务（渲染进程客户端）
registerSingleton(IChenilleIndexingService, ChenilleIndexingServiceImpl, InstantiationType.Delayed);
