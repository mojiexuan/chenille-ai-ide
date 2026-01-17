/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	FileToolResult,
	GetSystemInfoParams,
	GetSystemInfoResult,
	GetCurrentTimeParams,
	GetCurrentTimeResult
} from './types.js';

/**
 * 获取当前操作系统信息
 */
export async function getSystemInfo(
	_params: GetSystemInfoParams
): Promise<FileToolResult<GetSystemInfoResult>> {
	try {
		const platform = process.platform;
		const arch = process.arch;
		const nodeVersion = process.version;

		let osName: string;
		switch (platform) {
			case 'win32':
				osName = 'Windows';
				break;
			case 'darwin':
				osName = 'macOS';
				break;
			case 'linux':
				osName = 'Linux';
				break;
			default:
				osName = platform;
		}

		return {
			success: true,
			data: {
				platform,
				osName,
				arch,
				nodeVersion,
				homeDir: process.env.HOME || process.env.USERPROFILE || '',
				shell: process.env.SHELL || process.env.COMSPEC || ''
			}
		};
	} catch (error) {
		return {
			success: false,
			error: `获取系统信息失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}

/**
 * 获取当前系统时间
 */
export async function getCurrentTime(
	params: GetCurrentTimeParams
): Promise<FileToolResult<GetCurrentTimeResult>> {
	try {
		const now = new Date();
		const format = params.format || 'iso';

		let formatted: string;
		switch (format) {
			case 'iso':
				formatted = now.toISOString();
				break;
			case 'locale':
				formatted = now.toLocaleString();
				break;
			case 'date':
				formatted = now.toLocaleDateString();
				break;
			case 'time':
				formatted = now.toLocaleTimeString();
				break;
			case 'timestamp':
				formatted = String(now.getTime());
				break;
			default:
				formatted = now.toISOString();
		}

		return {
			success: true,
			data: {
				iso: now.toISOString(),
				timestamp: now.getTime(),
				formatted,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				timezoneOffset: now.getTimezoneOffset()
			}
		};
	} catch (error) {
		return {
			success: false,
			error: `获取时间失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}
