/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IChenilleVersionCheckService,
	ChenilleVersionCheckChannelClient,
	ChenilleVersionCheckChannelName
} from '../common/versionCheckService.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';

/**
 * Electron 渲染进程的版本检查服务
 * 通过 IPC 代理到主进程
 */
// @ts-expect-error: interface is implemented via proxy
export class ElectronChenilleVersionCheckService implements IChenilleVersionCheckService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(ChenilleVersionCheckChannelName);
		return new ChenilleVersionCheckChannelClient(channel);
	}
}

registerSingleton(IChenilleVersionCheckService, ElectronChenilleVersionCheckService, InstantiationType.Delayed);
