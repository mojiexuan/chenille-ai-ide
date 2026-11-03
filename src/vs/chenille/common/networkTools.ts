/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { AiModel } from './types.js';

/** 官方 DeepSeek API 域名 */
export const DEEPSEEK_OFFICIAL_HOST = 'api.deepseek.com';

/** 官方 DeepSeek API 根地址 */
export const DEEPSEEK_API_BASE = 'https://api.deepseek.com';

/** 搜索与抓取配置的存储键 */
export const DEEPSEEK_TOOLS_STORAGE_KEY = 'chenille.deepseekTools';

/** 判断模型是否指向官方 DeepSeek API */
export function isOfficialDeepSeekModel(model: AiModel | undefined): model is AiModel {
	if (!model?.baseUrl) {
		return false;
	}
	try {
		return new URL(model.baseUrl).hostname.toLowerCase() === DEEPSEEK_OFFICIAL_HOST;
	} catch {
		return false;
	}
}

/** 搜索与抓取配置：选择一个已添加的官方 DeepSeek 模型 */
export interface IDeepSeekToolsConfig {
	/** 选中的 DeepSeek 模型名称；未设置表示不启用 */
	modelName?: string;
}

/** DeepSeek 搜索结果 */
export interface IDeepSeekSearchResult {
	rerank_score?: number;
	title?: string;
	url?: string;
	snippet?: string;
	summary?: string;
	content?: string;
	site_name?: string | null;
	site_icon?: string | null;
	date?: string | null;
	authority?: number;
}

export interface IDeepSeekSearchResponse {
	results: IDeepSeekSearchResult[];
}

/** DeepSeek 抓取结果 */
export interface IDeepSeekFetchResult {
	title?: string;
	content: string;
}

/** DeepSeek 账户余额 */
export interface IDeepSeekBalanceInfo {
	currency: 'CNY' | 'USD';
	totalBalance: string;
	grantedBalance: string;
	toppedUpBalance: string;
}

export interface IDeepSeekBalance {
	isAvailable: boolean;
	infos: IDeepSeekBalanceInfo[];
}

/** 自建网页抓取结果 */
export interface IFetchedWebPage {
	/** 请求的原始 URL */
	url: string;
	/** 跟随重定向后的最终 URL */
	finalUrl: string;
	title?: string;
	/** 转换为 Markdown 的正文 */
	content: string;
	bytes: number;
	code: number;
	codeText: string;
	durationMs: number;
}

/**
 * 网络工具服务：自建网页抓取 + 官方 DeepSeek 搜索/抓取/余额。
 * 所有网络请求都在主进程执行，避免渲染进程的 CORS 限制。
 */
export const INetworkToolsService = createDecorator<INetworkToolsService>('chenilleNetworkToolsService');

export interface INetworkToolsService {
	readonly _serviceBrand: undefined;

	/** DeepSeek 搜索与抓取配置变化 */
	readonly onDidChangeDeepSeekConfig: Event<void>;

	/** 读取搜索与抓取配置 */
	getDeepSeekConfig(): Promise<IDeepSeekToolsConfig>;

	/** 保存搜索与抓取配置 */
	setDeepSeekConfig(config: IDeepSeekToolsConfig): Promise<void>;

	/** 是否已选择有效的官方 DeepSeek 模型（决定是否注入 DeepSeek 工具） */
	isDeepSeekEnabled(): Promise<boolean>;

	/**
	 * 查询 DeepSeek 账户余额。
	 * 传入 modelName 时使用该模型；否则使用搜索与抓取配置中的模型。
	 * 未启用或模型不是官方 DeepSeek 时返回 undefined。
	 */
	getDeepSeekBalance(modelName?: string): Promise<IDeepSeekBalance | undefined>;

	/** 使用官方 DeepSeek Search 搜索 */
	search(query: string, count?: number, needContent?: boolean): Promise<IDeepSeekSearchResponse>;

	/** 使用官方 DeepSeek Fetch 抓取 */
	fetch(url: string): Promise<IDeepSeekFetchResult>;

	/** 自建网页抓取，返回 Markdown */
	fetchWebPage(url: string): Promise<IFetchedWebPage>;
}

export const NetworkToolsChannelName = 'chenille.networkTools';

export class NetworkToolsChannel implements IServerChannel {
	constructor(private readonly service: INetworkToolsService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onDidChangeDeepSeekConfig': return this.service.onDidChangeDeepSeekConfig as Event<T>;
		}
		throw new Error(`No event: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'getDeepSeekConfig': return this.service.getDeepSeekConfig() as Promise<T>;
			case 'setDeepSeekConfig': return this.service.setDeepSeekConfig(args?.[0] as IDeepSeekToolsConfig) as Promise<T>;
			case 'isDeepSeekEnabled': return this.service.isDeepSeekEnabled() as Promise<T>;
			case 'getDeepSeekBalance': return this.service.getDeepSeekBalance(args?.[0] as string | undefined) as Promise<T>;
			case 'search': return this.service.search(args?.[0] as string, args?.[1] as number | undefined, args?.[2] as boolean | undefined) as Promise<T>;
			case 'fetch': return this.service.fetch(args?.[0] as string) as Promise<T>;
			case 'fetchWebPage': return this.service.fetchWebPage(args?.[0] as string) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class NetworkToolsChannelClient implements INetworkToolsService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeDeepSeekConfig: Event<void>;

	constructor(private readonly channel: IChannel) {
		this.onDidChangeDeepSeekConfig = this.channel.listen<void>('onDidChangeDeepSeekConfig');
	}

	getDeepSeekConfig(): Promise<IDeepSeekToolsConfig> {
		return this.channel.call('getDeepSeekConfig');
	}

	setDeepSeekConfig(config: IDeepSeekToolsConfig): Promise<void> {
		return this.channel.call('setDeepSeekConfig', [config]);
	}

	isDeepSeekEnabled(): Promise<boolean> {
		return this.channel.call('isDeepSeekEnabled');
	}

	getDeepSeekBalance(modelName?: string): Promise<IDeepSeekBalance | undefined> {
		return this.channel.call('getDeepSeekBalance', [modelName]);
	}

	search(query: string, count?: number, needContent?: boolean): Promise<IDeepSeekSearchResponse> {
		return this.channel.call('search', [query, count, needContent]);
	}

	fetch(url: string): Promise<IDeepSeekFetchResult> {
		return this.channel.call('fetch', [url]);
	}

	fetchWebPage(url: string): Promise<IFetchedWebPage> {
		return this.channel.call('fetchWebPage', [url]);
	}
}
