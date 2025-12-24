/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';
import { IAiModelStorageService, AiModelStorageService } from '../common/modelStorage.js';
import { IAiPromptStorageService, AiPromptStorageService } from '../common/promptStorage.js';
import { registerChenilleSettingsAction } from './settingsPanel/chenilleSettingsAction.js';

// 注册存储服务
registerSingleton(IAiModelStorageService, AiModelStorageService, InstantiationType.Delayed);
registerSingleton(IAiPromptStorageService, AiPromptStorageService, InstantiationType.Delayed);

// 注册Action
registerChenilleSettingsAction();
