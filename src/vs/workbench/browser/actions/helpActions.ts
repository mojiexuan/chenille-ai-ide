/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import product from '../../../platform/product/common/product.js';
import { isMacintosh, isLinux, language, isWeb } from '../../../base/common/platform.js';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { URI } from '../../../base/common/uri.js';
import { MenuId, Action2, registerAction2, MenuRegistry } from '../../../platform/actions/common/actions.js';
import { KeyChord, KeyMod, KeyCode } from '../../../base/common/keyCodes.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { Categories } from '../../../platform/action/common/actionCommonCategories.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';

class KeybindingsReferenceAction extends Action2 {

	static readonly ID = 'workbench.action.keybindingsReference';
	static readonly AVAILABLE = !!(isLinux ? product.keyboardShortcutsUrlLinux : isMacintosh ? product.keyboardShortcutsUrlMac : product.keyboardShortcutsUrlWin);

	constructor() {
		super({
			id: KeybindingsReferenceAction.ID,
			title: {
				...localize2('keybindingsReference', "键盘快捷方式参考"),
				mnemonicTitle: localize({ key: 'miKeyboardShortcuts', comment: ['&& denotes a mnemonic'] }, "键盘快捷方式参考(K)"),
			},
			category: Categories.Help,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: null,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyR)
			},
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '2_reference',
				order: 1
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		const url = isLinux ? productService.keyboardShortcutsUrlLinux : isMacintosh ? productService.keyboardShortcutsUrlMac : productService.keyboardShortcutsUrlWin;
		if (url) {
			openerService.open(URI.parse(url));
		}
	}
}

class OpenIntroductoryVideosUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openVideoTutorialsUrl';
	static readonly AVAILABLE = !!product.introductoryVideosUrl;

	constructor() {
		super({
			id: OpenIntroductoryVideosUrlAction.ID,
			title: {
				...localize2('openVideoTutorialsUrl', "视频教程"),
				mnemonicTitle: localize({ key: 'miVideoTutorials', comment: ['&& denotes a mnemonic'] }, "视频教程(V)"),
			},
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '2_reference',
				order: 2
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.introductoryVideosUrl) {
			openerService.open(URI.parse(productService.introductoryVideosUrl));
		}
	}
}

class OpenTipsAndTricksUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openTipsAndTricksUrl';
	static readonly AVAILABLE = !!product.tipsAndTricksUrl;

	constructor() {
		super({
			id: OpenTipsAndTricksUrlAction.ID,
			title: {
				...localize2('openTipsAndTricksUrl', "提示和技巧"),
				mnemonicTitle: localize({ key: 'miTipsAndTricks', comment: ['&& denotes a mnemonic'] }, "提示和技巧(C)"),
			},
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '2_reference',
				order: 3
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.tipsAndTricksUrl) {
			openerService.open(URI.parse(productService.tipsAndTricksUrl));
		}
	}
}

class OpenDocumentationUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openDocumentationUrl';
	static readonly AVAILABLE = !!(isWeb ? product.serverDocumentationUrl : product.documentationUrl);

	constructor() {
		super({
			id: OpenDocumentationUrlAction.ID,
			title: {
				...localize2('openDocumentationUrl', "文档"),
				mnemonicTitle: localize({ key: 'miDocumentation', comment: ['&& denotes a mnemonic'] }, "文档(D)"),
			},
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 3
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);
		const url = isWeb ? productService.serverDocumentationUrl : productService.documentationUrl;

		if (url) {
			openerService.open(URI.parse(url));
		}
	}
}

class OpenNewsletterSignupUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openNewsletterSignupUrl';
	static readonly AVAILABLE = !!product.newsletterSignupUrl;

	constructor() {
		super({
			id: OpenNewsletterSignupUrlAction.ID,
			title: localize2('newsletterSignup', '订阅 Chenille 新闻通讯'),
			category: Categories.Help,
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);
		const telemetryService = accessor.get(ITelemetryService);
		openerService.open(URI.parse(`${productService.newsletterSignupUrl}?machineId=${encodeURIComponent(telemetryService.machineId)}`));
	}
}

class OpenYouTubeUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openYouTubeUrl';
	static readonly AVAILABLE = !!product.youTubeUrl;

	constructor() {
		super({
			id: OpenYouTubeUrlAction.ID,
			title: {
				...localize2('openYouTubeUrl', "在 YouTube 上关注我们"),
				mnemonicTitle: localize({ key: 'miYouTube', comment: ['&& denotes a mnemonic'] }, "在 YouTube 上关注我们(J)"),
			},
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '3_feedback',
				order: 1
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.youTubeUrl) {
			openerService.open(URI.parse(productService.youTubeUrl));
		}
	}
}

class OpenRequestFeatureUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openRequestFeatureUrl';
	static readonly AVAILABLE = !!product.requestFeatureUrl;

	constructor() {
		super({
			id: OpenRequestFeatureUrlAction.ID,
			title: {
				...localize2('openUserVoiceUrl', "搜索功能请求"),
				mnemonicTitle: localize({ key: 'miUserVoice', comment: ['&& denotes a mnemonic'] }, "搜索功能请求(S)"),
			},
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '3_feedback',
				order: 2
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.requestFeatureUrl) {
			openerService.open(URI.parse(productService.requestFeatureUrl));
		}
	}
}

class OpenLicenseUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openLicenseUrl';
	static readonly AVAILABLE = !!(isWeb ? product.serverLicense : product.licenseUrl);

	constructor() {
		super({
			id: OpenLicenseUrlAction.ID,
			title: {
				...localize2('openLicenseUrl', "查看许可证"),
				mnemonicTitle: localize({ key: 'miLicense', comment: ['&& denotes a mnemonic'] }, "查看许可证(L)"),
			},
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '4_legal',
				order: 1
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);
		const url = isWeb ? productService.serverLicenseUrl : productService.licenseUrl;

		if (url) {
			if (language) {
				const queryArgChar = url.indexOf('?') > 0 ? '&' : '?';
				openerService.open(URI.parse(`${url}${queryArgChar}lang=${language}`));
			} else {
				openerService.open(URI.parse(url));
			}
		}
	}
}

class OpenPrivacyStatementUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openPrivacyStatementUrl';
	static readonly AVAILABLE = !!product.privacyStatementUrl;

	constructor() {
		super({
			id: OpenPrivacyStatementUrlAction.ID,
			title: {
				...localize2('openPrivacyStatement', "隐私声明"),
				mnemonicTitle: localize({ key: 'miPrivacyStatement', comment: ['&& denotes a mnemonic'] }, "隐私声明(Y)"),
			},
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '4_legal',
				order: 2
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.privacyStatementUrl) {
			openerService.open(URI.parse(productService.privacyStatementUrl));
		}
	}
}

class GetStartedWithAccessibilityFeatures extends Action2 {

	static readonly ID = 'workbench.action.getStartedWithAccessibilityFeatures';

	constructor() {
		super({
			id: GetStartedWithAccessibilityFeatures.ID,
			title: localize2('getStartedWithAccessibilityFeatures', '开始使用辅助功能'),
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 6
			}
		});
	}
	run(accessor: ServicesAccessor): void {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand('workbench.action.openWalkthrough', 'SetupAccessibility');
	}
}

class AskVSCodeCopilot extends Action2 {
	static readonly ID = 'workbench.action.askVScode';

	constructor() {
		super({
			id: AskVSCodeCopilot.ID,
			title: localize2('askVScode', '询问 @vscode'),
			category: Categories.Help,
			f1: true,
			precondition: ContextKeyExpr.equals('chatSetupHidden', false)
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand('workbench.action.chat.open', { mode: 'ask', query: '@vscode ', isPartialQuery: true });
	}
}

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	command: {
		id: AskVSCodeCopilot.ID,
		title: localize2('askVScode', '询问 @vscode'),
	},
	order: 7,
	group: '1_welcome',
	when: ContextKeyExpr.equals('chatSetupHidden', false)
});

// --- Actions Registration

if (KeybindingsReferenceAction.AVAILABLE) {
	registerAction2(KeybindingsReferenceAction);
}

if (OpenIntroductoryVideosUrlAction.AVAILABLE) {
	registerAction2(OpenIntroductoryVideosUrlAction);
}

if (OpenTipsAndTricksUrlAction.AVAILABLE) {
	registerAction2(OpenTipsAndTricksUrlAction);
}

if (OpenDocumentationUrlAction.AVAILABLE) {
	registerAction2(OpenDocumentationUrlAction);
}

if (OpenNewsletterSignupUrlAction.AVAILABLE) {
	registerAction2(OpenNewsletterSignupUrlAction);
}

if (OpenYouTubeUrlAction.AVAILABLE) {
	registerAction2(OpenYouTubeUrlAction);
}

if (OpenRequestFeatureUrlAction.AVAILABLE) {
	registerAction2(OpenRequestFeatureUrlAction);
}

if (OpenLicenseUrlAction.AVAILABLE) {
	registerAction2(OpenLicenseUrlAction);
}

if (OpenPrivacyStatementUrlAction.AVAILABLE) {
	registerAction2(OpenPrivacyStatementUrlAction);
}

registerAction2(GetStartedWithAccessibilityFeatures);

registerAction2(AskVSCodeCopilot);
