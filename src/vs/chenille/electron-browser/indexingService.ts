/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import {
	IChenilleIndexingService,
	ChenilleIndexingChannelClient,
	ChenilleIndexingChannelName,
} from '../common/indexing/indexingService.js';

/**
 * 创建渲染进程的索引服务客户端
 */
export function createIndexingServiceClient(
	mainProcessService: IMainProcessService,
): IChenilleIndexingService {
	const channel = mainProcessService.getChannel(ChenilleIndexingChannelName);
	return new ChenilleIndexingChannelClient(channel);
}
