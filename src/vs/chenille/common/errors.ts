/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chenille 业务错误
 */
export class ChenilleError extends Error {
	public readonly statusCode: number;
	public readonly data?: unknown;

	constructor(message: string, statusCode: number = 400, data?: unknown) {
		super(message);
		this.name = 'ChenilleError';
		this.statusCode = statusCode;
		this.data = data;
	}
}

/**
 * 网络请求错误
 */
export class NetworkError extends ChenilleError {
	constructor(message: string = '网络异常', statusCode: number = 0) {
		super(message, statusCode);
		this.name = 'NetworkError';
	}
}

/**
 * 响应解析错误
 */
export class ParseError extends ChenilleError {
	constructor(message: string = '响应数据解析失败') {
		super(message, 0);
		this.name = 'ParseError';
	}
}
