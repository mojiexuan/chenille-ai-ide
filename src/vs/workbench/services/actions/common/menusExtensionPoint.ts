/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { isFalsyOrWhitespace } from '../../../../base/common/strings.js';
import * as resources from '../../../../base/common/resources.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { IExtensionPointUser, ExtensionMessageCollector, ExtensionsRegistry } from '../../extensions/common/extensionsRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { MenuId, MenuRegistry, IMenuItem, ISubmenuItem } from '../../../../platform/actions/common/actions.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { index } from '../../../../base/common/arrays.js';
import { isProposedApiEnabled } from '../../extensions/common/extensions.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { IExtensionFeatureTableRenderer, IExtensionFeaturesRegistry, IRenderedData, IRowData, ITableData, Extensions as ExtensionFeaturesExtensions } from '../../extensionManagement/common/extensionFeatures.js';
import { IExtensionManifest, IKeyBinding } from '../../../../platform/extensions/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { platform } from '../../../../base/common/process.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { ResolvedKeybinding } from '../../../../base/common/keybindings.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ApiProposalName } from '../../../../platform/extensions/common/extensionsApiProposals.js';

interface IAPIMenu {
	readonly key: string;
	readonly id: MenuId;
	readonly description: string;
	readonly proposed?: ApiProposalName;
	readonly supportsSubmenus?: boolean; // defaults to true
}

const apiMenus: IAPIMenu[] = [
	{
		key: 'commandPalette',
		id: MenuId.CommandPalette,
		description: localize('menus.commandPalette', "命令面板"),
		supportsSubmenus: false
	},
	{
		key: 'touchBar',
		id: MenuId.TouchBarContext,
		description: localize('menus.touchBar', "触控栏 (仅限 macOS)"),
		supportsSubmenus: false
	},
	{
		key: 'editor/title',
		id: MenuId.EditorTitle,
		description: localize('menus.editorTitle', "编辑器标题菜单")
	},
	{
		key: 'editor/title/run',
		id: MenuId.EditorTitleRun,
		description: localize('menus.editorTitleRun', "编辑器标题菜单中的运行子菜单")
	},
	{
		key: 'editor/context',
		id: MenuId.EditorContext,
		description: localize('menus.editorContext', "编辑器上下文菜单")
	},
	{
		key: 'editor/context/copy',
		id: MenuId.EditorContextCopy,
		description: localize('menus.editorContextCopyAs', '编辑器上下文菜单中的"复制为"子菜单')
	},
	{
		key: 'editor/context/share',
		id: MenuId.EditorContextShare,
		description: localize('menus.editorContextShare', '编辑器上下文菜单中的"共享"子菜单'),
		proposed: 'contribShareMenu'
	},
	{
		key: 'explorer/context',
		id: MenuId.ExplorerContext,
		description: localize('menus.explorerContext', "文件资源管理器上下文菜单")
	},
	{
		key: 'explorer/context/share',
		id: MenuId.ExplorerContextShare,
		description: localize('menus.explorerContextShare', '文件资源管理器上下文菜单中的"共享"子菜单'),
		proposed: 'contribShareMenu'
	},
	{
		key: 'editor/title/context',
		id: MenuId.EditorTitleContext,
		description: localize('menus.editorTabContext', "编辑器选项卡上下文菜单")
	},
	{
		key: 'editor/title/context/share',
		id: MenuId.EditorTitleContextShare,
		description: localize('menus.editorTitleContextShare', '编辑器标题上下文菜单中的"共享"子菜单'),
		proposed: 'contribShareMenu'
	},
	{
		key: 'debug/callstack/context',
		id: MenuId.DebugCallStackContext,
		description: localize('menus.debugCallstackContext', "调试调用堆栈视图上下文菜单")
	},
	{
		key: 'debug/variables/context',
		id: MenuId.DebugVariablesContext,
		description: localize('menus.debugVariablesContext', "调试变量视图上下文菜单")
	},
	{
		key: 'debug/watch/context',
		id: MenuId.DebugWatchContext,
		description: localize('menus.debugWatchContext', "调试监视视图上下文菜单")
	},
	{
		key: 'debug/toolBar',
		id: MenuId.DebugToolBar,
		description: localize('menus.debugToolBar', "调试工具栏菜单")
	},
	{
		key: 'debug/createConfiguration',
		id: MenuId.DebugCreateConfiguration,
		proposed: 'contribDebugCreateConfiguration',
		description: localize('menus.debugCreateConfiguation', "调试创建配置菜单")
	},
	{
		key: 'notebook/variables/context',
		id: MenuId.NotebookVariablesContext,
		description: localize('menus.notebookVariablesContext', "笔记本变量视图上下文菜单")
	},
	{
		key: 'menuBar/home',
		id: MenuId.MenubarHomeMenu,
		description: localize('menus.home', "主页指示器上下文菜单 (仅限 Web)"),
		proposed: 'contribMenuBarHome',
		supportsSubmenus: false
	},
	{
		key: 'menuBar/edit/copy',
		id: MenuId.MenubarCopy,
		description: localize('menus.opy', '顶级编辑菜单中的"复制为"子菜单')
	},
	{
		key: 'scm/title',
		id: MenuId.SCMTitle,
		description: localize('menus.scmTitle', "源代码管理标题菜单")
	},
	{
		key: 'scm/sourceControl',
		id: MenuId.SCMSourceControl,
		description: localize('menus.scmSourceControl', "源代码管理菜单")
	},
	{
		key: 'scm/repositories/title',
		id: MenuId.SCMSourceControlTitle,
		description: localize('menus.scmSourceControlTitle', "源代码管理存储库标题菜单"),
		proposed: 'contribSourceControlTitleMenu'
	},
	{
		key: 'scm/repository',
		id: MenuId.SCMSourceControlInline,
		description: localize('menus.scmSourceControlInline', "源代码管理存储库菜单"),
	},
	{
		key: 'scm/resourceState/context',
		id: MenuId.SCMResourceContext,
		description: localize('menus.resourceStateContext', "源代码管理资源状态上下文菜单")
	},
	{
		key: 'scm/resourceFolder/context',
		id: MenuId.SCMResourceFolderContext,
		description: localize('menus.resourceFolderContext', "源代码管理资源文件夹上下文菜单")
	},
	{
		key: 'scm/resourceGroup/context',
		id: MenuId.SCMResourceGroupContext,
		description: localize('menus.resourceGroupContext', "源代码管理资源组上下文菜单")
	},
	{
		key: 'scm/change/title',
		id: MenuId.SCMChangeContext,
		description: localize('menus.changeTitle', "源代码管理内联更改菜单")
	},
	{
		key: 'scm/inputBox',
		id: MenuId.SCMInputBox,
		description: localize('menus.input', "源代码管理输入框菜单"),
		proposed: 'contribSourceControlInputBoxMenu'
	},
	{
		key: 'scm/history/title',
		id: MenuId.SCMHistoryTitle,
		description: localize('menus.scmHistoryTitle', "源代码管理历史记录标题菜单"),
		proposed: 'contribSourceControlHistoryTitleMenu'
	},
	{
		key: 'scm/historyItem/context',
		id: MenuId.SCMHistoryItemContext,
		description: localize('menus.historyItemContext', "源代码管理历史记录项上下文菜单"),
		proposed: 'contribSourceControlHistoryItemMenu'
	},
	{
		key: 'scm/historyItemRef/context',
		id: MenuId.SCMHistoryItemRefContext,
		description: localize('menus.historyItemRefContext', "源代码管理历史记录项引用上下文菜单"),
		proposed: 'contribSourceControlHistoryItemMenu'
	},
	{
		key: 'scm/artifactGroup/context',
		id: MenuId.SCMArtifactGroupContext,
		description: localize('menus.artifactGroupContext', "源代码管理工件组上下文菜单"),
		proposed: 'contribSourceControlArtifactGroupMenu'
	},
	{
		key: 'scm/artifact/context',
		id: MenuId.SCMArtifactContext,
		description: localize('menus.artifactContext', "源代码管理工件上下文菜单"),
		proposed: 'contribSourceControlArtifactMenu'
	},
	{
		key: 'statusBar/remoteIndicator',
		id: MenuId.StatusBarRemoteIndicatorMenu,
		description: localize('menus.statusBarRemoteIndicator', "状态栏中的远程指示器菜单"),
		supportsSubmenus: false
	},
	{
		key: 'terminal/context',
		id: MenuId.TerminalInstanceContext,
		description: localize('menus.terminalContext', "终端上下文菜单")
	},
	{
		key: 'terminal/title/context',
		id: MenuId.TerminalTabContext,
		description: localize('menus.terminalTabContext', "终端选项卡上下文菜单")
	},
	{
		key: 'view/title',
		id: MenuId.ViewTitle,
		description: localize('view.viewTitle', "贡献的视图标题菜单")
	},
	{
		key: 'viewContainer/title',
		id: MenuId.ViewContainerTitle,
		description: localize('view.containerTitle', "贡献的视图容器标题菜单"),
		proposed: 'contribViewContainerTitle'
	},
	{
		key: 'view/item/context',
		id: MenuId.ViewItemContext,
		description: localize('view.itemContext', "贡献的视图项上下文菜单")
	},
	{
		key: 'comments/comment/editorActions',
		id: MenuId.CommentEditorActions,
		description: localize('commentThread.editorActions', "贡献的评论编辑器操作"),
		proposed: 'contribCommentEditorActionsMenu'
	},
	{
		key: 'comments/commentThread/title',
		id: MenuId.CommentThreadTitle,
		description: localize('commentThread.title', "贡献的评论线程标题菜单")
	},
	{
		key: 'comments/commentThread/context',
		id: MenuId.CommentThreadActions,
		description: localize('commentThread.actions', "贡献的评论线程上下文菜单，在评论编辑器下方显示为按钮"),
		supportsSubmenus: false
	},
	{
		key: 'comments/commentThread/additionalActions',
		id: MenuId.CommentThreadAdditionalActions,
		description: localize('commentThread.actions', "贡献的评论线程上下文菜单，在评论编辑器下方显示为按钮"),
		supportsSubmenus: true,
		proposed: 'contribCommentThreadAdditionalMenu'
	},
	{
		key: 'comments/commentThread/title/context',
		id: MenuId.CommentThreadTitleContext,
		description: localize('commentThread.titleContext', "贡献的评论线程标题速览上下文菜单，在评论线程速览标题上右键单击时显示"),
		proposed: 'contribCommentPeekContext'
	},
	{
		key: 'comments/comment/title',
		id: MenuId.CommentTitle,
		description: localize('comment.title', "贡献的评论标题菜单")
	},
	{
		key: 'comments/comment/context',
		id: MenuId.CommentActions,
		description: localize('comment.actions', "贡献的评论上下文菜单，在评论编辑器下方显示为按钮"),
		supportsSubmenus: false
	},
	{
		key: 'comments/commentThread/comment/context',
		id: MenuId.CommentThreadCommentContext,
		description: localize('comment.commentContext', "贡献的评论上下文菜单，在评论线程速览视图中的单个评论上右键单击时显示"),
		proposed: 'contribCommentPeekContext'
	},
	{
		key: 'commentsView/commentThread/context',
		id: MenuId.CommentsViewThreadActions,
		description: localize('commentsView.threadActions', "评论视图中贡献的评论线程上下文菜单"),
		proposed: 'contribCommentsViewThreadMenus'
	},
	{
		key: 'notebook/toolbar',
		id: MenuId.NotebookToolbar,
		description: localize('notebook.toolbar', "贡献的笔记本工具栏菜单")
	},
	{
		key: 'notebook/kernelSource',
		id: MenuId.NotebookKernelSource,
		description: localize('notebook.kernelSource', "贡献的笔记本内核源菜单"),
		proposed: 'notebookKernelSource'
	},
	{
		key: 'notebook/cell/title',
		id: MenuId.NotebookCellTitle,
		description: localize('notebook.cell.title', "贡献的笔记本单元格标题菜单")
	},
	{
		key: 'notebook/cell/execute',
		id: MenuId.NotebookCellExecute,
		description: localize('notebook.cell.execute', "贡献的笔记本单元格执行菜单")
	},
	{
		key: 'interactive/toolbar',
		id: MenuId.InteractiveToolbar,
		description: localize('interactive.toolbar', "贡献的交互式工具栏菜单"),
	},
	{
		key: 'interactive/cell/title',
		id: MenuId.InteractiveCellTitle,
		description: localize('interactive.cell.title', "贡献的交互式单元格标题菜单"),
	},
	{
		key: 'issue/reporter',
		id: MenuId.IssueReporter,
		description: localize('issue.reporter', "贡献的问题报告菜单")
	},
	{
		key: 'testing/item/context',
		id: MenuId.TestItem,
		description: localize('testing.item.context', "贡献的测试项菜单"),
	},
	{
		key: 'testing/item/gutter',
		id: MenuId.TestItemGutter,
		description: localize('testing.item.gutter.title', "测试项的边槽装饰菜单"),
	},
	{
		key: 'testing/profiles/context',
		id: MenuId.TestProfilesContext,
		description: localize('testing.profiles.context.title', "配置测试配置文件的菜单"),
	},
	{
		key: 'testing/item/result',
		id: MenuId.TestPeekElement,
		description: localize('testing.item.result.title', "测试结果视图或速览中项目的菜单"),
	},
	{
		key: 'testing/message/context',
		id: MenuId.TestMessageContext,
		description: localize('testing.message.context.title', "显示消息的编辑器内容上方的突出按钮"),
	},
	{
		key: 'testing/message/content',
		id: MenuId.TestMessageContent,
		description: localize('testing.message.content.title', "结果树中消息的上下文菜单"),
	},
	{
		key: 'extension/context',
		id: MenuId.ExtensionContext,
		description: localize('menus.extensionContext', "扩展上下文菜单")
	},
	{
		key: 'timeline/title',
		id: MenuId.TimelineTitle,
		description: localize('view.timelineTitle', "时间线视图标题菜单")
	},
	{
		key: 'timeline/item/context',
		id: MenuId.TimelineItemContext,
		description: localize('view.timelineContext', "时间线视图项上下文菜单")
	},
	{
		key: 'ports/item/context',
		id: MenuId.TunnelContext,
		description: localize('view.tunnelContext', "端口视图项上下文菜单")
	},
	{
		key: 'ports/item/origin/inline',
		id: MenuId.TunnelOriginInline,
		description: localize('view.tunnelOriginInline', "端口视图项来源内联菜单")
	},
	{
		key: 'ports/item/port/inline',
		id: MenuId.TunnelPortInline,
		description: localize('view.tunnelPortInline', "端口视图项端口内联菜单")
	},
	{
		key: 'file/newFile',
		id: MenuId.NewFile,
		description: localize('file.newFile', '"新建文件..."快速选择，显示在欢迎页面和文件菜单中'),
		supportsSubmenus: false,
	},
	{
		key: 'webview/context',
		id: MenuId.WebviewContext,
		description: localize('webview.context', "Webview 上下文菜单")
	},
	{
		key: 'file/share',
		id: MenuId.MenubarShare,
		description: localize('menus.share', "顶级文件菜单中显示的共享子菜单"),
		proposed: 'contribShareMenu'
	},
	{
		key: 'editor/inlineCompletions/actions',
		id: MenuId.InlineCompletionsActions,
		description: localize('inlineCompletions.actions', "悬停在内联补全上时显示的操作"),
		supportsSubmenus: false,
		proposed: 'inlineCompletionsAdditions'
	},
	{
		key: 'editor/content',
		id: MenuId.EditorContent,
		description: localize('merge.toolbar', "编辑器中的突出按钮，覆盖其内容"),
		proposed: 'contribEditorContentMenu'
	},
	{
		key: 'editor/lineNumber/context',
		id: MenuId.EditorLineNumberContext,
		description: localize('editorLineNumberContext', "贡献的编辑器行号上下文菜单")
	},
	{
		key: 'mergeEditor/result/title',
		id: MenuId.MergeInputResultToolbar,
		description: localize('menus.mergeEditorResult', "合并编辑器的结果工具栏"),
		proposed: 'contribMergeEditorMenus'
	},
	{
		key: 'multiDiffEditor/content',
		id: MenuId.MultiDiffEditorContent,
		description: localize('menus.multiDiffEditorContent', "覆盖多差异编辑器的突出按钮"),
		proposed: 'contribEditorContentMenu'
	},
	{
		key: 'multiDiffEditor/resource/title',
		id: MenuId.MultiDiffEditorFileToolbar,
		description: localize('menus.multiDiffEditorResource', "多差异编辑器中的资源工具栏"),
		proposed: 'contribMultiDiffEditorMenus'
	},
	{
		key: 'diffEditor/gutter/hunk',
		id: MenuId.DiffEditorHunkToolbar,
		description: localize('menus.diffEditorGutterToolBarMenus', "差异编辑器中的边槽工具栏"),
		proposed: 'contribDiffEditorGutterToolBarMenus'
	},
	{
		key: 'diffEditor/gutter/selection',
		id: MenuId.DiffEditorSelectionToolbar,
		description: localize('menus.diffEditorGutterToolBarMenus', "差异编辑器中的边槽工具栏"),
		proposed: 'contribDiffEditorGutterToolBarMenus'
	},
	{
		key: 'searchPanel/aiResults/commands',
		id: MenuId.SearchActionMenu,
		description: localize('searchPanel.aiResultsCommands', "将贡献到 AI 搜索标题旁边显示为按钮的菜单的命令"),
	},
	{
		key: 'editor/context/chat',
		id: MenuId.ChatTextEditorMenu,
		description: localize('menus.chatTextEditor', "文本编辑器上下文菜单中的聊天子菜单"),
		supportsSubmenus: false,
		proposed: 'chatParticipantPrivate'
	},
	{
		key: 'chat/input/editing/sessionToolbar',
		id: MenuId.ChatEditingSessionChangesToolbar,
		description: localize('menus.chatEditingSessionChangesToolbar', "聊天编辑小部件的会话更改工具栏菜单"),
		proposed: 'chatSessionsProvider'
	},
	{
		// TODO: rename this to something like: `chatSessions/item/inline`
		key: 'chat/chatSessions',
		id: MenuId.AgentSessionsContext,
		description: localize('menus.chatSessions', "聊天会话菜单"),
		supportsSubmenus: false,
		proposed: 'chatSessionsProvider'
	},
	{
		key: 'chatSessions/newSession',
		id: MenuId.AgentSessionsCreateSubMenu,
		description: localize('menus.chatSessionsNewSession', "新建聊天会话的菜单"),
		supportsSubmenus: false,
		proposed: 'chatSessionsProvider'
	},
	{
		key: 'chat/multiDiff/context',
		id: MenuId.ChatMultiDiffContext,
		description: localize('menus.chatMultiDiffContext', "聊天多差异上下文菜单"),
		supportsSubmenus: false,
		proposed: 'chatSessionsProvider',
	},
];

namespace schema {

	// --- menus, submenus contribution point

	export interface IUserFriendlyMenuItem {
		command: string;
		alt?: string;
		when?: string;
		group?: string;
	}

	export interface IUserFriendlySubmenuItem {
		submenu: string;
		when?: string;
		group?: string;
	}

	export interface IUserFriendlySubmenu {
		id: string;
		label: string;
		icon?: IUserFriendlyIcon;
	}

	export function isMenuItem(item: IUserFriendlyMenuItem | IUserFriendlySubmenuItem): item is IUserFriendlyMenuItem {
		return typeof (item as IUserFriendlyMenuItem).command === 'string';
	}

	export function isValidMenuItem(item: IUserFriendlyMenuItem, collector: ExtensionMessageCollector): boolean {
		if (typeof item.command !== 'string') {
			collector.error(localize('requirestring', "属性 `{0}` 是必需的，且必须是 `string` 类型", 'command'));
			return false;
		}
		if (item.alt && typeof item.alt !== 'string') {
			collector.error(localize('optstring', "属性 `{0}` 可以省略或必须是 `string` 类型", 'alt'));
			return false;
		}
		if (item.when && typeof item.when !== 'string') {
			collector.error(localize('optstring', "属性 `{0}` 可以省略或必须是 `string` 类型", 'when'));
			return false;
		}
		if (item.group && typeof item.group !== 'string') {
			collector.error(localize('optstring', "属性 `{0}` 可以省略或必须是 `string` 类型", 'group'));
			return false;
		}

		return true;
	}

	export function isValidSubmenuItem(item: IUserFriendlySubmenuItem, collector: ExtensionMessageCollector): boolean {
		if (typeof item.submenu !== 'string') {
			collector.error(localize('requirestring', "属性 `{0}` 是必需的，且必须是 `string` 类型", 'submenu'));
			return false;
		}
		if (item.when && typeof item.when !== 'string') {
			collector.error(localize('optstring', "属性 `{0}` 可以省略或必须是 `string` 类型", 'when'));
			return false;
		}
		if (item.group && typeof item.group !== 'string') {
			collector.error(localize('optstring', "属性 `{0}` 可以省略或必须是 `string` 类型", 'group'));
			return false;
		}

		return true;
	}

	export function isValidItems(items: (IUserFriendlyMenuItem | IUserFriendlySubmenuItem)[], collector: ExtensionMessageCollector): boolean {
		if (!Array.isArray(items)) {
			collector.error(localize('requirearray', "子菜单项必须是数组"));
			return false;
		}

		for (const item of items) {
			if (isMenuItem(item)) {
				if (!isValidMenuItem(item, collector)) {
					return false;
				}
			} else {
				if (!isValidSubmenuItem(item, collector)) {
					return false;
				}
			}
		}

		return true;
	}

	export function isValidSubmenu(submenu: IUserFriendlySubmenu, collector: ExtensionMessageCollector): boolean {
		if (typeof submenu !== 'object') {
			collector.error(localize('require', "子菜单项必须是对象"));
			return false;
		}

		if (typeof submenu.id !== 'string') {
			collector.error(localize('requirestring', "属性 `{0}` 是必需的，且必须是 `string` 类型", 'id'));
			return false;
		}
		if (typeof submenu.label !== 'string') {
			collector.error(localize('requirestring', "属性 `{0}` 是必需的，且必须是 `string` 类型", 'label'));
			return false;
		}

		return true;
	}

	const menuItem: IJSONSchema = {
		type: 'object',
		required: ['command'],
		properties: {
			command: {
				description: localize('vscode.extension.contributes.menuItem.command', '要执行的命令的标识符。该命令必须在 "commands" 部分中声明'),
				type: 'string'
			},
			alt: {
				description: localize('vscode.extension.contributes.menuItem.alt', '要执行的替代命令的标识符。该命令必须在 "commands" 部分中声明'),
				type: 'string'
			},
			when: {
				description: localize('vscode.extension.contributes.menuItem.when', '显示此项必须为 true 的条件'),
				type: 'string'
			},
			group: {
				description: localize('vscode.extension.contributes.menuItem.group', '此项所属的组'),
				type: 'string'
			}
		}
	};

	const submenuItem: IJSONSchema = {
		type: 'object',
		required: ['submenu'],
		properties: {
			submenu: {
				description: localize('vscode.extension.contributes.menuItem.submenu', '要在此项中显示的子菜单的标识符'),
				type: 'string'
			},
			when: {
				description: localize('vscode.extension.contributes.menuItem.when', '显示此项必须为 true 的条件'),
				type: 'string'
			},
			group: {
				description: localize('vscode.extension.contributes.menuItem.group', '此项所属的组'),
				type: 'string'
			}
		}
	};

	const submenu: IJSONSchema = {
		type: 'object',
		required: ['id', 'label'],
		properties: {
			id: {
				description: localize('vscode.extension.contributes.submenu.id', '要显示为子菜单的菜单的标识符'),
				type: 'string'
			},
			label: {
				description: localize('vscode.extension.contributes.submenu.label', '指向此子菜单的菜单项的标签'),
				type: 'string'
			},
			icon: {
				description: localize({ key: 'vscode.extension.contributes.submenu.icon', comment: ['do not translate or change "\\$(zap)", \\ in front of $ is important.'] }, '(可选) 用于在 UI 中表示子菜单的图标。可以是文件路径、包含深色和浅色主题文件路径的对象，或主题图标引用，如 "\\$(zap)"'),
				anyOf: [{
					type: 'string'
				},
				{
					type: 'object',
					properties: {
						light: {
							description: localize('vscode.extension.contributes.submenu.icon.light', '使用浅色主题时的图标路径'),
							type: 'string'
						},
						dark: {
							description: localize('vscode.extension.contributes.submenu.icon.dark', '使用深色主题时的图标路径'),
							type: 'string'
						}
					}
				}]
			}
		}
	};

	export const menusContribution: IJSONSchema = {
		description: localize('vscode.extension.contributes.menus', "向编辑器贡献菜单项"),
		type: 'object',
		properties: index(apiMenus, menu => menu.key, menu => ({
			markdownDescription: menu.proposed ? localize('proposed', "提议的 API，需要 `enabledApiProposal: [\"{0}\"]` - {1}", menu.proposed, menu.description) : menu.description,
			type: 'array',
			items: menu.supportsSubmenus === false ? menuItem : { oneOf: [menuItem, submenuItem] }
		})),
		additionalProperties: {
			description: '子菜单',
			type: 'array',
			items: { oneOf: [menuItem, submenuItem] }
		}
	};

	export const submenusContribution: IJSONSchema = {
		description: localize('vscode.extension.contributes.submenus', "向编辑器贡献子菜单项"),
		type: 'array',
		items: submenu
	};

	// --- commands contribution point

	export interface IUserFriendlyCommand {
		command: string;
		title: string | ILocalizedString;
		shortTitle?: string | ILocalizedString;
		enablement?: string;
		category?: string | ILocalizedString;
		icon?: IUserFriendlyIcon;
	}

	export type IUserFriendlyIcon = string | { light: string; dark: string };

	export function isValidCommand(command: IUserFriendlyCommand, collector: ExtensionMessageCollector): boolean {
		if (!command) {
			collector.error(localize('nonempty', "期望非空值"));
			return false;
		}
		if (isFalsyOrWhitespace(command.command)) {
			collector.error(localize('requirestring', "属性 `{0}` 是必需的，且必须是 `string` 类型", 'command'));
			return false;
		}
		if (!isValidLocalizedString(command.title, collector, 'title')) {
			return false;
		}
		if (command.shortTitle && !isValidLocalizedString(command.shortTitle, collector, 'shortTitle')) {
			return false;
		}
		if (command.enablement && typeof command.enablement !== 'string') {
			collector.error(localize('optstring', "属性 `{0}` 可以省略或必须是 `string` 类型", 'precondition'));
			return false;
		}
		if (command.category && !isValidLocalizedString(command.category, collector, 'category')) {
			return false;
		}
		if (!isValidIcon(command.icon, collector)) {
			return false;
		}
		return true;
	}

	function isValidIcon(icon: IUserFriendlyIcon | undefined, collector: ExtensionMessageCollector): boolean {
		if (typeof icon === 'undefined') {
			return true;
		}
		if (typeof icon === 'string') {
			return true;
		} else if (typeof icon.dark === 'string' && typeof icon.light === 'string') {
			return true;
		}
		collector.error(localize('opticon', "属性 `icon` 可以省略或必须是字符串或类似 `{dark, light}` 的字面量"));
		return false;
	}

	function isValidLocalizedString(localized: string | ILocalizedString, collector: ExtensionMessageCollector, propertyName: string): boolean {
		if (typeof localized === 'undefined') {
			collector.error(localize('requireStringOrObject', "属性 `{0}` 是必需的，且必须是 `string` 或 `object` 类型", propertyName));
			return false;
		} else if (typeof localized === 'string' && isFalsyOrWhitespace(localized)) {
			collector.error(localize('requirestring', "属性 `{0}` 是必需的，且必须是 `string` 类型", propertyName));
			return false;
		} else if (typeof localized !== 'string' && (isFalsyOrWhitespace(localized.original) || isFalsyOrWhitespace(localized.value))) {
			collector.error(localize('requirestrings', "属性 `{0}` 和 `{1}` 是必需的，且必须是 `string` 类型", `${propertyName}.value`, `${propertyName}.original`));
			return false;
		}

		return true;
	}

	const commandType: IJSONSchema = {
		type: 'object',
		required: ['command', 'title'],
		properties: {
			command: {
				description: localize('vscode.extension.contributes.commandType.command', '要执行的命令的标识符'),
				type: 'string'
			},
			title: {
				description: localize('vscode.extension.contributes.commandType.title', '命令在 UI 中显示的标题'),
				type: 'string'
			},
			shortTitle: {
				markdownDescription: localize('vscode.extension.contributes.commandType.shortTitle', '(可选) 命令在 UI 中显示的短标题。菜单根据显示命令的上下文选择 `title` 或 `shortTitle`'),
				type: 'string'
			},
			category: {
				description: localize('vscode.extension.contributes.commandType.category', '(可选) 用于在 UI 中对命令进行分组的类别字符串'),
				type: 'string'
			},
			enablement: {
				description: localize('vscode.extension.contributes.commandType.precondition', '(可选) 在 UI 中启用命令必须为 true 的条件 (菜单和快捷键)。不会阻止通过其他方式执行命令，如 `executeCommand` API'),
				type: 'string'
			},
			icon: {
				description: localize({ key: 'vscode.extension.contributes.commandType.icon', comment: ['do not translate or change "\\$(zap)", \\ in front of $ is important.'] }, '(可选) 用于在 UI 中表示命令的图标。可以是文件路径、包含深色和浅色主题文件路径的对象，或主题图标引用，如 "\\$(zap)"'),
				anyOf: [{
					type: 'string'
				},
				{
					type: 'object',
					properties: {
						light: {
							description: localize('vscode.extension.contributes.commandType.icon.light', '使用浅色主题时的图标路径'),
							type: 'string'
						},
						dark: {
							description: localize('vscode.extension.contributes.commandType.icon.dark', '使用深色主题时的图标路径'),
							type: 'string'
						}
					}
				}]
			}
		}
	};

	export const commandsContribution: IJSONSchema = {
		description: localize('vscode.extension.contributes.commands', "向命令面板贡献命令"),
		oneOf: [
			commandType,
			{
				type: 'array',
				items: commandType
			}
		]
	};
}

const _commandRegistrations = new DisposableStore();

export const commandsExtensionPoint = ExtensionsRegistry.registerExtensionPoint<schema.IUserFriendlyCommand | schema.IUserFriendlyCommand[]>({
	extensionPoint: 'commands',
	jsonSchema: schema.commandsContribution,
	activationEventsGenerator: function* (contribs: readonly schema.IUserFriendlyCommand[]) {
		for (const contrib of contribs) {
			if (contrib.command) {
				yield `onCommand:${contrib.command}`;
			}
		}
	}
});

commandsExtensionPoint.setHandler(extensions => {

	function handleCommand(userFriendlyCommand: schema.IUserFriendlyCommand, extension: IExtensionPointUser<unknown>) {

		if (!schema.isValidCommand(userFriendlyCommand, extension.collector)) {
			return;
		}

		const { icon, enablement, category, title, shortTitle, command } = userFriendlyCommand;

		let absoluteIcon: { dark: URI; light?: URI } | ThemeIcon | undefined;
		if (icon) {
			if (typeof icon === 'string') {
				absoluteIcon = ThemeIcon.fromString(icon) ?? { dark: resources.joinPath(extension.description.extensionLocation, icon), light: resources.joinPath(extension.description.extensionLocation, icon) };

			} else {
				absoluteIcon = {
					dark: resources.joinPath(extension.description.extensionLocation, icon.dark),
					light: resources.joinPath(extension.description.extensionLocation, icon.light)
				};
			}
		}

		const existingCmd = MenuRegistry.getCommand(command);
		if (existingCmd) {
			if (existingCmd.source) {
				extension.collector.info(localize('dup1', "命令 `{0}` 已由 {1} ({2}) 注册", userFriendlyCommand.command, existingCmd.source.title, existingCmd.source.id));
			} else {
				extension.collector.info(localize('dup0', "命令 `{0}` 已注册", userFriendlyCommand.command));
			}
		}
		_commandRegistrations.add(MenuRegistry.addCommand({
			id: command,
			title,
			source: { id: extension.description.identifier.value, title: extension.description.displayName ?? extension.description.name },
			shortTitle,
			tooltip: title,
			category,
			precondition: ContextKeyExpr.deserialize(enablement),
			icon: absoluteIcon
		}));
	}

	// remove all previous command registrations
	_commandRegistrations.clear();

	for (const extension of extensions) {
		const { value } = extension;
		if (Array.isArray(value)) {
			for (const command of value) {
				handleCommand(command, extension);
			}
		} else {
			handleCommand(value, extension);
		}
	}
});

interface IRegisteredSubmenu {
	readonly id: MenuId;
	readonly label: string;
	readonly icon?: { dark: URI; light?: URI } | ThemeIcon;
}

const _submenus = new Map<string, IRegisteredSubmenu>();

const submenusExtensionPoint = ExtensionsRegistry.registerExtensionPoint<schema.IUserFriendlySubmenu[]>({
	extensionPoint: 'submenus',
	jsonSchema: schema.submenusContribution
});

submenusExtensionPoint.setHandler(extensions => {

	_submenus.clear();

	for (const extension of extensions) {
		const { value, collector } = extension;

		for (const [, submenuInfo] of Object.entries(value)) {

			if (!schema.isValidSubmenu(submenuInfo, collector)) {
				continue;
			}

			if (!submenuInfo.id) {
				collector.warn(localize('submenuId.invalid.id', "`{0}` 不是有效的子菜单标识符", submenuInfo.id));
				continue;
			}
			if (_submenus.has(submenuInfo.id)) {
				collector.info(localize('submenuId.duplicate.id', "子菜单 `{0}` 之前已注册", submenuInfo.id));
				continue;
			}
			if (!submenuInfo.label) {
				collector.warn(localize('submenuId.invalid.label', "`{0}` 不是有效的子菜单标签", submenuInfo.label));
				continue;
			}

			let absoluteIcon: { dark: URI; light?: URI } | ThemeIcon | undefined;
			if (submenuInfo.icon) {
				if (typeof submenuInfo.icon === 'string') {
					absoluteIcon = ThemeIcon.fromString(submenuInfo.icon) || { dark: resources.joinPath(extension.description.extensionLocation, submenuInfo.icon) };
				} else {
					absoluteIcon = {
						dark: resources.joinPath(extension.description.extensionLocation, submenuInfo.icon.dark),
						light: resources.joinPath(extension.description.extensionLocation, submenuInfo.icon.light)
					};
				}
			}

			const item: IRegisteredSubmenu = {
				id: MenuId.for(`api:${submenuInfo.id}`),
				label: submenuInfo.label,
				icon: absoluteIcon
			};

			_submenus.set(submenuInfo.id, item);
		}
	}
});

const _apiMenusByKey = new Map(apiMenus.map(menu => ([menu.key, menu])));
const _menuRegistrations = new DisposableStore();
const _submenuMenuItems = new Map<string /* menu id */, Set<string /* submenu id */>>();

const menusExtensionPoint = ExtensionsRegistry.registerExtensionPoint<{ [loc: string]: (schema.IUserFriendlyMenuItem | schema.IUserFriendlySubmenuItem)[] }>({
	extensionPoint: 'menus',
	jsonSchema: schema.menusContribution,
	deps: [submenusExtensionPoint]
});

menusExtensionPoint.setHandler(extensions => {

	// remove all previous menu registrations
	_menuRegistrations.clear();
	_submenuMenuItems.clear();

	for (const extension of extensions) {
		const { value, collector } = extension;

		for (const entry of Object.entries(value)) {
			if (!schema.isValidItems(entry[1], collector)) {
				continue;
			}

			let menu = _apiMenusByKey.get(entry[0]);

			if (!menu) {
				const submenu = _submenus.get(entry[0]);

				if (submenu) {
					menu = {
						key: entry[0],
						id: submenu.id,
						description: ''
					};
				}
			}

			if (!menu) {
				continue;
			}

			if (menu.proposed && !isProposedApiEnabled(extension.description, menu.proposed)) {
				collector.error(localize('proposedAPI.invalid', "{0} 是提议的菜单标识符。它需要 'package.json#enabledApiProposals: [\"{1}\"]'，且仅在开发模式下或使用以下命令行开关时可用: --enable-proposed-api {2}", entry[0], menu.proposed, extension.description.identifier.value));
				continue;
			}

			for (const menuItem of entry[1]) {
				let item: IMenuItem | ISubmenuItem;

				if (schema.isMenuItem(menuItem)) {
					const command = MenuRegistry.getCommand(menuItem.command);
					const alt = menuItem.alt && MenuRegistry.getCommand(menuItem.alt) || undefined;

					if (!command) {
						collector.error(localize('missing.command', "菜单项引用了未在 'commands' 部分中定义的命令 `{0}`", menuItem.command));
						continue;
					}
					if (menuItem.alt && !alt) {
						collector.warn(localize('missing.altCommand', "菜单项引用了未在 'commands' 部分中定义的替代命令 `{0}`", menuItem.alt));
					}
					if (menuItem.command === menuItem.alt) {
						collector.info(localize('dupe.command', "菜单项的默认命令和替代命令引用了相同的命令"));
					}

					item = { command, alt, group: undefined, order: undefined, when: undefined };
				} else {
					if (menu.supportsSubmenus === false) {
						collector.error(localize('unsupported.submenureference', "菜单项引用了不支持子菜单的菜单的子菜单"));
						continue;
					}

					const submenu = _submenus.get(menuItem.submenu);

					if (!submenu) {
						collector.error(localize('missing.submenu', "菜单项引用了未在 'submenus' 部分中定义的子菜单 `{0}`", menuItem.submenu));
						continue;
					}

					let submenuRegistrations = _submenuMenuItems.get(menu.id.id);

					if (!submenuRegistrations) {
						submenuRegistrations = new Set();
						_submenuMenuItems.set(menu.id.id, submenuRegistrations);
					}

					if (submenuRegistrations.has(submenu.id.id)) {
						collector.warn(localize('submenuItem.duplicate', "子菜单 `{0}` 已贡献到 `{1}` 菜单", menuItem.submenu, entry[0]));
						continue;
					}

					submenuRegistrations.add(submenu.id.id);

					item = { submenu: submenu.id, icon: submenu.icon, title: submenu.label, group: undefined, order: undefined, when: undefined };
				}

				if (menuItem.group) {
					const idx = menuItem.group.lastIndexOf('@');
					if (idx > 0) {
						item.group = menuItem.group.substr(0, idx);
						item.order = Number(menuItem.group.substr(idx + 1)) || undefined;
					} else {
						item.group = menuItem.group;
					}
				}

				if (menu.id === MenuId.ViewContainerTitle && !menuItem.when?.includes('viewContainer == workbench.view.debug')) {
					// Not a perfect check but enough to communicate that this proposed extension point is currently only for the debug view container
					collector.error(localize('viewContainerTitle.when', "{0} 菜单贡献必须在其 {2} 子句中检查 {1}", '`viewContainer/title`', '`viewContainer == workbench.view.debug`', '"when"'));
					continue;
				}

				item.when = ContextKeyExpr.deserialize(menuItem.when);
				_menuRegistrations.add(MenuRegistry.appendMenuItem(menu.id, item));
			}
		}
	}
});

class CommandsTableRenderer extends Disposable implements IExtensionFeatureTableRenderer {

	readonly type = 'table';

	constructor(
		@IKeybindingService private readonly _keybindingService: IKeybindingService
	) { super(); }

	shouldRender(manifest: IExtensionManifest): boolean {
		return !!manifest.contributes?.commands;
	}

	render(manifest: IExtensionManifest): IRenderedData<ITableData> {
		const rawCommands = manifest.contributes?.commands || [];
		const commands = rawCommands.map(c => ({
			id: c.command,
			title: c.title,
			keybindings: [] as ResolvedKeybinding[],
			menus: [] as string[]
		}));

		const byId = index(commands, c => c.id);

		const menus = manifest.contributes?.menus || {};

		// Add to commandPalette array any commands not explicitly contributed to it
		const implicitlyOnCommandPalette = index(commands, c => c.id);
		if (menus['commandPalette']) {
			for (const command of menus['commandPalette']) {
				delete implicitlyOnCommandPalette[command.command];
			}
		}

		if (Object.keys(implicitlyOnCommandPalette).length) {
			if (!menus['commandPalette']) {
				menus['commandPalette'] = [];
			}
			for (const command in implicitlyOnCommandPalette) {
				menus['commandPalette'].push({ command });
			}
		}

		for (const context in menus) {
			for (const menu of menus[context]) {

				// This typically happens for the commandPalette context
				if (menu.when === 'false') {
					continue;
				}
				if (menu.command) {
					let command = byId[menu.command];
					if (command) {
						if (!command.menus.includes(context)) {
							command.menus.push(context);
						}
					} else {
						command = { id: menu.command, title: '', keybindings: [], menus: [context] };
						byId[command.id] = command;
						commands.push(command);
					}
				}
			}
		}

		const rawKeybindings = manifest.contributes?.keybindings ? (Array.isArray(manifest.contributes.keybindings) ? manifest.contributes.keybindings : [manifest.contributes.keybindings]) : [];

		rawKeybindings.forEach(rawKeybinding => {
			const keybinding = this.resolveKeybinding(rawKeybinding);

			if (!keybinding) {
				return;
			}

			let command = byId[rawKeybinding.command];

			if (command) {
				command.keybindings.push(keybinding);
			} else {
				command = { id: rawKeybinding.command, title: '', keybindings: [keybinding], menus: [] };
				byId[command.id] = command;
				commands.push(command);
			}
		});

		if (!commands.length) {
			return { data: { headers: [], rows: [] }, dispose: () => { } };
		}

		const headers = [
			localize('command name', "ID"),
			localize('command title', "标题"),
			localize('keyboard shortcuts', "键盘快捷键"),
			localize('menuContexts', "菜单上下文")
		];

		const rows: IRowData[][] = commands.sort((a, b) => a.id.localeCompare(b.id))
			.map(command => {
				return [
					new MarkdownString().appendMarkdown(`\`${command.id}\``),
					typeof command.title === 'string' ? command.title : command.title.value,
					command.keybindings,
					new MarkdownString().appendMarkdown(`${command.menus.sort((a, b) => a.localeCompare(b)).map(menu => `\`${menu}\``).join('&nbsp;')}`),
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

	private resolveKeybinding(rawKeyBinding: IKeyBinding): ResolvedKeybinding | undefined {
		let key: string | undefined;

		switch (platform) {
			case 'win32': key = rawKeyBinding.win; break;
			case 'linux': key = rawKeyBinding.linux; break;
			case 'darwin': key = rawKeyBinding.mac; break;
		}

		return this._keybindingService.resolveUserBinding(key ?? rawKeyBinding.key)[0];
	}

}

Registry.as<IExtensionFeaturesRegistry>(ExtensionFeaturesExtensions.ExtensionFeaturesRegistry).registerExtensionFeature({
	id: 'commands',
	label: localize('commands', "命令"),
	access: {
		canToggle: false,
	},
	renderer: new SyncDescriptor(CommandsTableRenderer),
});
