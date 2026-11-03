/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INetworkToolsService, NetworkToolsChannelClient, NetworkToolsChannelName } from '../common/networkTools.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';

/**
 * Electron 桌面端的网络工具服务（自建抓取 + DeepSeek 搜索/抓取/余额）
 * 通过 IPC 代理到主进程，避免渲染进程的 CORS 限制。
 */
// @ts-expect-error: interface is implemented via proxy
export class ElectronNetworkToolsService implements INetworkToolsService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(NetworkToolsChannelName);
		return new NetworkToolsChannelClient(channel);
	}
}

registerSingleton(INetworkToolsService, ElectronNetworkToolsService, InstantiationType.Delayed);
