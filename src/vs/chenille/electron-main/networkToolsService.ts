/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IStateService } from '../../platform/state/node/state.js';
import { IAiModelStorageService } from '../common/storageIpc.js';
import { AiModel } from '../common/types.js';
import {
	DEEPSEEK_API_BASE,
	DEEPSEEK_TOOLS_STORAGE_KEY,
	IDeepSeekBalance,
	IDeepSeekFetchResult,
	IDeepSeekSearchResponse,
	IDeepSeekToolsConfig,
	IFetchedWebPage,
	INetworkToolsService,
	isOfficialDeepSeekModel,
} from '../common/networkTools.js';
import { convertHtmlToMarkdown, extractHtmlTitle } from '../node/htmlToMarkdown.js';

const USER_AGENT = 'Chenille-AI-IDE';
const FETCH_TIMEOUT_MS = 60_000;
const DEEPSEEK_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export class NetworkToolsMainService extends Disposable implements INetworkToolsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeDeepSeekConfig = this._register(new Emitter<void>());
	readonly onDidChangeDeepSeekConfig: Event<void> = this._onDidChangeDeepSeekConfig.event;

	constructor(
		@IStateService private readonly stateService: IStateService,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
	) {
		super();

		// 模型列表变化后重新校验选中的 DeepSeek 模型
		this._register(this.modelStorage.onDidChangeModels(() => {
			this._onDidChangeDeepSeekConfig.fire();
		}));
	}

	getDeepSeekConfig(): Promise<IDeepSeekToolsConfig> {
		const raw = this.stateService.getItem<string>(DEEPSEEK_TOOLS_STORAGE_KEY);
		if (!raw) {
			return Promise.resolve({});
		}
		try {
			const config = JSON.parse(raw) as IDeepSeekToolsConfig;
			return Promise.resolve({ modelName: typeof config.modelName === 'string' ? config.modelName : undefined });
		} catch {
			return Promise.resolve({});
		}
	}

	async setDeepSeekConfig(config: IDeepSeekToolsConfig): Promise<void> {
		const normalized: IDeepSeekToolsConfig = { modelName: config.modelName || undefined };
		this.stateService.setItem(DEEPSEEK_TOOLS_STORAGE_KEY, JSON.stringify(normalized));
		this._onDidChangeDeepSeekConfig.fire();
	}

	async isDeepSeekEnabled(): Promise<boolean> {
		return !!(await this.resolveModel());
	}

	async getDeepSeekBalance(modelName?: string): Promise<IDeepSeekBalance | undefined> {
		const model = modelName
			? await this.getModel(modelName)
			: await this.resolveModel();
		if (!model) {
			return undefined;
		}

		const response = await this.requestDeepSeek<{
			is_available: boolean;
			balance_infos: Array<{ currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }>;
		}>(model, '/user/balance', undefined, 'GET');

		return {
			isAvailable: !!response.is_available,
			infos: (response.balance_infos ?? []).map(info => ({
				currency: info.currency === 'USD' ? 'USD' : 'CNY',
				totalBalance: info.total_balance,
				grantedBalance: info.granted_balance,
				toppedUpBalance: info.topped_up_balance,
			})),
		};
	}

	async search(query: string, count?: number, needContent?: boolean): Promise<IDeepSeekSearchResponse> {
		const model = await this.requireModel('搜索');
		return this.requestDeepSeek<IDeepSeekSearchResponse>(model, '/v1/tools/search', {
			query,
			count: count ?? 10,
			need_content: !!needContent,
		}, 'POST');
	}

	async fetch(url: string): Promise<IDeepSeekFetchResult> {
		const model = await this.requireModel('抓取');
		return this.requestDeepSeek<IDeepSeekFetchResult>(model, '/v1/tools/fetch', { url }, 'POST');
	}

	async fetchWebPage(url: string): Promise<IFetchedWebPage> {
		const started = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				redirect: 'follow',
				signal: controller.signal,
				headers: {
					'User-Agent': USER_AGENT,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
				},
			});

			const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
			const contentLength = Number(response.headers.get('content-length') ?? '0');
			if (contentLength > MAX_RESPONSE_BYTES) {
				throw new Error(`响应体过大（${Math.round(contentLength / 1024 / 1024)} MB），已拒绝抓取。`);
			}

			const buffer = await response.arrayBuffer();
			if (buffer.byteLength > MAX_RESPONSE_BYTES) {
				throw new Error('响应体超过 10 MB，已拒绝抓取。');
			}

			const codeText = response.statusText || String(response.status);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${codeText}`);
			}
			if (contentType.includes('application/pdf') || contentType.startsWith('image/') || contentType.startsWith('audio/') || contentType.startsWith('video/')) {
				throw new Error(`暂不支持抓取该内容类型：${contentType || '未知'}`);
			}

			const html = new TextDecoder('utf-8').decode(buffer);
			const isHtml = contentType.includes('html') || /<html[\s>]/i.test(html.slice(0, 2048));
			const title = isHtml ? extractHtmlTitle(html) : undefined;
			const content = isHtml
				? convertHtmlToMarkdown(html, response.url || url)
				: html.trim().slice(0, 100_000);

			return {
				url,
				finalUrl: response.url || url,
				title,
				content,
				bytes: buffer.byteLength,
				code: response.status,
				codeText,
				durationMs: Date.now() - started,
			};
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`抓取超时（${FETCH_TIMEOUT_MS / 1000} 秒）：${url}`);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	private async getModel(name: string): Promise<AiModel | undefined> {
		const model = await this.modelStorage.get(name);
		return isOfficialDeepSeekModel(model) ? model : undefined;
	}

	private async resolveModel(): Promise<AiModel | undefined> {
		const config = await this.getDeepSeekConfig();
		if (!config.modelName) {
			return undefined;
		}
		return this.getModel(config.modelName);
	}

	private async requireModel(action: string): Promise<AiModel> {
		const model = await this.resolveModel();
		if (!model) {
			throw new Error(`未配置官方 DeepSeek 模型，无法使用${action}。请在 Chenille 设置面板的“搜索与抓取”中选择一个官方 DeepSeek 模型。`);
		}
		return model;
	}

	private async requestDeepSeek<T>(model: AiModel, path: string, body: unknown, method: 'GET' | 'POST'): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

		try {
			const response = await fetch(`${DEEPSEEK_API_BASE}${path}`, {
				method,
				signal: controller.signal,
				headers: {
					'Authorization': `Bearer ${model.apiKey}`,
					'Content-Type': 'application/json',
					'Accept': 'application/json',
					'User-Agent': USER_AGENT,
				},
				body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
			});

			const text = await response.text();
			if (!response.ok) {
				let detail = text;
				try {
					const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
					detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message ?? text;
				} catch {
					// 非 JSON 错误响应，直接使用文本
				}
				throw new Error(`DeepSeek API 请求失败（HTTP ${response.status}）：${detail.slice(0, 500)}`);
			}

			return JSON.parse(text) as T;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('DeepSeek API 请求超时。');
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}
}
