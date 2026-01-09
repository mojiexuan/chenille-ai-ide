/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { MarkdownString, isMarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { PolicyCategory } from '../../../../base/common/policy.js';
import { registerEditorFeature } from '../../../../editor/common/editorFeatures.js';
import * as nls from '../../../../nls.js';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { McpAccessValue, McpAutoStartValue, mcpAccessConfig, mcpAutoStartConfig, mcpGalleryServiceEnablementConfig, mcpGalleryServiceUrlConfig } from '../../../../platform/mcp/common/mcpManagement.js';
import product from '../../../../platform/product/common/product.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { Extensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { IWorkbenchAssignmentService } from '../../../services/assignment/common/assignmentService.js';
import { ChatEntitlement, IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { AddConfigurationType, AssistedTypes } from '../../mcp/browser/mcpCommandsAddConfiguration.js';
import { allDiscoverySources, discoverySourceSettingsLabel, mcpDiscoverySection, mcpServerSamplingSection } from '../../mcp/common/mcpConfiguration.js';
import { ChatAgentNameService, ChatAgentService, IChatAgentNameService, IChatAgentService } from '../common/chatAgents.js';
import { CodeMapperService, ICodeMapperService } from '../common/chatCodeMapperService.js';
import '../common/chatColors.js';
import { IChatEditingService } from '../common/chatEditingService.js';
import { IChatLayoutService } from '../common/chatLayoutService.js';
import { ChatModeService, IChatMode, IChatModeService } from '../common/chatModes.js';
import { ChatResponseResourceFileSystemProvider } from '../common/chatResponseResourceFileSystemProvider.js';
import { IChatService } from '../common/chatService.js';
import { ChatService } from '../common/chatServiceImpl.js';
import { IChatSessionsService } from '../common/chatSessionsService.js';
import { ChatSlashCommandService, IChatSlashCommandService } from '../common/chatSlashCommands.js';
import { ChatTodoListService, IChatTodoListService } from '../common/chatTodoListService.js';
import { ChatTransferService, IChatTransferService } from '../common/chatTransferService.js';
import { IChatVariablesService } from '../common/chatVariables.js';
import { ChatWidgetHistoryService, IChatWidgetHistoryService } from '../common/chatWidgetHistoryService.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind } from '../common/constants.js';
import { ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService } from '../common/ignoredFiles.js';
import { ILanguageModelsService, LanguageModelsService } from '../common/languageModels.js';
import { ILanguageModelStatsService, LanguageModelStatsService } from '../common/languageModelStats.js';
import { ILanguageModelToolsConfirmationService } from '../common/languageModelToolsConfirmationService.js';
import { ILanguageModelToolsService } from '../common/languageModelToolsService.js';
import { ChatPromptFilesExtensionPointHandler } from '../common/promptSyntax/chatPromptFilesContribution.js';
import { PromptsConfig } from '../common/promptSyntax/config/config.js';
import { INSTRUCTIONS_DEFAULT_SOURCE_FOLDER, INSTRUCTION_FILE_EXTENSION, LEGACY_MODE_DEFAULT_SOURCE_FOLDER, LEGACY_MODE_FILE_EXTENSION, PROMPT_DEFAULT_SOURCE_FOLDER, PROMPT_FILE_EXTENSION } from '../common/promptSyntax/config/promptFileLocations.js';
import { PromptLanguageFeaturesProvider } from '../common/promptSyntax/promptFileContributions.js';
import { AGENT_DOCUMENTATION_URL, INSTRUCTIONS_DOCUMENTATION_URL, PROMPT_DOCUMENTATION_URL } from '../common/promptSyntax/promptTypes.js';
import { IPromptsService } from '../common/promptSyntax/service/promptsService.js';
import { PromptsService } from '../common/promptSyntax/service/promptsServiceImpl.js';
import { LanguageModelToolsExtensionPointHandler } from '../common/tools/languageModelToolsContribution.js';
import { BuiltinToolsContribution } from '../common/tools/tools.js';
import { IVoiceChatService, VoiceChatService } from '../common/voiceChatService.js';
import { registerChatAccessibilityActions } from './actions/chatAccessibilityActions.js';
import { AgentChatAccessibilityHelp, EditsChatAccessibilityHelp, PanelChatAccessibilityHelp, QuickChatAccessibilityHelp } from './actions/chatAccessibilityHelp.js';
import { ACTION_ID_NEW_CHAT, CopilotTitleBarMenuRendering, ModeOpenChatGlobalAction, registerChatActions } from './actions/chatActions.js';
import { CodeBlockActionRendering, registerChatCodeBlockActions, registerChatCodeCompareBlockActions } from './actions/chatCodeblockActions.js';
import { ChatContextContributions } from './actions/chatContext.js';
import { registerChatContextActions } from './actions/chatContextActions.js';
import { ContinueChatInSessionActionRendering } from './actions/chatContinueInAction.js';
import { registerChatCopyActions } from './actions/chatCopyActions.js';
import { registerChatDeveloperActions } from './actions/chatDeveloperActions.js';
import { ChatSubmitAction, registerChatExecuteActions } from './actions/chatExecuteActions.js';
import { registerChatFileTreeActions } from './actions/chatFileTreeActions.js';
import { ChatGettingStartedContribution } from './actions/chatGettingStarted.js';
import { registerChatExportActions } from './actions/chatImportExport.js';
import { registerLanguageModelActions } from './actions/chatLanguageModelActions.js';
import { registerMoveActions } from './actions/chatMoveActions.js';
import { registerNewChatActions } from './actions/chatNewActions.js';
import { registerChatPromptNavigationActions } from './actions/chatPromptNavigationActions.js';
import { registerQuickChatActions } from './actions/chatQuickInputActions.js';
import { ChatAgentRecommendation } from './actions/chatAgentRecommendationActions.js';
import { DeleteChatSessionAction, OpenChatSessionInSidebarAction, RenameChatSessionAction, ToggleAgentSessionsViewLocationAction, ToggleChatSessionsDescriptionDisplayAction } from './actions/chatSessionActions.js';
import { registerChatTitleActions } from './actions/chatTitleActions.js';
import { registerChatElicitationActions } from './actions/chatElicitationActions.js';
import { registerChatToolActions } from './actions/chatToolActions.js';
import { ChatTransferContribution } from './actions/chatTransfer.js';
import './agentSessions/agentSessions.contribution.js';
import { IChatAccessibilityService, IChatCodeBlockContextProviderService, IChatWidgetService, IQuickChatService } from './chat.js';
import { ChatAccessibilityService } from './chatAccessibilityService.js';
import './chatAttachmentModel.js';
import './chatStatusWidget.js';
import { ChatAttachmentResolveService, IChatAttachmentResolveService } from './chatAttachmentResolveService.js';
import { ChatMarkdownAnchorService, IChatMarkdownAnchorService } from './chatContentParts/chatMarkdownAnchorService.js';
import { ChatContextPickService, IChatContextPickService } from './chatContextPickService.js';
import { ChatInputBoxContentProvider } from './chatEdinputInputContentProvider.js';
import { ChatEditingEditorAccessibility } from './chatEditing/chatEditingEditorAccessibility.js';
import { registerChatEditorActions } from './chatEditing/chatEditingEditorActions.js';
import { ChatEditingEditorContextKeys } from './chatEditing/chatEditingEditorContextKeys.js';
import { ChatEditingEditorOverlay } from './chatEditing/chatEditingEditorOverlay.js';
import { ChatEditingService } from './chatEditing/chatEditingServiceImpl.js';
import { ChatEditingNotebookFileSystemProviderContrib } from './chatEditing/notebook/chatEditingNotebookFileSystemProvider.js';
import { SimpleBrowserOverlay } from './chatEditing/simpleBrowserEditorOverlay.js';
import { ChatEditor, IChatEditorOptions } from './chatEditor.js';
import { ChatEditorInput, ChatEditorInputSerializer } from './chatEditorInput.js';
import { ChatLayoutService } from './chatLayoutService.js';
import './chatManagement/chatManagement.contribution.js';
import { agentSlashCommandToMarkdown, agentToMarkdown } from './chatMarkdownDecorationsRenderer.js';
import { ChatOutputRendererService, IChatOutputRendererService } from './chatOutputItemRenderer.js';
import { ChatCompatibilityNotifier, ChatExtensionPointHandler } from './chatParticipant.contribution.js';
import { ChatPasteProvidersFeature } from './chatPasteProviders.js';
import { QuickChatService } from './chatQuick.js';
import { ChatResponseAccessibleView } from './chatResponseAccessibleView.js';
import { ChatTerminalOutputAccessibleView } from './chatTerminalOutputAccessibleView.js';
import { ChatSessionsView, ChatSessionsViewContrib } from './chatSessions/view/chatSessionsView.js';
import { ChatSetupContribution, ChatTeardownContribution } from './chatSetup/chatSetupContributions.js';
// import { ChatStatusBarEntry } from './chatStatus/chatStatusEntry.js';
import { ChatVariablesService } from './chatVariables.js';
import { ChatWidget } from './chatWidget.js';
import { ChatCodeBlockContextProviderService } from './codeBlockContextProviderService.js';
import { ChatDynamicVariableModel } from './contrib/chatDynamicVariables.js';
import { ChatImplicitContextContribution } from './contrib/chatImplicitContext.js';
import './contrib/chatInputCompletions.js';
import './contrib/chatInputEditorContrib.js';
import './contrib/chatInputEditorHover.js';
import { ChatRelatedFilesContribution } from './contrib/chatInputRelatedFilesContrib.js';
import { LanguageModelToolsConfirmationService } from './languageModelToolsConfirmationService.js';
import { LanguageModelToolsService, globalAutoApproveDescription } from './languageModelToolsService.js';
import './promptSyntax/promptCodingAgentActionContribution.js';
import './promptSyntax/promptToolsCodeLensProvider.js';
import { PromptUrlHandler } from './promptSyntax/promptUrlHandler.js';
import { ConfigureToolSets, UserToolSetsContributions } from './tools/toolSetsContribution.js';
import { ChatViewsWelcomeHandler } from './viewsWelcome/chatViewsWelcomeHandler.js';
import { ChatWidgetService } from './chatWidgetService.js';
import './chatContextCollapseContribution.js';

const toolReferenceNameEnumValues: string[] = [];
const toolReferenceNameEnumDescriptions: string[] = [];

// Register configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'chatSidebar',
	title: nls.localize('interactiveSessionConfigurationTitle', "聊天"),
	type: 'object',
	properties: {
		'chat.fontSize': {
			type: 'number',
			description: nls.localize('chat.fontSize', "控制聊天消息中的字体大小（以像素为单位）。"),
			default: 13,
			minimum: 6,
			maximum: 100
		},
		'chat.fontFamily': {
			type: 'string',
			description: nls.localize('chat.fontFamily', "控制聊天消息中的字体系列。"),
			default: 'default'
		},
		'chat.editor.fontSize': {
			type: 'number',
			description: nls.localize('interactiveSession.editor.fontSize', "控制聊天代码块中的字体大小（以像素为单位）。"),
			default: isMacintosh ? 12 : 14,
		},
		'chat.editor.fontFamily': {
			type: 'string',
			description: nls.localize('interactiveSession.editor.fontFamily', "控制聊天代码块中的字体系列。"),
			default: 'default'
		},
		'chat.editor.fontWeight': {
			type: 'string',
			description: nls.localize('interactiveSession.editor.fontWeight', "控制聊天代码块中的字体粗细。"),
			default: 'default'
		},
		'chat.editor.wordWrap': {
			type: 'string',
			description: nls.localize('interactiveSession.editor.wordWrap', "控制聊天代码块中的行是否应换行。"),
			default: 'off',
			enum: ['on', 'off']
		},
		'chat.editor.lineHeight': {
			type: 'number',
			description: nls.localize('interactiveSession.editor.lineHeight', "控制聊天代码块中的行高（以像素为单位）。使用 0 从字体大小计算行高。"),
			default: 0
		},
		'chat.commandCenter.enabled': {
			type: 'boolean',
			markdownDescription: nls.localize('chat.commandCenter.enabled', "控制命令中心是否显示用于控制聊天的操作菜单（需要 {0}）。", '`#window.commandCenter#`'),
			default: true
		},
		'chat.implicitContext.enabled': {
			type: 'object',
			description: nls.localize('chat.implicitContext.enabled.1', "启用自动将活动编辑器用作指定聊天位置的聊天上下文。"),
			additionalProperties: {
				type: 'string',
				enum: ['never', 'first', 'always'],
				description: nls.localize('chat.implicitContext.value', "隐式上下文的值。"),
				enumDescriptions: [
					nls.localize('chat.implicitContext.value.never', "从不启用隐式上下文。"),
					nls.localize('chat.implicitContext.value.first', "仅在首次交互时启用隐式上下文。"),
					nls.localize('chat.implicitContext.value.always', "始终启用隐式上下文。")
				]
			},
			default: {
				'panel': 'always',
			}
		},
		'chat.implicitContext.suggestedContext': {
			type: 'boolean',
			markdownDescription: nls.localize('chat.implicitContext.suggestedContext', "控制是否显示新的隐式上下文流程。在询问和编辑模式下，上下文将自动包含。使用智能体时，上下文将作为附件建议。选择内容始终作为上下文包含。"),
			default: true,
		},
		'chat.editing.autoAcceptDelay': {
			type: 'number',
			markdownDescription: nls.localize('chat.editing.autoAcceptDelay', "聊天所做更改自动接受前的延迟时间。值以秒为单位，`0` 表示禁用，最大值为 `100` 秒。"),
			default: 0,
			minimum: 0,
			maximum: 100
		},
		'chat.editing.confirmEditRequestRemoval': {
			type: 'boolean',
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: nls.localize('chat.editing.confirmEditRequestRemoval', "是否在删除请求及其关联编辑之前显示确认。"),
			default: true,
		},
		'chat.editing.confirmEditRequestRetry': {
			type: 'boolean',
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: nls.localize('chat.editing.confirmEditRequestRetry', "是否在重试请求及其关联编辑之前显示确认。"),
			default: true,
		},
		'chat.experimental.detectParticipant.enabled': {
			type: 'boolean',
			deprecationMessage: nls.localize('chat.experimental.detectParticipant.enabled.deprecated', "此设置已弃用。请改用 `chat.detectParticipant.enabled`。"),
			description: nls.localize('chat.experimental.detectParticipant.enabled', "为面板聊天启用聊天参与者自动检测。"),
			default: null
		},
		'chat.detectParticipant.enabled': {
			type: 'boolean',
			description: nls.localize('chat.detectParticipant.enabled', "为面板聊天启用聊天参与者自动检测。"),
			default: true
		},
		'chat.renderRelatedFiles': {
			type: 'boolean',
			description: nls.localize('chat.renderRelatedFiles', "控制是否在聊天输入中呈现相关文件。"),
			default: false
		},
		'chat.notifyWindowOnConfirmation': {
			type: 'boolean',
			description: nls.localize('chat.notifyWindowOnConfirmation', "控制当窗口失去焦点时需要确认时，聊天会话是否应向用户显示操作系统通知。这包括窗口徽章和通知提示。"),
			default: true,
		},
		[ChatConfiguration.GlobalAutoApprove]: {
			default: false,
			markdownDescription: globalAutoApproveDescription.value,
			type: 'boolean',
			scope: ConfigurationScope.APPLICATION_MACHINE,
			tags: ['experimental'],
			policy: {
				name: 'ChatToolsAutoApprove',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.99',
				value: (account) => account.chat_preview_features_enabled === false ? false : undefined,
				localization: {
					description: {
						key: 'autoApprove2.description',
						value: nls.localize('autoApprove2.description', '全局自动批准（也称为"YOLO 模式"）完全禁用所有工作区中所有工具的手动批准，允许智能体完全自主运行。这非常危险，*永远不*推荐使用，即使是 Codespaces 和 Dev Containers 等容器化环境也会将用户密钥转发到容器中，可能会被泄露。\n\n此功能禁用关键安全保护，使攻击者更容易入侵机器。')
					}
				},
			}
		},
		[ChatConfiguration.AutoApproveEdits]: {
			default: {
				'**/*': true,
				'**/.vscode/*.json': false,
				'**/.git/**': false,
				'**/{package.json,package-lock.json,server.xml,build.rs,web.config,.gitattributes,.env}': false,
				'**/*.{code-workspace,csproj,fsproj,vbproj,vcxproj,proj,targets,props}': false,
			},
			markdownDescription: nls.localize('chat.tools.autoApprove.edits', "控制聊天所做的编辑是否自动批准。默认情况下批准所有编辑，但对某些可能导致即时意外副作用的文件（如 `**/.vscode/*.json`）除外。\n\n设置为 `true` 自动批准对匹配文件的编辑，设置为 `false` 始终需要明确批准。最后一个匹配给定文件的模式将决定编辑是否自动批准。"),
			type: 'object',
			additionalProperties: {
				type: 'boolean',
			}
		},
		[ChatConfiguration.AutoApprovedUrls]: {
			default: {},
			markdownDescription: nls.localize('chat.tools.fetchPage.approvedUrls', "控制聊天工具请求时哪些 URL 自动批准。键是 URL 模式，值可以是 `true` 批准请求和响应，`false` 拒绝，或具有 `approveRequest` 和 `approveResponse` 属性的对象进行精细控制。\n\n示例：\n- `\"https://example.com\": true` - 批准所有对 example.com 的请求\n- `\"https://*.example.com\": true` - 批准对 example.com 任何子域的所有请求\n- `\"https://example.com/api/*\": { \"approveRequest\": true, \"approveResponse\": false }` - 批准请求但不批准 example.com/api 路径的响应"),
			type: 'object',
			additionalProperties: {
				oneOf: [
					{ type: 'boolean' },
					{
						type: 'object',
						properties: {
							approveRequest: { type: 'boolean' },
							approveResponse: { type: 'boolean' }
						}
					}
				]
			}
		},
		[ChatConfiguration.EligibleForAutoApproval]: {
			default: {},
			markdownDescription: nls.localize('chat.tools.eligibleForAutoApproval', '控制哪些工具有资格自动批准。设置为 \'false\' 的工具将始终显示确认，永远不会提供自动批准选项。默认行为（或将工具设置为 \'true\'）可能会导致工具提供自动批准选项。'),
			type: 'object',
			propertyNames: {
				enum: toolReferenceNameEnumValues,
				enumDescriptions: toolReferenceNameEnumDescriptions,
			},
			additionalProperties: {
				type: 'boolean',
			},
			tags: ['experimental'],
			examples: [
				{
					'fetch': false,
					'runTests': false
				}
			],
			policy: {
				name: 'ChatToolsEligibleForAutoApproval',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.107',
				localization: {
					description: {
						key: 'chat.tools.eligibleForAutoApproval',
						value: nls.localize('chat.tools.eligibleForAutoApproval', '控制哪些工具有资格自动批准。设置为 \'false\' 的工具将始终显示确认，永远不会提供自动批准选项。默认行为（或将工具设置为 \'true\'）可能会导致工具提供自动批准选项。')
					}
				},
			}
		},
		[ChatConfiguration.SuspendThrottling]: { // TODO@deepak1556 remove this once https://github.com/microsoft/vscode/issues/263554 is resolved.
			type: 'boolean',
			description: nls.localize('chat.suspendThrottling', "控制当聊天请求正在进行时是否暂停后台节流，允许聊天会话在窗口失去焦点时继续。"),
			default: true,
			tags: ['preview']
		},
		'chat.sendElementsToChat.enabled': {
			default: true,
			description: nls.localize('chat.sendElementsToChat.enabled', "控制是否可以从简单浏览器将元素发送到聊天。"),
			type: 'boolean',
			tags: ['preview']
		},
		'chat.sendElementsToChat.attachCSS': {
			default: true,
			markdownDescription: nls.localize('chat.sendElementsToChat.attachCSS', "控制是否将所选元素的 CSS 添加到聊天中。必须启用 {0}。", '`#chat.sendElementsToChat.enabled#`'),
			type: 'boolean',
			tags: ['preview']
		},
		'chat.sendElementsToChat.attachImages': {
			default: true,
			markdownDescription: nls.localize('chat.sendElementsToChat.attachImages', "控制是否将所选元素的截图添加到聊天中。必须启用 {0}。", '`#chat.sendElementsToChat.enabled#`'),
			type: 'boolean',
			tags: ['experimental']
		},
		'chat.undoRequests.restoreInput': {
			default: true,
			markdownDescription: nls.localize('chat.undoRequests.restoreInput', "控制在执行撤消请求时是否应恢复聊天输入。输入将填充已恢复请求的文本。"),
			type: 'boolean',
		},
		'chat.editRequests': {
			markdownDescription: nls.localize('chat.editRequests', "启用在聊天中编辑请求。这允许您更改请求内容并重新提交给模型。"),
			type: 'string',
			enum: ['inline', 'hover', 'input', 'none'],
			default: 'inline',
		},
		[ChatConfiguration.ChatViewWelcomeEnabled]: {
			type: 'boolean',
			default: true,
			description: nls.localize('chat.welcome.enabled', "当聊天为空时显示欢迎横幅。"),
		},
		[ChatConfiguration.ChatViewSessionsEnabled]: { // TODO@bpasero move off preview
			type: 'boolean',
			default: true,
			description: nls.localize('chat.viewSessions.enabled', "当聊天为空时显示聊天智能体会话，或当聊天视图足够宽时在侧边显示。"),
			tags: ['preview', 'experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.ChatViewSessionsOrientation]: { // TODO@bpasero move off preview
			type: 'string',
			enum: ['auto', 'stacked', 'sideBySide'],
			enumDescriptions: [
				nls.localize('chat.viewSessions.orientation.auto', "根据可用空间自动确定方向。"),
				nls.localize('chat.viewSessions.orientation.stacked', "垂直堆叠显示会话，除非聊天会话可见。"),
				nls.localize('chat.viewSessions.orientation.sideBySide', "如果空间足够则并排显示会话，否则堆叠显示。")
			],
			default: 'sideBySide',
			description: nls.localize('chat.viewSessions.orientation', "控制聊天智能体会话视图与聊天并排显示时的方向。"),
			tags: ['preview', 'experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.ChatViewTitleEnabled]: { // TODO@bpasero move off preview
			type: 'boolean',
			default: true,
			description: nls.localize('chat.viewTitle.enabled', "在聊天视图中的聊天上方显示聊天标题。"),
			tags: ['preview', 'experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.NotifyWindowOnResponseReceived]: {
			type: 'boolean',
			default: true,
			description: nls.localize('chat.notifyWindowOnResponseReceived', "控制当窗口失去焦点时收到响应时，聊天会话是否应向用户显示操作系统通知。这包括窗口徽章和通知提示。"),
		},
		'chat.checkpoints.enabled': {
			type: 'boolean',
			default: true,
			description: nls.localize('chat.checkpoints.enabled', "在聊天中启用检查点。检查点允许您将聊天恢复到之前的状态。"),
		},
		'chat.checkpoints.showFileChanges': {
			type: 'boolean',
			description: nls.localize('chat.checkpoints.showFileChanges', "控制是否显示聊天检查点文件更改。"),
			default: false
		},
		[mcpAccessConfig]: {
			type: 'string',
			description: nls.localize('chat.mcp.access', "控制对已安装的模型上下文协议服务器的访问。"),
			enum: [
				McpAccessValue.None,
				McpAccessValue.Registry,
				McpAccessValue.All
			],
			enumDescriptions: [
				nls.localize('chat.mcp.access.none', "不允许访问 MCP 服务器。"),
				nls.localize('chat.mcp.access.registry', "允许访问从 Chenille 连接的注册表安装的 MCP 服务器。"),
				nls.localize('chat.mcp.access.any', "允许访问任何已安装的 MCP 服务器。")
			],
			default: McpAccessValue.All,
			policy: {
				name: 'ChatMCP',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.99',
				value: (account) => {
					if (account.mcp === false) {
						return McpAccessValue.None;
					}
					if (account.mcpAccess === 'registry_only') {
						return McpAccessValue.Registry;
					}
					return undefined;
				},
				localization: {
					description: {
						key: 'chat.mcp.access',
						value: nls.localize('chat.mcp.access', "控制对已安装的模型上下文协议服务器的访问。")
					},
					enumDescriptions: [
						{
							key: 'chat.mcp.access.none', value: nls.localize('chat.mcp.access.none', "不允许访问 MCP 服务器。"),
						},
						{
							key: 'chat.mcp.access.registry', value: nls.localize('chat.mcp.access.registry', "允许访问从 Chenille 连接的注册表安装的 MCP 服务器。"),
						},
						{
							key: 'chat.mcp.access.any', value: nls.localize('chat.mcp.access.any', "允许访问任何已安装的 MCP 服务器。")
						}
					]
				},
			}
		},
		[mcpAutoStartConfig]: {
			type: 'string',
			description: nls.localize('chat.mcp.autostart', "控制在提交聊天消息时是否应自动启动 MCP 服务器。"),
			default: McpAutoStartValue.NewAndOutdated,
			enum: [
				McpAutoStartValue.Never,
				McpAutoStartValue.OnlyNew,
				McpAutoStartValue.NewAndOutdated
			],
			enumDescriptions: [
				nls.localize('chat.mcp.autostart.never', "从不自动启动 MCP 服务器。"),
				nls.localize('chat.mcp.autostart.onlyNew', "仅自动启动从未运行过的新 MCP 服务器。"),
				nls.localize('chat.mcp.autostart.newAndOutdated', "自动启动尚未运行的新 MCP 服务器和过时的 MCP 服务器。")
			],
			tags: ['experimental'],
		},
		[mcpServerSamplingSection]: {
			type: 'object',
			description: nls.localize('chat.mcp.serverSampling', "配置向 MCP 服务器公开哪些模型用于采样（在后台发出模型请求）。此设置可以在 `{0}` 命令下以图形方式编辑。", 'MCP: ' + nls.localize('mcp.list', '列出服务器')),
			scope: ConfigurationScope.RESOURCE,
			additionalProperties: {
				type: 'object',
				properties: {
					allowedDuringChat: {
						type: 'boolean',
						description: nls.localize('chat.mcp.serverSampling.allowedDuringChat', "此服务器是否可以在聊天会话中的工具调用期间发出采样请求。"),
						default: true,
					},
					allowedOutsideChat: {
						type: 'boolean',
						description: nls.localize('chat.mcp.serverSampling.allowedOutsideChat', "此服务器是否允许在聊天会话之外发出采样请求。"),
						default: false,
					},
					allowedModels: {
						type: 'array',
						items: {
							type: 'string',
							description: nls.localize('chat.mcp.serverSampling.model', "MCP 服务器可以访问的模型。"),
						},
					}
				}
			},
		},
		[AssistedTypes[AddConfigurationType.NuGetPackage].enabledConfigKey]: {
			type: 'boolean',
			description: nls.localize('chat.mcp.assisted.nuget.enabled.description', "为 AI 辅助的 MCP 服务器安装启用 NuGet 包。用于从 .NET 包的中央注册表 (NuGet.org) 按名称安装 MCP 服务器。"),
			default: false,
			tags: ['experimental'],
			experiment: {
				mode: 'startup'
			}
		},
		[ChatConfiguration.Edits2Enabled]: {
			type: 'boolean',
			description: nls.localize('chat.edits2Enabled', "启用基于工具调用的新编辑模式。启用此功能后，不支持工具调用的模型将无法用于编辑模式。"),
			default: false,
		},
		[ChatConfiguration.ExtensionToolsEnabled]: {
			type: 'boolean',
			description: nls.localize('chat.extensionToolsEnabled', "启用使用第三方扩展贡献的工具。"),
			default: true,
			policy: {
				name: 'ChatAgentExtensionTools',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.99',
				localization: {
					description: {
						key: 'chat.extensionToolsEnabled',
						value: nls.localize('chat.extensionToolsEnabled', "启用使用第三方扩展贡献的工具。")
					}
				},
			}
		},
		[ChatConfiguration.AgentEnabled]: {
			type: 'boolean',
			description: nls.localize('chat.agent.enabled.description', "启用后，可以从聊天激活智能体模式，并且可以使用具有副作用的智能体上下文中的工具。"),
			default: true,
			policy: {
				name: 'ChatAgentMode',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.99',
				value: (account) => account.chat_agent_enabled === false ? false : undefined,
				localization: {
					description: {
						key: 'chat.agent.enabled.description',
						value: nls.localize('chat.agent.enabled.description', "启用后，可以从聊天激活智能体模式，并且可以使用具有副作用的智能体上下文中的工具。"),
					}
				}
			}
		},
		[ChatConfiguration.EnableMath]: {
			type: 'boolean',
			description: nls.localize('chat.mathEnabled.description', "使用 KaTeX 在聊天响应中启用数学公式渲染。"),
			default: true,
			tags: ['preview'],
		},
		[ChatConfiguration.ShowCodeBlockProgressAnimation]: {
			type: 'boolean',
			description: nls.localize('chat.codeBlock.showProgressAnimation.description', "应用编辑时，在代码块标签中显示进度动画。如果禁用，则显示进度百分比。"),
			default: true,
			tags: ['experimental'],
		},
		['chat.statusWidget.sku']: {
			type: 'string',
			enum: ['free', 'anonymous'],
			enumDescriptions: [
				nls.localize('chat.statusWidget.sku.free', "为免费层用户显示状态小部件。"),
				nls.localize('chat.statusWidget.sku.anonymous', "为匿名用户显示状态小部件。")
			],
			description: nls.localize('chat.statusWidget.enabled.description', "控制当配额超出时，哪种用户类型应在新聊天会话中看到状态小部件。"),
			default: undefined,
			tags: ['experimental', 'advanced'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.AgentSessionsViewLocation]: {
			type: 'string',
			enum: ['disabled', 'view', 'single-view'], // TODO@bpasero remove this setting eventually
			description: nls.localize('chat.sessionsViewLocation.description', "控制在哪里显示智能体会话菜单。"),
			default: 'disabled',
			tags: ['preview', 'experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[mcpDiscoverySection]: {
			type: 'object',
			properties: Object.fromEntries(allDiscoverySources.map(k => [k, { type: 'boolean', description: discoverySourceSettingsLabel[k] }])),
			additionalProperties: false,
			default: Object.fromEntries(allDiscoverySources.map(k => [k, false])),
			markdownDescription: nls.localize('mcp.discovery.enabled', "配置从各种其他应用程序的配置中发现模型上下文协议服务器。"),
		},
		[mcpGalleryServiceEnablementConfig]: {
			type: 'boolean',
			default: false,
			tags: ['preview'],
			description: nls.localize('chat.mcp.gallery.enabled', "启用模型上下文协议 (MCP) 服务器的默认市场。"),
			included: product.quality === 'stable'
		},
		[mcpGalleryServiceUrlConfig]: {
			type: 'string',
			description: nls.localize('mcp.gallery.serviceUrl', "配置要连接的 MCP 库服务 URL"),
			default: '',
			scope: ConfigurationScope.APPLICATION,
			tags: ['usesOnlineServices', 'advanced'],
			included: false,
			policy: {
				name: 'McpGalleryServiceUrl',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.101',
				value: (account) => account.mcpRegistryUrl,
				localization: {
					description: {
						key: 'mcp.gallery.serviceUrl',
						value: nls.localize('mcp.gallery.serviceUrl', "配置要连接的 MCP 库服务 URL"),
					}
				}
			},
		},
		[PromptsConfig.INSTRUCTIONS_LOCATION_KEY]: {
			type: 'object',
			title: nls.localize(
				'chat.instructions.config.locations.title',
				"指令文件位置",
			),
			markdownDescription: nls.localize(
				'chat.instructions.config.locations.description',
				"指定可在聊天会话中附加的指令文件 (`*{0}`) 的位置。[了解更多]({1})。\n\n相对路径从工作区的根文件夹解析。",
				INSTRUCTION_FILE_EXTENSION,
				INSTRUCTIONS_DOCUMENTATION_URL,
			),
			default: {
				[INSTRUCTIONS_DEFAULT_SOURCE_FOLDER]: true,
			},
			additionalProperties: { type: 'boolean' },
			restricted: true,
			tags: ['prompts', 'reusable prompts', 'prompt snippets', 'instructions'],
			examples: [
				{
					[INSTRUCTIONS_DEFAULT_SOURCE_FOLDER]: true,
				},
				{
					[INSTRUCTIONS_DEFAULT_SOURCE_FOLDER]: true,
					'/Users/vscode/repos/instructions': true,
				},
			],
		},
		[PromptsConfig.PROMPT_LOCATIONS_KEY]: {
			type: 'object',
			title: nls.localize(
				'chat.reusablePrompts.config.locations.title',
				"提示文件位置",
			),
			markdownDescription: nls.localize(
				'chat.reusablePrompts.config.locations.description',
				"指定可在聊天会话中运行的可重用提示文件 (`*{0}`) 的位置。[了解更多]({1})。\n\n相对路径从工作区的根文件夹解析。",
				PROMPT_FILE_EXTENSION,
				PROMPT_DOCUMENTATION_URL,
			),
			default: {
				[PROMPT_DEFAULT_SOURCE_FOLDER]: true,
			},
			additionalProperties: { type: 'boolean' },
			unevaluatedProperties: { type: 'boolean' },
			restricted: true,
			tags: ['prompts', 'reusable prompts', 'prompt snippets', 'instructions'],
			examples: [
				{
					[PROMPT_DEFAULT_SOURCE_FOLDER]: true,
				},
				{
					[PROMPT_DEFAULT_SOURCE_FOLDER]: true,
					'/Users/vscode/repos/prompts': true,
				},
			],
		},
		[PromptsConfig.MODE_LOCATION_KEY]: {
			type: 'object',
			title: nls.localize(
				'chat.mode.config.locations.title',
				"模式文件位置",
			),
			markdownDescription: nls.localize(
				'chat.mode.config.locations.description',
				"指定自定义聊天模式文件 (`*{0}`) 的位置。[了解更多]({1})。\n\n相对路径从工作区的根文件夹解析。",
				LEGACY_MODE_FILE_EXTENSION,
				AGENT_DOCUMENTATION_URL,
			),
			default: {
				[LEGACY_MODE_DEFAULT_SOURCE_FOLDER]: true,
			},
			deprecationMessage: nls.localize('chat.mode.config.locations.deprecated', "此设置已弃用，将在未来版本中删除。聊天模式现在称为自定义智能体，位于 `.github/agents` 中"),
			additionalProperties: { type: 'boolean' },
			unevaluatedProperties: { type: 'boolean' },
			restricted: true,
			tags: ['experimental', 'prompts', 'reusable prompts', 'prompt snippets', 'instructions'],
			examples: [
				{
					[LEGACY_MODE_DEFAULT_SOURCE_FOLDER]: true,
				},
				{
					[LEGACY_MODE_DEFAULT_SOURCE_FOLDER]: true,
					'/Users/vscode/repos/chatmodes': true,
				},
			],
		},
		[PromptsConfig.USE_AGENT_MD]: {
			type: 'boolean',
			title: nls.localize('chat.useAgentMd.title', "使用 AGENTS.MD 文件",),
			markdownDescription: nls.localize('chat.useAgentMd.description', "控制是否将工作区根目录中找到的 `AGENTS.MD` 文件中的指令附加到所有聊天请求。",),
			default: true,
			restricted: true,
			disallowConfigurationDefault: true,
			tags: ['prompts', 'reusable prompts', 'prompt snippets', 'instructions']
		},
		[PromptsConfig.USE_NESTED_AGENT_MD]: {
			type: 'boolean',
			title: nls.localize('chat.useNestedAgentMd.title', "使用嵌套的 AGENTS.MD 文件",),
			markdownDescription: nls.localize('chat.useNestedAgentMd.description', "控制是否在所有聊天请求中列出工作区中找到的嵌套 `AGENTS.MD` 文件中的指令。如果 `read` 工具可用，语言模型可以按需加载这些技能。",),
			default: false,
			restricted: true,
			disallowConfigurationDefault: true,
			tags: ['experimental', 'prompts', 'reusable prompts', 'prompt snippets', 'instructions']
		},
		[PromptsConfig.USE_CLAUDE_SKILLS]: {
			type: 'boolean',
			title: nls.localize('chat.useClaudeSkills.title', "使用 Claude 技能",),
			markdownDescription: nls.localize('chat.useClaudeSkills.description', "控制是否在所有聊天请求中列出工作区和用户主目录下 `.claude/skills` 中找到的 Claude 技能。如果 `read` 工具可用，语言模型可以按需加载这些技能。",),
			default: false,
			restricted: true,
			disallowConfigurationDefault: true,
			tags: ['experimental', 'prompts', 'reusable prompts', 'prompt snippets', 'instructions']
		},
		[PromptsConfig.PROMPT_FILES_SUGGEST_KEY]: {
			type: 'object',
			scope: ConfigurationScope.RESOURCE,
			title: nls.localize(
				'chat.promptFilesRecommendations.title',
				"提示文件推荐",
			),
			markdownDescription: nls.localize(
				'chat.promptFilesRecommendations.description',
				"配置在聊天欢迎视图中推荐哪些提示文件。每个键是提示文件名，值可以是 `true` 始终推荐，`false` 从不推荐，或 [when 子句](https://aka.ms/vscode-when-clause) 表达式，如 `resourceExtname == .js` 或 `resourceLangId == markdown`。",
			),
			default: {},
			additionalProperties: {
				oneOf: [
					{ type: 'boolean' },
					{ type: 'string' }
				]
			},
			tags: ['prompts', 'reusable prompts', 'prompt snippets', 'instructions'],
			examples: [
				{
					'plan': true,
					'a11y-audit': 'resourceExtname == .html',
					'document': 'resourceLangId == markdown'
				}
			],
		},
		[ChatConfiguration.TodosShowWidget]: {
			type: 'boolean',
			default: true,
			description: nls.localize('chat.tools.todos.showWidget', "控制是否在聊天输入上方显示待办事项列表小部件。启用后，小部件会显示智能体创建的待办事项，并随着进度更新。"),
			tags: ['experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		'chat.todoListTool.writeOnly': {
			type: 'boolean',
			default: false,
			description: nls.localize('chat.todoListTool.writeOnly', "启用后，待办事项工具以只写模式运行，要求智能体在上下文中记住待办事项。"),
			tags: ['experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		'chat.todoListTool.descriptionField': {
			type: 'boolean',
			default: true,
			description: nls.localize('chat.todoListTool.descriptionField', "启用后，待办事项包含实现上下文的详细描述。这提供了更多信息，但会使用额外的令牌，可能会减慢响应速度。"),
			tags: ['experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.ThinkingStyle]: {
			type: 'string',
			default: 'fixedScrolling',
			enum: ['collapsed', 'collapsedPreview', 'fixedScrolling'],
			enumDescriptions: [
				nls.localize('chat.agent.thinkingMode.collapsed', "思考部分默认折叠。"),
				nls.localize('chat.agent.thinkingMode.collapsedPreview', "思考部分先展开，然后在到达非思考部分时折叠。"),
				nls.localize('chat.agent.thinkingMode.fixedScrolling', "在固定高度的流式面板中显示思考，自动滚动；点击标题展开到完整高度。"),
			],
			description: nls.localize('chat.agent.thinkingStyle', "控制思考的呈现方式。"),
			tags: ['experimental'],
		},
		[ChatConfiguration.ThinkingGenerateTitles]: {
			type: 'boolean',
			default: true,
			description: nls.localize('chat.agent.thinking.generateTitles', "控制是否使用 LLM 为思考部分生成摘要标题。"),
			tags: ['experimental'],
		},
		'chat.agent.thinking.collapsedTools': {
			type: 'string',
			default: 'always',
			enum: ['off', 'withThinking', 'always'],
			enumDescriptions: [
				nls.localize('chat.agent.thinking.collapsedTools.off', "工具调用单独显示，不折叠到思考中。"),
				nls.localize('chat.agent.thinking.collapsedTools.withThinking', "当存在思考时，工具调用折叠到思考部分中。"),
				nls.localize('chat.agent.thinking.collapsedTools.always', "工具调用始终折叠，即使没有思考。"),
			],
			markdownDescription: nls.localize('chat.agent.thinking.collapsedTools', "控制工具调用相对于思考部分的显示方式。"),
			tags: ['experimental'],
		},
		'chat.disableAIFeatures': {
			type: 'boolean',
			description: nls.localize('chat.disableAIFeatures', "禁用并隐藏 GitHub Copilot 提供的内置 AI 功能，包括聊天和内联建议。"),
			default: false,
			scope: ConfigurationScope.WINDOW
		},
		[ChatConfiguration.ShowAgentSessionsViewDescription]: {
			type: 'boolean',
			description: nls.localize('chat.showAgentSessionsViewDescription', "控制是否在聊天会话视图中的第二行显示会话描述。"),
			default: true,
		},
		'chat.allowAnonymousAccess': { // TODO@bpasero remove me eventually
			type: 'boolean',
			description: nls.localize('chat.allowAnonymousAccess', "控制是否允许在聊天中进行匿名访问。"),
			default: false,
			tags: ['experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.RestoreLastPanelSession]: { // TODO@bpasero review this setting later
			type: 'boolean',
			description: nls.localize('chat.restoreLastPanelSession', "控制重启后是否在面板中恢复上次会话。"),
			default: true,
			tags: ['experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.ExitAfterDelegation]: {
			type: 'boolean',
			description: nls.localize('chat.exitAfterDelegation', "控制聊天面板在将请求委托给另一个会话后是否自动退出。"),
			default: true,
			tags: ['preview'],
		},
		'chat.extensionUnification.enabled': {
			type: 'boolean',
			description: nls.localize('chat.extensionUnification.enabled', "启用 GitHub Copilot 扩展的统一。启用后，所有 GitHub Copilot 功能都由 GitHub Copilot Chat 扩展提供。禁用后，GitHub Copilot 和 GitHub Copilot Chat 扩展独立运行。"),
			default: true,
			tags: ['experimental'],
			experiment: {
				mode: 'auto'
			}
		},
		[ChatConfiguration.SubagentToolCustomAgents]: {
			type: 'boolean',
			description: nls.localize('chat.subagentTool.customAgents', "runSubagent 工具是否能够使用自定义智能体。启用后，该工具可以接受自定义智能体的名称，但必须提供智能体的确切名称。"),
			default: false,
			tags: ['experimental'],
		}
	}
});
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ChatEditor,
		ChatEditorInput.EditorID,
		nls.localize('chat', "聊天")
	),
	[
		new SyncDescriptor(ChatEditorInput)
	]
);
Registry.as<IConfigurationMigrationRegistry>(Extensions.ConfigurationMigration).registerConfigurationMigrations([
	{
		key: 'chat.experimental.detectParticipant.enabled',
		migrateFn: (value, _accessor) => ([
			['chat.experimental.detectParticipant.enabled', { value: undefined }],
			['chat.detectParticipant.enabled', { value: value !== false }]
		])
	},
	{
		key: mcpDiscoverySection,
		migrateFn: (value: unknown) => {
			if (typeof value === 'boolean') {
				return { value: Object.fromEntries(allDiscoverySources.map(k => [k, value])) };
			}

			return { value };
		}
	},
]);

class ChatResolverContribution extends Disposable {

	static readonly ID = 'workbench.contrib.chatResolver';

	private readonly _editorRegistrations = this._register(new DisposableMap<string>());

	constructor(
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._registerEditor(Schemas.vscodeChatEditor);
		this._registerEditor(Schemas.vscodeLocalChatSession);

		this._register(chatSessionsService.onDidChangeContentProviderSchemes((e) => {
			for (const scheme of e.added) {
				this._registerEditor(scheme);
			}
			for (const scheme of e.removed) {
				this._editorRegistrations.deleteAndDispose(scheme);
			}
		}));

		for (const scheme of chatSessionsService.getContentProviderSchemes()) {
			this._registerEditor(scheme);
		}
	}

	private _registerEditor(scheme: string): void {
		this._editorRegistrations.set(scheme, this.editorResolverService.registerEditor(`${scheme}:**/**`,
			{
				id: ChatEditorInput.EditorID,
				label: nls.localize('chat', "聊天"),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === scheme,
			},
			{
				createEditorInput: ({ resource, options }) => {
					return {
						editor: this.instantiationService.createInstance(ChatEditorInput, resource, options as IChatEditorOptions),
						options
					};
				}
			}
		));
	}
}

class ChatAgentSettingContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatAgentSetting';

	constructor(
		@IWorkbenchAssignmentService private readonly experimentService: IWorkbenchAssignmentService,
		@IChatEntitlementService private readonly entitlementService: IChatEntitlementService,
	) {
		super();
		this.registerMaxRequestsSetting();
	}


	private registerMaxRequestsSetting(): void {
		let lastNode: IConfigurationNode | undefined;
		const registerMaxRequestsSetting = () => {
			const treatmentId = this.entitlementService.entitlement === ChatEntitlement.Free ?
				'chatAgentMaxRequestsFree' :
				'chatAgentMaxRequestsPro';
			Promise.all([
				this.experimentService.getTreatment<number>(treatmentId),
				this.experimentService.getTreatment<number>('chatAgentMaxRequestsLimit')
			]).then(([value, maxLimit]) => {
				const defaultValue = value ?? (this.entitlementService.entitlement === ChatEntitlement.Free ? 25 : 25);
				const node: IConfigurationNode = {
					id: 'chatSidebar',
					title: nls.localize('interactiveSessionConfigurationTitle', "聊天"),
					type: 'object',
					properties: {
						'chat.agent.maxRequests': {
							type: 'number',
							markdownDescription: nls.localize('chat.agent.maxRequests', "使用智能体时每轮允许的最大请求数。达到限制时，将询问是否确认继续。"),
							default: defaultValue,
							maximum: maxLimit,
						},
					}
				};
				configurationRegistry.updateConfigurations({ remove: lastNode ? [lastNode] : [], add: [node] });
				lastNode = node;
			});
		};
		this._register(Event.runAndSubscribe(Event.debounce(this.entitlementService.onDidChangeEntitlement, () => { }, 1000), () => registerMaxRequestsSetting()));
	}
}


/**
 * Workbench contribution to register actions for custom chat modes via events
 */
class ChatAgentActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatAgentActions';

	private readonly _modeActionDisposables = new DisposableMap<string>();

	constructor(
		@IChatModeService private readonly chatModeService: IChatModeService,
	) {
		super();
		this._store.add(this._modeActionDisposables);

		// Register actions for existing custom modes
		const { custom } = this.chatModeService.getModes();
		for (const mode of custom) {
			this._registerModeAction(mode);
		}

		// Listen for custom mode changes by tracking snapshots
		this._register(this.chatModeService.onDidChangeChatModes(() => {
			const { custom } = this.chatModeService.getModes();
			const currentModeIds = new Set<string>();
			const currentModeNames = new Map<string, string>();

			for (const mode of custom) {
				const modeName = mode.name.get();
				if (currentModeNames.has(modeName)) {
					// If there is a name collision, the later one in the list wins
					currentModeIds.delete(currentModeNames.get(modeName)!);
				}

				currentModeNames.set(modeName, mode.id);
				currentModeIds.add(mode.id);
			}

			// Remove modes that no longer exist and those replaced by modes later in the list with same name
			for (const modeId of this._modeActionDisposables.keys()) {
				if (!currentModeIds.has(modeId)) {
					this._modeActionDisposables.deleteAndDispose(modeId);
				}
			}

			// Register new modes
			for (const mode of custom) {
				if (currentModeIds.has(mode.id) && !this._modeActionDisposables.has(mode.id)) {
					this._registerModeAction(mode);
				}
			}
		}));
	}

	private _registerModeAction(mode: IChatMode): void {
		const actionClass = class extends ModeOpenChatGlobalAction {
			constructor() {
				super(mode);
			}
		};
		this._modeActionDisposables.set(mode.id, registerAction2(actionClass));
	}
}

class ToolReferenceNamesContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.toolReferenceNames';

	constructor(
		@ILanguageModelToolsService private readonly _languageModelToolsService: ILanguageModelToolsService,
	) {
		super();
		this._updateToolReferenceNames();
		this._register(this._languageModelToolsService.onDidChangeTools(() => this._updateToolReferenceNames()));
	}

	private _updateToolReferenceNames(): void {
		const tools =
			Array.from(this._languageModelToolsService.getTools())
				.filter((tool): tool is typeof tool & { toolReferenceName: string } => typeof tool.toolReferenceName === 'string')
				.sort((a, b) => a.toolReferenceName.localeCompare(b.toolReferenceName));
		toolReferenceNameEnumValues.length = 0;
		toolReferenceNameEnumDescriptions.length = 0;
		for (const tool of tools) {
			toolReferenceNameEnumValues.push(tool.toolReferenceName);
			toolReferenceNameEnumDescriptions.push(nls.localize(
				'chat.toolReferenceName.description',
				"{0} - {1}",
				tool.toolReferenceName,
				tool.userDescription || tool.displayName
			));
		}
		configurationRegistry.notifyConfigurationSchemaUpdated({
			id: 'chatSidebar',
			properties: {
				[ChatConfiguration.EligibleForAutoApproval]: {}
			}
		});
	}
}

AccessibleViewRegistry.register(new ChatTerminalOutputAccessibleView());
AccessibleViewRegistry.register(new ChatResponseAccessibleView());
AccessibleViewRegistry.register(new PanelChatAccessibilityHelp());
AccessibleViewRegistry.register(new QuickChatAccessibilityHelp());
AccessibleViewRegistry.register(new EditsChatAccessibilityHelp());
AccessibleViewRegistry.register(new AgentChatAccessibilityHelp());

registerEditorFeature(ChatInputBoxContentProvider);

class ChatSlashStaticSlashCommandsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.chatSlashStaticSlashCommands';

	constructor(
		@IChatSlashCommandService slashCommandService: IChatSlashCommandService,
		@ICommandService commandService: ICommandService,
		@IChatAgentService chatAgentService: IChatAgentService,
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._store.add(slashCommandService.registerSlashCommand({
			command: 'clear',
			detail: nls.localize('clear', "开始新聊天"),
			sortText: 'z2_clear',
			executeImmediately: true,
			locations: [ChatAgentLocation.Chat]
		}, async () => {
			commandService.executeCommand(ACTION_ID_NEW_CHAT);
		}));
		this._store.add(slashCommandService.registerSlashCommand({
			command: 'help',
			detail: '',
			sortText: 'z1_help',
			executeImmediately: true,
			locations: [ChatAgentLocation.Chat],
			modes: [ChatModeKind.Ask]
		}, async (prompt, progress, _history, _location, sessionResource) => {
			const defaultAgent = chatAgentService.getDefaultAgent(ChatAgentLocation.Chat);
			const agents = chatAgentService.getAgents();

			// Report prefix
			if (defaultAgent?.metadata.helpTextPrefix) {
				if (isMarkdownString(defaultAgent.metadata.helpTextPrefix)) {
					progress.report({ content: defaultAgent.metadata.helpTextPrefix, kind: 'markdownContent' });
				} else {
					progress.report({ content: new MarkdownString(defaultAgent.metadata.helpTextPrefix), kind: 'markdownContent' });
				}
				progress.report({ content: new MarkdownString('\n\n'), kind: 'markdownContent' });
			}

			// Report agent list
			const agentText = (await Promise.all(agents
				.filter(a => !a.isDefault && !a.isCore)
				.filter(a => a.locations.includes(ChatAgentLocation.Chat))
				.map(async a => {
					const description = a.description ? `- ${a.description}` : '';
					const agentMarkdown = instantiationService.invokeFunction(accessor => agentToMarkdown(a, sessionResource, true, accessor));
					const agentLine = `- ${agentMarkdown} ${description}`;
					const commandText = a.slashCommands.map(c => {
						const description = c.description ? `- ${c.description}` : '';
						return `\t* ${agentSlashCommandToMarkdown(a, c, sessionResource)} ${description}`;
					}).join('\n');

					return (agentLine + '\n' + commandText).trim();
				}))).join('\n');
			progress.report({ content: new MarkdownString(agentText, { isTrusted: { enabledCommands: [ChatSubmitAction.ID] } }), kind: 'markdownContent' });

			// Report help text ending
			if (defaultAgent?.metadata.helpTextPostfix) {
				progress.report({ content: new MarkdownString('\n\n'), kind: 'markdownContent' });
				if (isMarkdownString(defaultAgent.metadata.helpTextPostfix)) {
					progress.report({ content: defaultAgent.metadata.helpTextPostfix, kind: 'markdownContent' });
				} else {
					progress.report({ content: new MarkdownString(defaultAgent.metadata.helpTextPostfix), kind: 'markdownContent' });
				}
			}

			// Without this, the response will be done before it renders and so it will not stream. This ensures that if the response starts
			// rendering during the next 200ms, then it will be streamed. Once it starts streaming, the whole response streams even after
			// it has received all response data has been received.
			await timeout(200);
		}));
	}
}
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ChatEditorInput.TypeID, ChatEditorInputSerializer);

registerWorkbenchContribution2(ChatResolverContribution.ID, ChatResolverContribution, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(ChatSlashStaticSlashCommandsContribution.ID, ChatSlashStaticSlashCommandsContribution, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ChatExtensionPointHandler.ID, ChatExtensionPointHandler, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(LanguageModelToolsExtensionPointHandler.ID, LanguageModelToolsExtensionPointHandler, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatPromptFilesExtensionPointHandler.ID, ChatPromptFilesExtensionPointHandler, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatCompatibilityNotifier.ID, ChatCompatibilityNotifier, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(CopilotTitleBarMenuRendering.ID, CopilotTitleBarMenuRendering, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(CodeBlockActionRendering.ID, CodeBlockActionRendering, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ContinueChatInSessionActionRendering.ID, ContinueChatInSessionActionRendering, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatImplicitContextContribution.ID, ChatImplicitContextContribution, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ChatRelatedFilesContribution.ID, ChatRelatedFilesContribution, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ChatViewsWelcomeHandler.ID, ChatViewsWelcomeHandler, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(ChatGettingStartedContribution.ID, ChatGettingStartedContribution, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ChatSetupContribution.ID, ChatSetupContribution, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatTeardownContribution.ID, ChatTeardownContribution, WorkbenchPhase.AfterRestored);
// 禁用底部状态栏的 Copilot 图标 - 本地运行不需要
// registerWorkbenchContribution2(ChatStatusBarEntry.ID, ChatStatusBarEntry, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(BuiltinToolsContribution.ID, BuiltinToolsContribution, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ChatAgentSettingContribution.ID, ChatAgentSettingContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatAgentActionsContribution.ID, ChatAgentActionsContribution, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ToolReferenceNamesContribution.ID, ToolReferenceNamesContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatAgentRecommendation.ID, ChatAgentRecommendation, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ChatEditingEditorAccessibility.ID, ChatEditingEditorAccessibility, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatEditingEditorOverlay.ID, ChatEditingEditorOverlay, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(SimpleBrowserOverlay.ID, SimpleBrowserOverlay, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatEditingEditorContextKeys.ID, ChatEditingEditorContextKeys, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatTransferContribution.ID, ChatTransferContribution, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatContextContributions.ID, ChatContextContributions, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatResponseResourceFileSystemProvider.ID, ChatResponseResourceFileSystemProvider, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(PromptUrlHandler.ID, PromptUrlHandler, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatSessionsViewContrib.ID, ChatSessionsViewContrib, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatSessionsView.ID, ChatSessionsView, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatEditingNotebookFileSystemProviderContrib.ID, ChatEditingNotebookFileSystemProviderContrib, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(UserToolSetsContributions.ID, UserToolSetsContributions, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(PromptLanguageFeaturesProvider.ID, PromptLanguageFeaturesProvider, WorkbenchPhase.Eventually);

registerChatActions();
registerChatAccessibilityActions();
registerChatCopyActions();
registerChatCodeBlockActions();
registerChatCodeCompareBlockActions();
registerChatFileTreeActions();
registerChatPromptNavigationActions();
registerChatTitleActions();
registerChatExecuteActions();
registerQuickChatActions();
registerChatExportActions();
registerMoveActions();
registerNewChatActions();
registerChatContextActions();
registerChatDeveloperActions();
registerChatEditorActions();
registerChatElicitationActions();
registerChatToolActions();
registerLanguageModelActions();

registerEditorFeature(ChatPasteProvidersFeature);


registerSingleton(IChatTransferService, ChatTransferService, InstantiationType.Delayed);
registerSingleton(IChatService, ChatService, InstantiationType.Delayed);
registerSingleton(IChatWidgetService, ChatWidgetService, InstantiationType.Delayed);
registerSingleton(IQuickChatService, QuickChatService, InstantiationType.Delayed);
registerSingleton(IChatAccessibilityService, ChatAccessibilityService, InstantiationType.Delayed);
registerSingleton(IChatWidgetHistoryService, ChatWidgetHistoryService, InstantiationType.Delayed);
registerSingleton(ILanguageModelsService, LanguageModelsService, InstantiationType.Delayed);
registerSingleton(ILanguageModelStatsService, LanguageModelStatsService, InstantiationType.Delayed);
registerSingleton(IChatSlashCommandService, ChatSlashCommandService, InstantiationType.Delayed);
registerSingleton(IChatAgentService, ChatAgentService, InstantiationType.Delayed);
registerSingleton(IChatAgentNameService, ChatAgentNameService, InstantiationType.Delayed);
registerSingleton(IChatVariablesService, ChatVariablesService, InstantiationType.Delayed);
registerSingleton(ILanguageModelToolsService, LanguageModelToolsService, InstantiationType.Delayed);
registerSingleton(ILanguageModelToolsConfirmationService, LanguageModelToolsConfirmationService, InstantiationType.Delayed);
registerSingleton(IVoiceChatService, VoiceChatService, InstantiationType.Delayed);
registerSingleton(IChatCodeBlockContextProviderService, ChatCodeBlockContextProviderService, InstantiationType.Delayed);
registerSingleton(ICodeMapperService, CodeMapperService, InstantiationType.Delayed);
registerSingleton(IChatEditingService, ChatEditingService, InstantiationType.Delayed);
registerSingleton(IChatMarkdownAnchorService, ChatMarkdownAnchorService, InstantiationType.Delayed);
registerSingleton(ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService, InstantiationType.Delayed);
registerSingleton(IPromptsService, PromptsService, InstantiationType.Delayed);
registerSingleton(IChatContextPickService, ChatContextPickService, InstantiationType.Delayed);
registerSingleton(IChatModeService, ChatModeService, InstantiationType.Delayed);
registerSingleton(IChatAttachmentResolveService, ChatAttachmentResolveService, InstantiationType.Delayed);
registerSingleton(IChatTodoListService, ChatTodoListService, InstantiationType.Delayed);
registerSingleton(IChatOutputRendererService, ChatOutputRendererService, InstantiationType.Delayed);
registerSingleton(IChatLayoutService, ChatLayoutService, InstantiationType.Delayed);

registerAction2(ConfigureToolSets);
registerAction2(RenameChatSessionAction);
registerAction2(DeleteChatSessionAction);
registerAction2(OpenChatSessionInSidebarAction);
registerAction2(ToggleChatSessionsDescriptionDisplayAction);
registerAction2(ToggleAgentSessionsViewLocationAction);

ChatWidget.CONTRIBS.push(ChatDynamicVariableModel);
