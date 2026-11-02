/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFetchOptions } from './types.js';

/**
 * 构建带查询参数的 URL
 */
export function buildUrlWithParams(url: string, params: Record<string, unknown>): string {
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			searchParams.append(key, String(value));
		}
	}
	const queryString = searchParams.toString();
	if (!queryString) {
		return url;
	}
	const separator = url.includes('?') ? '&' : '?';
	return `${url}${separator}${queryString}`;
}

/**
 * 判断是否为 GET 类请求（参数放 URL）
 */
export function isGetLikeMethod(method: string): boolean {
	const m = method.toUpperCase();
	return m === 'GET' || m === 'DELETE';
}

/**
 * 准备请求参数
 */
export function prepareRequest<P>(url: string, options: IFetchOptions<P>): { url: string; init: RequestInit } {
	const { params, headers = {}, body, method = 'GET', signal } = options;

	const requestHeaders: Record<string, string> = { ...headers };
	if (!requestHeaders['Content-Type'] && !body) {
		requestHeaders['Content-Type'] = 'application/json';
	}

	let finalUrl = url;
	let requestBody: BodyInit | undefined = body;

	if (!body && params) {
		if (isGetLikeMethod(method)) {
			finalUrl = buildUrlWithParams(url, params as Record<string, unknown>);
		} else {
			requestBody = JSON.stringify(params);
		}
	}

	// FormData 需要移除 Content-Type
	if (requestBody instanceof FormData) {
		delete requestHeaders['Content-Type'];
	}

	const init: RequestInit = {
		method,
		headers: requestHeaders,
		body: requestBody,
		signal,
	};

	return { url: finalUrl, init };
}
