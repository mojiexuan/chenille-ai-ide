/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import themePickerContent from './media/theme_picker.js';
import themePickerSmallContent from './media/theme_picker_small.js';
import notebookProfileContent from './media/notebookProfile.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { NotebookSetting } from '../../notebook/common/notebookCommon.js';
import { CONTEXT_ACCESSIBILITY_MODE_ENABLED } from '../../../../platform/accessibility/common/accessibility.js';
import { URI } from '../../../../base/common/uri.js';
import product from '../../../../platform/product/common/product.js';

interface IGettingStartedContentProvider {
	(): string;
}

const defaultChat = {
	documentationUrl: product.defaultChatAgent?.documentationUrl ?? '',
	manageSettingsUrl: product.defaultChatAgent?.manageSettingsUrl ?? '',
	provider: product.defaultChatAgent?.provider ?? { default: { name: '' } },
	publicCodeMatchesUrl: product.defaultChatAgent?.publicCodeMatchesUrl ?? '',
	termsStatementUrl: product.defaultChatAgent?.termsStatementUrl ?? '',
	privacyStatementUrl: product.defaultChatAgent?.privacyStatementUrl ?? ''
};

export const copilotSettingsMessage = localize({ key: 'settings', comment: ['{Locked="["}', '{Locked="]({0})"}', '{Locked="]({1})"}'] }, "{0} Copilot 可能会显示[公共代码]({1})建议并使用您的数据来改进产品。您可以随时更改这些[设置]({2})。", defaultChat.provider.default.name, defaultChat.publicCodeMatchesUrl, defaultChat.manageSettingsUrl);

class GettingStartedContentProviderRegistry {

	private readonly providers = new Map<string, IGettingStartedContentProvider>();

	registerProvider(moduleId: string, provider: IGettingStartedContentProvider): void {
		this.providers.set(moduleId, provider);
	}

	getProvider(moduleId: string): IGettingStartedContentProvider | undefined {
		return this.providers.get(moduleId);
	}
}
export const gettingStartedContentRegistry = new GettingStartedContentProviderRegistry();

export async function moduleToContent(resource: URI): Promise<string> {
	if (!resource.query) {
		throw new Error('Getting Started: invalid resource');
	}

	const query = JSON.parse(resource.query);
	if (!query.moduleId) {
		throw new Error('Getting Started: invalid resource');
	}

	const provider = gettingStartedContentRegistry.getProvider(query.moduleId);
	if (!provider) {
		throw new Error(`Getting Started: no provider registered for ${query.moduleId}`);
	}

	return provider();
}

gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/theme_picker', themePickerContent);
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/theme_picker_small', themePickerSmallContent);
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/notebookProfile', notebookProfileContent);
// Register empty media for accessibility walkthrough
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/empty', () => '');

const setupIcon = registerIcon('getting-started-setup', Codicon.zap, localize('getting-started-setup-icon', "欢迎页面设置类别使用的图标"));
const beginnerIcon = registerIcon('getting-started-beginner', Codicon.lightbulb, localize('getting-started-beginner-icon', "欢迎页面初学者类别使用的图标"));

export type BuiltinGettingStartedStep = {
	id: string;
	title: string;
	description: string;
	completionEvents?: string[];
	when?: string;
	media:
	| { type: 'image'; path: string | { hc: string; hcLight?: string; light: string; dark: string }; altText: string }
	| { type: 'svg'; path: string; altText: string }
	| { type: 'markdown'; path: string }
	| { type: 'video'; path: string | { hc: string; hcLight?: string; light: string; dark: string }; poster?: string | { hc: string; hcLight?: string; light: string; dark: string }; altText: string };
};

export type BuiltinGettingStartedCategory = {
	id: string;
	title: string;
	description: string;
	isFeatured: boolean;
	next?: string;
	icon: ThemeIcon;
	when?: string;
	content:
	| { type: 'steps'; steps: BuiltinGettingStartedStep[] };
	walkthroughPageTitle: string;
};

export type BuiltinGettingStartedStartEntry = {
	id: string;
	title: string;
	description: string;
	icon: ThemeIcon;
	when?: string;
	content:
	| { type: 'startEntry'; command: string };
};

type GettingStartedWalkthroughContent = BuiltinGettingStartedCategory[];
type GettingStartedStartEntryContent = BuiltinGettingStartedStartEntry[];

export const startEntries: GettingStartedStartEntryContent = [
	{
		id: 'welcome.showNewFileEntries',
		title: localize('gettingStarted.newFile.title', "新建文件..."),
		description: localize('gettingStarted.newFile.description', "打开新的无标题文本文件、笔记本或自定义编辑器。"),
		icon: Codicon.newFile,
		content: {
			type: 'startEntry',
			command: 'command:welcome.showNewFileEntries',
		}
	},
	{
		id: 'topLevelOpenMac',
		title: localize('gettingStarted.openMac.title', "打开..."),
		description: localize('gettingStarted.openMac.description', "打开文件或文件夹以开始工作"),
		icon: Codicon.folderOpened,
		when: '!isWeb && isMac',
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.files.openFileFolder',
		}
	},
	{
		id: 'topLevelOpenFile',
		title: localize('gettingStarted.openFile.title', "打开文件..."),
		description: localize('gettingStarted.openFile.description', "打开文件以开始工作"),
		icon: Codicon.goToFile,
		when: 'isWeb || !isMac',
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.files.openFile',
		}
	},
	{
		id: 'topLevelOpenFolder',
		title: localize('gettingStarted.openFolder.title', "打开文件夹..."),
		description: localize('gettingStarted.openFolder.description', "打开文件夹以开始工作"),
		icon: Codicon.folderOpened,
		when: '!isWeb && !isMac',
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.files.openFolder',
		}
	},
	{
		id: 'topLevelOpenFolderWeb',
		title: localize('gettingStarted.openFolder.title', "打开文件夹..."),
		description: localize('gettingStarted.openFolder.description', "打开文件夹以开始工作"),
		icon: Codicon.folderOpened,
		when: '!openFolderWorkspaceSupport && workbenchState == \'workspace\'',
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.files.openFolderViaWorkspace',
		}
	},
	{
		id: 'topLevelGitClone',
		title: localize('gettingStarted.topLevelGitClone.title', "克隆 Git 存储库..."),
		description: localize('gettingStarted.topLevelGitClone.description', "将远程存储库克隆到本地文件夹"),
		when: 'config.git.enabled && !git.missing',
		icon: Codicon.sourceControl,
		content: {
			type: 'startEntry',
			command: 'command:git.clone',
		}
	},
	{
		id: 'topLevelGitOpen',
		title: localize('gettingStarted.topLevelGitOpen.title', "打开存储库..."),
		description: localize('gettingStarted.topLevelGitOpen.description', "连接到远程存储库或拉取请求以浏览、搜索、编辑和提交"),
		when: 'workspacePlatform == \'webworker\'',
		icon: Codicon.sourceControl,
		content: {
			type: 'startEntry',
			command: 'command:remoteHub.openRepository',
		}
	},
	{
		id: 'topLevelRemoteOpen',
		title: localize('gettingStarted.topLevelRemoteOpen.title', "连接到..."),
		description: localize('gettingStarted.topLevelRemoteOpen.description', "连接到远程开发工作区。"),
		when: '!isWeb',
		icon: Codicon.remote,
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.remote.showMenu',
		}
	},
	{
		id: 'topLevelOpenTunnel',
		title: localize('gettingStarted.topLevelOpenTunnel.title', "打开隧道..."),
		description: localize('gettingStarted.topLevelOpenTunnel.description', "通过隧道连接到远程计算机"),
		when: 'isWeb && showRemoteStartEntryInWeb',
		icon: Codicon.remote,
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.remote.showWebStartEntryActions',
		}
	},
	{
		id: 'topLevelNewWorkspaceChat',
		title: localize('gettingStarted.newWorkspaceChat.title', "生成新工作区..."),
		description: localize('gettingStarted.newWorkspaceChat.description', "通过聊天创建新工作区"),
		icon: Codicon.chatSparkle,
		when: '!isWeb && !chatSetupHidden',
		content: {
			type: 'startEntry',
			command: 'command:welcome.newWorkspaceChat',
		}
	},
];

const Button = (title: string, href: string) => `[${title}](${href})`;

const CopilotStepTitle = localize('gettingStarted.copilotSetup.title', "免费使用 Copilot AI 功能");
const CopilotDescription = localize({ key: 'gettingStarted.copilotSetup.description', comment: ['{Locked="["}', '{Locked="]({0})"}'] }, "您可以使用 [Copilot]({0}) 跨多个文件生成代码、修复错误、询问有关代码的问题，以及使用自然语言完成更多操作。", defaultChat.documentationUrl ?? '');
const CopilotTermsString = localize({ key: 'gettingStarted.copilotSetup.terms', comment: ['{Locked="]({2})"}', '{Locked="]({3})"}'] }, "继续使用 {0} Copilot，即表示您同意 {1} 的[条款]({2})和[隐私声明]({3})", defaultChat.provider.default.name, defaultChat.provider.default.name, defaultChat.termsStatementUrl, defaultChat.privacyStatementUrl);
const CopilotAnonymousButton = Button(localize('setupCopilotButton.setup', "使用 AI 功能"), `command:workbench.action.chat.triggerSetupAnonymousWithoutDialog`);
const CopilotSignedOutButton = Button(localize('setupCopilotButton.setup', "使用 AI 功能"), `command:workbench.action.chat.triggerSetup`);
const CopilotSignedInButton = Button(localize('setupCopilotButton.setup', "使用 AI 功能"), `command:workbench.action.chat.triggerSetup`);
const CopilotCompleteButton = Button(localize('setupCopilotButton.chatWithCopilot', "开始聊天"), 'command:workbench.action.chat.open');

function createCopilotSetupStep(id: string, button: string, when: string, includeTerms: boolean): BuiltinGettingStartedStep {
	const description = includeTerms ?
		`${CopilotDescription}\n${CopilotTermsString}\n${button}` :
		`${CopilotDescription}\n${button}`;

	return {
		id,
		title: CopilotStepTitle,
		description,
		when: `${when} && !chatSetupHidden`,
		media: {
			type: 'svg', altText: 'Chenille Copilot multi file edits', path: 'multi-file-edits.svg'
		},
	};
}

export const walkthroughs: GettingStartedWalkthroughContent = [
	{
		id: 'Setup',
		title: localize('gettingStarted.setup.title', "开始使用 Chenille"),
		description: localize('gettingStarted.setup.description', "自定义编辑器、学习基础知识并开始编码"),
		isFeatured: true,
		icon: setupIcon,
		when: '!isWeb',
		walkthroughPageTitle: localize('gettingStarted.setup.walkthroughPageTitle', '设置 Chenille'),
		next: 'Beginner',
		content: {
			type: 'steps',
			steps: [
				createCopilotSetupStep('CopilotSetupAnonymous', CopilotAnonymousButton, 'chatAnonymous && !chatSetupInstalled', true),
				createCopilotSetupStep('CopilotSetupSignedOut', CopilotSignedOutButton, 'chatEntitlementSignedOut && !chatAnonymous', false),
				createCopilotSetupStep('CopilotSetupComplete', CopilotCompleteButton, 'chatSetupInstalled && !chatSetupDisabled && (chatAnonymous || chatPlanPro || chatPlanProPlus || chatPlanBusiness || chatPlanEnterprise || chatPlanFree)', false),
				createCopilotSetupStep('CopilotSetupSignedIn', CopilotSignedInButton, '!chatEntitlementSignedOut && (!chatSetupInstalled || chatSetupDisabled || chatPlanCanSignUp)', false),
				{
					id: 'pickColorTheme',
					title: localize('gettingStarted.pickColor.title', "选择主题"),
					description: localize('gettingStarted.pickColor.description.interpolated', "合适的主题可以帮助您专注于代码，让眼睛更舒适，使用起来也更有趣。\n{0}", Button(localize('titleID', "浏览颜色主题"), 'command:workbench.action.selectTheme')),
					completionEvents: [
						'onSettingChanged:workbench.colorTheme',
						'onCommand:workbench.action.selectTheme'
					],
					media: { type: 'markdown', path: 'theme_picker', }
				},
				{
					id: 'videoTutorial',
					title: localize('gettingStarted.videoTutorial.title', "观看视频教程"),
					description: localize('gettingStarted.videoTutorial.description.interpolated', "观看一系列简短实用的 Chenille 核心功能视频教程中的第一个。\n{0}", Button(localize('watch', "观看教程"), 'https://aka.ms/vscode-getting-started-video')),
					media: { type: 'svg', altText: 'Chenille AI 设置', path: 'learn.svg' },
				}
			]
		}
	},

	{
		id: 'SetupWeb',
		title: localize('gettingStarted.setupWeb.title', "开始使用 Chenille 网页版"),
		description: localize('gettingStarted.setupWeb.description', "自定义编辑器、学习基础知识并开始编码"),
		isFeatured: true,
		icon: setupIcon,
		when: 'isWeb',
		next: 'Beginner',
		walkthroughPageTitle: localize('gettingStarted.setupWeb.walkthroughPageTitle', '设置 Chenille 网页版'),
		content: {
			type: 'steps',
			steps: [
				{
					id: 'pickColorThemeWeb',
					title: localize('gettingStarted.pickColor.title', "选择主题"),
					description: localize('gettingStarted.pickColor.description.interpolated', "合适的主题可以帮助您专注于代码，让眼睛更舒适，使用起来也更有趣。\n{0}", Button(localize('titleID', "浏览颜色主题"), 'command:workbench.action.selectTheme')),
					completionEvents: [
						'onSettingChanged:workbench.colorTheme',
						'onCommand:workbench.action.selectTheme'
					],
					media: { type: 'markdown', path: 'theme_picker', }
				},
				{
					id: 'menuBarWeb',
					title: localize('gettingStarted.menuBar.title', "恰到好处的界面"),
					description: localize('gettingStarted.menuBar.description.interpolated', "完整的菜单栏在下拉菜单中可用，为您的代码腾出空间。切换其外观以便更快访问。\n{0}", Button(localize('toggleMenuBar', "切换菜单栏"), 'command:workbench.action.toggleMenuBar')),
					when: 'isWeb',
					media: {
						type: 'svg', altText: '菜单下拉与可见菜单栏的比较。', path: 'menuBar.svg'
					},
				},
				{
					id: 'extensionsWebWeb',
					title: localize('gettingStarted.extensions.title', "使用扩展编码"),
					description: localize('gettingStarted.extensionsWeb.description.interpolated', "扩展是 Chenille 的增强功能。越来越多的扩展可在网页版中使用。\n{0}", Button(localize('browsePopularWeb', "浏览热门网页扩展"), 'command:workbench.extensions.action.showPopularExtensions')),
					when: 'workspacePlatform == \'webworker\'',
					media: {
						type: 'svg', altText: '带有精选语言扩展的 Chenille 扩展市场', path: 'extensions-web.svg'
					},
				},
				{
					id: 'findLanguageExtensionsWeb',
					title: localize('gettingStarted.findLanguageExts.title', "丰富的语言支持"),
					description: localize('gettingStarted.findLanguageExts.description.interpolated', "通过语法高亮、内联建议、代码检查和调试功能更智能地编码。虽然许多语言是内置的，但还可以通过扩展添加更多语言。\n{0}", Button(localize('browseLangExts', "浏览语言扩展"), 'command:workbench.extensions.action.showLanguageExtensions')),
					when: 'workspacePlatform != \'webworker\'',
					media: {
						type: 'svg', altText: '语言扩展', path: 'languages.svg'
					},
				},
				{
					id: 'settingsSyncWeb',
					title: localize('gettingStarted.settingsSync.title', "跨设备同步设置"),
					description: localize('gettingStarted.settingsSync.description.interpolated', "在所有设备上备份和更新您的重要自定义设置。\n{0}", Button(localize('enableSync', "备份和同步设置"), 'command:workbench.userDataSync.actions.turnOn')),
					when: 'syncStatus != uninitialized',
					completionEvents: ['onEvent:sync-enabled'],
					media: {
						type: 'svg', altText: '设置齿轮菜单中的"启用同步"选项。', path: 'settingsSync.svg'
					},
				},
				{
					id: 'commandPaletteTaskWeb',
					title: localize('gettingStarted.commandPalette.title', "使用命令面板提高效率"),
					description: localize('gettingStarted.commandPalette.description.interpolated', "无需使用鼠标即可运行命令，完成 Chenille 中的任何任务。\n{0}", Button(localize('commandPalette', "打开命令面板"), 'command:workbench.action.showCommands')),
					media: { type: 'svg', altText: '用于搜索和执行命令的命令面板覆盖层。', path: 'commandPalette.svg' },
				},
				{
					id: 'pickAFolderTask-WebWeb',
					title: localize('gettingStarted.setup.OpenFolder.title', "打开您的代码"),
					description: localize('gettingStarted.setup.OpenFolderWeb.description.interpolated', "您已准备好开始编码。您可以打开本地项目或远程存储库，将文件导入 Chenille。\n{0}\n{1}", Button(localize('openFolder', "打开文件夹"), 'command:workbench.action.addRootFolder'), Button(localize('openRepository', "打开存储库"), 'command:remoteHub.openRepository')),
					when: 'workspaceFolderCount == 0',
					media: {
						type: 'svg', altText: '资源管理器视图显示打开文件夹和克隆存储库的按钮。', path: 'openFolder.svg'
					}
				},
				{
					id: 'quickOpenWeb',
					title: localize('gettingStarted.quickOpen.title', "在文件之间快速导航"),
					description: localize('gettingStarted.quickOpen.description.interpolated', "只需一个按键即可在文件之间即时导航。提示：按右箭头键可打开多个文件。\n{0}", Button(localize('quickOpen', "快速打开文件"), 'command:toSide:workbench.action.quickOpen')),
					when: 'workspaceFolderCount != 0',
					media: {
						type: 'svg', altText: '在快速搜索中转到文件。', path: 'search.svg'
					}
				}
			]
		}
	},
	{
		id: 'SetupAccessibility',
		title: localize('gettingStarted.setupAccessibility.title', "开始使用辅助功能"),
		description: localize('gettingStarted.setupAccessibility.description', "了解使 Chenille 具有辅助功能的工具和快捷方式。请注意，某些操作无法在演练上下文中执行。"),
		isFeatured: true,
		icon: setupIcon,
		when: CONTEXT_ACCESSIBILITY_MODE_ENABLED.key,
		next: 'Setup',
		walkthroughPageTitle: localize('gettingStarted.setupAccessibility.walkthroughPageTitle', '设置 Chenille 辅助功能'),
		content: {
			type: 'steps',
			steps: [
				{
					id: 'accessibilityHelp',
					title: localize('gettingStarted.accessibilityHelp.title', "使用辅助功能帮助对话框了解功能"),
					description: localize('gettingStarted.accessibilityHelp.description.interpolated', "辅助功能帮助对话框提供有关功能预期行为以及操作它们的命令/快捷键的信息。\n当焦点在编辑器、终端、笔记本、聊天响应、评论或调试控制台中时，可以使用「打开辅助功能帮助」命令打开相关对话框。\n{0}", Button(localize('openAccessibilityHelp', "打开辅助功能帮助"), 'command:editor.action.accessibilityHelp')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'accessibleView',
					title: localize('gettingStarted.accessibleView.title', "屏幕阅读器用户可以在辅助视图中逐行、逐字符检查内容。"),
					description: localize('gettingStarted.accessibleView.description.interpolated', "辅助视图可用于终端、悬停提示、通知、评论、笔记本输出、聊天响应、内联补全和调试控制台输出。\n当焦点在这些功能中的任何一个时，可以使用「打开辅助视图」命令打开它。\n{0}", Button(localize('openAccessibleView', "打开辅助视图"), 'command:editor.action.accessibleView')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'verbositySettings',
					title: localize('gettingStarted.verbositySettings.title', "控制 aria 标签的详细程度"),
					description: localize('gettingStarted.verbositySettings.description.interpolated', "工作台周围的功能存在屏幕阅读器详细程度设置，以便用户熟悉某个功能后，可以避免听到有关如何操作它的提示。例如，存在辅助功能帮助对话框的功能将指示如何打开该对话框，直到该功能的详细程度设置被禁用。\n可以通过运行「打开辅助功能设置」命令来配置这些和其他辅助功能设置。\n{0}", Button(localize('openVerbositySettings', "打开辅助功能设置"), 'command:workbench.action.openAccessibilitySettings')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'commandPaletteTaskAccessibility',
					title: localize('gettingStarted.commandPaletteAccessibility.title', "使用命令面板提高效率"),
					description: localize('gettingStarted.commandPaletteAccessibility.description.interpolated', "无需使用鼠标即可运行命令，完成 Chenille 中的任何任务。\n{0}", Button(localize('commandPalette', "打开命令面板"), 'command:workbench.action.showCommands')),
					media: { type: 'markdown', path: 'empty' },
				},
				{
					id: 'keybindingsAccessibility',
					title: localize('gettingStarted.keyboardShortcuts.title', "自定义键盘快捷方式"),
					description: localize('gettingStarted.keyboardShortcuts.description.interpolated', "发现您喜欢的命令后，创建自定义键盘快捷方式以便即时访问。\n{0}", Button(localize('keyboardShortcuts', "键盘快捷方式"), 'command:toSide:workbench.action.openGlobalKeybindings')),
					media: {
						type: 'markdown', path: 'empty',
					}
				},
				{
					id: 'accessibilitySignals',
					title: localize('gettingStarted.accessibilitySignals.title', "微调您希望通过音频或盲文设备接收的辅助功能信号"),
					description: localize('gettingStarted.accessibilitySignals.description.interpolated', "工作台周围会针对不同事件播放辅助功能声音和公告。\n可以使用「列出信号声音」和「列出信号公告」命令来发现和配置这些内容。\n{0}\n{1}", Button(localize('listSignalSounds', "列出信号声音"), 'command:signals.sounds.help'), Button(localize('listSignalAnnouncements', "列出信号公告"), 'command:accessibility.announcement.help')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'hover',
					title: localize('gettingStarted.hover.title', "访问编辑器中的悬停提示以获取有关变量或符号的更多信息"),
					description: localize('gettingStarted.hover.description.interpolated', "当焦点在编辑器中的变量或符号上时，可以使用「显示或聚焦悬停提示」命令聚焦悬停提示。\n{0}", Button(localize('showOrFocusHover', "显示或聚焦悬停提示"), 'command:editor.action.showHover')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'goToSymbol',
					title: localize('gettingStarted.goToSymbol.title', "导航到文件中的符号"),
					description: localize('gettingStarted.goToSymbol.description.interpolated', "「转到符号」命令对于在文档中的重要标记之间导航非常有用。\n{0}", Button(localize('openGoToSymbol', "转到符号"), 'command:editor.action.goToSymbol')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'codeFolding',
					title: localize('gettingStarted.codeFolding.title', "使用代码折叠来折叠代码块并专注于您感兴趣的代码。"),
					description: localize('gettingStarted.codeFolding.description.interpolated', "使用「切换折叠」命令折叠或展开代码部分。\n{0}\n使用「递归切换折叠」命令递归折叠或展开。\n{1}\n", Button(localize('toggleFold', "切换折叠"), 'command:editor.toggleFold'), Button(localize('toggleFoldRecursively', "递归切换折叠"), 'command:editor.toggleFoldRecursively')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'intellisense',
					title: localize('gettingStarted.intellisense.title', "使用 IntelliSense 提高编码效率"),
					description: localize('gettingStarted.intellisense.description.interpolated', "可以使用「触发建议」命令打开 IntelliSense 建议。\n{0}\n可以使用「触发内联建议」触发内联 IntelliSense 建议。\n{1}\n有用的设置包括 editor.inlineCompletionsAccessibilityVerbose 和 editor.screenReaderAnnounceInlineSuggestion。", Button(localize('triggerIntellisense', "触发建议"), 'command:editor.action.triggerSuggest'), Button(localize('triggerInlineSuggestion', "触发内联建议"), 'command:editor.action.inlineSuggest.trigger')),
					media: {
						type: 'markdown', path: 'empty'
					}
				},
				{
					id: 'accessibilitySettings',
					title: localize('gettingStarted.accessibilitySettings.title', "配置辅助功能设置"),
					description: localize('gettingStarted.accessibilitySettings.description.interpolated', "可以通过运行「打开辅助功能设置」命令来配置辅助功能设置。\n{0}", Button(localize('openAccessibilitySettings', "打开辅助功能设置"), 'command:workbench.action.openAccessibilitySettings')),
					media: { type: 'markdown', path: 'empty' }
				},
				{
					id: 'dictation',
					title: localize('gettingStarted.dictation.title', "使用听写在编辑器和终端中编写代码和文本"),
					description: localize('gettingStarted.dictation.description.interpolated', "听写允许您使用语音编写代码和文本。可以使用「语音: 在编辑器中开始听写」命令激活它。\n{0}\n对于终端中的听写，请使用「语音: 在终端中开始听写」和「语音: 在终端中停止听写」命令。\n{1}\n{2}", Button(localize('toggleDictation', "语音: 在编辑器中开始听写"), 'command:workbench.action.editorDictation.start'), Button(localize('terminalStartDictation', "语音: 在终端中开始听写"), 'command:workbench.action.terminal.startVoice'), Button(localize('terminalStopDictation', "语音: 在终端中停止听写"), 'command:workbench.action.terminal.stopVoice')),
					when: 'hasSpeechProvider',
					media: { type: 'markdown', path: 'empty' }
				}
			]
		}
	},
	{
		id: 'Beginner',
		isFeatured: false,
		title: localize('gettingStarted.beginner.title', "学习基础知识"),
		icon: beginnerIcon,
		description: localize('gettingStarted.beginner.description', "了解最基本功能的概述"),
		walkthroughPageTitle: localize('gettingStarted.beginner.walkthroughPageTitle', '基本功能'),
		content: {
			type: 'steps',
			steps: [
				{
					id: 'settingsAndSync',
					title: localize('gettingStarted.settings.title', "调整设置"),
					description: localize('gettingStarted.settingsAndSync.description.interpolated', "自定义 Chenille 的各个方面，并跨设备[同步](command:workbench.userDataSync.actions.turnOn)自定义设置。\n{0}", Button(localize('tweakSettings', "打开设置"), 'command:toSide:workbench.action.openSettings')),
					when: 'workspacePlatform != \'webworker\' && syncStatus != uninitialized',
					completionEvents: ['onEvent:sync-enabled'],
					media: {
						type: 'svg', altText: 'Chenille AI 设置', path: 'settings.svg'
					},
				},
				{
					id: 'extensions',
					title: localize('gettingStarted.extensions.title', "使用扩展编码"),
					description: localize('gettingStarted.extensions.description.interpolated', "扩展是 Chenille 的增强功能。它们涵盖了便捷的生产力技巧、扩展开箱即用的功能，以及添加全新的功能。\n{0}", Button(localize('browsePopular', "浏览热门扩展"), 'command:workbench.extensions.action.showPopularExtensions')),
					when: 'workspacePlatform != \'webworker\'',
					media: {
						type: 'svg', altText: '带有精选语言扩展的 Chenille 扩展市场', path: 'extensions.svg'
					},
				},
				{
					id: 'terminal',
					title: localize('gettingStarted.terminal.title', "内置终端"),
					description: localize('gettingStarted.terminal.description.interpolated', "在代码旁边快速运行 shell 命令并监控构建输出。\n{0}", Button(localize('showTerminal', "打开终端"), 'command:workbench.action.terminal.toggleTerminal')),
					when: 'workspacePlatform != \'webworker\' && remoteName != codespaces && !terminalIsOpen',
					media: {
						type: 'svg', altText: '运行一些 npm 命令的集成终端', path: 'terminal.svg'
					},
				},
				{
					id: 'debugging',
					title: localize('gettingStarted.debug.title', "观察代码运行"),
					description: localize('gettingStarted.debug.description.interpolated', "通过设置启动配置来加速编辑、构建、测试和调试循环。\n{0}", Button(localize('runProject', "运行项目"), 'command:workbench.action.debug.selectandstart')),
					when: 'workspacePlatform != \'webworker\' && workspaceFolderCount != 0',
					media: {
						type: 'svg', altText: '运行和调试视图。', path: 'debug.svg',
					},
				},
				{
					id: 'scmClone',
					title: localize('gettingStarted.scm.title', "使用 Git 跟踪代码"),
					description: localize('gettingStarted.scmClone.description.interpolated', "为您的项目设置内置版本控制，以跟踪更改并与他人协作。\n{0}", Button(localize('cloneRepo', "克隆仓库"), 'command:git.clone')),
					when: 'config.git.enabled && !git.missing && workspaceFolderCount == 0',
					media: {
						type: 'svg', altText: '源代码管理视图。', path: 'git.svg',
					},
				},
				{
					id: 'scmSetup',
					title: localize('gettingStarted.scm.title', "使用 Git 跟踪代码"),
					description: localize('gettingStarted.scmSetup.description.interpolated', "为您的项目设置内置版本控制，以跟踪更改并与他人协作。\n{0}", Button(localize('initRepo', "初始化GIT仓库"), 'command:git.init')),
					when: 'config.git.enabled && !git.missing && workspaceFolderCount != 0 && gitOpenRepositoryCount == 0',
					media: {
						type: 'svg', altText: '源代码管理视图。', path: 'git.svg',
					},
				},
				{
					id: 'scm',
					title: localize('gettingStarted.scm.title', "使用 Git 跟踪代码"),
					description: localize('gettingStarted.scm.description.interpolated', "不再需要查找 Git 命令！Git 和 GitHub 工作流已无缝集成。\n{0}", Button(localize('openSCM', "打开源代码管理"), 'command:workbench.view.scm')),
					when: 'config.git.enabled && !git.missing && workspaceFolderCount != 0 && gitOpenRepositoryCount != 0 && activeViewlet != \'workbench.view.scm\'',
					media: {
						type: 'svg', altText: '源代码管理视图。', path: 'git.svg',
					},
				},
				{
					id: 'installGit',
					title: localize('gettingStarted.installGit.title', "安装 Git"),
					description: localize({ key: 'gettingStarted.installGit.description.interpolated', comment: ['The placeholders are command link items should not be translated'] }, "安装 Git 以跟踪项目中的更改。\n{0}\n安装后{1}重新加载窗口{2}以完成 Git 设置。", Button(localize('installGit', "安装 Git"), 'https://aka.ms/vscode-install-git'), '[', '](command:workbench.action.reloadWindow)'),
					when: 'git.missing',
					media: {
						type: 'svg', altText: '安装 Git。', path: 'git.svg',
					},
					completionEvents: [
						'onContext:git.state == initialized'
					]
				},

				{
					id: 'tasks',
					title: localize('gettingStarted.tasks.title', "自动化项目任务"),
					when: 'workspaceFolderCount != 0 && workspacePlatform != \'webworker\'',
					description: localize('gettingStarted.tasks.description.interpolated', "为常见工作流创建任务，享受运行脚本和自动检查结果的集成体验。\n{0}", Button(localize('runTasks', "运行自动检测的任务"), 'command:workbench.action.tasks.runTask')),
					media: {
						type: 'svg', altText: '任务运行器。', path: 'runTask.svg',
					},
				},
				{
					id: 'shortcuts',
					title: localize('gettingStarted.shortcuts.title', "自定义快捷方式"),
					description: localize('gettingStarted.shortcuts.description.interpolated', "发现您喜欢的命令后，创建自定义键盘快捷方式以便即时访问。\n{0}", Button(localize('keyboardShortcuts', "键盘快捷方式"), 'command:toSide:workbench.action.openGlobalKeybindings')),
					media: {
						type: 'svg', altText: '交互式快捷方式。', path: 'shortcuts.svg',
					}
				},
				{
					id: 'workspaceTrust',
					title: localize('gettingStarted.workspaceTrust.title', "安全浏览和编辑代码"),
					description: localize('gettingStarted.workspaceTrust.description.interpolated', "{0}让您决定项目文件夹是否应**允许或限制**自动代码执行__（扩展、调试等所需）__。\n打开文件/文件夹时会提示授予信任。您随时可以稍后{1}。", Button(localize('workspaceTrust', "工作区信任"), 'https://code.visualstudio.com/docs/editor/workspace-trust'), Button(localize('enableTrust', "启用信任"), 'command:toSide:workbench.trust.manage')),
					when: 'workspacePlatform != \'webworker\' && !isWorkspaceTrusted && workspaceFolderCount == 0',
					media: {
						type: 'svg', altText: '受限模式下的工作区信任编辑器和切换到受信任模式的主按钮。', path: 'workspaceTrust.svg'
					},
				},
			]
		}
	},
	{
		id: 'notebooks',
		title: localize('gettingStarted.notebook.title', "自定义笔记本"),
		description: '',
		icon: setupIcon,
		isFeatured: false,
		when: `config.${NotebookSetting.openGettingStarted} && userHasOpenedNotebook`,
		walkthroughPageTitle: localize('gettingStarted.notebook.walkthroughPageTitle', '笔记本'),
		content: {
			type: 'steps',
			steps: [
				{
					completionEvents: ['onCommand:notebook.setProfile'],
					id: 'notebookProfile',
					title: localize('gettingStarted.notebookProfile.title', "选择笔记本的布局"),
					description: localize('gettingStarted.notebookProfile.description', "让笔记本按照您喜欢的方式呈现"),
					when: 'userHasOpenedNotebook',
					media: {
						type: 'markdown', path: 'notebookProfile'
					}
				},
			]
		}
	}
];
