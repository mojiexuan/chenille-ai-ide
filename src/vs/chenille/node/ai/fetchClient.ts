/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FetchOptions {
	url: string;
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
	token?: { isCancellationRequested: boolean; onCancellationRequested?: (callback: () => void) => { dispose: () => void } };
}

export interface StreamCallbackData {
	content?: string;
	done: boolean;
	error?: string;
}

/**
 * 通用 fetch 请求封装
 */
export async function fetchJson<T>(options: FetchOptions): Promise<T> {
	const { url, method = 'POST', headers = {}, body, timeout = 60000 } = options;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	// 监听取消
	const cancelListener = options.token?.onCancellationRequested?.(() => {
		controller.abort();
	});

	try {
		const response = await fetch(url, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...headers,
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		return await response.json() as T;
	} finally {
		clearTimeout(timeoutId);
		cancelListener?.dispose();
	}
}

/**
 * 流式 fetch 请求封装（SSE）
 */
export async function fetchStream(
	options: FetchOptions,
	onData: (line: string) => void,
	onDone: () => void,
	onError: (error: Error) => void
): Promise<void> {
	const { url, method = 'POST', headers = {}, body, timeout = 300000 } = options;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	// 监听取消
	const cancelListener = options.token?.onCancellationRequested?.(() => {
		controller.abort();
	});

	try {
		const response = await fetch(url, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...headers,
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('Response body is not readable');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				// 处理缓冲区中剩余的数据
				if (buffer.trim()) {
					const lines = buffer.split('\n');
					for (const line of lines) {
						if (line.trim()) {
							onData(line);
						}
					}
				}
				onDone();
				break;
			}

			buffer += decoder.decode(value, { stream: true });

			// 按行处理 SSE 数据
			const lines = buffer.split('\n');
			buffer = lines.pop() || ''; // 保留最后一个不完整的行

			for (const line of lines) {
				if (line.trim()) {
					onData(line);
				}
			}
		}
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			onDone();
		} else {
			onError(error instanceof Error ? error : new Error(String(error)));
		}
	} finally {
		clearTimeout(timeoutId);
		cancelListener?.dispose();
	}
}

/**
 * 拼接 URL 路径
 */
export function joinUrl(baseUrl: string, path: string): string {
	const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
	const p = path.startsWith('/') ? path : `/${path}`;
	return base + p;
}
