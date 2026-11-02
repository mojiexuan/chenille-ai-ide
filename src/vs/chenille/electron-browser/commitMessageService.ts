/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommitMessageService, CommitMessageChannelClient, CommitMessageChannelName } from '../common/commitMessage.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';

/**
 * Electron 桌面端的提交消息服务
 * 通过 IPC 代理到主进程
 */
// @ts-expect-error: interface is implemented via proxy
export class ElectronCommitMessageService implements ICommitMessageService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(CommitMessageChannelName);
		return new CommitMessageChannelClient(channel);
	}
}

registerSingleton(ICommitMessageService, ElectronCommitMessageService, InstantiationType.Delayed);
