/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerChenilleSettingsAction } from './settingsPanel/chenilleSettingsAction.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';
import { IChenilleChatController, ChenilleChatControllerImpl } from './chat/chenilleChatController.js';
import { IChenilleChatIntegration, ChenilleChatIntegrationImpl, ChenilleChatProviderImpl } from './chat/index.js';
import { IChenilleToolDispatcher, ChenilleToolDispatcher } from '../tools/dispatcher.js';
import { IChenilleChatProvider } from '../common/chatProvider.js';
import { IChenilleChatModeService, ChenilleChatModeService } from '../common/chatMode.js';
import { IContextCollapseService, ContextCollapseService } from './chat/contextCollapseService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../workbench/common/contributions.js';
import { ChenilleAgentContribution } from './chat/chenilleAgentContribution.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { ChenilleInlineCompletionProvider } from './inlineCompletions/chenilleInlineCompletionProvider.js';
import { ChenilleVersionCheckUIService } from './versionCheck.contribution.js';
import { IChenilleDiffSessionService, ChenilleDiffSessionService } from './diffSession/index.js';
import { IProjectRulesService, ProjectRulesService } from './rules/projectRulesService.js';
import { IProjectSkillsService, ProjectSkillsService } from './skills/projectSkillsService.js';
import { ISkillService } from '../common/skills.js';
import { SkillService } from './skills/skillService.js';
import { ChenilleLanguageModelContribution } from './languageModel/chenilleLanguageModelContribution.js';
import { registerChenilleDefaultConfigurations, registerChenilleMenu } from './chenilleShellContribution.js';

// 导入 Chenille 品牌样式
import './media/chenilleBrand.css';

// 默认主题、菜单入口与登录入口抑制
registerChenilleDefaultConfigurations();
registerChenilleMenu();

// 导入 diff actions（自动注册）
import './diffSession/chenilleDiffActions.js';

// 导入 SCM 提交消息 action（自动注册）
import './scm/commitMessageAction.js';

// 导入 CSS 样式
import './diffSession/chenilleDiffSession.css';

// 导入 electron-browser 服务（自动注册）
import '../electron-browser/globalRulesStorageService.js';
import '../electron-browser/globalSkillsStorageService.js';

// 注册 Action
registerChenilleSettingsAction();

// 注册服务
registerSingleton(IChenilleChatModeService, ChenilleChatModeService, InstantiationType.Delayed);
registerSingleton(IChenilleToolDispatcher, ChenilleToolDispatcher, InstantiationType.Delayed);
registerSingleton(IChenilleChatController, ChenilleChatControllerImpl, InstantiationType.Delayed);
registerSingleton(IChenilleChatIntegration, ChenilleChatIntegrationImpl, InstantiationType.Delayed);
registerSingleton(IChenilleChatProvider, ChenilleChatProviderImpl, InstantiationType.Delayed);
registerSingleton(IContextCollapseService, ContextCollapseService, InstantiationType.Delayed);
registerSingleton(IChenilleDiffSessionService, ChenilleDiffSessionService, InstantiationType.Delayed);
registerSingleton(IProjectRulesService, ProjectRulesService, InstantiationType.Delayed);
registerSingleton(IProjectSkillsService, ProjectSkillsService, InstantiationType.Delayed);
registerSingleton(ISkillService, SkillService, InstantiationType.Delayed);

// 注册 Chenille Agent 到 VS Code Chat 系统
registerWorkbenchContribution2(ChenilleAgentContribution.ID, ChenilleAgentContribution, WorkbenchPhase.AfterRestored);

// 把 Chenille 配置的模型暴露给官方 Chat 模型选择器
registerWorkbenchContribution2(ChenilleLanguageModelContribution.ID, ChenilleLanguageModelContribution, WorkbenchPhase.AfterRestored);

// 注册内联补全
class ChenilleInlineCompletionContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chenille.inlineCompletion';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(instantiationService.createInstance(ChenilleInlineCompletionProvider));
	}
}

registerWorkbenchContribution2(ChenilleInlineCompletionContribution.ID, ChenilleInlineCompletionContribution, WorkbenchPhase.AfterRestored);

// 注册版本检查 UI
class ChenilleVersionCheckContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chenille.versionCheck';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(instantiationService.createInstance(ChenilleVersionCheckUIService));
	}
}

registerWorkbenchContribution2(ChenilleVersionCheckContribution.ID, ChenilleVersionCheckContribution, WorkbenchPhase.Eventually);
