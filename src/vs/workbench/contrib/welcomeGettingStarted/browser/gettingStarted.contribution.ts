/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { GettingStartedInputSerializer, GettingStartedPage, inWelcomeContext } from './gettingStarted.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { MenuId, registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ContextKeyExpr, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IWalkthroughsService } from './gettingStartedService.js';
import { GettingStartedEditorOptions, GettingStartedInput } from './gettingStartedInput.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { isLinux, isMacintosh, isWindows, OperatingSystem as OS } from '../../../../base/common/platform.js';
import { IExtensionManagementServerService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { StartupPageEditorResolverContribution, StartupPageRunnerContribution } from './startupPage.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { GettingStartedAccessibleView } from './gettingStartedAccessibleView.js';

export * as icons from './gettingStartedIcons.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openWalkthrough',
			title: localize2('miWelcome', '欢迎'),
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 1,
			},
			metadata: {
				description: localize2('minWelcomeDescription', '打开演练以帮助你开始使用 Chenille。')
			}
		});
	}

	public run(
		accessor: ServicesAccessor,
		walkthroughID: string | { category: string; step: string } | undefined,
		optionsOrToSide: { toSide?: boolean; inactive?: boolean } | boolean | undefined
	) {
		const editorService = accessor.get(IEditorService);
		const commandService = accessor.get(ICommandService);

		const toSide = typeof optionsOrToSide === 'object' ? optionsOrToSide.toSide : optionsOrToSide;
		const inactive = typeof optionsOrToSide === 'object' ? optionsOrToSide.inactive : false;
		const activeEditor = editorService.activeEditor;

		if (walkthroughID) {
			const selectedCategory = typeof walkthroughID === 'string' ? walkthroughID : walkthroughID.category;
			let selectedStep: string | undefined;
			if (typeof walkthroughID === 'object' && 'category' in walkthroughID && 'step' in walkthroughID) {
				selectedStep = `${walkthroughID.category}#${walkthroughID.step}`;
			} else {
				selectedStep = undefined;
			}

			// If the walkthrough is already open just reveal the step
			if (selectedStep && activeEditor instanceof GettingStartedInput && activeEditor.selectedCategory === selectedCategory) {
				activeEditor.showWelcome = false;
				commandService.executeCommand('walkthroughs.selectStep', selectedStep);
				return;
			}

			let options: GettingStartedEditorOptions;
			if (selectedCategory) {
				// Otherwise open the walkthrough editor with the selected category and step
				options = { selectedCategory, selectedStep, showWelcome: false, preserveFocus: toSide ?? false, inactive };
			} else {
				// Open Welcome page
				options = { selectedCategory, selectedStep, showWelcome: true, preserveFocus: toSide ?? false, inactive };
			}
			editorService.openEditor({
				resource: GettingStartedInput.RESOURCE,
				options
			}, toSide ? SIDE_GROUP : undefined);

		} else {
			editorService.openEditor({
				resource: GettingStartedInput.RESOURCE,
				options: { preserveFocus: toSide ?? false, inactive }
			}, toSide ? SIDE_GROUP : undefined);
		}
	}
});

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(GettingStartedInput.ID, GettingStartedInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		GettingStartedPage,
		GettingStartedPage.ID,
		localize('welcome', "欢迎")
	),
	[
		new SyncDescriptor(GettingStartedInput)
	]
);

const category = localize2('welcome', "欢迎");

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.goBack',
			title: localize2('welcome.goBack', '返回'),
			category,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Escape,
				when: inWelcomeContext
			},
			precondition: ContextKeyExpr.equals('activeEditor', 'gettingStartedPage'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const editorPane = editorService.activeEditorPane;
		if (editorPane instanceof GettingStartedPage) {
			editorPane.escape();
		}
	}
});

CommandsRegistry.registerCommand({
	id: 'walkthroughs.selectStep',
	handler: (accessor, stepID: string) => {
		const editorService = accessor.get(IEditorService);
		const editorPane = editorService.activeEditorPane;
		if (editorPane instanceof GettingStartedPage) {
			editorPane.selectStepLoose(stepID);
		} else {
			console.error('Cannot run walkthroughs.selectStep outside of walkthrough context');
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.markStepComplete',
			title: localize('welcome.markStepComplete', "标记步骤为已完成"),
			category,
		});
	}

	run(accessor: ServicesAccessor, arg: string) {
		if (!arg) { return; }
		const gettingStartedService = accessor.get(IWalkthroughsService);
		gettingStartedService.progressStep(arg);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.markStepIncomplete',
			title: localize('welcome.markStepInomplete', "标记步骤为未完成"),
			category,
		});
	}

	run(accessor: ServicesAccessor, arg: string) {
		if (!arg) { return; }
		const gettingStartedService = accessor.get(IWalkthroughsService);
		gettingStartedService.deprogressStep(arg);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.showAllWalkthroughs',
			title: localize2('welcome.showAllWalkthroughs', '打开演练...'),
			category,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 3,
			},
		});
	}

	private async getQuickPickItems(
		contextService: IContextKeyService,
		gettingStartedService: IWalkthroughsService
	): Promise<IQuickPickItem[]> {
		const categories = await gettingStartedService.getWalkthroughs();
		return categories
			.filter(c => contextService.contextMatchesRules(c.when))
			.map(x => ({
				id: x.id,
				label: x.title,
				detail: x.description,
				description: x.source,
			}));
	}

	async run(accessor: ServicesAccessor) {
		const commandService = accessor.get(ICommandService);
		const contextService = accessor.get(IContextKeyService);
		const quickInputService = accessor.get(IQuickInputService);
		const gettingStartedService = accessor.get(IWalkthroughsService);
		const extensionService = accessor.get(IExtensionService);

		const disposables = new DisposableStore();
		const quickPick = disposables.add(quickInputService.createQuickPick());
		quickPick.canSelectMany = false;
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		quickPick.placeholder = localize('pickWalkthroughs', '选择要打开的演练');
		quickPick.items = await this.getQuickPickItems(contextService, gettingStartedService);
		quickPick.busy = true;
		disposables.add(quickPick.onDidAccept(() => {
			const selection = quickPick.selectedItems[0];
			if (selection) {
				commandService.executeCommand('workbench.action.openWalkthrough', selection.id);
			}
			quickPick.hide();
		}));
		disposables.add(quickPick.onDidHide(() => disposables.dispose()));
		await extensionService.whenInstalledExtensionsRegistered();
		disposables.add(gettingStartedService.onDidAddWalkthrough(async () => {
			quickPick.items = await this.getQuickPickItems(contextService, gettingStartedService);
		}));
		quickPick.show();
		quickPick.busy = false;
	}
});

CommandsRegistry.registerCommand({
	id: 'welcome.newWorkspaceChat',
	handler: (accessor, stepID: string) => {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand('workbench.action.chat.open', { mode: 'agent', query: '#new ', isPartialQuery: true });
	}
});

export const WorkspacePlatform = new RawContextKey<'mac' | 'linux' | 'windows' | 'webworker' | undefined>('workspacePlatform', undefined, localize('workspacePlatform', "当前工作区的平台，在远程或无服务器上下文中可能与 UI 的平台不同"));
class WorkspacePlatformContribution {

	static readonly ID = 'workbench.contrib.workspacePlatform';

	constructor(
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IContextKeyService private readonly contextService: IContextKeyService,
	) {
		this.remoteAgentService.getEnvironment().then(env => {
			const remoteOS = env?.os;

			const remotePlatform = remoteOS === OS.Macintosh ? 'mac'
				: remoteOS === OS.Windows ? 'windows'
					: remoteOS === OS.Linux ? 'linux'
						: undefined;

			if (remotePlatform) {
				WorkspacePlatform.bindTo(this.contextService).set(remotePlatform);
			} else if (this.extensionManagementServerService.localExtensionManagementServer) {
				if (isMacintosh) {
					WorkspacePlatform.bindTo(this.contextService).set('mac');
				} else if (isLinux) {
					WorkspacePlatform.bindTo(this.contextService).set('linux');
				} else if (isWindows) {
					WorkspacePlatform.bindTo(this.contextService).set('windows');
				}
			} else if (this.extensionManagementServerService.webExtensionManagementServer) {
				WorkspacePlatform.bindTo(this.contextService).set('webworker');
			} else {
				console.error('Error: Unable to detect workspace platform');
			}
		});
	}
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		'workbench.welcomePage.walkthroughs.openOnInstall': {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: true,
			description: localize('workbench.welcomePage.walkthroughs.openOnInstall', "启用后，安装扩展时将打开该扩展的演练。")
		},
		'workbench.startupEditor': {
			'scope': ConfigurationScope.RESOURCE,
			'type': 'string',
			'enum': ['none', 'welcomePage', 'readme', 'newUntitledFile', 'welcomePageInEmptyWorkbench', 'terminal'],
			'enumDescriptions': [
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.none' }, "启动时不打开编辑器。"),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePage' }, "打开欢迎页面，其中包含帮助你开始使用 Chenille 和扩展的内容。"),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.readme' }, "打开包含 README 的文件夹时打开 README，否则回退到 'welcomePage'。注意: 这仅作为全局配置生效，如果在工作区或文件夹配置中设置将被忽略。"),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.newUntitledFile' }, "打开新的无标题文本文件(仅在打开空窗口时适用)。"),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePageInEmptyWorkbench' }, "打开空工作台时打开欢迎页面。"),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.terminal' }, "在编辑器区域打开新终端。"),
			],
			'default': 'welcomePage',
			'description': localize('workbench.startupEditor', "控制启动时显示哪个编辑器(如果没有从上一个会话恢复)。")
		},
		'workbench.welcomePage.preferReducedMotion': {
			scope: ConfigurationScope.APPLICATION,
			type: 'boolean',
			default: false,
			deprecationMessage: localize('deprecationMessage', "已弃用，请使用全局设置 `workbench.reduceMotion`。"),
			description: localize('workbench.welcomePage.preferReducedMotion', "启用后，减少欢迎页面中的动画效果。")
		}
	}
});

registerWorkbenchContribution2(WorkspacePlatformContribution.ID, WorkspacePlatformContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(StartupPageEditorResolverContribution.ID, StartupPageEditorResolverContribution, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(StartupPageRunnerContribution.ID, StartupPageRunnerContribution, WorkbenchPhase.AfterRestored);

AccessibleViewRegistry.register(new GettingStartedAccessibleView());

