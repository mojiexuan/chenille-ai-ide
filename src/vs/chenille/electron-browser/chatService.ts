/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChenilleAiService, ChenilleAiChannelClient, ChenilleAiChannelName } from '../common/chatService.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';

/**
 * Electron 桌面端的 AI 服务
 * 通过 IPC 代理到主进程
 */
// @ts-expect-error: interface is implemented via proxy
export class ElectronChenilleAiService implements IChenilleAiService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(ChenilleAiChannelName);
		return new ChenilleAiChannelClient(channel);
	}
}

registerSingleton(IChenilleAiService, ElectronChenilleAiService, InstantiationType.Delayed);
