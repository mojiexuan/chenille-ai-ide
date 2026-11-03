/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../workbench/common/contributions.js';
import { ILanguageModelsService, IUserFriendlyLanguageModel } from '../../../workbench/contrib/chat/common/languageModels.js';
import { CHENILLE_MODEL_VENDOR } from '../../common/modelIdentifier.js';
import { ChenilleLanguageModelProvider } from './chenilleLanguageModelProvider.js';

/**
 * 把 Chenille 配置的模型暴露给官方 Chat 模型选择器。
 * 工作台窗口与 Agents 窗口都需要它，因此独立成可复用的贡献类。
 */
export class ChenilleLanguageModelContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chenille.languageModel';

	constructor(
		@ILanguageModelsService languageModelsService: ILanguageModelsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const descriptor: IUserFriendlyLanguageModel = {
			vendor: CHENILLE_MODEL_VENDOR,
			displayName: localize('chenille.languageModel.displayName', "Chenille 模型"),
			configuration: undefined,
			managementCommand: undefined,
			when: undefined,
		};

		languageModelsService.deltaLanguageModelChatProviderDescriptors([descriptor], []);
		this._register(toDisposable(() => languageModelsService.deltaLanguageModelChatProviderDescriptors([], [descriptor])));

		const provider = this._register(instantiationService.createInstance(ChenilleLanguageModelProvider));
		this._register(languageModelsService.registerLanguageModelProvider(CHENILLE_MODEL_VENDOR, provider));

		// 触发一次模型解析，让模型选择器无需等待首次交互即可拿到列表
		void languageModelsService.selectLanguageModels({ vendor: CHENILLE_MODEL_VENDOR });
	}
}
