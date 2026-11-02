/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';
import {
	IGlobalSkillsStorageService,
	GlobalSkillsStorageChannelClient,
	GlobalSkillsStorageChannelName
} from '../common/skills.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';

/**
 * 全局 Skills 存储服务（渲染进程）
 */
// @ts-expect-error: interface is implemented via proxy
export class ElectronGlobalSkillsStorageService implements IGlobalSkillsStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(GlobalSkillsStorageChannelName);
		return new GlobalSkillsStorageChannelClient(channel);
	}
}

registerSingleton(IGlobalSkillsStorageService, ElectronGlobalSkillsStorageService, InstantiationType.Delayed);
