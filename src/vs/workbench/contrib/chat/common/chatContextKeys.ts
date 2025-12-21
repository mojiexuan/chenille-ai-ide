/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IsWebContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { RemoteNameContext } from '../../../common/contextkeys.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { ChatEntitlementContextKeys } from '../../../services/chat/common/chatEntitlementService.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind } from './constants.js';

export namespace ChatContextKeys {
	export const responseVote = new RawContextKey<string>('chatSessionResponseVote', '', { type: 'string', description: localize('interactiveSessionResponseVote', "当响应被点赞时设置为'up'，被踩时设置为'down'，否则为空字符串。") });
	export const responseDetectedAgentCommand = new RawContextKey<boolean>('chatSessionResponseDetectedAgentOrCommand', false, { type: 'boolean', description: localize('chatSessionResponseDetectedAgentOrCommand', "当代理或命令被自动检测到时为True。") });
	export const responseSupportsIssueReporting = new RawContextKey<boolean>('chatResponseSupportsIssueReporting', false, { type: 'boolean', description: localize('chatResponseSupportsIssueReporting', "当前聊天响应支持问题报告时为True。") });
	export const responseIsFiltered = new RawContextKey<boolean>('chatSessionResponseFiltered', false, { type: 'boolean', description: localize('chatResponseFiltered', "当聊天响应被服务器过滤时为True。") });
	export const responseHasError = new RawContextKey<boolean>('chatSessionResponseError', false, { type: 'boolean', description: localize('chatResponseErrored', "当聊天响应出现错误时为True。") });
	export const requestInProgress = new RawContextKey<boolean>('chatSessionRequestInProgress', false, { type: 'boolean', description: localize('interactiveSessionRequestInProgress', "当前请求仍在进行中时为True。") });
	export const currentlyEditing = new RawContextKey<boolean>('chatSessionCurrentlyEditing', false, { type: 'boolean', description: localize('interactiveSessionCurrentlyEditing', "当前请求正在被编辑时为True。") });
	export const currentlyEditingInput = new RawContextKey<boolean>('chatSessionCurrentlyEditingInput', false, { type: 'boolean', description: localize('interactiveSessionCurrentlyEditingInput', "当底部的当前请求输入正在被编辑时为True。") });

	export const isResponse = new RawContextKey<boolean>('chatResponse', false, { type: 'boolean', description: localize('chatResponse', "聊天项是一个响应。") });
	export const isRequest = new RawContextKey<boolean>('chatRequest', false, { type: 'boolean', description: localize('chatRequest', "聊天项是一个请求。") });
	export const itemId = new RawContextKey<string>('chatItemId', '', { type: 'string', description: localize('chatItemId', "聊天项的ID。") });
	export const lastItemId = new RawContextKey<string[]>('chatLastItemId', [], { type: 'string', description: localize('chatLastItemId', "最后一个聊天项的ID。") });

	export const editApplied = new RawContextKey<boolean>('chatEditApplied', false, { type: 'boolean', description: localize('chatEditApplied', "当聊天文本编辑已应用时为True。") });

	export const inputHasText = new RawContextKey<boolean>('chatInputHasText', false, { type: 'boolean', description: localize('interactiveInputHasText', "当聊天输入框有文本时为True。") });
	export const inputHasFocus = new RawContextKey<boolean>('chatInputHasFocus', false, { type: 'boolean', description: localize('interactiveInputHasFocus', "当聊天输入框获得焦点时为True。") });
	export const inChatInput = new RawContextKey<boolean>('inChatInput', false, { type: 'boolean', description: localize('inInteractiveInput', "当焦点在聊天输入框中时为True，否则为False。") });
	export const inChatSession = new RawContextKey<boolean>('inChat', false, { type: 'boolean', description: localize('inChat', "当焦点在聊天小部件中时为True，否则为False。") });
	export const inChatEditor = new RawContextKey<boolean>('inChatEditor', false, { type: 'boolean', description: localize('inChatEditor', "焦点是否在聊天编辑器中。") });
	export const inChatTerminalToolOutput = new RawContextKey<boolean>('inChatTerminalToolOutput', false, { type: 'boolean', description: localize('inChatTerminalToolOutput', "当焦点在聊天终端输出区域时为True。") });
	export const chatModeKind = new RawContextKey<ChatModeKind>('chatAgentKind', ChatModeKind.Ask, { type: 'string', description: localize('agentKind', "当前代理的'类型'。") });
	export const chatToolCount = new RawContextKey<number>('chatToolCount', 0, { type: 'number', description: localize('chatToolCount', "当前代理中可用工具的数量。") });
	export const chatToolGroupingThreshold = new RawContextKey<number>('chat.toolGroupingThreshold', 0, { type: 'number', description: localize('chatToolGroupingThreshold', "开始进行虚拟分组的工具数量阈值。") });

	export const supported = ContextKeyExpr.or(IsWebContext.negate(), RemoteNameContext.notEqualsTo(''), ContextKeyExpr.has('config.chat.experimental.serverlessWebEnabled'));
	export const enabled = new RawContextKey<boolean>('chatIsEnabled', false, { type: 'boolean', description: localize('chatIsEnabled', "当聊天功能因默认聊天参与者已激活并有实现时启用为True。") });

	/**
	 * 当聊天小部件锁定到编码代理会话时为True。
	 */
	export const lockedToCodingAgent = new RawContextKey<boolean>('lockedToCodingAgent', false, { type: 'boolean', description: localize('lockedToCodingAgent', "当聊天小部件锁定到编码代理会话时为True。") });
	export const agentSupportsAttachments = new RawContextKey<boolean>('agentSupportsAttachments', false, { type: 'boolean', description: localize('agentSupportsAttachments', "当聊天代理支持附件时为True。") });
	export const withinEditSessionDiff = new RawContextKey<boolean>('withinEditSessionDiff', false, { type: 'boolean', description: localize('withinEditSessionDiff', "当聊天小部件分派到编辑会话聊天时为True。") });
	export const filePartOfEditSession = new RawContextKey<boolean>('filePartOfEditSession', false, { type: 'boolean', description: localize('filePartOfEditSession', "当聊天小部件在具有编辑会话的文件中时为True。") });

	export const extensionParticipantRegistered = new RawContextKey<boolean>('chatPanelExtensionParticipantRegistered', false, { type: 'boolean', description: localize('chatPanelExtensionParticipantRegistered', "当扩展为面板注册了默认聊天参与者时为True。") });
	export const panelParticipantRegistered = new RawContextKey<boolean>('chatPanelParticipantRegistered', false, { type: 'boolean', description: localize('chatParticipantRegistered', "当为面板注册了默认聊天参与者时为True。") });
	export const chatEditingCanUndo = new RawContextKey<boolean>('chatEditingCanUndo', false, { type: 'boolean', description: localize('chatEditingCanUndo', "当可以在编辑面板中撤销交互时为True。") });
	export const chatEditingCanRedo = new RawContextKey<boolean>('chatEditingCanRedo', false, { type: 'boolean', description: localize('chatEditingCanRedo', "当可以在编辑面板中重做交互时为True。") });
	export const languageModelsAreUserSelectable = new RawContextKey<boolean>('chatModelsAreUserSelectable', false, { type: 'boolean', description: localize('chatModelsAreUserSelectable', "当用户可以手动选择聊天模型时为True。") });
	export const chatSessionHasModels = new RawContextKey<boolean>('chatSessionHasModels', false, { type: 'boolean', description: localize('chatSessionHasModels', "当聊天处于具有可显示'模型'的贡献聊天会话中时为True。") });
	export const extensionInvalid = new RawContextKey<boolean>('chatExtensionInvalid', false, { type: 'boolean', description: localize('chatExtensionInvalid', "当已安装的聊天扩展无效且需要更新时为True。") });
	export const inputCursorAtTop = new RawContextKey<boolean>('chatCursorAtTop', false);
	export const inputHasAgent = new RawContextKey<boolean>('chatInputHasAgent', false);
	export const location = new RawContextKey<ChatAgentLocation>('chatLocation', undefined);
	export const inQuickChat = new RawContextKey<boolean>('quickChatHasFocus', false, { type: 'boolean', description: localize('inQuickChat', "当快速聊天UI获得焦点时为True，否则为False。") });
	export const hasFileAttachments = new RawContextKey<boolean>('chatHasFileAttachments', false, { type: 'boolean', description: localize('chatHasFileAttachments', "当聊天有文件附件时为True。") });
	export const chatSessionIsEmpty = new RawContextKey<boolean>('chatSessionIsEmpty', true, { type: 'boolean', description: localize('chatSessionIsEmpty', "当前聊天会话没有请求时为True。") });

	export const remoteJobCreating = new RawContextKey<boolean>('chatRemoteJobCreating', false, { type: 'boolean', description: localize('chatRemoteJobCreating', "当正在创建远程编码代理任务时为True。") });
	export const hasRemoteCodingAgent = new RawContextKey<boolean>('hasRemoteCodingAgent', false, localize('hasRemoteCodingAgent', "是否有任何远程编码代理可用"));
	export const enableRemoteCodingAgentPromptFileOverlay = new RawContextKey<boolean>('enableRemoteCodingAgentPromptFileOverlay', false, localize('enableRemoteCodingAgentPromptFileOverlay', "是否启用远程编码代理提示文件覆盖功能"));
	/** 当#new想要打开新文件夹时，扩展使用此键跳过退出确认 */
	export const skipChatRequestInProgressMessage = new RawContextKey<boolean>('chatSkipRequestInProgressMessage', false, { type: 'boolean', description: localize('chatSkipRequestInProgressMessage', "当应跳过聊天请求进行中消息时为True。") });

	// Re-exported from chat entitlement service
	export const Setup = ChatEntitlementContextKeys.Setup;
	export const Entitlement = ChatEntitlementContextKeys.Entitlement;
	export const chatQuotaExceeded = ChatEntitlementContextKeys.chatQuotaExceeded;
	export const completionsQuotaExceeded = ChatEntitlementContextKeys.completionsQuotaExceeded;

	export const Editing = {
		hasToolConfirmation: new RawContextKey<boolean>('chatHasToolConfirmation', false, { type: 'boolean', description: localize('chatEditingHasToolConfirmation', "当存在工具确认时为True。") }),
		hasElicitationRequest: new RawContextKey<boolean>('chatHasElicitationRequest', false, { type: 'boolean', description: localize('chatEditingHasElicitationRequest', "当聊天引出请求待处理时为True。") }),
	};

	export const Tools = {
		toolsCount: new RawContextKey<number>('toolsCount', 0, { type: 'number', description: localize('toolsCount', "聊天中可用工具的数量。") })
	};

	export const Modes = {
		hasCustomChatModes: new RawContextKey<boolean>('chatHasCustomAgents', false, { type: 'boolean', description: localize('chatHasAgents', "当聊天有可用的自定义代理时为True。") }),
		agentModeDisabledByPolicy: new RawContextKey<boolean>('chatAgentModeDisabledByPolicy', false, { type: 'boolean', description: localize('chatAgentModeDisabledByPolicy', "当代理模式被组织策略禁用时为True。") }),
	};

	export const panelLocation = new RawContextKey<ViewContainerLocation>('chatPanelLocation', undefined, { type: 'number', description: localize('chatPanelLocation', "聊天面板的位置。") });

	export const isCombinedAgentSessionsViewer = new RawContextKey<boolean>('chatIsCombinedSessionViewer', false, { type: 'boolean', description: localize('chatIsCombinedSessionViewer', "当聊天会话查看器使用新的组合样式时为True。") }); // TODO@bpasero eventually retire this context key
	export const agentSessionsViewerLimited = new RawContextKey<boolean>('agentSessionsViewerLimited', undefined, { type: 'boolean', description: localize('agentSessionsViewerLimited', "聊天视图中的代理会话视图是否仅限于显示最近的会话。") });
	export const agentSessionsViewerOrientation = new RawContextKey<number>('agentSessionsViewerOrientation', undefined, { type: 'number', description: localize('agentSessionsViewerOrientation', "聊天视图中代理会话视图的方向。") });
	export const agentSessionsViewerPosition = new RawContextKey<number>('agentSessionsViewerPosition', undefined, { type: 'number', description: localize('agentSessionsViewerPosition', "聊天视图中代理会话视图的位置。") });
	export const agentSessionType = new RawContextKey<string>('chatSessionType', '', { type: 'string', description: localize('agentSessionType', "当前代理会话项的类型。") });
	export const hasAgentSessionChanges = new RawContextKey<boolean>('agentSessionHasChanges', false, { type: 'boolean', description: localize('agentSessionHasChanges', "当前代理会话项有更改时为True。") });
	export const isArchivedAgentSession = new RawContextKey<boolean>('agentSessionIsArchived', false, { type: 'boolean', description: localize('agentSessionIsArchived', "当代理会话项已归档时为True。") });
	export const isReadAgentSession = new RawContextKey<boolean>('agentSessionIsRead', false, { type: 'boolean', description: localize('agentSessionIsRead', "当代理会话项已读时为True。") });
	export const isActiveAgentSession = new RawContextKey<boolean>('agentSessionIsActive', false, { type: 'boolean', description: localize('agentSessionIsActive', "当代理会话当前处于活动状态（不可删除）时为True。") });

	export const isKatexMathElement = new RawContextKey<boolean>('chatIsKatexMathElement', false, { type: 'boolean', description: localize('chatIsKatexMathElement', "当聚焦于KaTeX数学元素时为True。") });
}

export namespace ChatContextKeyExprs {
	export const inEditingMode = ContextKeyExpr.or(
		ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Edit),
		ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
	);

	/**
	 * 指示何时应显示欢迎/设置视图的上下文表达式
	 */
	export const chatSetupTriggerContext = ContextKeyExpr.or(
		ChatContextKeys.Setup.installed.negate(),
		ChatContextKeys.Entitlement.canSignUp
	);

	export const agentViewWhen = ContextKeyExpr.and(
		ChatEntitlementContextKeys.Setup.hidden.negate(),
		ChatEntitlementContextKeys.Setup.disabled.negate(),
		ContextKeyExpr.equals(`config.${ChatConfiguration.AgentSessionsViewLocation}`, 'view'));
}
