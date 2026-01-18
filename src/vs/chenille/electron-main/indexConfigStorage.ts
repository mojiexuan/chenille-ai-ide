/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStateService } from '../../platform/state/node/state.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { Emitter, Event } from '../../base/common/event.js';

const STORAGE_KEY = 'chenille.indexConfig';

/**
 * 工作区索引配置
 */
export interface IWorkspaceIndexConfig {
	/** 工作区路径 */
	workspacePath: string;
	/** 是否启用索引 */
	enabled: boolean;
	/** 是否自动启动文件监听 */
	autoWatch: boolean;
	/** 最后索引时间 */
	lastIndexedAt?: number;
	/** 自定义排除模式 */
	excludePatterns?: string[];
	/** 自定义包含扩展名 */
	includeExtensions?: string[];
	/** 嵌入模型名称（来自模型管理，远程模型时使用） */
	embeddingModelName?: string;
	/** 是否使用本地模型 */
	useLocalModel?: boolean;
	/** Embedding 并发数（1-1000，默认 3）重启生效 */
	embeddingConcurrency?: number;
}

/**
 * 索引配置存储（所有工作区）
 */
interface IndexConfigData {
	workspaces: Record<string, IWorkspaceIndexConfig>;
}

/**
 * 索引配置存储服务接口
 */
export interface IIndexConfigStorageService {
	readonly _serviceBrand: undefined;

	/** 配置变更事件 */
	readonly onDidChangeConfig: Event<string>;

	/**
	 * 获取工作区配置
	 */
	getWorkspaceConfig(workspacePath: string): Promise<IWorkspaceIndexConfig>;

	/**
	 * 保存工作区配置
	 */
	saveWorkspaceConfig(config: IWorkspaceIndexConfig): Promise<void>;

	/**
	 * 获取所有已配置的工作区
	 */
	getAllWorkspaces(): Promise<IWorkspaceIndexConfig[]>;

	/**
	 * 删除工作区配置
	 */
	deleteWorkspaceConfig(workspacePath: string): Promise<void>;
}

/**
 * 索引配置存储服务实现
 */
export class IndexConfigStorageService extends Disposable implements IIndexConfigStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfig = this._register(new Emitter<string>());
	readonly onDidChangeConfig: Event<string> = this._onDidChangeConfig.event;

	constructor(
		@IStateService private readonly stateService: IStateService
	) {
		super();
	}

	/**
	 * 获取所有配置数据
	 */
	private getAllData(): IndexConfigData {
		const data = this.stateService.getItem<string>(STORAGE_KEY);
		if (!data) {
			return { workspaces: {} };
		}
		try {
			return JSON.parse(data) as IndexConfigData;
		} catch {
			return { workspaces: {} };
		}
	}

	/**
	 * 保存所有配置数据
	 */
	private saveAllData(data: IndexConfigData): void {
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(data));
	}

	/**
	 * 规范化路径（用于作为 key）
	 */
	private normalizePath(workspacePath: string): string {
		// 统一使用小写和正斜杠
		return workspacePath.toLowerCase().replace(/\\/g, '/');
	}

	/**
	 * 获取工作区配置
	 */
	async getWorkspaceConfig(workspacePath: string): Promise<IWorkspaceIndexConfig> {
		const data = this.getAllData();
		const key = this.normalizePath(workspacePath);
		const existing = data.workspaces[key];

		if (existing) {
			return existing;
		}

		// 返回默认配置
		return {
			workspacePath,
			enabled: false, // 默认禁用
			autoWatch: true, // 默认启用文件监听
		};
	}

	/**
	 * 保存工作区配置
	 */
	async saveWorkspaceConfig(config: IWorkspaceIndexConfig): Promise<void> {
		const data = this.getAllData();
		const key = this.normalizePath(config.workspacePath);

		data.workspaces[key] = config;
		this.saveAllData(data);

		this._onDidChangeConfig.fire(config.workspacePath);
	}

	/**
	 * 获取所有已配置的工作区
	 */
	async getAllWorkspaces(): Promise<IWorkspaceIndexConfig[]> {
		const data = this.getAllData();
		return Object.values(data.workspaces);
	}

	/**
	 * 删除工作区配置
	 */
	async deleteWorkspaceConfig(workspacePath: string): Promise<void> {
		const data = this.getAllData();
		const key = this.normalizePath(workspacePath);

		if (data.workspaces[key]) {
			delete data.workspaces[key];
			this.saveAllData(data);
			this._onDidChangeConfig.fire(workspacePath);
		}
	}
}
