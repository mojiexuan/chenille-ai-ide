/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mapFindFirst } from '../../../../base/common/arraysFind.js';
import { assertNever } from '../../../../base/common/assert.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { parse as parseJsonc } from '../../../../base/common/jsonc.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { autorun } from '../../../../base/common/observable.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IMcpRemoteServerConfiguration, IMcpServerConfiguration, IMcpServerVariable, IMcpStdioServerConfiguration, McpServerType } from '../../../../platform/mcp/common/mcpPlatformTypes.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../platform/quickinput/common/quickInput.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isWorkspaceFolder, IWorkspaceContextService, IWorkspaceFolder, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IWorkbenchMcpManagementService } from '../../../services/mcp/common/mcpWorkbenchManagementService.js';
import { McpCommandIds } from '../common/mcpCommandIds.js';
import { allDiscoverySources, DiscoverySource, mcpDiscoverySection, mcpStdioServerSchema } from '../common/mcpConfiguration.js';
import { IMcpRegistry } from '../common/mcpRegistryTypes.js';
import { IMcpService, McpConnectionState } from '../common/mcpTypes.js';

export const enum AddConfigurationType {
	Stdio,
	HTTP,

	NpmPackage,
	PipPackage,
	NuGetPackage,
	DockerImage,
}

type AssistedConfigurationType = AddConfigurationType.NpmPackage | AddConfigurationType.PipPackage | AddConfigurationType.NuGetPackage | AddConfigurationType.DockerImage;

export const AssistedTypes = {
	[AddConfigurationType.NpmPackage]: {
		title: localize('mcp.npm.title', "输入 NPM 包名称"),
		placeholder: localize('mcp.npm.placeholder', "包名称 (例如 @org/package)"),
		pickLabel: localize('mcp.serverType.npm', "NPM 包"),
		pickDescription: localize('mcp.serverType.npm.description', "从 NPM 包名称安装"),
		enabledConfigKey: null, // always enabled
	},
	[AddConfigurationType.PipPackage]: {
		title: localize('mcp.pip.title', "输入 Pip 包名称"),
		placeholder: localize('mcp.pip.placeholder', "包名称 (例如 package-name)"),
		pickLabel: localize('mcp.serverType.pip', "Pip 包"),
		pickDescription: localize('mcp.serverType.pip.description', "从 Pip 包名称安装"),
		enabledConfigKey: null, // always enabled
	},
	[AddConfigurationType.NuGetPackage]: {
		title: localize('mcp.nuget.title', "输入 NuGet 包名称"),
		placeholder: localize('mcp.nuget.placeholder', "包名称 (例如 Package.Name)"),
		pickLabel: localize('mcp.serverType.nuget', "NuGet 包"),
		pickDescription: localize('mcp.serverType.nuget.description', "从 NuGet 包名称安装"),
		enabledConfigKey: 'chat.mcp.assisted.nuget.enabled',
	},
	[AddConfigurationType.DockerImage]: {
		title: localize('mcp.docker.title', "输入 Docker 镜像名称"),
		placeholder: localize('mcp.docker.placeholder', "镜像名称 (例如 mcp/imagename)"),
		pickLabel: localize('mcp.serverType.docker', "Docker 镜像"),
		pickDescription: localize('mcp.serverType.docker.description', "从 Docker 镜像安装"),
		enabledConfigKey: null, // always enabled
	},
};

const enum AddConfigurationCopilotCommand {
	/** Returns whether MCP enhanced setup is enabled. */
	IsSupported = 'github.copilot.chat.mcp.setup.check',

	/** Takes an npm/pip package name, validates its owner. */
	ValidatePackage = 'github.copilot.chat.mcp.setup.validatePackage',

	/** Returns the resolved MCP configuration. */
	StartFlow = 'github.copilot.chat.mcp.setup.flow',
}

type ValidatePackageResult =
	{ state: 'ok'; publisher: string; name?: string; version?: string }
	| { state: 'error'; error: string; helpUri?: string; helpUriLabel?: string };

type AddServerData = {
	packageType: string;
};
type AddServerClassification = {
	owner: 'digitarald';
	comment: 'Generic details for adding a new MCP server';
	packageType: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The type of MCP server package' };
};
type AddServerCompletedData = {
	packageType: string;
	serverType: string | undefined;
	target: string;
};
type AddServerCompletedClassification = {
	owner: 'digitarald';
	comment: 'Generic details for successfully adding model-assisted MCP server';
	packageType: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The type of MCP server package' };
	serverType: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The type of MCP server' };
	target: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The target of the MCP server configuration' };
};

type AssistedServerConfiguration = {
	type?: 'assisted';
	name?: string;
	server: Omit<IMcpStdioServerConfiguration, 'type'>;
	inputs?: IMcpServerVariable[];
	inputValues?: Record<string, string>;
} | {
	type: 'mapped';
	name?: string;
	server: Omit<IMcpStdioServerConfiguration, 'type'>;
	inputs?: IMcpServerVariable[];
};

export class McpAddConfigurationCommand {
	constructor(
		private readonly workspaceFolder: IWorkspaceFolder | undefined,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IWorkbenchMcpManagementService private readonly _mcpManagementService: IWorkbenchMcpManagementService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@ICommandService private readonly _commandService: ICommandService,
		@IMcpRegistry private readonly _mcpRegistry: IMcpRegistry,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IEditorService private readonly _editorService: IEditorService,
		@IFileService private readonly _fileService: IFileService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IMcpService private readonly _mcpService: IMcpService,
		@ILabelService private readonly _label: ILabelService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) { }

	private async getServerType(): Promise<AddConfigurationType | undefined> {
		type TItem = { kind: AddConfigurationType | 'browse' | 'discovery' } & IQuickPickItem;
		const items: QuickPickInput<TItem>[] = [
			{ kind: AddConfigurationType.Stdio, label: localize('mcp.serverType.command', "命令 (stdio)"), description: localize('mcp.serverType.command.description', "运行实现 MCP 协议的本地命令") },
			{ kind: AddConfigurationType.HTTP, label: localize('mcp.serverType.http', "HTTP (HTTP 或服务器发送事件)"), description: localize('mcp.serverType.http.description', "连接到实现 MCP 协议的远程 HTTP 服务器") }
		];

		let aiSupported: boolean | undefined;
		try {
			aiSupported = await this._commandService.executeCommand<boolean>(AddConfigurationCopilotCommand.IsSupported);
		} catch {
			// ignored
		}

		if (aiSupported) {
			items.unshift({ type: 'separator', label: localize('mcp.serverType.manual', "手动安装") });

			const elligableTypes = Object.entries(AssistedTypes).map(([type, { pickLabel, pickDescription, enabledConfigKey }]) => {
				if (enabledConfigKey) {
					const enabled = this._configurationService.getValue<boolean>(enabledConfigKey) ?? false;
					if (!enabled) {
						return;
					}
				}
				return {
					kind: Number(type) as AddConfigurationType,
					label: pickLabel,
					description: pickDescription,
				};
			}).filter(x => !!x);

			items.push(
				{ type: 'separator', label: localize('mcp.serverType.copilot', "模型辅助") },
				...elligableTypes
			);
		}

		items.push({ type: 'separator' });

		const discovery = this._configurationService.getValue<{ [K in DiscoverySource]: boolean }>(mcpDiscoverySection);
		if (discovery && typeof discovery === 'object' && allDiscoverySources.some(d => !discovery[d])) {
			items.push({
				kind: 'discovery',
				label: localize('mcp.servers.discovery', "从其他应用程序添加..."),
			});
		}

		items.push({
			kind: 'browse',
			label: localize('mcp.servers.browse', "浏览 MCP 服务器..."),
		});

		const result = await this._quickInputService.pick<TItem>(items, {
			placeHolder: localize('mcp.serverType.placeholder', "选择要添加的 MCP 服务器类型"),
		});

		if (result?.kind === 'browse') {
			this._commandService.executeCommand(McpCommandIds.Browse);
			return undefined;
		}

		if (result?.kind === 'discovery') {
			this._commandService.executeCommand('workbench.action.openSettings', mcpDiscoverySection);
			return undefined;
		}

		return result?.kind;
	}

	private async getStdioConfig(): Promise<IMcpStdioServerConfiguration | undefined> {
		const command = await this._quickInputService.input({
			title: localize('mcp.command.title', "输入命令"),
			placeHolder: localize('mcp.command.placeholder', "要运行的命令(可带参数)"),
			ignoreFocusLost: true,
		});

		if (!command) {
			return undefined;
		}

		this._telemetryService.publicLog2<AddServerData, AddServerClassification>('mcp.addserver', {
			packageType: 'stdio'
		});

		// Split command into command and args, handling quotes
		const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g)!;
		return {
			type: McpServerType.LOCAL,
			command: parts[0].replace(/"/g, ''),

			args: parts.slice(1).map(arg => arg.replace(/"/g, ''))
		};
	}

	private async getSSEConfig(): Promise<IMcpRemoteServerConfiguration | undefined> {
		const url = await this._quickInputService.input({
			title: localize('mcp.url.title', "输入服务器 URL"),
			placeHolder: localize('mcp.url.placeholder', "MCP 服务器的 URL (例如 http://localhost:3000)"),
			ignoreFocusLost: true,
		});

		if (!url) {
			return undefined;
		}

		this._telemetryService.publicLog2<AddServerData, AddServerClassification>('mcp.addserver', {
			packageType: 'sse'
		});

		return { url, type: McpServerType.REMOTE };
	}

	private async getServerId(suggestion = `my-mcp-server-${generateUuid().split('-')[0]}`): Promise<string | undefined> {
		const id = await this._quickInputService.input({
			title: localize('mcp.serverId.title', "输入服务器 ID"),
			placeHolder: localize('mcp.serverId.placeholder', "此服务器的唯一标识符"),
			value: suggestion,
			ignoreFocusLost: true,
		});

		return id;
	}

	private async getConfigurationTarget(): Promise<ConfigurationTarget | IWorkspaceFolder | undefined> {
		const options: (IQuickPickItem & { target?: ConfigurationTarget | IWorkspaceFolder })[] = [
			{ target: ConfigurationTarget.USER_LOCAL, label: localize('mcp.target.user', "全局"), description: localize('mcp.target.user.description', "在所有工作区中可用，本地运行") }
		];

		const raLabel = this._environmentService.remoteAuthority && this._label.getHostLabel(Schemas.vscodeRemote, this._environmentService.remoteAuthority);
		if (raLabel) {
			options.push({ target: ConfigurationTarget.USER_REMOTE, label: localize('mcp.target.remote', "远程"), description: localize('mcp.target..remote.description', "在此远程计算机上可用，在 {0} 上运行", raLabel) });
		}

		const workbenchState = this._workspaceService.getWorkbenchState();
		if (workbenchState !== WorkbenchState.EMPTY) {
			const target = workbenchState === WorkbenchState.FOLDER ? this._workspaceService.getWorkspace().folders[0] : ConfigurationTarget.WORKSPACE;
			if (this._environmentService.remoteAuthority) {
				options.push({ target, label: localize('mcp.target.workspace', "工作区"), description: localize('mcp.target.workspace.description.remote', "在此工作区中可用，在 {0} 上运行", raLabel) });
			} else {
				options.push({ target, label: localize('mcp.target.workspace', "工作区"), description: localize('mcp.target.workspace.description', "在此工作区中可用，本地运行") });
			}
		}

		if (options.length === 1) {
			return options[0].target;
		}

		const targetPick = await this._quickInputService.pick(options, {
			title: localize('mcp.target.title', "添加 MCP 服务器"),
			placeHolder: localize('mcp.target.placeholder', "选择配置目标")
		});

		return targetPick?.target;
	}

	private async getAssistedConfig(type: AssistedConfigurationType): Promise<{ name?: string; server: Omit<IMcpStdioServerConfiguration, 'type'>; inputs?: IMcpServerVariable[]; inputValues?: Record<string, string> } | undefined> {
		const packageName = await this._quickInputService.input({
			ignoreFocusLost: true,
			title: AssistedTypes[type].title,
			placeHolder: AssistedTypes[type].placeholder,
		});

		if (!packageName) {
			return undefined;
		}

		const enum LoadAction {
			Retry = 'retry',
			Cancel = 'cancel',
			Allow = 'allow',
			OpenUri = 'openUri',
		}

		const loadingQuickPickStore = new DisposableStore();
		const loadingQuickPick = loadingQuickPickStore.add(this._quickInputService.createQuickPick<IQuickPickItem & { id: LoadAction; helpUri?: URI }>());
		loadingQuickPick.title = localize('mcp.loading.title', "正在加载包详情...");
		loadingQuickPick.busy = true;
		loadingQuickPick.ignoreFocusOut = true;

		const packageType = this.getPackageType(type);

		this._telemetryService.publicLog2<AddServerData, AddServerClassification>('mcp.addserver', {
			packageType: packageType!
		});

		this._commandService.executeCommand<ValidatePackageResult>(
			AddConfigurationCopilotCommand.ValidatePackage,
			{
				type: packageType,
				name: packageName,
				targetConfig: {
					...mcpStdioServerSchema,
					properties: {
						...mcpStdioServerSchema.properties,
						name: {
							type: 'string',
							description: 'Suggested name of the server, alphanumeric and hyphen only',
						}
					},
					required: [...(mcpStdioServerSchema.required || []), 'name'],
				},
			}
		).then(result => {
			if (!result || result.state === 'error') {
				loadingQuickPick.title = result?.error || 'Unknown error loading package';

				const items: Array<IQuickPickItem & { id: LoadAction; helpUri?: URI }> = [];

				if (result?.helpUri) {
					items.push({
						id: LoadAction.OpenUri,
						label: result.helpUriLabel ?? localize('mcp.error.openHelpUri', '打开帮助链接'),
						helpUri: URI.parse(result.helpUri),
					});
				}

				items.push(
					{ id: LoadAction.Retry, label: localize('mcp.error.retry', '尝试其他包') },
					{ id: LoadAction.Cancel, label: localize('cancel', '取消') },
				);

				loadingQuickPick.items = items;
			} else {
				loadingQuickPick.title = localize(
					'mcp.confirmPublish', '从 {2} 安装 {0}{1}?',
					result.name ?? packageName,
					result.version ? `@${result.version}` : '',
					result.publisher);
				loadingQuickPick.items = [
					{ id: LoadAction.Allow, label: localize('allow', "允许") },
					{ id: LoadAction.Cancel, label: localize('cancel', '取消') }
				];
			}
			loadingQuickPick.busy = false;
		});

		const loadingAction = await new Promise<{ id: LoadAction; helpUri?: URI } | undefined>(resolve => {
			loadingQuickPick.onDidAccept(() => resolve(loadingQuickPick.selectedItems[0]));
			loadingQuickPick.onDidHide(() => resolve(undefined));
			loadingQuickPick.show();
		}).finally(() => loadingQuickPick.dispose());

		switch (loadingAction?.id) {
			case LoadAction.Retry:
				return this.getAssistedConfig(type);
			case LoadAction.OpenUri:
				if (loadingAction.helpUri) { this._openerService.open(loadingAction.helpUri); }
				return undefined;
			case LoadAction.Allow:
				break;
			case LoadAction.Cancel:
			default:
				return undefined;
		}

		const config = await this._commandService.executeCommand<AssistedServerConfiguration>(
			AddConfigurationCopilotCommand.StartFlow,
			{
				name: packageName,
				type: packageType
			}
		);

		if (config?.type === 'mapped') {
			return {
				name: config.name,
				server: config.server,
				inputs: config.inputs,
			};
		} else if (config?.type === 'assisted' || !config?.type) {
			return config;
		} else {
			assertNever(config?.type);
		}
	}

	/** Shows the location of a server config once it's discovered. */
	private showOnceDiscovered(name: string) {
		const store = new DisposableStore();
		store.add(autorun(reader => {
			const colls = this._mcpRegistry.collections.read(reader);
			const servers = this._mcpService.servers.read(reader);
			const match = mapFindFirst(colls, collection => mapFindFirst(collection.serverDefinitions.read(reader),
				server => server.label === name ? { server, collection } : undefined));
			const server = match && servers.find(s => s.definition.id === match.server.id);


			if (match && server) {
				if (match.collection.presentation?.origin) {
					this._editorService.openEditor({
						resource: match.collection.presentation.origin,
						options: {
							selection: match.server.presentation?.origin?.range,
							preserveFocus: true,
						}
					});
				} else {
					this._commandService.executeCommand(McpCommandIds.ServerOptions, name);
				}

				server.start({ promptType: 'all-untrusted' }).then(state => {
					if (state.state === McpConnectionState.Kind.Error) {
						server.showOutput();
					}
				});

				store.dispose();
			}
		}));

		store.add(disposableTimeout(() => store.dispose(), 5000));
	}

	public async run(): Promise<void> {
		// Step 1: Choose server type
		const serverType = await this.getServerType();
		if (serverType === undefined) {
			return;
		}

		// Step 2: Get server details based on type
		let config: IMcpServerConfiguration | undefined;
		let suggestedName: string | undefined;
		let inputs: IMcpServerVariable[] | undefined;
		let inputValues: Record<string, string> | undefined;
		switch (serverType) {
			case AddConfigurationType.Stdio:
				config = await this.getStdioConfig();
				break;
			case AddConfigurationType.HTTP:
				config = await this.getSSEConfig();
				break;
			case AddConfigurationType.NpmPackage:
			case AddConfigurationType.PipPackage:
			case AddConfigurationType.NuGetPackage:
			case AddConfigurationType.DockerImage: {
				const r = await this.getAssistedConfig(serverType);
				config = r?.server ? { ...r.server, type: McpServerType.LOCAL } : undefined;
				suggestedName = r?.name;
				inputs = r?.inputs;
				inputValues = r?.inputValues;
				break;
			}
			default:
				assertNever(serverType);
		}

		if (!config) {
			return;
		}

		// Step 3: Get server ID
		const name = await this.getServerId(suggestedName);
		if (!name) {
			return;
		}

		// Step 4: Choose configuration target if no configUri provided
		let target: ConfigurationTarget | IWorkspaceFolder | undefined = this.workspaceFolder;
		if (!target) {
			target = await this.getConfigurationTarget();
			if (!target) {
				return;
			}
		}

		await this._mcpManagementService.install({ name, config, inputs }, { target });

		if (inputValues) {
			for (const [key, value] of Object.entries(inputValues)) {
				await this._mcpRegistry.setSavedInput(key, (isWorkspaceFolder(target) ? ConfigurationTarget.WORKSPACE_FOLDER : target) ?? ConfigurationTarget.WORKSPACE, value);
			}
		}

		const packageType = this.getPackageType(serverType);
		if (packageType) {
			this._telemetryService.publicLog2<AddServerCompletedData, AddServerCompletedClassification>('mcp.addserver.completed', {
				packageType,
				serverType: config.type,
				target: target === ConfigurationTarget.WORKSPACE ? 'workspace' : 'user'
			});
		}

		this.showOnceDiscovered(name);
	}

	public async pickForUrlHandler(resource: URI, showIsPrimary = false): Promise<void> {
		const name = decodeURIComponent(basename(resource)).replace(/\.json$/, '');
		const placeHolder = localize('install.title', '安装 MCP 服务器 {0}', name);

		const items: IQuickPickItem[] = [
			{ id: 'install', label: localize('install.start', '安装服务器') },
			{ id: 'show', label: localize('install.show', '显示配置', name) },
			{ id: 'rename', label: localize('install.rename', '重命名 "{0}"', name) },
			{ id: 'cancel', label: localize('cancel', '取消') },
		];
		if (showIsPrimary) {
			[items[0], items[1]] = [items[1], items[0]];
		}

		const pick = await this._quickInputService.pick(items, { placeHolder, ignoreFocusLost: true });
		const getEditors = () => this._editorService.findEditors(resource);

		switch (pick?.id) {
			case 'show':
				await this._editorService.openEditor({ resource });
				break;
			case 'install':
				await this._editorService.save(getEditors());
				try {
					const contents = await this._fileService.readFile(resource);
					const { inputs, ...config }: IMcpServerConfiguration & { inputs?: IMcpServerVariable[] } = parseJsonc(contents.value.toString());
					await this._mcpManagementService.install({ name, config, inputs });
					this._editorService.closeEditors(getEditors());
					this.showOnceDiscovered(name);
				} catch (e) {
					this._notificationService.error(localize('install.error', '安装 MCP 服务器 {0} 时出错: {1}', name, e.message));
					await this._editorService.openEditor({ resource });
				}
				break;
			case 'rename': {
				const newName = await this._quickInputService.input({ placeHolder: localize('install.newName', '输入新名称'), value: name });
				if (newName) {
					const newURI = resource.with({ path: `/${encodeURIComponent(newName)}.json` });
					await this._editorService.save(getEditors());
					await this._fileService.move(resource, newURI);
					return this.pickForUrlHandler(newURI, showIsPrimary);
				}
				break;
			}
		}
	}

	private getPackageType(serverType: AddConfigurationType): string | undefined {
		switch (serverType) {
			case AddConfigurationType.NpmPackage:
				return 'npm';
			case AddConfigurationType.PipPackage:
				return 'pip';
			case AddConfigurationType.NuGetPackage:
				return 'nuget';
			case AddConfigurationType.DockerImage:
				return 'docker';
			case AddConfigurationType.Stdio:
				return 'stdio';
			case AddConfigurationType.HTTP:
				return 'sse';
			default:
				return undefined;
		}
	}
}
