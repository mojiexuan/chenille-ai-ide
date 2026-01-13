/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';
import {
	IGlobalRulesStorageService,
	GlobalRulesStorageChannelClient,
	GlobalRulesStorageChannelName
} from '../common/globalRulesStorage.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';

/**
 * 全局规则存储服务（渲染进程）
 */
// @ts-expect-error: interface is implemented via proxy
export class ElectronGlobalRulesStorageService implements IGlobalRulesStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(GlobalRulesStorageChannelName);
		return new GlobalRulesStorageChannelClient(channel);
	}
}

registerSingleton(IGlobalRulesStorageService, ElectronGlobalRulesStorageService, InstantiationType.Delayed);
