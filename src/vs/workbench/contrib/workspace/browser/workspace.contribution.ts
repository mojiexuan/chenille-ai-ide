/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/workspaceTrustEditor.css';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Severity } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWorkspaceTrustRequestService, WorkspaceTrustUriResponse } from '../../../../platform/workspace/common/workspaceTrust.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ContextKeyExpr, IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../browser/editor.js';
import { shieldIcon, WorkspaceTrustEditor } from './workspaceTrustEditor.js';
import { WorkspaceTrustEditorInput } from '../../../services/workspaces/browser/workspaceTrustEditorInput.js';
import { WORKSPACE_TRUST_BANNER, WORKSPACE_TRUST_EMPTY_WINDOW, WORKSPACE_TRUST_ENABLED, WORKSPACE_TRUST_STARTUP_PROMPT, WORKSPACE_TRUST_UNTRUSTED_FILES } from '../../../services/workspaces/common/workspaceTrust.js';
import { IEditorSerializer, IEditorFactoryRegistry, EditorExtensions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isEmptyWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, IWorkspaceContextService, IWorkspaceFoldersWillChangeEvent, toWorkspaceIdentifier, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { dirname, resolve } from '../../../../base/common/path.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMarkdownString, MarkdownString } from '../../../../base/common/htmlContent.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IBannerItem, IBannerService } from '../../../services/banner/browser/bannerService.js';
import { isVirtualWorkspace } from '../../../../platform/workspace/common/virtualWorkspace.js';
import { LIST_WORKSPACE_UNSUPPORTED_EXTENSIONS_COMMAND_ID } from '../../extensions/common/extensions.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { WORKSPACE_TRUST_SETTING_TAG } from '../../preferences/common/preferences.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { ILabelService, Verbosity } from '../../../../platform/label/common/label.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { MANAGE_TRUST_COMMAND_ID, WorkspaceTrustContext } from '../common/workspace.js';
import { isWeb } from '../../../../base/common/platform.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { securityConfigurationNodeBase } from '../../../common/configuration.js';
import { basename, dirname as uriDirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';

const BANNER_RESTRICTED_MODE = 'workbench.banner.restrictedMode';
const STARTUP_PROMPT_SHOWN_KEY = 'workspace.trust.startupPrompt.shown';
const BANNER_RESTRICTED_MODE_DISMISSED_KEY = 'workbench.banner.restrictedMode.dismissed';

export class WorkspaceTrustContextKeys extends Disposable implements IWorkbenchContribution {

	private readonly _ctxWorkspaceTrustEnabled: IContextKey<boolean>;
	private readonly _ctxWorkspaceTrustState: IContextKey<boolean>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspaceTrustEnablementService workspaceTrustEnablementService: IWorkspaceTrustEnablementService,
		@IWorkspaceTrustManagementService workspaceTrustManagementService: IWorkspaceTrustManagementService
	) {
		super();

		this._ctxWorkspaceTrustEnabled = WorkspaceTrustContext.IsEnabled.bindTo(contextKeyService);
		this._ctxWorkspaceTrustEnabled.set(workspaceTrustEnablementService.isWorkspaceTrustEnabled());

		this._ctxWorkspaceTrustState = WorkspaceTrustContext.IsTrusted.bindTo(contextKeyService);
		this._ctxWorkspaceTrustState.set(workspaceTrustManagementService.isWorkspaceTrusted());

		this._register(workspaceTrustManagementService.onDidChangeTrust(trusted => this._ctxWorkspaceTrustState.set(trusted)));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(WorkspaceTrustContextKeys, LifecyclePhase.Restored);


/*
 * Trust Request via Service UX handler
 */

export class WorkspaceTrustRequestHandler extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.workspaceTrustRequestHandler';

	constructor(
		@IDialogService private readonly dialogService: IDialogService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService) {
		super();

		this.registerListeners();
	}

	private get useWorkspaceLanguage(): boolean {
		return !isSingleFolderWorkspaceIdentifier(toWorkspaceIdentifier(this.workspaceContextService.getWorkspace()));
	}

	private registerListeners(): void {

		// Open files trust request
		this._register(this.workspaceTrustRequestService.onDidInitiateOpenFilesTrustRequest(async () => {
			await this.workspaceTrustManagementService.workspaceResolved;

			// Details
			const markdownDetails = [
				this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY ?
					localize('openLooseFileWorkspaceDetails', "你正在尝试在受信任的工作区中打开不受信任的文件。") :
					localize('openLooseFileWindowDetails', "你正在尝试在受信任的窗口中打开不受信任的文件。"),
				localize('openLooseFileLearnMore', "如果你不想打开不受信任的文件，我们建议在新窗口中以受限模式打开它们，因为这些文件可能是恶意的。请参阅[我们的文档](https://aka.ms/vscode-workspace-trust)了解更多信息。")
			];

			// Dialog
			await this.dialogService.prompt<void>({
				type: Severity.Info,
				message: this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY ?
					localize('openLooseFileWorkspaceMesssage', "是否允许在此工作区中打开不受信任的文件?") :
					localize('openLooseFileWindowMesssage', "是否允许在此窗口中打开不受信任的文件?"),
				buttons: [
					{
						label: localize({ key: 'open', comment: ['&& denotes a mnemonic'] }, "打开(O)"),
						run: ({ checkboxChecked }) => this.workspaceTrustRequestService.completeOpenFilesTrustRequest(WorkspaceTrustUriResponse.Open, !!checkboxChecked)
					},
					{
						label: localize({ key: 'newWindow', comment: ['&& denotes a mnemonic'] }, "在受限模式下打开(R)"),
						run: ({ checkboxChecked }) => this.workspaceTrustRequestService.completeOpenFilesTrustRequest(WorkspaceTrustUriResponse.OpenInNewWindow, !!checkboxChecked)
					}
				],
				cancelButton: {
					run: () => this.workspaceTrustRequestService.completeOpenFilesTrustRequest(WorkspaceTrustUriResponse.Cancel)
				},
				checkbox: {
					label: localize('openLooseFileWorkspaceCheckbox', "为所有工作区记住我的选择"),
					checked: false
				},
				custom: {
					icon: Codicon.shield,
					markdownDetails: markdownDetails.map(md => { return { markdown: new MarkdownString(md) }; })
				}
			});
		}));

		// Workspace trust request
		this._register(this.workspaceTrustRequestService.onDidInitiateWorkspaceTrustRequest(async requestOptions => {
			await this.workspaceTrustManagementService.workspaceResolved;

			// Title
			const message = this.useWorkspaceLanguage ?
				localize('workspaceTrust', "你信任此工作区中文件的作者吗?") :
				localize('folderTrust', "你信任此文件夹中文件的作者吗?");

			// Message
			const defaultDetails = localize('immediateTrustRequestMessage', "如果你不信任当前打开的文件或文件夹的来源，你尝试使用的功能可能存在安全风险。");
			const details = requestOptions?.message ?? defaultDetails;

			// Buttons
			const buttons = requestOptions?.buttons ?? [
				{ label: this.useWorkspaceLanguage ? localize({ key: 'grantWorkspaceTrustButton', comment: ['&& denotes a mnemonic'] }, "信任工作区并继续(T)") : localize({ key: 'grantFolderTrustButton', comment: ['&& denotes a mnemonic'] }, "信任文件夹并继续(&&T)"), type: 'ContinueWithTrust' },
				{ label: localize({ key: 'manageWorkspaceTrustButton', comment: ['&& denotes a mnemonic'] }, "管理(M)"), type: 'Manage' }
			];

			// Add Cancel button if not provided
			if (!buttons.some(b => b.type === 'Cancel')) {
				buttons.push({ label: localize('cancelWorkspaceTrustButton', "取消"), type: 'Cancel' });
			}

			// Dialog
			const { result } = await this.dialogService.prompt({
				type: Severity.Info,
				message,
				custom: {
					icon: Codicon.shield,
					markdownDetails: [
						{ markdown: new MarkdownString(details) },
						{ markdown: new MarkdownString(localize('immediateTrustRequestLearnMore', "如果你不信任这些文件的作者，我们不建议继续操作，因为这些文件可能是恶意的。请参阅[我们的文档](https://aka.ms/vscode-workspace-trust)了解更多信息。")) }
					]
				},
				buttons: buttons.filter(b => b.type !== 'Cancel').map(button => {
					return {
						label: button.label,
						run: () => button.type
					};
				}),
				cancelButton: (() => {
					const cancelButton = buttons.find(b => b.type === 'Cancel');
					if (!cancelButton) {
						return undefined;
					}

					return {
						label: cancelButton.label,
						run: () => cancelButton.type
					};
				})()
			});


			// Dialog result
			switch (result) {
				case 'ContinueWithTrust':
					await this.workspaceTrustRequestService.completeWorkspaceTrustRequest(true);
					break;
				case 'ContinueWithoutTrust':
					await this.workspaceTrustRequestService.completeWorkspaceTrustRequest(undefined);
					break;
				case 'Manage':
					this.workspaceTrustRequestService.cancelWorkspaceTrustRequest();
					await this.commandService.executeCommand(MANAGE_TRUST_COMMAND_ID);
					break;
				case 'Cancel':
					this.workspaceTrustRequestService.cancelWorkspaceTrustRequest();
					break;
			}
		}));
	}
}


/*
 * Trust UX and Startup Handler
 */
export class WorkspaceTrustUXHandler extends Disposable implements IWorkbenchContribution {

	private readonly entryId = `status.workspaceTrust`;

	private readonly statusbarEntryAccessor: MutableDisposable<IStatusbarEntryAccessor>;

	constructor(
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustEnablementService private readonly workspaceTrustEnablementService: IWorkspaceTrustEnablementService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IBannerService private readonly bannerService: IBannerService,
		@ILabelService private readonly labelService: ILabelService,
		@IHostService private readonly hostService: IHostService,
		@IProductService private readonly productService: IProductService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		this.statusbarEntryAccessor = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

		(async () => {

			await this.workspaceTrustManagementService.workspaceTrustInitialized;

			if (this.workspaceTrustEnablementService.isWorkspaceTrustEnabled()) {
				this.registerListeners();
				this.updateStatusbarEntry(this.workspaceTrustManagementService.isWorkspaceTrusted());

				// Show modal dialog
				if (this.hostService.hasFocus) {
					this.showModalOnStart();
				} else {
					const focusDisposable = this.hostService.onDidChangeFocus(focused => {
						if (focused) {
							focusDisposable.dispose();
							this.showModalOnStart();
						}
					});
				}
			}
		})();
	}

	private registerListeners(): void {
		this._register(this.workspaceContextService.onWillChangeWorkspaceFolders(e => {
			if (e.fromCache) {
				return;
			}
			if (!this.workspaceTrustEnablementService.isWorkspaceTrustEnabled()) {
				return;
			}

			const addWorkspaceFolder = async (e: IWorkspaceFoldersWillChangeEvent): Promise<void> => {
				const trusted = this.workspaceTrustManagementService.isWorkspaceTrusted();

				// Workspace is trusted and there are added/changed folders
				if (trusted && (e.changes.added.length || e.changes.changed.length)) {
					const addedFoldersTrustInfo = await Promise.all(e.changes.added.map(folder => this.workspaceTrustManagementService.getUriTrustInfo(folder.uri)));

					if (!addedFoldersTrustInfo.map(info => info.trusted).every(trusted => trusted)) {
						const { confirmed } = await this.dialogService.confirm({
							type: Severity.Info,
							message: localize('addWorkspaceFolderMessage', "你信任此文件夹中文件的作者吗?"),
							detail: localize('addWorkspaceFolderDetail', "你正在将当前不受信任的文件添加到受信任的工作区。你信任这些新文件的作者吗?"),
							cancelButton: localize('no', '否'),
							custom: { icon: Codicon.shield }
						});

						// Mark added/changed folders as trusted
						await this.workspaceTrustManagementService.setUrisTrust(addedFoldersTrustInfo.map(i => i.uri), confirmed);
					}
				}
			};

			return e.join(addWorkspaceFolder(e));
		}));

		this._register(this.workspaceTrustManagementService.onDidChangeTrust(trusted => {
			this.updateWorkbenchIndicators(trusted);
		}));

		this._register(this.workspaceTrustRequestService.onDidInitiateWorkspaceTrustRequestOnStartup(async () => {

			let titleString: string | undefined;
			let learnMoreString: string | undefined;
			let trustOption: string | undefined;
			let dontTrustOption: string | undefined;
			const isAiGeneratedWorkspace = await this.isAiGeneratedWorkspace();
			if (isAiGeneratedWorkspace && this.productService.aiGeneratedWorkspaceTrust) {
				titleString = this.productService.aiGeneratedWorkspaceTrust.title;
				learnMoreString = this.productService.aiGeneratedWorkspaceTrust.startupTrustRequestLearnMore;
				trustOption = this.productService.aiGeneratedWorkspaceTrust.trustOption;
				dontTrustOption = this.productService.aiGeneratedWorkspaceTrust.dontTrustOption;
			} else {
				console.warn('AI generated workspace trust dialog contents not available.');
			}

			const title = titleString ?? (this.useWorkspaceLanguage ?
				localize('workspaceTrust', "你信任此工作区中文件的作者吗?") :
				localize('folderTrust', "你信任此文件夹中文件的作者吗?"));

			let checkboxText: string | undefined;
			const workspaceIdentifier = toWorkspaceIdentifier(this.workspaceContextService.getWorkspace());
			const isSingleFolderWorkspace = isSingleFolderWorkspaceIdentifier(workspaceIdentifier);
			const isEmptyWindow = isEmptyWorkspaceIdentifier(workspaceIdentifier);
			if (!isAiGeneratedWorkspace && this.workspaceTrustManagementService.canSetParentFolderTrust()) {
				const name = basename(uriDirname((workspaceIdentifier as ISingleFolderWorkspaceIdentifier).uri));
				checkboxText = localize('checkboxString', "信任父文件夹 '{0}' 中所有文件的作者", name);
			}

			// Show Workspace Trust Start Dialog
			this.doShowModal(
				title,
				{ label: trustOption ?? localize({ key: 'trustOption', comment: ['&& denotes a mnemonic'] }, "是的，我信任作者(Y)"), sublabel: isSingleFolderWorkspace ? localize('trustFolderOptionDescription', "信任文件夹并启用所有功能") : localize('trustWorkspaceOptionDescription', "信任工作区并启用所有功能") },
				{ label: dontTrustOption ?? localize({ key: 'dontTrustOption', comment: ['&& denotes a mnemonic'] }, "不，我不信任作者(N)"), sublabel: isSingleFolderWorkspace ? localize('dontTrustFolderOptionDescription', "在受限模式下浏览文件夹") : localize('dontTrustWorkspaceOptionDescription', "在受限模式下浏览工作区") },
				[
					!isSingleFolderWorkspace ?
						localize('workspaceStartupTrustDetails', "{0} 提供的功能可能会自动执行此工作区中的文件。", this.productService.nameShort) :
						localize('folderStartupTrustDetails', "{0} 提供的功能可能会自动执行此文件夹中的文件。", this.productService.nameShort),
					learnMoreString ?? localize('startupTrustRequestLearnMore', "如果你不信任这些文件的作者，我们建议以受限模式继续，因为这些文件可能是恶意的。请参阅[我们的文档](https://aka.ms/vscode-workspace-trust)了解更多信息。"),
					!isEmptyWindow ?
						`\`${this.labelService.getWorkspaceLabel(workspaceIdentifier, { verbose: Verbosity.LONG })}\`` : '',
				],
				checkboxText
			);
		}));
	}

	private updateWorkbenchIndicators(trusted: boolean): void {
		const bannerItem = this.getBannerItem(!trusted);

		this.updateStatusbarEntry(trusted);

		if (bannerItem) {
			if (!trusted) {
				this.bannerService.show(bannerItem);
			} else {
				this.bannerService.hide(BANNER_RESTRICTED_MODE);
			}
		}
	}

	//#region Dialog

	private async doShowModal(question: string, trustedOption: { label: string; sublabel: string }, untrustedOption: { label: string; sublabel: string }, markdownStrings: string[], trustParentString?: string): Promise<void> {
		await this.dialogService.prompt({
			type: Severity.Info,
			message: question,
			checkbox: trustParentString ? {
				label: trustParentString
			} : undefined,
			buttons: [
				{
					label: trustedOption.label,
					run: async ({ checkboxChecked }) => {
						if (checkboxChecked) {
							await this.workspaceTrustManagementService.setParentFolderTrust(true);
						} else {
							await this.workspaceTrustRequestService.completeWorkspaceTrustRequest(true);
						}
					}
				},
				{
					label: untrustedOption.label,
					run: () => {
						this.updateWorkbenchIndicators(false);
						this.workspaceTrustRequestService.cancelWorkspaceTrustRequest();
					}
				}
			],
			custom: {
				buttonDetails: [
					trustedOption.sublabel,
					untrustedOption.sublabel
				],
				disableCloseAction: true,
				icon: Codicon.shield,
				markdownDetails: markdownStrings.map(md => { return { markdown: new MarkdownString(md) }; })
			}
		});

		this.storageService.store(STARTUP_PROMPT_SHOWN_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private async showModalOnStart(): Promise<void> {
		if (this.workspaceTrustManagementService.isWorkspaceTrusted()) {
			this.updateWorkbenchIndicators(true);
			return;
		}

		// Don't show modal prompt if workspace trust cannot be changed
		if (!(this.workspaceTrustManagementService.canSetWorkspaceTrust())) {
			return;
		}

		// Don't show modal prompt for virtual workspaces by default
		if (isVirtualWorkspace(this.workspaceContextService.getWorkspace())) {
			this.updateWorkbenchIndicators(false);
			return;
		}

		// Don't show modal prompt for empty workspaces by default
		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.updateWorkbenchIndicators(false);
			return;
		}

		if (this.startupPromptSetting === 'never') {
			this.updateWorkbenchIndicators(false);
			return;
		}

		if (this.startupPromptSetting === 'once' && this.storageService.getBoolean(STARTUP_PROMPT_SHOWN_KEY, StorageScope.WORKSPACE, false)) {
			this.updateWorkbenchIndicators(false);
			return;
		}

		// Use the workspace trust request service to show modal dialog
		this.workspaceTrustRequestService.requestWorkspaceTrustOnStartup();
	}

	private get startupPromptSetting(): 'always' | 'once' | 'never' {
		return this.configurationService.getValue(WORKSPACE_TRUST_STARTUP_PROMPT);
	}

	private get useWorkspaceLanguage(): boolean {
		return !isSingleFolderWorkspaceIdentifier(toWorkspaceIdentifier(this.workspaceContextService.getWorkspace()));
	}

	private async isAiGeneratedWorkspace(): Promise<boolean> {
		const aiGeneratedWorkspaces = URI.joinPath(this.environmentService.workspaceStorageHome, 'aiGeneratedWorkspaces.json');
		return await this.fileService.exists(aiGeneratedWorkspaces).then(async result => {
			if (result) {
				try {
					const content = await this.fileService.readFile(aiGeneratedWorkspaces);
					const workspaces = JSON.parse(content.value.toString()) as string[];
					if (workspaces.indexOf(this.workspaceContextService.getWorkspace().folders[0].uri.toString()) > -1) {
						return true;
					}
				} catch (e) {
					// Ignore errors when resolving file contents
				}
			}
			return false;
		});
	}

	//#endregion

	//#region Banner

	private getBannerItem(restrictedMode: boolean): IBannerItem | undefined {
		const dismissedRestricted = this.storageService.getBoolean(BANNER_RESTRICTED_MODE_DISMISSED_KEY, StorageScope.WORKSPACE, false);

		// never show the banner
		if (this.bannerSetting === 'never') {
			return undefined;
		}

		// info has been dismissed
		if (this.bannerSetting === 'untilDismissed' && dismissedRestricted) {
			return undefined;
		}

		const actions =
			[
				{
					label: localize('restrictedModeBannerManage', "管理"),
					href: 'command:' + MANAGE_TRUST_COMMAND_ID
				},
				{
					label: localize('restrictedModeBannerLearnMore', "了解更多"),
					href: 'https://aka.ms/vscode-workspace-trust'
				}
			];

		return {
			id: BANNER_RESTRICTED_MODE,
			icon: shieldIcon,
			ariaLabel: this.getBannerItemAriaLabels(),
			message: this.getBannerItemMessages(),
			actions,
			onClose: () => {
				if (restrictedMode) {
					this.storageService.store(BANNER_RESTRICTED_MODE_DISMISSED_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
				}
			}
		};
	}

	private getBannerItemAriaLabels(): string {
		switch (this.workspaceContextService.getWorkbenchState()) {
			case WorkbenchState.EMPTY:
				return localize('restrictedModeBannerAriaLabelWindow', "受限模式用于安全地浏览代码。信任此窗口以启用所有功能。使用导航键访问横幅操作。");
			case WorkbenchState.FOLDER:
				return localize('restrictedModeBannerAriaLabelFolder', "受限模式用于安全地浏览代码。信任此文件夹以启用所有功能。使用导航键访问横幅操作。");
			case WorkbenchState.WORKSPACE:
				return localize('restrictedModeBannerAriaLabelWorkspace', "受限模式用于安全地浏览代码。信任此工作区以启用所有功能。使用导航键访问横幅操作。");
		}
	}

	private getBannerItemMessages(): string {
		switch (this.workspaceContextService.getWorkbenchState()) {
			case WorkbenchState.EMPTY:
				return localize('restrictedModeBannerMessageWindow', "受限模式用于安全地浏览代码。信任此窗口以启用所有功能。");
			case WorkbenchState.FOLDER:
				return localize('restrictedModeBannerMessageFolder', "受限模式用于安全地浏览代码。信任此文件夹以启用所有功能。");
			case WorkbenchState.WORKSPACE:
				return localize('restrictedModeBannerMessageWorkspace', "受限模式用于安全地浏览代码。信任此工作区以启用所有功能。");
		}
	}


	private get bannerSetting(): 'always' | 'untilDismissed' | 'never' {
		const result = this.configurationService.getValue<'always' | 'untilDismissed' | 'never'>(WORKSPACE_TRUST_BANNER);

		// In serverless environments, we don't need to aggressively show the banner
		if (result !== 'always' && isWeb && !this.remoteAgentService.getConnection()?.remoteAuthority) {
			return 'never';
		}

		return result;
	}

	//#endregion

	//#region Statusbar

	private getRestrictedModeStatusbarEntry(): IStatusbarEntry {
		let ariaLabel = '';
		let toolTip: IMarkdownString | string | undefined;
		switch (this.workspaceContextService.getWorkbenchState()) {
			case WorkbenchState.EMPTY: {
				ariaLabel = localize('status.ariaUntrustedWindow', "受限模式: 由于此窗口不受信任，某些功能已被禁用。");
				toolTip = {
					value: localize(
						{ key: 'status.tooltipUntrustedWindow2', comment: ['[abc]({n}) are links.  Only translate `features are disabled` and `window is not trusted`. Do not change brackets and parentheses or {n}'] },
						"正在受限模式下运行\n\n由于此[窗口不受信任]({1})，某些[功能已被禁用]({0})。",
						`command:${LIST_WORKSPACE_UNSUPPORTED_EXTENSIONS_COMMAND_ID}`,
						`command:${MANAGE_TRUST_COMMAND_ID}`
					),
					isTrusted: true,
					supportThemeIcons: true
				};
				break;
			}
			case WorkbenchState.FOLDER: {
				ariaLabel = localize('status.ariaUntrustedFolder', "受限模式: 由于此文件夹不受信任，某些功能已被禁用。");
				toolTip = {
					value: localize(
						{ key: 'status.tooltipUntrustedFolder2', comment: ['[abc]({n}) are links.  Only translate `features are disabled` and `folder is not trusted`. Do not change brackets and parentheses or {n}'] },
						"正在受限模式下运行\n\n由于此[文件夹不受信任]({1})，某些[功能已被禁用]({0})。",
						`command:${LIST_WORKSPACE_UNSUPPORTED_EXTENSIONS_COMMAND_ID}`,
						`command:${MANAGE_TRUST_COMMAND_ID}`
					),
					isTrusted: true,
					supportThemeIcons: true
				};
				break;
			}
			case WorkbenchState.WORKSPACE: {
				ariaLabel = localize('status.ariaUntrustedWorkspace', "受限模式: 由于此工作区不受信任，某些功能已被禁用。");
				toolTip = {
					value: localize(
						{ key: 'status.tooltipUntrustedWorkspace2', comment: ['[abc]({n}) are links. Only translate `features are disabled` and `workspace is not trusted`. Do not change brackets and parentheses or {n}'] },
						"正在受限模式下运行\n\n由于此[工作区不受信任]({1})，某些[功能已被禁用]({0})。",
						`command:${LIST_WORKSPACE_UNSUPPORTED_EXTENSIONS_COMMAND_ID}`,
						`command:${MANAGE_TRUST_COMMAND_ID}`
					),
					isTrusted: true,
					supportThemeIcons: true
				};
				break;
			}
		}

		return {
			name: localize('status.WorkspaceTrust', "工作区信任"),
			text: `$(shield) ${localize('untrusted', "受限模式")}`,
			ariaLabel: ariaLabel,
			tooltip: toolTip,
			command: MANAGE_TRUST_COMMAND_ID,
			kind: 'prominent'
		};
	}

	private updateStatusbarEntry(trusted: boolean): void {
		if (trusted && this.statusbarEntryAccessor.value) {
			this.statusbarEntryAccessor.clear();
			return;
		}

		if (!trusted && !this.statusbarEntryAccessor.value) {
			const entry = this.getRestrictedModeStatusbarEntry();
			this.statusbarEntryAccessor.value = this.statusbarService.addEntry(entry, this.entryId, StatusbarAlignment.LEFT, { location: { id: 'status.host', priority: Number.POSITIVE_INFINITY }, alignment: StatusbarAlignment.RIGHT });
		}
	}

	//#endregion
}

registerWorkbenchContribution2(WorkspaceTrustRequestHandler.ID, WorkspaceTrustRequestHandler, WorkbenchPhase.BlockRestore);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(WorkspaceTrustUXHandler, LifecyclePhase.Restored);


/**
 * Trusted Workspace GUI Editor
 */
class WorkspaceTrustEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: WorkspaceTrustEditorInput): string {
		return '';
	}

	deserialize(instantiationService: IInstantiationService): WorkspaceTrustEditorInput {
		return instantiationService.createInstance(WorkspaceTrustEditorInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory)
	.registerEditorSerializer(WorkspaceTrustEditorInput.ID, WorkspaceTrustEditorInputSerializer);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		WorkspaceTrustEditor,
		WorkspaceTrustEditor.ID,
		localize('workspaceTrustEditor', "工作区信任编辑器")
	),
	[
		new SyncDescriptor(WorkspaceTrustEditorInput)
	]
);


/*
 * Actions
 */

// Configure Workspace Trust Settings

const CONFIGURE_TRUST_COMMAND_ID = 'workbench.trust.configure';
const WORKSPACES_CATEGORY = localize2('workspacesCategory', '工作区');

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CONFIGURE_TRUST_COMMAND_ID,
			title: localize2('configureWorkspaceTrustSettings', "配置工作区信任设置"),
			precondition: ContextKeyExpr.and(WorkspaceTrustContext.IsEnabled, ContextKeyExpr.equals(`config.${WORKSPACE_TRUST_ENABLED}`, true)),
			category: WORKSPACES_CATEGORY,
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		accessor.get(IPreferencesService).openUserSettings({ jsonEditor: false, query: `@tag:${WORKSPACE_TRUST_SETTING_TAG}` });
	}
});

// Manage Workspace Trust

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: MANAGE_TRUST_COMMAND_ID,
			title: localize2('manageWorkspaceTrust', "管理工作区信任"),
			precondition: ContextKeyExpr.and(WorkspaceTrustContext.IsEnabled, ContextKeyExpr.equals(`config.${WORKSPACE_TRUST_ENABLED}`, true)),
			category: WORKSPACES_CATEGORY,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		const input = instantiationService.createInstance(WorkspaceTrustEditorInput);

		editorService.openEditor(input, { pinned: true });
		return;
	}
});


/*
 * Configuration
 */
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		...securityConfigurationNodeBase,
		properties: {
			[WORKSPACE_TRUST_ENABLED]: {
				type: 'boolean',
				default: true,
				description: localize('workspace.trust.description', "控制是否在 Chenille 中启用工作区信任。"),
				tags: [WORKSPACE_TRUST_SETTING_TAG],
				scope: ConfigurationScope.APPLICATION,
			},
			[WORKSPACE_TRUST_STARTUP_PROMPT]: {
				type: 'string',
				default: 'once',
				description: localize('workspace.trust.startupPrompt.description', "控制何时显示信任工作区的启动提示。"),
				tags: [WORKSPACE_TRUST_SETTING_TAG],
				scope: ConfigurationScope.APPLICATION,
				enum: ['always', 'once', 'never'],
				enumDescriptions: [
					localize('workspace.trust.startupPrompt.always', "每次打开不受信任的工作区时都询问是否信任。"),
					localize('workspace.trust.startupPrompt.once', "首次打开不受信任的工作区时询问是否信任。"),
					localize('workspace.trust.startupPrompt.never', "打开不受信任的工作区时不询问是否信任。"),
				]
			},
			[WORKSPACE_TRUST_BANNER]: {
				type: 'string',
				default: 'untilDismissed',
				description: localize('workspace.trust.banner.description', "控制何时显示受限模式横幅。"),
				tags: [WORKSPACE_TRUST_SETTING_TAG],
				scope: ConfigurationScope.APPLICATION,
				enum: ['always', 'untilDismissed', 'never'],
				enumDescriptions: [
					localize('workspace.trust.banner.always', "每次打开不受信任的工作区时都显示横幅。"),
					localize('workspace.trust.banner.untilDismissed', "打开不受信任的工作区时显示横幅，直到被关闭。"),
					localize('workspace.trust.banner.never', "打开不受信任的工作区时不显示横幅。"),
				]
			},
			[WORKSPACE_TRUST_UNTRUSTED_FILES]: {
				type: 'string',
				default: 'prompt',
				markdownDescription: localize('workspace.trust.untrustedFiles.description', "控制如何处理在受信任的工作区中打开不受信任的文件。此设置也适用于在通过 `#{0}#` 信任的空窗口中打开文件。", WORKSPACE_TRUST_EMPTY_WINDOW),
				tags: [WORKSPACE_TRUST_SETTING_TAG],
				scope: ConfigurationScope.APPLICATION,
				enum: ['prompt', 'open', 'newWindow'],
				enumDescriptions: [
					localize('workspace.trust.untrustedFiles.prompt', "针对每个工作区询问如何处理不受信任的文件。一旦不受信任的文件被引入受信任的工作区，将不再提示。"),
					localize('workspace.trust.untrustedFiles.open', "始终允许将不受信任的文件引入受信任的工作区，而不提示。"),
					localize('workspace.trust.untrustedFiles.newWindow', "始终在单独的窗口中以受限模式打开不受信任的文件，而不提示。"),
				]
			},
			[WORKSPACE_TRUST_EMPTY_WINDOW]: {
				type: 'boolean',
				default: true,
				markdownDescription: localize('workspace.trust.emptyWindow.description', "控制在 Chenille 中是否默认信任空窗口。与 `#{0}#` 一起使用时，可以在空窗口中启用 Chenille 的全部功能而无需提示。", WORKSPACE_TRUST_UNTRUSTED_FILES),
				tags: [WORKSPACE_TRUST_SETTING_TAG],
				scope: ConfigurationScope.APPLICATION
			}
		}
	});

class WorkspaceTrustTelemetryContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustEnablementService private readonly workspaceTrustEnablementService: IWorkspaceTrustEnablementService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
	) {
		super();

		this.workspaceTrustManagementService.workspaceTrustInitialized
			.then(() => {
				this.logInitialWorkspaceTrustInfo();
				this.logWorkspaceTrust(this.workspaceTrustManagementService.isWorkspaceTrusted());

				this._register(this.workspaceTrustManagementService.onDidChangeTrust(isTrusted => this.logWorkspaceTrust(isTrusted)));
			});
	}

	private logInitialWorkspaceTrustInfo(): void {
		if (!this.workspaceTrustEnablementService.isWorkspaceTrustEnabled()) {
			const disabledByCliFlag = this.environmentService.disableWorkspaceTrust;

			type WorkspaceTrustDisabledEventClassification = {
				owner: 'sbatten';
				comment: 'Logged when workspace trust is disabled';
				reason: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The reason workspace trust is disabled. e.g. cli or setting' };
			};

			type WorkspaceTrustDisabledEvent = {
				reason: 'setting' | 'cli';
			};

			this.telemetryService.publicLog2<WorkspaceTrustDisabledEvent, WorkspaceTrustDisabledEventClassification>('workspaceTrustDisabled', {
				reason: disabledByCliFlag ? 'cli' : 'setting'
			});
			return;
		}

		type WorkspaceTrustInfoEventClassification = {
			owner: 'sbatten';
			comment: 'Information about the workspaces trusted on the machine';
			trustedFoldersCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The number of trusted folders on the machine' };
		};

		type WorkspaceTrustInfoEvent = {
			trustedFoldersCount: number;
		};

		this.telemetryService.publicLog2<WorkspaceTrustInfoEvent, WorkspaceTrustInfoEventClassification>('workspaceTrustFolderCounts', {
			trustedFoldersCount: this.workspaceTrustManagementService.getTrustedUris().length,
		});
	}

	private async logWorkspaceTrust(isTrusted: boolean): Promise<void> {
		if (!this.workspaceTrustEnablementService.isWorkspaceTrustEnabled()) {
			return;
		}

		type WorkspaceTrustStateChangedEvent = {
			workspaceId: string;
			isTrusted: boolean;
		};

		type WorkspaceTrustStateChangedEventClassification = {
			owner: 'sbatten';
			comment: 'Logged when the workspace transitions between trusted and restricted modes';
			workspaceId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'An id of the workspace' };
			isTrusted: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'true if the workspace is trusted' };
		};

		this.telemetryService.publicLog2<WorkspaceTrustStateChangedEvent, WorkspaceTrustStateChangedEventClassification>('workspaceTrustStateChanged', {
			workspaceId: this.workspaceContextService.getWorkspace().id,
			isTrusted: isTrusted
		});

		if (isTrusted) {
			type WorkspaceTrustFolderInfoEventClassification = {
				owner: 'sbatten';
				comment: 'Some metrics on the trusted workspaces folder structure';
				trustedFolderDepth: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The number of directories deep of the trusted path' };
				workspaceFolderDepth: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The number of directories deep of the workspace path' };
				delta: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The difference between the trusted path and the workspace path directories depth' };
			};

			type WorkspaceTrustFolderInfoEvent = {
				trustedFolderDepth: number;
				workspaceFolderDepth: number;
				delta: number;
			};

			const getDepth = (folder: string): number => {
				let resolvedPath = resolve(folder);

				let depth = 0;
				while (dirname(resolvedPath) !== resolvedPath && depth < 100) {
					resolvedPath = dirname(resolvedPath);
					depth++;
				}

				return depth;
			};

			for (const folder of this.workspaceContextService.getWorkspace().folders) {
				const { trusted, uri } = await this.workspaceTrustManagementService.getUriTrustInfo(folder.uri);
				if (!trusted) {
					continue;
				}

				const workspaceFolderDepth = getDepth(folder.uri.fsPath);
				const trustedFolderDepth = getDepth(uri.fsPath);
				const delta = workspaceFolderDepth - trustedFolderDepth;

				this.telemetryService.publicLog2<WorkspaceTrustFolderInfoEvent, WorkspaceTrustFolderInfoEventClassification>('workspaceFolderDepthBelowTrustedFolder', { workspaceFolderDepth, trustedFolderDepth, delta });
			}
		}
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(WorkspaceTrustTelemetryContribution, LifecyclePhase.Restored);
