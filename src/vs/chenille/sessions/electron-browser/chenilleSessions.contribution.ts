/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Codicon } from '../../../base/common/codicons.js';
import { Event } from '../../../base/common/event.js';
import { constObservable } from '../../../base/common/observable.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../workbench/common/contributions.js';
import { MenuRegistry } from '../../../platform/actions/common/actions.js';
import { Menus } from '../../../sessions/browser/menus.js';
import { ChatAgentLocation } from '../../../workbench/contrib/chat/common/constants.js';
import { IChatSession, IChatSessionContentProvider, IChatSessionsService } from '../../../workbench/contrib/chat/common/chatSessionsService.js';
import { ISessionsProvidersService } from '../../../sessions/services/sessions/browser/sessionsProvidersService.js';
import { ISkillService } from '../../common/skills.js';
import { IMemoryService } from '../../common/memory.js';
import { ChenilleMemoryService } from '../../browser/memory/memoryService.js';
import { IChenilleToolDispatcher, ChenilleToolDispatcher } from '../../tools/dispatcher.js';
import { IChenilleDiffSessionService } from '../../browser/diffSession/chenilleDiffSession.js';
import { ChenilleDiffSessionService } from '../../browser/diffSession/chenilleDiffSessionService.js';
import { IProjectRulesService, ProjectRulesService } from '../../browser/rules/projectRulesService.js';
import { IProjectSkillsService, ProjectSkillsService } from '../../browser/skills/projectSkillsService.js';
import { SkillService } from '../../browser/skills/skillService.js';
import { ChenilleAgentContribution } from '../../browser/chat/chenilleAgentContribution.js';
import { ChenilleLanguageModelContribution } from '../../browser/languageModel/chenilleLanguageModelContribution.js';
import { CHENILLE_SESSION_SCHEME, CHENILLE_SESSION_TYPE_ID, ChenilleSessionsProvider } from '../browser/chenilleSessionsProvider.js';
import { CHENILLE_SETTINGS_ACTION_ID, registerChenilleSettingsAction } from '../../browser/settingsPanel/chenilleSettingsAction.js';
import '../../electron-browser/networkToolsService.js';

// 隐藏 Agents 窗口中的 GitHub 账号入口
import '../../browser/media/chenilleSessions.css';

// Agents 窗口独立入口，需要单独注册 Chenille 默认主题
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		'workbench.colorTheme': 'Chenille Dark',
		// Chenille 只提供本地对话，隐藏需要 GitHub 登录的 Copilot Cloud / CLI 会话。
		'github.copilot.chat.cloudAgent.enabled': false,
		'github.copilot.chat.backgroundAgent.enabled': false,
	}
}]);

// Agents 窗口标题栏提供 Chenille 设置入口
registerChenilleSettingsAction();
MenuRegistry.appendMenuItem(Menus.TitleBarRightLayout, {
	command: {
		id: CHENILLE_SETTINGS_ACTION_ID,
		title: localize('chenille.openSettings', "Chenille 设置"),
		icon: Codicon.gear,
	},
	group: 'navigation',
	order: -100,
});

// 导入 electron-browser 服务（自动注册到当前渲染进程）
import '../../electron-browser/chatService.js';
import '../../electron-browser/storageService.js';
import '../../electron-browser/globalRulesStorageService.js';
import '../../electron-browser/globalSkillsStorageService.js';

// Chenille 的 AI、存储与工具服务
registerSingleton(IChenilleToolDispatcher, ChenilleToolDispatcher, InstantiationType.Delayed);
registerSingleton(IChenilleDiffSessionService, ChenilleDiffSessionService, InstantiationType.Delayed);
registerSingleton(IProjectRulesService, ProjectRulesService, InstantiationType.Delayed);
registerSingleton(IProjectSkillsService, ProjectSkillsService, InstantiationType.Delayed);
registerSingleton(ISkillService, SkillService, InstantiationType.Delayed);
registerSingleton(IMemoryService, ChenilleMemoryService, InstantiationType.Delayed);

/** 把 Chenille 的模型与 Agent 注册到 Agents 窗口 */
registerWorkbenchContribution2(ChenilleLanguageModelContribution.ID, ChenilleLanguageModelContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChenilleAgentContribution.ID, ChenilleAgentContribution, WorkbenchPhase.AfterRestored);

/**
 * 注册 Chenille 会话内容提供者，让官方聊天界面可以为 Chenille 会话创建聊天模型。
 * 会话保持内存态，历史由官方 Chat 模型自己维护。
 */
class ChenilleChatSessionContentProvider implements IChatSessionContentProvider {
	async provideChatSessionContent(sessionResource: URI, _token: CancellationToken): Promise<IChatSession> {
		return {
			sessionResource,
			history: [],
			isCompleteObs: constObservable(true),
			onWillDispose: Event.None,
			dispose() { },
		};
	}
}

/**
 * 注册 Chenille 的 Agents 会话 provider。
 */
export class ChenilleSessionsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chenille.sessions';

	constructor(
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(chatSessionsService.registerChatSessionContribution({
			type: CHENILLE_SESSION_TYPE_ID,
			name: 'Chenille',
			displayName: 'Chenille',
			description: localize('chenille.session.description', "使用 Chenille 配置的本地模型进行对话"),
			icon: 'sparkle',
			locations: [ChatAgentLocation.Chat],
			order: 0,
			supportsAutoModel: false,
		}));

		this._register(chatSessionsService.registerChatSessionContentProvider(CHENILLE_SESSION_SCHEME, new ChenilleChatSessionContentProvider()));

		const provider = this._register(instantiationService.createInstance(ChenilleSessionsProvider));
		this._register(sessionsProvidersService.registerProvider(provider));
	}
}

registerWorkbenchContribution2(ChenilleSessionsContribution.ID, ChenilleSessionsContribution, WorkbenchPhase.AfterRestored);
