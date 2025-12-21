/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFetchOptions, IRequestService } from '../common/types.js';
import { ChenilleError, NetworkError, ParseError } from '../common/errors.js';
import { prepareRequest } from '../common/utils.js';

/**
 * 处理响应
 */
async function handleResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw new NetworkError('网络异常', response.status);
	}

	try {
		return await response.json() as T;
	} catch {
		throw new ParseError('响应数据解析失败');
	}
}

/**
 * 通用 fetch 请求方法（Node 端）
 */
export async function request<T = unknown, P = unknown>(
	url: string,
	options: IFetchOptions<P> = {}
): Promise<T> {
	const { url: finalUrl, init } = prepareRequest(url, options);

	try {
		const response = await fetch(finalUrl, init);
		return await handleResponse<T>(response);
	} catch (error) {
		if (error instanceof ChenilleError) {
			throw error;
		}
		throw new NetworkError('请求失败');
	}
}

export function get<T = unknown, P = unknown>(
	url: string,
	params?: P,
	options?: Omit<IFetchOptions<P>, 'method' | 'params'>
): Promise<T> {
	return request<T, P>(url, { ...options, params, method: 'GET' });
}

export function post<T = unknown, P = unknown>(
	url: string,
	params?: P,
	options?: Omit<IFetchOptions<P>, 'method' | 'params'>
): Promise<T> {
	return request<T, P>(url, { ...options, params, method: 'POST' });
}

export function put<T = unknown, P = unknown>(
	url: string,
	params?: P,
	options?: Omit<IFetchOptions<P>, 'method' | 'params'>
): Promise<T> {
	return request<T, P>(url, { ...options, params, method: 'PUT' });
}

export function del<T = unknown, P = unknown>(
	url: string,
	params?: P,
	options?: Omit<IFetchOptions<P>, 'method' | 'params'>
): Promise<T> {
	return request<T, P>(url, { ...options, params, method: 'DELETE' });
}

export function patch<T = unknown, P = unknown>(
	url: string,
	params?: P,
	options?: Omit<IFetchOptions<P>, 'method' | 'params'>
): Promise<T> {
	return request<T, P>(url, { ...options, params, method: 'PATCH' });
}

/**
 * Node 端请求服务
 */
export const nodeRequestService: IRequestService = {
	request,
	get,
	post,
	put,
	delete: del,
	patch,
};
