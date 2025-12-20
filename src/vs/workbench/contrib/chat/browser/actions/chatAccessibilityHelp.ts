/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { AccessibleDiffViewerNext } from '../../../../../editor/browser/widget/diffEditor/commands.js';
import { localize } from '../../../../../nls.js';
import { AccessibleContentProvider, AccessibleViewProviderId, AccessibleViewType } from '../../../../../platform/accessibility/browser/accessibleView.js';
import { IAccessibleViewImplementation } from '../../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { AccessibilityVerbositySettingId } from '../../../accessibility/browser/accessibilityConfiguration.js';
import { INLINE_CHAT_ID } from '../../../inlineChat/common/inlineChat.js';
import { TerminalContribCommandId } from '../../../terminal/terminalContribExports.js';
import { ChatContextKeyExprs, ChatContextKeys } from '../../common/chatContextKeys.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind } from '../../common/constants.js';
import { IChatWidgetService } from '../chat.js';
import { ChatEditingShowChangesAction, ViewPreviousEditsAction } from '../chatEditing/chatEditingActions.js';

export class PanelChatAccessibilityHelp implements IAccessibleViewImplementation {
	readonly priority = 107;
	readonly name = 'panelChat';
	readonly type = AccessibleViewType.Help;
	readonly when = ContextKeyExpr.and(ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat), ChatContextKeys.inQuickChat.negate(), ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Ask), ContextKeyExpr.or(ChatContextKeys.inChatSession, ChatContextKeys.isResponse, ChatContextKeys.isRequest));
	getProvider(accessor: ServicesAccessor) {
		return getChatAccessibilityHelpProvider(accessor, undefined, 'panelChat');
	}
}

export class QuickChatAccessibilityHelp implements IAccessibleViewImplementation {
	readonly priority = 107;
	readonly name = 'quickChat';
	readonly type = AccessibleViewType.Help;
	readonly when = ContextKeyExpr.and(ChatContextKeys.inQuickChat, ContextKeyExpr.or(ChatContextKeys.inChatSession, ChatContextKeys.isResponse, ChatContextKeys.isRequest));
	getProvider(accessor: ServicesAccessor) {
		return getChatAccessibilityHelpProvider(accessor, undefined, 'quickChat');
	}
}

export class EditsChatAccessibilityHelp implements IAccessibleViewImplementation {
	readonly priority = 119;
	readonly name = 'editsView';
	readonly type = AccessibleViewType.Help;
	readonly when = ContextKeyExpr.and(ChatContextKeyExprs.inEditingMode, ChatContextKeys.inChatInput);
	getProvider(accessor: ServicesAccessor) {
		return getChatAccessibilityHelpProvider(accessor, undefined, 'editsView');
	}
}

export class AgentChatAccessibilityHelp implements IAccessibleViewImplementation {
	readonly priority = 120;
	readonly name = 'agentView';
	readonly type = AccessibleViewType.Help;
	readonly when = ContextKeyExpr.and(ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent), ChatContextKeys.inChatInput);
	getProvider(accessor: ServicesAccessor) {
		return getChatAccessibilityHelpProvider(accessor, undefined, 'agentView');
	}
}

export function getAccessibilityHelpText(type: 'panelChat' | 'inlineChat' | 'agentView' | 'quickChat' | 'editsView' | 'agentView', keybindingService: IKeybindingService): string {
	const content = [];
	if (type === 'panelChat' || type === 'quickChat' || type === 'agentView') {
		if (type === 'quickChat') {
			content.push(localize('chat.overview', '快速聊天视图由输入框和请求/响应列表组成。输入框用于发送请求，列表用于显示响应。'));
			content.push(localize('chat.differenceQuick', '快速聊天视图是用于发送和查看请求的临时界面，而面板聊天视图是持久界面，还支持导航建议的后续问题。'));
		}
		if (type === 'panelChat') {
			content.push(localize('chat.differencePanel', '面板聊天视图是持久界面，还支持导航建议的后续问题，而快速聊天视图是用于发送和查看请求的临时界面。'));
		}
		content.push(localize('chat.requestHistory', '在输入框中，使用上下箭头键浏览请求历史记录。编辑输入内容后按 Enter 或点击提交按钮运行新请求。'));
		content.push(localize('chat.attachments.removal', '要移除附加的上下文，请聚焦到附件并按 Delete 或 Backspace 键。'));
		content.push(localize('chat.inspectResponse', '在输入框中，在无障碍视图中检查最后一个响应{0}。', '<keybinding:editor.action.accessibleView>'));
		content.push(localize('workbench.action.chat.focus', '要聚焦聊天请求和响应列表，请调用"聚焦聊天"命令{0}。这将把焦点移到最近的响应，然后您可以使用上下箭头键进行导航。', getChatFocusKeybindingLabel(keybindingService, type, 'last')));
		content.push(localize('workbench.action.chat.focusLastFocusedItem', '要返回到您上次聚焦的聊天响应，请调用"聚焦上次聚焦的聊天响应"命令{0}。', getChatFocusKeybindingLabel(keybindingService, type, 'lastFocused')));
		content.push(localize('workbench.action.chat.focusInput', '要聚焦聊天请求的输入框，请调用"聚焦聊天输入"命令{0}。', getChatFocusKeybindingLabel(keybindingService, type, 'input')));
		content.push(localize('chat.progressVerbosity', '在处理聊天请求时，如果请求超过 4 秒，您将听到详细的进度更新。这包括诸如"搜索 <搜索词> 找到 X 个结果"、"创建文件 <文件名>"或"读取文件 <文件路径>"等信息。可以通过 accessibility.verboseChatProgressUpdates 禁用此功能。'));
		content.push(localize('chat.announcement', '聊天响应将在到达时播报。响应将指示代码块的数量（如果有），然后是响应的其余部分。'));
		content.push(localize('workbench.action.chat.nextCodeBlock', '要聚焦响应中的下一个代码块，请调用"聊天: 下一个代码块"命令{0}。', '<keybinding:workbench.action.chat.nextCodeBlock>'));
		content.push(localize('workbench.action.chat.nextUserPrompt', '要导航到对话中的下一个用户提示，请调用"下一个用户提示"命令{0}。', '<keybinding:workbench.action.chat.nextUserPrompt>'));
		content.push(localize('workbench.action.chat.previousUserPrompt', '要导航到对话中的上一个用户提示，请调用"上一个用户提示"命令{0}。', '<keybinding:workbench.action.chat.previousUserPrompt>'));
		content.push(localize('workbench.action.chat.announceConfirmation', '要聚焦待处理的聊天确认对话框，请调用"聚焦聊天确认状态"命令{0}。', '<keybinding:workbench.action.chat.focusConfirmation>'));
		content.push(localize('chat.showHiddenTerminals', '如果有任何隐藏的聊天终端，您可以通过调用"查看隐藏的聊天终端"命令{0}来查看它们。', '<keybinding:workbench.action.terminal.chat.viewHiddenChatTerminals>'));
		content.push(localize('chat.focusMostRecentTerminal', '要聚焦运行工具的最后一个聊天终端，请调用"聚焦最近的聊天终端"命令{0}。', `<keybinding:${TerminalContribCommandId.FocusMostRecentChatTerminal}>`));
		content.push(localize('chat.focusMostRecentTerminalOutput', '要聚焦最后一个聊天终端工具的输出，请调用"聚焦最近的聊天终端输出"命令{0}。', `<keybinding:${TerminalContribCommandId.FocusMostRecentChatTerminalOutput}>`));
		if (type === 'panelChat') {
			content.push(localize('workbench.action.chat.newChat', '要创建新的聊天会话，请调用"新建聊天"命令{0}。', '<keybinding:workbench.action.chat.new>'));
		}
	}
	if (type === 'editsView' || type === 'agentView') {
		if (type === 'agentView') {
			content.push(localize('chatAgent.overview', '聊天代理视图用于在工作区中的文件之间应用编辑、在终端中运行命令等。'));
		} else {
			content.push(localize('chatEditing.overview', '聊天编辑视图用于在多个文件之间应用编辑。'));
		}
		content.push(localize('chatEditing.format', '它由输入框和文件工作集 (Shift+Tab) 组成。'));
		content.push(localize('chatEditing.expectation', '发送请求时，在应用编辑期间会显示进度指示器。'));
		content.push(localize('chatEditing.review', '编辑应用完成后，会播放声音表示文档已打开并准备好进行审查。可以通过 accessibility.signals.chatEditModifiedFile 禁用该声音。'));
		content.push(localize('chatEditing.sections', '使用"导航到上一个"{0}和"下一个"{1}在编辑器中的编辑之间导航', '<keybinding:chatEditor.action.navigatePrevious>', '<keybinding:chatEditor.action.navigateNext>'));
		content.push(localize('chatEditing.acceptHunk', '在编辑器中，对当前更改执行"保留"{0}、"撤销"{1}或"切换差异"{2}。', '<keybinding:chatEditor.action.acceptHunk>', '<keybinding:chatEditor.action.undoHunk>', '<keybinding:chatEditor.action.toggleDiff>'));
		content.push(localize('chatEditing.undoKeepSounds', '接受或撤销更改时会播放声音。可以通过 accessibility.signals.editsKept 和 accessibility.signals.editsUndone 禁用这些声音。'));
		if (type === 'agentView') {
			content.push(localize('chatAgent.userActionRequired', '当需要用户操作时会发出警报。例如，如果代理想要在终端中运行某些内容，您将听到"需要操作: 在终端中运行命令"。'));
			content.push(localize('chatAgent.runCommand', '要执行该操作，请使用接受工具命令{0}。', '<keybinding:workbench.action.chat.acceptTool>'));
			content.push(localize('chatAgent.autoApprove', '要自动批准工具操作而无需手动确认，请在设置中将 {0} 设置为 {1}。', ChatConfiguration.GlobalAutoApprove, 'true'));
			content.push(localize('chatAgent.acceptTool', '要接受工具操作，请使用"接受工具确认"命令{0}。', '<keybinding:workbench.action.chat.acceptTool>'));
			content.push(localize('chatAgent.openEditedFilesSetting', '默认情况下，当对文件进行编辑时，它们将被打开。要更改此行为，请在设置中将 accessibility.openChatEditedFiles 设置为 false。'));
		}
		content.push(localize('chatEditing.helpfulCommands', '一些有用的命令包括:'));
		content.push(localize('workbench.action.chat.undoEdits', '- 撤销编辑{0}。', '<keybinding:workbench.action.chat.undoEdits>'));
		content.push(localize('workbench.action.chat.editing.attachFiles', '- 附加文件{0}。', '<keybinding:workbench.action.chat.editing.attachFiles>'));
		content.push(localize('chatEditing.removeFileFromWorkingSet', '- 从工作集中移除文件{0}。', '<keybinding:chatEditing.removeFileFromWorkingSet>'));
		content.push(localize('chatEditing.acceptFile', '- 保留{0}和撤销文件{1}。', '<keybinding:chatEditing.acceptFile>', '<keybinding:chatEditing.discardFile>'));
		content.push(localize('chatEditing.saveAllFiles', '- 保存所有文件{0}。', '<keybinding:chatEditing.saveAllFiles>'));
		content.push(localize('chatEditing.acceptAllFiles', '- 保留所有编辑{0}。', '<keybinding:chatEditing.acceptAllFiles>'));
		content.push(localize('chatEditing.discardAllFiles', '- 撤销所有编辑{0}。', '<keybinding:chatEditing.discardAllFiles>'));
		content.push(localize('chatEditing.openFileInDiff', '- 在差异视图中打开文件{0}。', '<keybinding:chatEditing.openFileInDiff>'));
		content.push(`- ${ChatEditingShowChangesAction.LABEL}<keybinding:chatEditing.viewChanges>`);
		content.push(`- ${ViewPreviousEditsAction.Label}<keybinding:chatEditing.viewPreviousEdits>`);
	}
	else {
		content.push(localize('inlineChat.overview', "内联聊天发生在代码编辑器中，并考虑当前选择。它对于修改当前编辑器很有用。例如，修复诊断问题、编写文档或重构代码。请记住，AI 生成的代码可能不正确。"));
		content.push(localize('inlineChat.access', "可以通过代码操作或直接使用命令激活: 内联聊天: 开始内联聊天{0}。", '<keybinding:inlineChat.start>'));
		content.push(localize('inlineChat.requestHistory', '在输入框中，使用"显示上一个"{0}和"显示下一个"{1}浏览请求历史记录。编辑输入内容后按 Enter 或点击提交按钮运行新请求。', '<keybinding:history.showPrevious>', '<keybinding:history.showNext>'));
		content.push(localize('inlineChat.inspectResponse', '在输入框中，在无障碍视图中检查响应{0}。', '<keybinding:editor.action.accessibleView>'));
		content.push(localize('inlineChat.contextActions', "上下文菜单操作可能会运行以 / 为前缀的请求。输入 / 以发现此类预制命令。"));
		content.push(localize('inlineChat.fix', "如果调用了修复操作，响应将指示当前代码的问题。将呈现差异编辑器，可以通过 Tab 键访问。"));
		content.push(localize('inlineChat.diff', "进入差异编辑器后，使用{0}进入审查模式。使用上下箭头键导航包含建议更改的行。", AccessibleDiffViewerNext.id));
		content.push(localize('inlineChat.toolbar', "使用 Tab 键访问条件部分，如命令、状态、消息响应等。"));
	}
	content.push(localize('chat.signals', "可以通过以 signals.chat 为前缀的设置更改无障碍信号。默认情况下，如果请求超过 4 秒，您将听到表示进度仍在进行的声音。"));
	return content.join('\n');
}

export function getChatAccessibilityHelpProvider(accessor: ServicesAccessor, editor: ICodeEditor | undefined, type: 'panelChat' | 'inlineChat' | 'quickChat' | 'editsView' | 'agentView'): AccessibleContentProvider | undefined {
	const widgetService = accessor.get(IChatWidgetService);
	const keybindingService = accessor.get(IKeybindingService);
	const inputEditor: ICodeEditor | undefined = widgetService.lastFocusedWidget?.inputEditor;

	if (!inputEditor) {
		return;
	}
	const domNode = inputEditor.getDomNode() ?? undefined;
	if (!domNode) {
		return;
	}

	const cachedPosition = inputEditor.getPosition();
	inputEditor.getSupportedActions();
	const helpText = getAccessibilityHelpText(type, keybindingService);
	return new AccessibleContentProvider(
		type === 'panelChat' ? AccessibleViewProviderId.PanelChat : type === 'inlineChat' ? AccessibleViewProviderId.InlineChat : type === 'agentView' ? AccessibleViewProviderId.AgentChat : AccessibleViewProviderId.QuickChat,
		{ type: AccessibleViewType.Help },
		() => helpText,
		() => {
			if (type === 'quickChat' || type === 'editsView' || type === 'agentView' || type === 'panelChat') {
				if (cachedPosition) {
					inputEditor.setPosition(cachedPosition);
				}
				inputEditor.focus();

			} else if (type === 'inlineChat') {
				// TODO@jrieken find a better way for this
				const ctrl = <{ focus(): void } | undefined>editor?.getContribution(INLINE_CHAT_ID);
				ctrl?.focus();

			}
		},
		type === 'panelChat' ? AccessibilityVerbositySettingId.Chat : AccessibilityVerbositySettingId.InlineChat,
	);
}

// The when clauses for actions may not be true when we invoke the accessible view, so we need to provide the keybinding label manually
// to ensure it's correct
function getChatFocusKeybindingLabel(keybindingService: IKeybindingService, type: 'agentView' | 'panelChat' | 'inlineChat' | 'quickChat', focus?: 'lastFocused' | 'last' | 'input'): string | undefined {
	let kbs;
	const fallback = ' (unassigned keybinding)';
	if (focus === 'input') {
		kbs = keybindingService.lookupKeybindings('workbench.action.chat.focusInput');
	} else if (focus === 'lastFocused') {
		kbs = keybindingService.lookupKeybindings('workbench.chat.action.focusLastFocused');
	} else {
		kbs = keybindingService.lookupKeybindings('chat.action.focus');
	}
	if (!kbs?.length) {
		return fallback;
	}
	let kb;
	if (type === 'agentView' || type === 'panelChat') {
		if (focus !== 'input') {
			kb = kbs.find(kb => kb.getAriaLabel()?.includes('UpArrow'))?.getAriaLabel();
		} else {
			kb = kbs.find(kb => kb.getAriaLabel()?.includes('DownArrow'))?.getAriaLabel();
		}
	} else {
		// Quick chat
		if (focus !== 'input') {
			kb = kbs.find(kb => kb.getAriaLabel()?.includes('DownArrow'))?.getAriaLabel();
		} else {
			kb = kbs.find(kb => kb.getAriaLabel()?.includes('UpArrow'))?.getAriaLabel();
		}
	}
	return !!kb ? ` (${kb})` : fallback;
}
