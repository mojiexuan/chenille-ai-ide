/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { get } from '../fetch.js';
import { ChenilleResponse } from './types.api.js';

export namespace Version {
	export interface VersionResult {
		name: string;
		code: number;
		content: string;
		url: string;
	}
}

/**
 * 获取版本信息
 */
export const getVersionInfo = () => {
	return get<ChenilleResponse<Version.VersionResult>>('https://ai.chenjiabao.cn');
}
