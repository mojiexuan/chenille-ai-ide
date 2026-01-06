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

// 注册 Action
registerChenilleSettingsAction();

// 注册服务
registerSingleton(IChenilleChatModeService, ChenilleChatModeService, InstantiationType.Delayed);
registerSingleton(IChenilleToolDispatcher, ChenilleToolDispatcher, InstantiationType.Delayed);
registerSingleton(IChenilleChatController, ChenilleChatControllerImpl, InstantiationType.Delayed);
registerSingleton(IChenilleChatIntegration, ChenilleChatIntegrationImpl, InstantiationType.Delayed);
registerSingleton(IChenilleChatProvider, ChenilleChatProviderImpl, InstantiationType.Delayed);
registerSingleton(IContextCollapseService, ContextCollapseService, InstantiationType.Delayed);
