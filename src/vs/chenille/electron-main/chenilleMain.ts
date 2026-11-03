/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server as ElectronIPCServer } from '../../base/parts/ipc/electron-main/ipc.electron.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import { ICommitMessageService, CommitMessageChannel, CommitMessageChannelName } from '../common/commitMessage.js';
import { IAiAgentStorageService, AgentStorageChannel, AgentStorageChannelName, IAiModelStorageService, IMcpRuntimeService, IMcpServerStorageService, McpRuntimeChannel, McpRuntimeChannelName, McpServerStorageChannel, McpServerStorageChannelName, ModelStorageChannel, ModelStorageChannelName } from '../common/storageIpc.js';
import { AiAgentStorageMainService } from './agentStorage.js';
import { McpRuntimeMainService } from './mcpRuntimeService.js';
import { McpServerStorageMainService } from './mcpServerStorage.js';
import { AiModelStorageMainService } from './modelStorage.js';
import { IAiAgentMainService, AiAgentMainService } from './agentService.js';
import { IChenilleAiService, ChenilleAiChannel, ChenilleAiChannelName } from '../common/chatService.js';
import { ChenilleAiMainService } from './chatService.js';
import { IChenilleInlineCompletionService, ChenilleInlineCompletionChannel, ChenilleInlineCompletionChannelName } from '../common/inlineCompletionService.js';
import { ChenilleInlineCompletionMainService } from './inlineCompletionService.js';
import { IChenilleVersionCheckService, ChenilleVersionCheckChannel, ChenilleVersionCheckChannelName } from '../common/versionCheckService.js';
import { ChenilleVersionCheckMainService } from './versionCheckService.js';
import { IGlobalRulesStorageService, GlobalRulesStorageChannel, GlobalRulesStorageChannelName } from '../common/globalRulesStorage.js';
import { GlobalRulesStorageMainService } from './globalRulesStorage.js';
import { IGlobalSkillsStorageService, GlobalSkillsStorageChannel, GlobalSkillsStorageChannelName } from '../common/skills.js';
import { GlobalSkillsStorageMainService } from './globalSkillsStorage.js';
import { CommitMessageMainService } from './commitMessageService.js';
import { INetworkToolsService, NetworkToolsChannel, NetworkToolsChannelName } from '../common/networkTools.js';
import { NetworkToolsMainService } from './networkToolsService.js';

/**
 * Registers the Chenille services that run in the Electron main process.
 */
export function registerChenilleMainServices(services: ServiceCollection): void {
	services.set(IAiModelStorageService, new SyncDescriptor(AiModelStorageMainService));
	services.set(IAiAgentStorageService, new SyncDescriptor(AiAgentStorageMainService));
	services.set(IMcpServerStorageService, new SyncDescriptor(McpServerStorageMainService));
	services.set(IMcpRuntimeService, new SyncDescriptor(McpRuntimeMainService));
	services.set(IAiAgentMainService, new SyncDescriptor(AiAgentMainService));
	services.set(ICommitMessageService, new SyncDescriptor(CommitMessageMainService));
	services.set(IChenilleAiService, new SyncDescriptor(ChenilleAiMainService));
	services.set(IChenilleInlineCompletionService, new SyncDescriptor(ChenilleInlineCompletionMainService));
	services.set(IChenilleVersionCheckService, new SyncDescriptor(ChenilleVersionCheckMainService));
	services.set(IGlobalRulesStorageService, new SyncDescriptor(GlobalRulesStorageMainService));
	services.set(IGlobalSkillsStorageService, new SyncDescriptor(GlobalSkillsStorageMainService));
	services.set(INetworkToolsService, new SyncDescriptor(NetworkToolsMainService));
}

/**
 * Registers the Chenille IPC channels used by the renderer process.
 */
export function registerChenilleMainChannels(accessor: ServicesAccessor, mainProcessElectronServer: ElectronIPCServer): void {
	const modelStorageChannel = new ModelStorageChannel(accessor.get(IAiModelStorageService));
	mainProcessElectronServer.registerChannel(ModelStorageChannelName, modelStorageChannel);

	const agentStorageChannel = new AgentStorageChannel(accessor.get(IAiAgentStorageService));
	mainProcessElectronServer.registerChannel(AgentStorageChannelName, agentStorageChannel);

	const mcpServerStorageChannel = new McpServerStorageChannel(accessor.get(IMcpServerStorageService));
	mainProcessElectronServer.registerChannel(McpServerStorageChannelName, mcpServerStorageChannel);

	const mcpRuntimeChannel = new McpRuntimeChannel(accessor.get(IMcpRuntimeService));
	mainProcessElectronServer.registerChannel(McpRuntimeChannelName, mcpRuntimeChannel);

	const commitMessageChannel = new CommitMessageChannel(accessor.get(ICommitMessageService));
	mainProcessElectronServer.registerChannel(CommitMessageChannelName, commitMessageChannel);

	const chatChannel = new ChenilleAiChannel(accessor.get(IChenilleAiService));
	mainProcessElectronServer.registerChannel(ChenilleAiChannelName, chatChannel);

	const inlineCompletionChannel = new ChenilleInlineCompletionChannel(accessor.get(IChenilleInlineCompletionService));
	mainProcessElectronServer.registerChannel(ChenilleInlineCompletionChannelName, inlineCompletionChannel);

	const versionCheckChannel = new ChenilleVersionCheckChannel(accessor.get(IChenilleVersionCheckService));
	mainProcessElectronServer.registerChannel(ChenilleVersionCheckChannelName, versionCheckChannel);

	const globalRulesStorageChannel = new GlobalRulesStorageChannel(accessor.get(IGlobalRulesStorageService));
	mainProcessElectronServer.registerChannel(GlobalRulesStorageChannelName, globalRulesStorageChannel);

	const globalSkillsStorageChannel = new GlobalSkillsStorageChannel(accessor.get(IGlobalSkillsStorageService));
	mainProcessElectronServer.registerChannel(GlobalSkillsStorageChannelName, globalSkillsStorageChannel);

	const networkToolsChannel = new NetworkToolsChannel(accessor.get(INetworkToolsService));
	mainProcessElectronServer.registerChannel(NetworkToolsChannelName, networkToolsChannel);
}
