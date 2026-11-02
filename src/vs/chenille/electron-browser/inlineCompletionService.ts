/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IChenilleInlineCompletionService,
	ChenilleInlineCompletionChannelClient,
	ChenilleInlineCompletionChannelName
} from '../common/inlineCompletionService.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';

/**
 * Electron 桌面端的 Inline Completion 服务
 * 通过 IPC 代理到主进程
 */
// @ts-expect-error: interface is implemented via proxy
export class ElectronChenilleInlineCompletionService implements IChenilleInlineCompletionService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(ChenilleInlineCompletionChannelName);
		return new ChenilleInlineCompletionChannelClient(channel);
	}
}

registerSingleton(IChenilleInlineCompletionService, ElectronChenilleInlineCompletionService, InstantiationType.Delayed);
