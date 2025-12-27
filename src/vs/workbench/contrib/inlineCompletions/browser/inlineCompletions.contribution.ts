/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { withoutDuplicates } from '../../../../base/common/arrays.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun, observableFromEvent } from '../../../../base/common/observable.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { inlineCompletionProviderGetMatcher, providerIdSchemaUri } from '../../../../editor/contrib/inlineCompletions/browser/controller/commands.js';
import { Extensions, IJSONContributionRegistry } from '../../../../platform/jsonschemas/common/jsonContributionRegistry.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
// import { wrapInHotClass1 } from '../../../../platform/observable/common/wrapInHotClass.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ChenilleInlineCompletionProvider } from './chenilleInlineCompletionProvider.js';
import { ChenilleVersionCheckUIService } from '../../../../chenille/browser/versionCheck.contribution.js';
// import { InlineCompletionLanguageStatusBarContribution } from './inlineCompletionLanguageStatusBarContribution.js';

// 移除底部状态栏的内联建议图标
// registerWorkbenchContribution2(InlineCompletionLanguageStatusBarContribution.Id, wrapInHotClass1(InlineCompletionLanguageStatusBarContribution.hot), WorkbenchPhase.Eventually);

export class InlineCompletionSchemaContribution extends Disposable implements IWorkbenchContribution {
	public static Id = 'vs.contrib.InlineCompletionSchemaContribution';

	constructor(
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
	) {
		super();

		const registry = Registry.as<IJSONContributionRegistry>(Extensions.JSONContribution);
		const inlineCompletionsProvider = observableFromEvent(this,
			this._languageFeaturesService.inlineCompletionsProvider.onDidChange,
			() => this._languageFeaturesService.inlineCompletionsProvider.allNoModel()
		);

		this._register(autorun(reader => {
			const provider = inlineCompletionsProvider.read(reader);
			registry.registerSchema(providerIdSchemaUri, {
				enum: withoutDuplicates(provider.flatMap(p => inlineCompletionProviderGetMatcher(p))),
			}, reader.store);
		}));
	}
}

registerWorkbenchContribution2(InlineCompletionSchemaContribution.Id, InlineCompletionSchemaContribution, WorkbenchPhase.Eventually);

/**
 * Chenille Inline Completion 功能注册
 */
class ChenilleInlineCompletionContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chenille.inlineCompletion';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(instantiationService.createInstance(ChenilleInlineCompletionProvider));
	}
}

registerWorkbenchContribution2(
	ChenilleInlineCompletionContribution.ID,
	ChenilleInlineCompletionContribution,
	WorkbenchPhase.AfterRestored
);

/**
 * Chenille 版本检查功能注册
 */
class ChenilleVersionCheckContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chenille.versionCheck';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(instantiationService.createInstance(ChenilleVersionCheckUIService));
	}
}

registerWorkbenchContribution2(
	ChenilleVersionCheckContribution.ID,
	ChenilleVersionCheckContribution,
	WorkbenchPhase.Eventually
);
