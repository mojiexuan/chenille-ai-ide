/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IAiModelStorageService, ModelStorageChannelClient, ModelStorageChannelName,
	IAiPromptStorageService, PromptStorageChannelClient, PromptStorageChannelName,
	IAiAgentStorageService, AgentStorageChannelClient, AgentStorageChannelName,
	IMcpServerStorageService, McpServerStorageChannelClient, McpServerStorageChannelName,
} from '../common/storageIpc.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';

/**
 * Model 存储服务（Browser 端 IPC 客户端）
 */
// @ts-expect-error: interface is implemented via proxy
class ElectronModelStorageService implements IAiModelStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return new ModelStorageChannelClient(mainProcessService.getChannel(ModelStorageChannelName));
	}
}

/**
 * Prompt 存储服务（Browser 端 IPC 客户端）
 */
// @ts-expect-error: interface is implemented via proxy
class ElectronPromptStorageService implements IAiPromptStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return new PromptStorageChannelClient(mainProcessService.getChannel(PromptStorageChannelName));
	}
}

/**
 * Agent 存储服务（Browser 端 IPC 客户端）
 */
// @ts-expect-error: interface is implemented via proxy
class ElectronAgentStorageService implements IAiAgentStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return new AgentStorageChannelClient(mainProcessService.getChannel(AgentStorageChannelName));
	}
}

registerSingleton(IAiModelStorageService, ElectronModelStorageService, InstantiationType.Delayed);
registerSingleton(IAiPromptStorageService, ElectronPromptStorageService, InstantiationType.Delayed);
registerSingleton(IAiAgentStorageService, ElectronAgentStorageService, InstantiationType.Delayed);

/**
 * MCP Server 存储服务（Browser 端 IPC 客户端）
 */
// @ts-expect-error: interface is implemented via proxy
class ElectronMcpServerStorageService implements IMcpServerStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return new McpServerStorageChannelClient(mainProcessService.getChannel(McpServerStorageChannelName));
	}
}

registerSingleton(IMcpServerStorageService, ElectronMcpServerStorageService, InstantiationType.Delayed);
