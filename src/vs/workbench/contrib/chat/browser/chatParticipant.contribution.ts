/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, isNonEmptyArray } from '../../../../base/common/arrays.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Event } from '../../../../base/common/event.js';
import { createCommandUri, MarkdownString } from '../../../../base/common/htmlContent.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import * as strings from '../../../../base/common/strings.js';
import { localize, localize2 } from '../../../../nls.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier, IExtensionManifest } from '../../../../platform/extensions/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { Extensions, IExtensionFeaturesRegistry, IExtensionFeatureTableRenderer, IRenderedData, IRowData, ITableData } from '../../../services/extensionManagement/common/extensionFeatures.js';
import { isProposedApiEnabled } from '../../../services/extensions/common/extensions.js';
import * as extensionsRegistry from '../../../services/extensions/common/extensionsRegistry.js';
import { showExtensionsWithIdsCommandId } from '../../extensions/browser/extensionsActions.js';
import { IExtension, IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { IChatAgentData, IChatAgentService } from '../common/chatAgents.js';
import { ChatContextKeys } from '../common/chatContextKeys.js';
import { IRawChatParticipantContribution } from '../common/chatParticipantContribTypes.js';
import { ChatAgentLocation, ChatModeKind } from '../common/constants.js';
import { ChatViewId, ChatViewContainerId } from './chat.js';
import { ChatViewPane } from './chatViewPane.js';

// --- Chat Container &  View Registration

const chatViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: ChatViewContainerId,
	title: localize2('chat.viewContainer.label', "聊天"),
	icon: Codicon.chatSparkle,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [ChatViewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: ChatViewContainerId,
	hideIfEmpty: true,
	order: 1,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true, doNotRegisterOpenCommand: true });

const chatViewDescriptor: IViewDescriptor = {
	id: ChatViewId,
	containerIcon: chatViewContainer.icon,
	containerTitle: chatViewContainer.title.value,
	singleViewPaneContainerTitle: chatViewContainer.title.value,
	name: localize2('chat.viewContainer.label', "聊天"),
	canToggleVisibility: false,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: ChatViewContainerId,
		title: chatViewContainer.title,
		mnemonicTitle: localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "聊天"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyI,
			mac: {
				primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyI
			}
		},
		order: 1
	},
	ctorDescriptor: new SyncDescriptor(ChatViewPane),
	when: ContextKeyExpr.or(
		ContextKeyExpr.or(
			ChatContextKeys.Setup.hidden,
			ChatContextKeys.Setup.disabled
		)?.negate(),
		ChatContextKeys.panelParticipantRegistered,
		ChatContextKeys.extensionInvalid
	)
};
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([chatViewDescriptor], chatViewContainer);

const chatParticipantExtensionPoint = extensionsRegistry.ExtensionsRegistry.registerExtensionPoint<IRawChatParticipantContribution[]>({
	extensionPoint: 'chatParticipants',
	jsonSchema: {
		description: localize('vscode.extension.contributes.chatParticipant', '贡献一个聊天参与者'),
		type: 'array',
		items: {
			additionalProperties: false,
			type: 'object',
			defaultSnippets: [{ body: { name: '', description: '' } }],
			required: ['name', 'id'],
			properties: {
				id: {
					description: localize('chatParticipantId', "此聊天参与者的唯一 ID。"),
					type: 'string'
				},
				name: {
					description: localize('chatParticipantName', "此聊天参与者的用户可见名称。用户将使用 '@' 加此名称来调用参与者。名称不能包含空格。"),
					type: 'string',
					pattern: '^[\\w-]+$'
				},
				fullName: {
					markdownDescription: localize('chatParticipantFullName', "此聊天参与者的全名，显示为来自此参与者的响应的标签。如果未提供，则使用 {0}。", '`name`'),
					type: 'string'
				},
				description: {
					description: localize('chatParticipantDescription', "此聊天参与者的描述，显示在 UI 中。"),
					type: 'string'
				},
				isSticky: {
					description: localize('chatCommandSticky', "调用命令是否将聊天置于持久模式，在该模式下命令会自动添加到下一条消息的聊天输入中。"),
					type: 'boolean'
				},
				sampleRequest: {
					description: localize('chatSampleRequest', "当用户在 `/help` 中点击此参与者时，此文本将被提交给参与者。"),
					type: 'string'
				},
				when: {
					description: localize('chatParticipantWhen', "启用此参与者必须为真的条件。"),
					type: 'string'
				},
				disambiguation: {
					description: localize('chatParticipantDisambiguation', "帮助自动将用户问题路由到此聊天参与者的元数据。"),
					type: 'array',
					items: {
						additionalProperties: false,
						type: 'object',
						defaultSnippets: [{ body: { category: '', description: '', examples: [] } }],
						required: ['category', 'description', 'examples'],
						properties: {
							category: {
								markdownDescription: localize('chatParticipantDisambiguationCategory', "此类别的详细名称，例如 `workspace_questions` 或 `web_questions`。"),
								type: 'string'
							},
							description: {
								description: localize('chatParticipantDisambiguationDescription', "适合此聊天参与者的问题类型的详细描述。"),
								type: 'string'
							},
							examples: {
								description: localize('chatParticipantDisambiguationExamples', "适合此聊天参与者的代表性示例问题列表。"),
								type: 'array'
							},
						}
					}
				},
				commands: {
					markdownDescription: localize('chatCommandsDescription', "此聊天参与者可用的命令，用户可以使用 `/` 来调用。"),
					type: 'array',
					items: {
						additionalProperties: false,
						type: 'object',
						defaultSnippets: [{ body: { name: '', description: '' } }],
						required: ['name'],
						properties: {
							name: {
								description: localize('chatCommand', "此命令在 UI 中引用的简短名称，例如用于修复问题的 `fix` 或解释代码的 `explain`。名称在此参与者提供的命令中必须唯一。"),
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
							sampleRequest: {
								description: localize('chatCommandSampleRequest', "当用户在 `/help` 中点击此命令时，此文本将被提交给参与者。"),
								type: 'string'
							},
							isSticky: {
								description: localize('chatCommandSticky', "调用命令是否将聊天置于持久模式，在该模式下命令会自动添加到下一条消息的聊天输入中。"),
								type: 'boolean'
							},
							disambiguation: {
								description: localize('chatCommandDisambiguation', "帮助自动将用户问题路由到此聊天命令的元数据。"),
								type: 'array',
								items: {
									additionalProperties: false,
									type: 'object',
									defaultSnippets: [{ body: { category: '', description: '', examples: [] } }],
									required: ['category', 'description', 'examples'],
									properties: {
										category: {
											markdownDescription: localize('chatCommandDisambiguationCategory', "此类别的详细名称，例如 `workspace_questions` 或 `web_questions`。"),
											type: 'string'
										},
										description: {
											description: localize('chatCommandDisambiguationDescription', "适合此聊天命令的问题类型的详细描述。"),
											type: 'string'
										},
										examples: {
											description: localize('chatCommandDisambiguationExamples', "适合此聊天命令的代表性示例问题列表。"),
											type: 'array'
										},
									}
								}
							}
						}
					}
				},
			}
		}
	},
	activationEventsGenerator: function* (contributions: readonly IRawChatParticipantContribution[]) {
		for (const contrib of contributions) {
			yield `onChatParticipant:${contrib.id}`;
		}
	},
});

export class ChatExtensionPointHandler implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatExtensionPointHandler';

	private _participantRegistrationDisposables = new DisposableMap<string>();

	constructor(
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
	) {
		this.handleAndRegisterChatExtensions();
	}

	private handleAndRegisterChatExtensions(): void {
		chatParticipantExtensionPoint.setHandler((extensions, delta) => {
			for (const extension of delta.added) {
				for (const providerDescriptor of extension.value) {
					if (!providerDescriptor.name?.match(/^[\w-]+$/)) {
						extension.collector.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with invalid name: ${providerDescriptor.name}. Name must match /^[\\w-]+$/.`);
						continue;
					}

					if (providerDescriptor.fullName && strings.AmbiguousCharacters.getInstance(new Set()).containsAmbiguousCharacter(providerDescriptor.fullName)) {
						extension.collector.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with fullName that contains ambiguous characters: ${providerDescriptor.fullName}.`);
						continue;
					}

					// Spaces are allowed but considered "invisible"
					if (providerDescriptor.fullName && strings.InvisibleCharacters.containsInvisibleCharacter(providerDescriptor.fullName.replace(/ /g, ''))) {
						extension.collector.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with fullName that contains invisible characters: ${providerDescriptor.fullName}.`);
						continue;
					}

					if ((providerDescriptor.isDefault || providerDescriptor.modes) && !isProposedApiEnabled(extension.description, 'defaultChatParticipant')) {
						extension.collector.error(`Extension '${extension.description.identifier.value}' CANNOT use API proposal: defaultChatParticipant.`);
						continue;
					}

					if (providerDescriptor.locations && !isProposedApiEnabled(extension.description, 'chatParticipantAdditions')) {
						extension.collector.error(`Extension '${extension.description.identifier.value}' CANNOT use API proposal: chatParticipantAdditions.`);
						continue;
					}

					if (!providerDescriptor.id || !providerDescriptor.name) {
						extension.collector.error(`Extension '${extension.description.identifier.value}' CANNOT register participant without both id and name.`);
						continue;
					}

					const participantsDisambiguation: {
						category: string;
						description: string;
						examples: string[];
					}[] = [];

					if (providerDescriptor.disambiguation?.length) {
						participantsDisambiguation.push(...providerDescriptor.disambiguation.map((d) => ({
							...d, category: d.category ?? d.categoryName
						})));
					}

					try {
						const store = new DisposableStore();
						store.add(this._chatAgentService.registerAgent(
							providerDescriptor.id,
							{
								extensionId: extension.description.identifier,
								extensionVersion: extension.description.version,
								publisherDisplayName: extension.description.publisherDisplayName ?? extension.description.publisher, // May not be present in OSS
								extensionPublisherId: extension.description.publisher,
								extensionDisplayName: extension.description.displayName ?? extension.description.name,
								id: providerDescriptor.id,
								description: providerDescriptor.description,
								when: providerDescriptor.when,
								metadata: {
									isSticky: providerDescriptor.isSticky,
									sampleRequest: providerDescriptor.sampleRequest,
								},
								name: providerDescriptor.name,
								fullName: providerDescriptor.fullName,
								isDefault: providerDescriptor.isDefault,
								locations: isNonEmptyArray(providerDescriptor.locations) ?
									providerDescriptor.locations.map(ChatAgentLocation.fromRaw) :
									[ChatAgentLocation.Chat],
								modes: providerDescriptor.isDefault ? (providerDescriptor.modes ?? [ChatModeKind.Ask]) : [ChatModeKind.Agent, ChatModeKind.Ask, ChatModeKind.Edit],
								slashCommands: providerDescriptor.commands ?? [],
								disambiguation: coalesce(participantsDisambiguation.flat()),
							} satisfies IChatAgentData));

						this._participantRegistrationDisposables.set(
							getParticipantKey(extension.description.identifier, providerDescriptor.id),
							store
						);
					} catch (e) {
						extension.collector.error(`Failed to register participant ${providerDescriptor.id}: ${toErrorMessage(e, true)}`);
					}
				}
			}

			for (const extension of delta.removed) {
				for (const providerDescriptor of extension.value) {
					this._participantRegistrationDisposables.deleteAndDispose(getParticipantKey(extension.description.identifier, providerDescriptor.id));
				}
			}
		});
	}
}

function getParticipantKey(extensionId: ExtensionIdentifier, participantName: string): string {
	return `${extensionId.value}_${participantName}`;
}

export class ChatCompatibilityNotifier extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatCompatNotifier';

	private registeredWelcomeView = false;

	constructor(
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IProductService private readonly productService: IProductService,
	) {
		super();

		// It may be better to have some generic UI for this, for any extension that is incompatible,
		// but this is only enabled for Chat now and it needs to be obvious.
		const isInvalid = ChatContextKeys.extensionInvalid.bindTo(contextKeyService);
		this._register(Event.runAndSubscribe(
			extensionsWorkbenchService.onDidChangeExtensionsNotification,
			() => {
				const notification = extensionsWorkbenchService.getExtensionsNotification();
				const chatExtension = notification?.extensions.find(ext => ExtensionIdentifier.equals(ext.identifier.id, this.productService.defaultChatAgent?.chatExtensionId));
				if (chatExtension) {
					isInvalid.set(true);
					this.registerWelcomeView(chatExtension);
				} else {
					isInvalid.set(false);
				}
			}
		));
	}

	private registerWelcomeView(chatExtension: IExtension) {
		if (this.registeredWelcomeView) {
			return;
		}

		this.registeredWelcomeView = true;
		const showExtensionLabel = localize('showExtension', "显示扩展");
		const mainMessage = localize('chatFailErrorMessage', "聊天加载失败，因为已安装的 Copilot Chat 扩展版本与此版本的 {0} 不兼容。请确保 Copilot Chat 扩展是最新的。", this.productService.nameLong);
		const commandButton = `[${showExtensionLabel}](${createCommandUri(showExtensionsWithIdsCommandId, [this.productService.defaultChatAgent?.chatExtensionId])})`;
		const versionMessage = `Copilot Chat 版本：${chatExtension.version}`;
		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		this._register(viewsRegistry.registerViewWelcomeContent(ChatViewId, {
			content: [mainMessage, commandButton, versionMessage].join('\n\n'),
			when: ChatContextKeys.extensionInvalid,
		}));
	}
}

class ChatParticipantDataRenderer extends Disposable implements IExtensionFeatureTableRenderer {
	readonly type = 'table';

	shouldRender(manifest: IExtensionManifest): boolean {
		return !!manifest.contributes?.chatParticipants;
	}

	render(manifest: IExtensionManifest): IRenderedData<ITableData> {
		const nonDefaultContributions = manifest.contributes?.chatParticipants?.filter(c => !c.isDefault) ?? [];
		if (!nonDefaultContributions.length) {
			return { data: { headers: [], rows: [] }, dispose: () => { } };
		}

		const headers = [
			localize('participantName', "名称"),
			localize('participantFullName', "全名"),
			localize('participantDescription', "描述"),
			localize('participantCommands', "命令"),
		];

		const rows: IRowData[][] = nonDefaultContributions.map(d => {
			return [
				'@' + d.name,
				d.fullName,
				d.description ?? '-',
				d.commands?.length ? new MarkdownString(d.commands.map(c => `- /` + c.name).join('\n')) : '-'
			];
		});

		return {
			data: {
				headers,
				rows
			},
			dispose: () => { }
		};
	}
}

Registry.as<IExtensionFeaturesRegistry>(Extensions.ExtensionFeaturesRegistry).registerExtensionFeature({
	id: 'chatParticipants',
	label: localize('chatParticipants', "聊天参与者"),
	access: {
		canToggle: false
	},
	renderer: new SyncDescriptor(ChatParticipantDataRenderer),
});
