/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sep } from '../../../../base/common/path.js';
import { raceCancellationError } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { combinedDisposable, Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { Schemas } from '../../../../base/common/network.js';
import * as resources from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, IMenuService, MenuId, MenuItemAction, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IRelaxedExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditableData } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IExtensionService, isProposedApiEnabled } from '../../../services/extensions/common/extensions.js';
import { ExtensionsRegistry } from '../../../services/extensions/common/extensionsRegistry.js';
import { ChatEditorInput } from '../browser/chatEditorInput.js';
import { IChatAgentAttachmentCapabilities, IChatAgentData, IChatAgentService } from '../common/chatAgents.js';
import { ChatContextKeys } from '../common/chatContextKeys.js';
import { ChatSessionStatus, IChatSession, IChatSessionContentProvider, IChatSessionItem, IChatSessionItemProvider, IChatSessionProviderOptionGroup, IChatSessionProviderOptionItem, IChatSessionsExtensionPoint, IChatSessionsService, localChatSessionType, SessionOptionsChangedCallback } from '../common/chatSessionsService.js';
import { LEGACY_AGENT_SESSIONS_VIEW_ID, ChatAgentLocation, ChatModeKind } from '../common/constants.js';
import { CHAT_CATEGORY } from './actions/chatActions.js';
import { IChatEditorOptions } from './chatEditor.js';
import { NEW_CHAT_SESSION_ACTION_ID } from './chatSessions/common.js';
import { IChatModel } from '../common/chatModel.js';
import { IChatService, IChatToolInvocation } from '../common/chatService.js';
import { autorun, autorunIterableDelta, observableSignalFromEvent } from '../../../../base/common/observable.js';
import { IChatRequestVariableEntry } from '../common/chatVariableEntries.js';
import { renderAsPlaintext } from '../../../../base/browser/markdownRenderer.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewId } from './chat.js';
import { ChatViewPane } from './chatViewPane.js';

const extensionPoint = ExtensionsRegistry.registerExtensionPoint<IChatSessionsExtensionPoint[]>({
	extensionPoint: 'chatSessions',
	jsonSchema: {
		description: localize('chatSessionsExtPoint', '为聊天小部件贡献聊天会话集成。'),
		type: 'array',
		items: {
			type: 'object',
			additionalProperties: false,
			properties: {
				type: {
					description: localize('chatSessionsExtPoint.chatSessionType', '聊天会话类型的唯一标识符。'),
					type: 'string',
				},
				name: {
					description: localize('chatSessionsExtPoint.name', '动态注册的聊天参与者名称(例如: @agent)。不能包含空格。'),
					type: 'string',
					pattern: '^[\\w-]+$'
				},
				displayName: {
					description: localize('chatSessionsExtPoint.displayName', '此项目的较长名称，用于在菜单中显示。'),
					type: 'string',
				},
				description: {
					description: localize('chatSessionsExtPoint.description', '聊天会话的描述，用于菜单和工具提示。'),
					type: 'string'
				},
				when: {
					description: localize('chatSessionsExtPoint.when', '显示此项目必须为真的条件。'),
					type: 'string'
				},
				icon: {
					description: localize('chatSessionsExtPoint.icon', '聊天会话编辑器选项卡的图标标识符(codicon ID)。例如 "$(github)" 或 "$(cloud)"。'),
					anyOf: [{
						type: 'string'
					},
					{
						type: 'object',
						properties: {
							light: {
								description: localize('icon.light', '浅色主题使用的图标路径'),
								type: 'string'
							},
							dark: {
								description: localize('icon.dark', '深色主题使用的图标路径'),
								type: 'string'
							}
						}
					}]
				},
				order: {
					description: localize('chatSessionsExtPoint.order', '此项目应显示的顺序。'),
					type: 'integer'
				},
				alternativeIds: {
					description: localize('chatSessionsExtPoint.alternativeIds', '用于向后兼容的替代标识符。'),
					type: 'array',
					items: {
						type: 'string'
					}
				},
				welcomeTitle: {
					description: localize('chatSessionsExtPoint.welcomeTitle', '此会话类型在聊天欢迎视图中显示的标题文本。'),
					type: 'string'
				},
				welcomeMessage: {
					description: localize('chatSessionsExtPoint.welcomeMessage', '此会话类型在聊天欢迎视图中显示的消息文本(支持 markdown)。'),
					type: 'string'
				},
				welcomeTips: {
					description: localize('chatSessionsExtPoint.welcomeTips', '此会话类型在聊天欢迎视图中显示的提示文本(支持 markdown 和主题图标)。'),
					type: 'string'
				},
				inputPlaceholder: {
					description: localize('chatSessionsExtPoint.inputPlaceholder', '此会话类型在聊天输入框中显示的占位符文本。'),
					type: 'string'
				},
				capabilities: {
					description: localize('chatSessionsExtPoint.capabilities', '此聊天会话的可选功能。'),
					type: 'object',
					additionalProperties: false,
					properties: {
						supportsFileAttachments: {
							description: localize('chatSessionsExtPoint.supportsFileAttachments', '此聊天会话是否支持附加文件或文件引用。'),
							type: 'boolean'
						},
						supportsToolAttachments: {
							description: localize('chatSessionsExtPoint.supportsToolAttachments', '此聊天会话是否支持附加工具或工具引用。'),
							type: 'boolean'
						},
						supportsMCPAttachments: {
							description: localize('chatSessionsExtPoint.supportsMCPAttachments', '此聊天会话是否支持附加 MCP 资源。'),
							type: 'boolean'
						},
						supportsImageAttachments: {
							description: localize('chatSessionsExtPoint.supportsImageAttachments', '此聊天会话是否支持附加图片。'),
							type: 'boolean'
						},
						supportsSearchResultAttachments: {
							description: localize('chatSessionsExtPoint.supportsSearchResultAttachments', '此聊天会话是否支持附加搜索结果。'),
							type: 'boolean'
						},
						supportsInstructionAttachments: {
							description: localize('chatSessionsExtPoint.supportsInstructionAttachments', '此聊天会话是否支持附加指令。'),
							type: 'boolean'
						},
						supportsSourceControlAttachments: {
							description: localize('chatSessionsExtPoint.supportsSourceControlAttachments', '此聊天会话是否支持附加源代码管理更改。'),
							type: 'boolean'
						},
						supportsProblemAttachments: {
							description: localize('chatSessionsExtPoint.supportsProblemAttachments', '此聊天会话是否支持附加问题。'),
							type: 'boolean'
						},
						supportsSymbolAttachments: {
							description: localize('chatSessionsExtPoint.supportsSymbolAttachments', '此聊天会话是否支持附加符号。'),
							type: 'boolean'
						}
					}
				},
				commands: {
					markdownDescription: localize('chatCommandsDescription', "此聊天会话可用的命令，用户可以使用 `/` 调用。"),
					type: 'array',
					items: {
						additionalProperties: false,
						type: 'object',
						defaultSnippets: [{ body: { name: '', description: '' } }],
						required: ['name'],
						properties: {
							name: {
								description: localize('chatCommand', "此命令在 UI 中引用的简短名称，例如 `fix` 或 `explain` 用于修复问题或解释代码的命令。该名称在此参与者提供的命令中应该是唯一的。"),
								type: 'string'
							},
							description: {
								description: localize('chatCommandDescription', "此命令的描述。"),
								type: 'string'
							},
							when: {
								description: localize('chatCommandWhen', "启用此命令必须为真的条件。"),
								type: 'string'
							},
						}
					}
				},
				canDelegate: {
					description: localize('chatSessionsExtPoint.canDelegate', '是否支持委托。默认为 false。请注意，启用此功能是实验性的，可能不会始终被遵守。'),
					type: 'boolean',
					default: false
				}
			},
			required: ['type', 'name', 'displayName', 'description'],
		}
	},
	activationEventsGenerator: function* (contribs) {
		for (const contrib of contribs) {
			yield `onChatSession:${contrib.type}`;
		}
	}
});

class ContributedChatSessionData extends Disposable {

	private readonly _optionsCache: Map<string /* 'models' */, string | IChatSessionProviderOptionItem>;
	public getOption(optionId: string): string | IChatSessionProviderOptionItem | undefined {
		return this._optionsCache.get(optionId);
	}
	public setOption(optionId: string, value: string | IChatSessionProviderOptionItem): void {
		this._optionsCache.set(optionId, value);
	}

	constructor(
		readonly session: IChatSession,
		readonly chatSessionType: string,
		readonly resource: URI,
		readonly options: Record<string, string | IChatSessionProviderOptionItem> | undefined,
		private readonly onWillDispose: (resource: URI) => void
	) {
		super();

		this._optionsCache = new Map<string, string | IChatSessionProviderOptionItem>();
		if (options) {
			for (const [key, value] of Object.entries(options)) {
				this._optionsCache.set(key, value);
			}
		}

		this._register(this.session.onWillDispose(() => {
			this.onWillDispose(this.resource);
		}));
	}
}


export class ChatSessionsService extends Disposable implements IChatSessionsService {
	readonly _serviceBrand: undefined;

	private readonly _itemsProviders: Map</* type */ string, IChatSessionItemProvider> = new Map();

	private readonly _contributions: Map</* type */ string, { readonly contribution: IChatSessionsExtensionPoint; readonly extension: IRelaxedExtensionDescription }> = new Map();
	private readonly _contributionDisposables = this._register(new DisposableMap</* type */ string>());

	private readonly _contentProviders: Map</* scheme */ string, IChatSessionContentProvider> = new Map();
	private readonly _alternativeIdMap: Map</* alternativeId */ string, /* primaryType */ string> = new Map();
	private readonly _contextKeys = new Set<string>();

	private readonly _onDidChangeItemsProviders = this._register(new Emitter<IChatSessionItemProvider>());
	readonly onDidChangeItemsProviders: Event<IChatSessionItemProvider> = this._onDidChangeItemsProviders.event;

	private readonly _onDidChangeSessionItems = this._register(new Emitter<string>());
	readonly onDidChangeSessionItems: Event<string> = this._onDidChangeSessionItems.event;

	private readonly _onDidChangeAvailability = this._register(new Emitter<void>());
	readonly onDidChangeAvailability: Event<void> = this._onDidChangeAvailability.event;

	private readonly _onDidChangeInProgress = this._register(new Emitter<void>());
	public get onDidChangeInProgress() { return this._onDidChangeInProgress.event; }

	private readonly _onDidChangeContentProviderSchemes = this._register(new Emitter<{ readonly added: string[]; readonly removed: string[] }>());
	public get onDidChangeContentProviderSchemes() { return this._onDidChangeContentProviderSchemes.event; }
	private readonly _onDidChangeSessionOptions = this._register(new Emitter<URI>());
	public get onDidChangeSessionOptions() { return this._onDidChangeSessionOptions.event; }
	private readonly _onDidChangeOptionGroups = this._register(new Emitter<string>());
	public get onDidChangeOptionGroups() { return this._onDidChangeOptionGroups.event; }

	private readonly inProgressMap: Map<string, number> = new Map();
	private readonly _sessionTypeOptions: Map<string, IChatSessionProviderOptionGroup[]> = new Map();
	private readonly _sessionTypeIcons: Map<string, ThemeIcon | { light: URI; dark: URI }> = new Map();
	private readonly _sessionTypeWelcomeTitles: Map<string, string> = new Map();
	private readonly _sessionTypeWelcomeMessages: Map<string, string> = new Map();
	private readonly _sessionTypeWelcomeTips: Map<string, string> = new Map();
	private readonly _sessionTypeInputPlaceholders: Map<string, string> = new Map();

	private readonly _sessions = new ResourceMap<ContributedChatSessionData>();
	private readonly _editableSessions = new ResourceMap<IEditableData>();

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IMenuService private readonly _menuService: IMenuService,
		@IThemeService private readonly _themeService: IThemeService,
		@ILabelService private readonly _labelService: ILabelService
	) {
		super();

		this._register(extensionPoint.setHandler(extensions => {
			for (const ext of extensions) {
				if (!isProposedApiEnabled(ext.description, 'chatSessionsProvider')) {
					continue;
				}
				if (!Array.isArray(ext.value)) {
					continue;
				}
				for (const contribution of ext.value) {
					this._register(this.registerContribution(contribution, ext.description));
				}
			}
		}));

		// Listen for context changes and re-evaluate contributions
		this._register(Event.filter(this._contextKeyService.onDidChangeContext, e => e.affectsSome(this._contextKeys))(() => {
			this._evaluateAvailability();
		}));

		this._register(this.onDidChangeSessionItems(chatSessionType => {
			this.updateInProgressStatus(chatSessionType).catch(error => {
				this._logService.warn(`Failed to update progress status for '${chatSessionType}':`, error);
			});
		}));

		this._register(this._labelService.registerFormatter({
			scheme: Schemas.copilotPr,
			formatting: {
				label: '${authority}${path}',
				separator: sep,
				stripPathStartingSeparator: true,
			}
		}));
	}

	public reportInProgress(chatSessionType: string, count: number): void {
		let displayName: string | undefined;

		if (chatSessionType === localChatSessionType) {
			displayName = 'Local Chat Agent';
		} else {
			displayName = this._contributions.get(chatSessionType)?.contribution.displayName;
		}

		if (displayName) {
			this.inProgressMap.set(displayName, count);
		}
		this._onDidChangeInProgress.fire();
	}

	public getInProgress(): { displayName: string; count: number }[] {
		return Array.from(this.inProgressMap.entries()).map(([displayName, count]) => ({ displayName, count }));
	}

	private async updateInProgressStatus(chatSessionType: string): Promise<void> {
		try {
			const items = await this.getChatSessionItems(chatSessionType, CancellationToken.None);
			const inProgress = items.filter(item => item.status && this.isChatSessionInProgressStatus(item.status));
			this.reportInProgress(chatSessionType, inProgress.length);
		} catch (error) {
			this._logService.warn(`Failed to update in-progress status for chat session type '${chatSessionType}':`, error);
		}
	}

	private registerContribution(contribution: IChatSessionsExtensionPoint, ext: IRelaxedExtensionDescription): IDisposable {
		if (this._contributions.has(contribution.type)) {
			return { dispose: () => { } };
		}

		// Track context keys from the when condition
		if (contribution.when) {
			const whenExpr = ContextKeyExpr.deserialize(contribution.when);
			if (whenExpr) {
				for (const key of whenExpr.keys()) {
					this._contextKeys.add(key);
				}
			}
		}

		this._contributions.set(contribution.type, { contribution, extension: ext });

		// Register alternative IDs if provided
		if (contribution.alternativeIds) {
			for (const altId of contribution.alternativeIds) {
				if (this._alternativeIdMap.has(altId)) {
					this._logService.warn(`Alternative ID '${altId}' is already mapped to '${this._alternativeIdMap.get(altId)}'. Remapping to '${contribution.type}'.`);
				}
				this._alternativeIdMap.set(altId, contribution.type);
			}
		}

		// Store icon mapping if provided
		let icon: ThemeIcon | { dark: URI; light: URI } | undefined;

		if (contribution.icon) {
			// Parse icon string - support ThemeIcon format or file path from extension
			if (typeof contribution.icon === 'string') {
				icon = contribution.icon.startsWith('$(') && contribution.icon.endsWith(')')
					? ThemeIcon.fromString(contribution.icon)
					: ThemeIcon.fromId(contribution.icon);
			} else {
				icon = {
					dark: resources.joinPath(ext.extensionLocation, contribution.icon.dark),
					light: resources.joinPath(ext.extensionLocation, contribution.icon.light)
				};
			}
		}

		if (icon) {
			this._sessionTypeIcons.set(contribution.type, icon);
		}

		// Store welcome title, message, tips, and input placeholder if provided
		if (contribution.welcomeTitle) {
			this._sessionTypeWelcomeTitles.set(contribution.type, contribution.welcomeTitle);
		}
		if (contribution.welcomeMessage) {
			this._sessionTypeWelcomeMessages.set(contribution.type, contribution.welcomeMessage);
		}
		if (contribution.welcomeTips) {
			this._sessionTypeWelcomeTips.set(contribution.type, contribution.welcomeTips);
		}
		if (contribution.inputPlaceholder) {
			this._sessionTypeInputPlaceholders.set(contribution.type, contribution.inputPlaceholder);
		}

		this._evaluateAvailability();

		return {
			dispose: () => {
				this._contributions.delete(contribution.type);
				// Remove alternative ID mappings
				if (contribution.alternativeIds) {
					for (const altId of contribution.alternativeIds) {
						if (this._alternativeIdMap.get(altId) === contribution.type) {
							this._alternativeIdMap.delete(altId);
						}
					}
				}
				this._sessionTypeIcons.delete(contribution.type);
				this._sessionTypeWelcomeTitles.delete(contribution.type);
				this._sessionTypeWelcomeMessages.delete(contribution.type);
				this._sessionTypeWelcomeTips.delete(contribution.type);
				this._sessionTypeInputPlaceholders.delete(contribution.type);
				this._contributionDisposables.deleteAndDispose(contribution.type);
			}
		};
	}

	private _isContributionAvailable(contribution: IChatSessionsExtensionPoint): boolean {
		if (!contribution.when) {
			return true;
		}
		const whenExpr = ContextKeyExpr.deserialize(contribution.when);
		return !whenExpr || this._contextKeyService.contextMatchesRules(whenExpr);
	}

	/**
	 * Resolves a session type to its primary type, checking for alternative IDs.
	 * @param sessionType The session type or alternative ID to resolve
	 * @returns The primary session type, or undefined if not found or not available
	 */
	private _resolveToPrimaryType(sessionType: string): string | undefined {
		// Try to find the primary type first
		const contribution = this._contributions.get(sessionType)?.contribution;
		if (contribution) {
			// If the contribution is available, use it
			if (this._isContributionAvailable(contribution)) {
				return sessionType;
			}
			// If not available, fall through to check for alternatives
		}

		// Check if this is an alternative ID, or if the primary type is not available
		const primaryType = this._alternativeIdMap.get(sessionType);
		if (primaryType) {
			const altContribution = this._contributions.get(primaryType)?.contribution;
			if (altContribution && this._isContributionAvailable(altContribution)) {
				this._logService.trace(`Resolving chat session type '${sessionType}' to alternative type '${primaryType}'`);
				return primaryType;
			}
		}

		return undefined;
	}

	private _registerMenuItems(contribution: IChatSessionsExtensionPoint, extensionDescription: IRelaxedExtensionDescription): IDisposable {
		// If provider registers anything for the create submenu, let it fully control the creation
		const contextKeyService = this._contextKeyService.createOverlay([
			['chatSessionType', contribution.type]
		]);

		const rawMenuActions = this._menuService.getMenuActions(MenuId.AgentSessionsCreateSubMenu, contextKeyService);
		const menuActions = rawMenuActions.map(value => value[1]).flat();

		const whenClause = ContextKeyExpr.and(
			ContextKeyExpr.equals('view', `${LEGACY_AGENT_SESSIONS_VIEW_ID}.${contribution.type}`)
		);

		const disposables = new DisposableStore();

		// If there's exactly one action, inline it
		if (menuActions.length === 1) {
			const first = menuActions[0];
			if (first instanceof MenuItemAction) {
				disposables.add(MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
					group: 'navigation',
					title: first.label,
					icon: Codicon.plus,
					order: 1,
					when: whenClause,
					command: first.item,
				}));
			}
		}

		if (menuActions.length) {
			disposables.add(MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
				group: 'navigation',
				title: localize('interactiveSession.chatSessionSubMenuTitle', "创建聊天会话"),
				icon: Codicon.plus,
				order: 1,
				when: whenClause,
				submenu: MenuId.AgentSessionsCreateSubMenu,
				isSplitButton: menuActions.length > 1
			}));
		} else {
			// We control creation instead
			disposables.add(MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
				command: {
					id: `${NEW_CHAT_SESSION_ACTION_ID}.${contribution.type}`,
					title: localize('interactiveSession.openNewSessionEditor', "新建 {0}", contribution.displayName),
					icon: Codicon.plus,
					source: {
						id: extensionDescription.identifier.value,
						title: extensionDescription.displayName || extensionDescription.name,
					}
				},
				group: 'navigation',
				order: 1,
				when: whenClause,
			}));
		}

		// Also mirror all create submenu actions into the global Chat New menu
		for (const action of menuActions) {
			if (action instanceof MenuItemAction) {
				disposables.add(MenuRegistry.appendMenuItem(MenuId.ChatNewMenu, {
					command: action.item,
					group: '4_externally_contributed',
				}));
			}
		}
		return {
			dispose: () => disposables.dispose()
		};
	}

	private _registerCommands(contribution: IChatSessionsExtensionPoint): IDisposable {
		return combinedDisposable(
			registerAction2(class OpenChatSessionAction extends Action2 {
				constructor() {
					super({
						id: `workbench.action.chat.openSessionWithPrompt.${contribution.type}`,
						title: localize2('interactiveSession.openSessionWithPrompt', "New {0} with Prompt", contribution.displayName),
						category: CHAT_CATEGORY,
						icon: Codicon.plus,
						f1: false,
						precondition: ChatContextKeys.enabled
					});
				}

				async run(accessor: ServicesAccessor, chatOptions?: { resource: UriComponents; prompt: string; attachedContext?: IChatRequestVariableEntry[] }): Promise<void> {
					const chatService = accessor.get(IChatService);
					const { type } = contribution;

					if (chatOptions) {
						const resource = URI.revive(chatOptions.resource);
						const ref = await chatService.loadSessionForResource(resource, ChatAgentLocation.Chat, CancellationToken.None);
						await chatService.sendRequest(resource, chatOptions.prompt, { agentIdSilent: type, attachedContext: chatOptions.attachedContext });
						ref?.dispose();
					}
				}
			}),
			// Creates a chat editor
			registerAction2(class OpenNewChatSessionEditorAction extends Action2 {
				constructor() {
					super({
						id: `workbench.action.chat.openNewSessionEditor.${contribution.type}`,
						title: localize2('interactiveSession.openNewSessionEditor', "New {0}", contribution.displayName),
						category: CHAT_CATEGORY,
						icon: Codicon.plus,
						f1: true,
						precondition: ChatContextKeys.enabled,
					});
				}

				async run(accessor: ServicesAccessor, chatOptions?: { prompt: string; attachedContext?: IChatRequestVariableEntry[] }): Promise<void> {
					const editorService = accessor.get(IEditorService);
					const logService = accessor.get(ILogService);
					const chatService = accessor.get(IChatService);
					const { type } = contribution;

					try {
						const options: IChatEditorOptions = {
							override: ChatEditorInput.EditorID,
							pinned: true,
							title: {
								fallback: localize('chatEditorContributionName', "{0}", contribution.displayName),
							}
						};
						const resource = URI.from({
							scheme: type,
							path: `/untitled-${generateUuid()}`,
						});
						await editorService.openEditor({ resource, options });
						if (chatOptions?.prompt) {
							await chatService.sendRequest(resource, chatOptions.prompt, { agentIdSilent: type, attachedContext: chatOptions.attachedContext });
						}
					} catch (e) {
						logService.error(`Failed to open new '${type}' chat session editor`, e);
					}
				}
			}),
			// New chat in sidebar chat (+ button)
			registerAction2(class OpenNewChatSessionSidebarAction extends Action2 {
				constructor() {
					super({
						id: `workbench.action.chat.openNewSessionSidebar.${contribution.type}`,
						title: localize2('interactiveSession.openNewSessionSidebar', "New {0}", contribution.displayName),
						category: CHAT_CATEGORY,
						icon: Codicon.plus,
						f1: false, // Hide from Command Palette
						precondition: ChatContextKeys.enabled,
						menu: {
							id: MenuId.ChatNewMenu,
							group: '3_new_special',
						}
					});
				}

				async run(accessor: ServicesAccessor, chatOptions?: { prompt: string; attachedContext?: IChatRequestVariableEntry[] }): Promise<void> {
					const viewsService = accessor.get(IViewsService);
					const logService = accessor.get(ILogService);
					const chatService = accessor.get(IChatService);
					const { type } = contribution;

					try {
						const resource = URI.from({
							scheme: type,
							path: `/untitled-${generateUuid()}`,
						});

						const view = await viewsService.openView(ChatViewId) as ChatViewPane;
						await view.loadSession(resource);
						if (chatOptions?.prompt) {
							await chatService.sendRequest(resource, chatOptions.prompt, { agentIdSilent: type, attachedContext: chatOptions.attachedContext });
						}
						view.focus();
					} catch (e) {
						logService.error(`Failed to open new '${type}' chat session in sidebar`, e);
					}
				}
			})
		);
	}

	private _evaluateAvailability(): void {
		let hasChanges = false;
		for (const { contribution, extension } of this._contributions.values()) {
			const isCurrentlyRegistered = this._contributionDisposables.has(contribution.type);
			const shouldBeRegistered = this._isContributionAvailable(contribution);
			if (isCurrentlyRegistered && !shouldBeRegistered) {
				// Disable the contribution by disposing its disposable store
				this._contributionDisposables.deleteAndDispose(contribution.type);

				// Also dispose any cached sessions for this contribution
				this._disposeSessionsForContribution(contribution.type);
				hasChanges = true;
			} else if (!isCurrentlyRegistered && shouldBeRegistered) {
				// Enable the contribution by registering it
				this._enableContribution(contribution, extension);
				hasChanges = true;
			}
		}
		if (hasChanges) {
			this._onDidChangeAvailability.fire();
			for (const provider of this._itemsProviders.values()) {
				this._onDidChangeItemsProviders.fire(provider);
			}
			for (const { contribution } of this._contributions.values()) {
				this._onDidChangeSessionItems.fire(contribution.type);
			}
		}
	}

	private _enableContribution(contribution: IChatSessionsExtensionPoint, ext: IRelaxedExtensionDescription): void {
		const disposableStore = new DisposableStore();
		this._contributionDisposables.set(contribution.type, disposableStore);
		if (contribution.canDelegate) {
			disposableStore.add(this._registerAgent(contribution, ext));
			disposableStore.add(this._registerCommands(contribution));
		}
		disposableStore.add(this._registerMenuItems(contribution, ext));
	}

	private _disposeSessionsForContribution(contributionId: string): void {
		// Find and dispose all sessions that belong to this contribution
		const sessionsToDispose: URI[] = [];
		for (const [sessionResource, sessionData] of this._sessions) {
			if (sessionData.chatSessionType === contributionId) {
				sessionsToDispose.push(sessionResource);
			}
		}

		if (sessionsToDispose.length > 0) {
			this._logService.info(`Disposing ${sessionsToDispose.length} cached sessions for contribution '${contributionId}' due to when clause change`);
		}

		for (const sessionKey of sessionsToDispose) {
			const sessionData = this._sessions.get(sessionKey);
			if (sessionData) {
				sessionData.dispose(); // This will call _onWillDisposeSession and clean up
			}
		}
	}

	private _registerAgent(contribution: IChatSessionsExtensionPoint, ext: IRelaxedExtensionDescription): IDisposable {
		const { type: id, name, displayName, description } = contribution;
		const storedIcon = this._sessionTypeIcons.get(id);
		const icons = ThemeIcon.isThemeIcon(storedIcon)
			? { themeIcon: storedIcon, icon: undefined, iconDark: undefined }
			: storedIcon
				? { icon: storedIcon.light, iconDark: storedIcon.dark }
				: { themeIcon: Codicon.sendToRemoteAgent };

		const agentData: IChatAgentData = {
			id,
			name,
			fullName: displayName,
			description: description,
			isDefault: false,
			isCore: false,
			isDynamic: true,
			slashCommands: contribution.commands ?? [],
			locations: [ChatAgentLocation.Chat],
			modes: [ChatModeKind.Agent, ChatModeKind.Ask],
			disambiguation: [],
			metadata: {
				...icons,
			},
			capabilities: contribution.capabilities,
			canAccessPreviousChatHistory: true,
			extensionId: ext.identifier,
			extensionVersion: ext.version,
			extensionDisplayName: ext.displayName || ext.name,
			extensionPublisherId: ext.publisher,
		};

		return this._chatAgentService.registerAgent(id, agentData);
	}

	getAllChatSessionContributions(): IChatSessionsExtensionPoint[] {
		return Array.from(this._contributions.values(), x => x.contribution)
			.filter(contribution => this._isContributionAvailable(contribution));
	}

	getChatSessionContribution(chatSessionType: string): IChatSessionsExtensionPoint | undefined {
		const contribution = this._contributions.get(chatSessionType)?.contribution;
		if (!contribution) {
			return undefined;
		}

		return this._isContributionAvailable(contribution) ? contribution : undefined;
	}

	getAllChatSessionItemProviders(): IChatSessionItemProvider[] {
		return [...this._itemsProviders.values()].filter(provider => {
			// Check if the provider's corresponding contribution is available
			const contribution = this._contributions.get(provider.chatSessionType)?.contribution;
			return !contribution || this._isContributionAvailable(contribution);
		});
	}

	async activateChatSessionItemProvider(chatViewType: string): Promise<IChatSessionItemProvider | undefined> {
		await this._extensionService.whenInstalledExtensionsRegistered();
		const resolvedType = this._resolveToPrimaryType(chatViewType);
		if (resolvedType) {
			chatViewType = resolvedType;
		}

		const contribution = this._contributions.get(chatViewType)?.contribution;
		if (contribution && !this._isContributionAvailable(contribution)) {
			return undefined;
		}

		if (this._itemsProviders.has(chatViewType)) {
			return this._itemsProviders.get(chatViewType);
		}

		await this._extensionService.activateByEvent(`onChatSession:${chatViewType}`);

		return this._itemsProviders.get(chatViewType);
	}

	async canResolveChatSession(chatSessionResource: URI) {
		await this._extensionService.whenInstalledExtensionsRegistered();
		const resolvedType = this._resolveToPrimaryType(chatSessionResource.scheme) || chatSessionResource.scheme;
		const contribution = this._contributions.get(resolvedType)?.contribution;
		if (contribution && !this._isContributionAvailable(contribution)) {
			return false;
		}

		if (this._contentProviders.has(chatSessionResource.scheme)) {
			return true;
		}

		await this._extensionService.activateByEvent(`onChatSession:${chatSessionResource.scheme}`);
		return this._contentProviders.has(chatSessionResource.scheme);
	}

	async getAllChatSessionItems(token: CancellationToken): Promise<Array<{ readonly chatSessionType: string; readonly items: IChatSessionItem[] }>> {
		return Promise.all(Array.from(this.getAllChatSessionContributions(), async contrib => {
			return {
				chatSessionType: contrib.type,
				items: await this.getChatSessionItems(contrib.type, token)
			};
		}));
	}

	private async getChatSessionItems(chatSessionType: string, token: CancellationToken): Promise<IChatSessionItem[]> {
		if (!(await this.activateChatSessionItemProvider(chatSessionType))) {
			return [];
		}

		const resolvedType = this._resolveToPrimaryType(chatSessionType);
		if (resolvedType) {
			chatSessionType = resolvedType;
		}

		const provider = this._itemsProviders.get(chatSessionType);
		if (provider?.provideChatSessionItems) {
			const sessions = await provider.provideChatSessionItems(token);
			return sessions;
		}

		return [];
	}

	public registerChatSessionItemProvider(provider: IChatSessionItemProvider): IDisposable {
		const chatSessionType = provider.chatSessionType;
		this._itemsProviders.set(chatSessionType, provider);
		this._onDidChangeItemsProviders.fire(provider);

		const disposables = new DisposableStore();
		disposables.add(provider.onDidChangeChatSessionItems(() => {
			this._onDidChangeSessionItems.fire(chatSessionType);
		}));

		this.updateInProgressStatus(chatSessionType).catch(error => {
			this._logService.warn(`Failed to update initial progress status for '${chatSessionType}':`, error);
		});

		return {
			dispose: () => {
				disposables.dispose();

				const provider = this._itemsProviders.get(chatSessionType);
				if (provider) {
					this._itemsProviders.delete(chatSessionType);
					this._onDidChangeItemsProviders.fire(provider);
				}
			}
		};
	}

	registerChatSessionContentProvider(chatSessionType: string, provider: IChatSessionContentProvider): IDisposable {
		if (this._contentProviders.has(chatSessionType)) {
			throw new Error(`Content provider for ${chatSessionType} is already registered.`);
		}

		this._contentProviders.set(chatSessionType, provider);
		this._onDidChangeContentProviderSchemes.fire({ added: [chatSessionType], removed: [] });

		return {
			dispose: () => {
				this._contentProviders.delete(chatSessionType);

				this._onDidChangeContentProviderSchemes.fire({ added: [], removed: [chatSessionType] });

				// Remove all sessions that were created by this provider
				for (const [key, session] of this._sessions) {
					if (session.chatSessionType === chatSessionType) {
						session.dispose();
						this._sessions.delete(key);
					}
				}
			}
		};
	}

	public registerChatModelChangeListeners(
		chatService: IChatService,
		chatSessionType: string,
		onChange: () => void
	): IDisposable {
		const disposableStore = new DisposableStore();
		const chatModelsICareAbout = chatService.chatModels.map(models =>
			Array.from(models).filter((model: IChatModel) => model.sessionResource.scheme === chatSessionType)
		);

		const listeners = new ResourceMap<IDisposable>();
		const autoRunDisposable = autorunIterableDelta(
			reader => chatModelsICareAbout.read(reader),
			({ addedValues, removedValues }) => {
				removedValues.forEach((removed) => {
					const listener = listeners.get(removed.sessionResource);
					if (listener) {
						listeners.delete(removed.sessionResource);
						listener.dispose();
					}
				});
				addedValues.forEach((added) => {
					const requestChangeListener = added.lastRequestObs.map(last => last?.response && observableSignalFromEvent('chatSessions.modelRequestChangeListener', last.response.onDidChange));
					const modelChangeListener = observableSignalFromEvent('chatSessions.modelChangeListener', added.onDidChange);
					listeners.set(added.sessionResource, autorun(reader => {
						requestChangeListener.read(reader)?.read(reader);
						modelChangeListener.read(reader);
						onChange();
					}));
				});
			}
		);
		disposableStore.add(toDisposable(() => {
			for (const listener of listeners.values()) { listener.dispose(); }
		}));
		disposableStore.add(autoRunDisposable);
		return disposableStore;
	}


	public getInProgressSessionDescription(chatModel: IChatModel): string | undefined {
		const requests = chatModel.getRequests();
		if (requests.length === 0) {
			return undefined;
		}

		// Get the last request to check its response status
		const lastRequest = requests.at(-1);
		const response = lastRequest?.response;
		if (!response) {
			return undefined;
		}

		// If the response is complete, show Finished
		if (response.isComplete) {
			return undefined;
		}

		// Get the response parts to find tool invocations and progress messages
		const responseParts = response.response.value;
		let description: string | IMarkdownString | undefined = '';

		for (let i = responseParts.length - 1; i >= 0; i--) {
			const part = responseParts[i];
			if (description) {
				break;
			}

			if (part.kind === 'confirmation' && typeof part.message === 'string') {
				description = part.message;
			} else if (part.kind === 'toolInvocation') {
				const toolInvocation = part as IChatToolInvocation;
				const state = toolInvocation.state.get();
				description = toolInvocation.generatedTitle || toolInvocation.pastTenseMessage || toolInvocation.invocationMessage;
				if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation) {
					const confirmationTitle = toolInvocation.confirmationMessages?.title;
					const titleMessage = confirmationTitle && (typeof confirmationTitle === 'string'
						? confirmationTitle
						: confirmationTitle.value);
					const descriptionValue = typeof description === 'string' ? description : description.value;
					description = titleMessage ?? localize('chat.sessions.description.waitingForConfirmation', "等待确认: {0}", descriptionValue);
				}
			} else if (part.kind === 'toolInvocationSerialized') {
				description = part.invocationMessage;
			} else if (part.kind === 'progressMessage') {
				description = part.content;
			} else if (part.kind === 'thinking') {
				description = localize('chat.sessions.description.thinking', '思考中...');
			}
		}

		return renderAsPlaintext(description, { useLinkFormatter: true });
	}

	public async getOrCreateChatSession(sessionResource: URI, token: CancellationToken): Promise<IChatSession> {
		const existingSessionData = this._sessions.get(sessionResource);
		if (existingSessionData) {
			return existingSessionData.session;
		}

		if (!(await raceCancellationError(this.canResolveChatSession(sessionResource), token))) {
			throw Error(`Can not find provider for ${sessionResource}`);
		}

		const resolvedType = this._resolveToPrimaryType(sessionResource.scheme) || sessionResource.scheme;
		const provider = this._contentProviders.get(resolvedType);
		if (!provider) {
			throw Error(`Can not find provider for ${sessionResource}`);
		}

		const session = await raceCancellationError(provider.provideChatSessionContent(sessionResource, token), token);
		const sessionData = new ContributedChatSessionData(session, sessionResource.scheme, sessionResource, session.options, resource => {
			sessionData.dispose();
			this._sessions.delete(resource);
		});

		this._sessions.set(sessionResource, sessionData);

		return session;
	}

	public hasAnySessionOptions(sessionResource: URI): boolean {
		const session = this._sessions.get(sessionResource);
		return !!session && !!session.options && Object.keys(session.options).length > 0;
	}

	public getSessionOption(sessionResource: URI, optionId: string): string | IChatSessionProviderOptionItem | undefined {
		const session = this._sessions.get(sessionResource);
		return session?.getOption(optionId);
	}

	public setSessionOption(sessionResource: URI, optionId: string, value: string | IChatSessionProviderOptionItem): boolean {
		const session = this._sessions.get(sessionResource);
		return !!session?.setOption(optionId, value);
	}

	// Implementation of editable session methods
	public async setEditableSession(sessionResource: URI, data: IEditableData | null): Promise<void> {
		if (!data) {
			this._editableSessions.delete(sessionResource);
		} else {
			this._editableSessions.set(sessionResource, data);
		}
		// Trigger refresh of the session views that might need to update their rendering
		this._onDidChangeSessionItems.fire(localChatSessionType);
	}

	public getEditableData(sessionResource: URI): IEditableData | undefined {
		return this._editableSessions.get(sessionResource);
	}

	public isEditable(sessionResource: URI): boolean {
		return this._editableSessions.has(sessionResource);
	}

	public notifySessionItemsChanged(chatSessionType: string): void {
		this._onDidChangeSessionItems.fire(chatSessionType);
	}

	/**
	 * Store option groups for a session type
	 */
	public setOptionGroupsForSessionType(chatSessionType: string, handle: number, optionGroups?: IChatSessionProviderOptionGroup[]): void {
		if (optionGroups) {
			this._sessionTypeOptions.set(chatSessionType, optionGroups);
		} else {
			this._sessionTypeOptions.delete(chatSessionType);
		}
		this._onDidChangeOptionGroups.fire(chatSessionType);
	}

	/**
	 * Get available option groups for a session type
	 */
	public getOptionGroupsForSessionType(chatSessionType: string): IChatSessionProviderOptionGroup[] | undefined {
		return this._sessionTypeOptions.get(chatSessionType);
	}

	private _optionsChangeCallback?: SessionOptionsChangedCallback;

	/**
	 * Set the callback for notifying extensions about option changes
	 */
	public setOptionsChangeCallback(callback: SessionOptionsChangedCallback): void {
		this._optionsChangeCallback = callback;
	}

	/**
	 * Notify extension about option changes for a session
	 */
	public async notifySessionOptionsChange(sessionResource: URI, updates: ReadonlyArray<{ optionId: string; value: string | IChatSessionProviderOptionItem }>): Promise<void> {
		if (!updates.length) {
			return;
		}
		if (this._optionsChangeCallback) {
			await this._optionsChangeCallback(sessionResource, updates);
		}
		for (const u of updates) {
			this.setSessionOption(sessionResource, u.optionId, u.value);
		}
		this._onDidChangeSessionOptions.fire(sessionResource);
	}

	/**
	 * Get the icon for a specific session type
	 */
	public getIconForSessionType(chatSessionType: string): ThemeIcon | URI | undefined {
		const sessionTypeIcon = this._sessionTypeIcons.get(chatSessionType);

		if (ThemeIcon.isThemeIcon(sessionTypeIcon)) {
			return sessionTypeIcon;
		}

		if (isDark(this._themeService.getColorTheme().type)) {
			return sessionTypeIcon?.dark;
		} else {
			return sessionTypeIcon?.light;
		}
	}

	/**
	 * Get the welcome title for a specific session type
	 */
	public getWelcomeTitleForSessionType(chatSessionType: string): string | undefined {
		return this._sessionTypeWelcomeTitles.get(chatSessionType);
	}

	/**
	 * Get the welcome message for a specific session type
	 */
	public getWelcomeMessageForSessionType(chatSessionType: string): string | undefined {
		return this._sessionTypeWelcomeMessages.get(chatSessionType);
	}

	/**
	 * Get the input placeholder for a specific session type
	 */
	public getInputPlaceholderForSessionType(chatSessionType: string): string | undefined {
		return this._sessionTypeInputPlaceholders.get(chatSessionType);
	}

	/**
	 * Get the capabilities for a specific session type
	 */
	public getCapabilitiesForSessionType(chatSessionType: string): IChatAgentAttachmentCapabilities | undefined {
		const contribution = this._contributions.get(chatSessionType)?.contribution;
		return contribution?.capabilities;
	}

	public getContentProviderSchemes(): string[] {
		return Array.from(this._contentProviders.keys());
	}

	public isChatSessionInProgressStatus(state: ChatSessionStatus): boolean {
		return state === ChatSessionStatus.InProgress || state === ChatSessionStatus.NeedsInput;
	}
}

registerSingleton(IChatSessionsService, ChatSessionsService, InstantiationType.Delayed);
