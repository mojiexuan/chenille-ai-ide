/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { pathToFileURL } from 'url';

/**
 * 运行时加载第三方 SDK。
 *
 * 开发版直接走 Node 的模块解析；打包版会把 node_modules 收进
 * node_modules.asar，而 ESM 的裸模块解析无法进入 asar，因此回退到
 * asar 内的绝对路径。
 */
export async function loadSdkModule<T>(packageName: string, entryFile: string): Promise<T> {
	try {
		return await import(packageName) as T;
	} catch (err) {
		const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
		if (!resourcesPath) {
			throw err;
		}
		const modulePath = join(resourcesPath, 'app', 'node_modules.asar', packageName, entryFile);
		return await import(pathToFileURL(modulePath).href) as T;
	}
}
