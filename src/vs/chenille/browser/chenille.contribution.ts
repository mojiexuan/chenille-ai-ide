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
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../workbench/common/contributions.js';
import { ChenilleAgentContribution } from './chat/chenilleAgentContribution.js';
import { IChenilleDiffSessionService, ChenilleDiffSessionService } from './diffSession/index.js';
import { IProjectRulesService, ProjectRulesService } from './rules/projectRulesService.js';

// 导入 diff actions（自动注册）
import './diffSession/chenilleDiffActions.js';

// 导入 CSS 样式
import './diffSession/chenilleDiffSession.css';

// 导入 electron-browser 服务（自动注册）
import '../electron-browser/globalRulesStorageService.js';

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

// 注册 Chenille Agent 到 VS Code Chat 系统
registerWorkbenchContribution2(ChenilleAgentContribution.ID, ChenilleAgentContribution, WorkbenchPhase.AfterRestored);
