/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions, IConfigurationNode, IConfigurationPropertySchema, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { workbenchConfigurationNodeBase, Extensions as WorkbenchExtensions, IConfigurationMigrationRegistry, ConfigurationKeyValuePairs, ConfigurationMigration } from '../../../common/configuration.js';
import { AccessibilitySignal } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { AccessibilityVoiceSettingId, ISpeechService, SPEECH_LANGUAGES } from '../../speech/common/speechService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { Event } from '../../../../base/common/event.js';
import { isDefined } from '../../../../base/common/types.js';

export const accessibilityHelpIsShown = new RawContextKey<boolean>('accessibilityHelpIsShown', false, true);
export const accessibleViewIsShown = new RawContextKey<boolean>('accessibleViewIsShown', false, true);
export const accessibleViewSupportsNavigation = new RawContextKey<boolean>('accessibleViewSupportsNavigation', false, true);
export const accessibleViewVerbosityEnabled = new RawContextKey<boolean>('accessibleViewVerbosityEnabled', false, true);
export const accessibleViewGoToSymbolSupported = new RawContextKey<boolean>('accessibleViewGoToSymbolSupported', false, true);
export const accessibleViewOnLastLine = new RawContextKey<boolean>('accessibleViewOnLastLine', false, true);
export const accessibleViewCurrentProviderId = new RawContextKey<string>('accessibleViewCurrentProviderId', undefined, undefined);
export const accessibleViewInCodeBlock = new RawContextKey<boolean>('accessibleViewInCodeBlock', undefined, undefined);
export const accessibleViewContainsCodeBlocks = new RawContextKey<boolean>('accessibleViewContainsCodeBlocks', undefined, undefined);
export const accessibleViewHasUnassignedKeybindings = new RawContextKey<boolean>('accessibleViewHasUnassignedKeybindings', undefined, undefined);
export const accessibleViewHasAssignedKeybindings = new RawContextKey<boolean>('accessibleViewHasAssignedKeybindings', undefined, undefined);

/**
 * Miscellaneous settings tagged with accessibility and implemented in the accessibility contrib but
 * were better to live under workbench for discoverability.
 */
export const enum AccessibilityWorkbenchSettingId {
	DimUnfocusedEnabled = 'accessibility.dimUnfocused.enabled',
	DimUnfocusedOpacity = 'accessibility.dimUnfocused.opacity',
	HideAccessibleView = 'accessibility.hideAccessibleView',
	AccessibleViewCloseOnKeyPress = 'accessibility.accessibleView.closeOnKeyPress',
	VerboseChatProgressUpdates = 'accessibility.verboseChatProgressUpdates'
}

export const enum ViewDimUnfocusedOpacityProperties {
	Default = 0.75,
	Minimum = 0.2,
	Maximum = 1
}

export const enum AccessibilityVerbositySettingId {
	Terminal = 'accessibility.verbosity.terminal',
	DiffEditor = 'accessibility.verbosity.diffEditor',
	MergeEditor = 'accessibility.verbosity.mergeEditor',
	Chat = 'accessibility.verbosity.panelChat',
	InlineChat = 'accessibility.verbosity.inlineChat',
	TerminalInlineChat = 'accessibility.verbosity.terminalChat',
	TerminalChatOutput = 'accessibility.verbosity.terminalChatOutput',
	InlineCompletions = 'accessibility.verbosity.inlineCompletions',
	KeybindingsEditor = 'accessibility.verbosity.keybindingsEditor',
	Notebook = 'accessibility.verbosity.notebook',
	Editor = 'accessibility.verbosity.editor',
	Hover = 'accessibility.verbosity.hover',
	Notification = 'accessibility.verbosity.notification',
	EmptyEditorHint = 'accessibility.verbosity.emptyEditorHint',
	ReplEditor = 'accessibility.verbosity.replEditor',
	Comments = 'accessibility.verbosity.comments',
	DiffEditorActive = 'accessibility.verbosity.diffEditorActive',
	Debug = 'accessibility.verbosity.debug',
	Walkthrough = 'accessibility.verbosity.walkthrough',
	SourceControl = 'accessibility.verbosity.sourceControl'
}

const baseVerbosityProperty: IConfigurationPropertySchema = {
	type: 'boolean',
	default: true,
	tags: ['accessibility']
};

export const accessibilityConfigurationNodeBase = Object.freeze<IConfigurationNode>({
	id: 'accessibility',
	title: localize('accessibilityConfigurationTitle', "辅助功能"),
	type: 'object'
});

export const soundFeatureBase: IConfigurationPropertySchema = {
	'type': 'string',
	'enum': ['auto', 'on', 'off'],
	'default': 'auto',
	'enumDescriptions': [
		localize('sound.enabled.auto', "当连接屏幕阅读器时启用声音。"),
		localize('sound.enabled.on', "启用声音。"),
		localize('sound.enabled.off', "禁用声音。")
	],
	tags: ['accessibility'],
};

const signalFeatureBase: IConfigurationPropertySchema = {
	'type': 'object',
	'tags': ['accessibility'],
	additionalProperties: false,
	default: {
		sound: 'auto',
		announcement: 'auto'
	}
};

export const announcementFeatureBase: IConfigurationPropertySchema = {
	'type': 'string',
	'enum': ['auto', 'off'],
	'default': 'auto',
	'enumDescriptions': [
		localize('announcement.enabled.auto', "启用播报，仅在屏幕阅读器优化模式下播放。"),
		localize('announcement.enabled.off', "禁用播报。")
	],
	tags: ['accessibility'],
};

const defaultNoAnnouncement: IConfigurationPropertySchema = {
	'type': 'object',
	'tags': ['accessibility'],
	additionalProperties: false,
	'default': {
		'sound': 'auto',
	}
};

const configuration: IConfigurationNode = {
	...accessibilityConfigurationNodeBase,
	scope: ConfigurationScope.RESOURCE,
	properties: {
		[AccessibilityVerbositySettingId.Terminal]: {
			description: localize('verbosity.terminal.description', '当终端获得焦点时，提供有关如何访问终端辅助功能帮助菜单的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.DiffEditor]: {
			description: localize('verbosity.diffEditor.description', '当差异编辑器获得焦点时，提供有关如何导航更改的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Chat]: {
			description: localize('verbosity.chat.description', '当聊天输入获得焦点时，提供有关如何访问聊天帮助菜单的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.InlineChat]: {
			description: localize('verbosity.interactiveEditor.description', '当输入获得焦点时，提供有关如何访问内联编辑器聊天辅助功能帮助菜单的信息，并提示如何使用该功能。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.TerminalChatOutput]: {
			description: localize('verbosity.terminalChatOutput.description', '提供有关如何在辅助视图中打开聊天终端输出的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.InlineCompletions]: {
			description: localize('verbosity.inlineCompletions.description', '提供有关如何访问内联补全悬停和辅助视图的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.KeybindingsEditor]: {
			description: localize('verbosity.keybindingsEditor.description', '当某行获得焦点时，提供有关如何在键绑定编辑器中更改键绑定的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Notebook]: {
			description: localize('verbosity.notebook', '当笔记本单元格获得焦点时，提供有关如何聚焦单元格容器或内部编辑器的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Hover]: {
			description: localize('verbosity.hover', '提供有关如何在辅助视图中打开悬停的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Notification]: {
			description: localize('verbosity.notification', '提供有关如何在辅助视图中打开通知的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.EmptyEditorHint]: {
			description: localize('verbosity.emptyEditorHint', '在空文本编辑器中提供有关相关操作的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.ReplEditor]: {
			description: localize('verbosity.replEditor.description', '当 REPL 编辑器获得焦点时，提供有关如何访问 REPL 编辑器辅助功能帮助菜单的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Comments]: {
			description: localize('verbosity.comments', '提供有关可在评论小组件或包含评论的文件中执行的操作的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.DiffEditorActive]: {
			description: localize('verbosity.diffEditorActive', '当差异编辑器成为活动编辑器时进行指示。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Debug]: {
			description: localize('verbosity.debug', '当调试控制台或运行和调试视图获得焦点时，提供有关如何访问调试控制台辅助功能帮助对话框的信息。请注意，需要重新加载窗口才能使此设置生效。'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Walkthrough]: {
			description: localize('verbosity.walkthrough', '提供有关如何在辅助视图中打开演练的信息。'),
			...baseVerbosityProperty
		},
		[AccessibilityWorkbenchSettingId.AccessibleViewCloseOnKeyPress]: {
			markdownDescription: localize('terminal.integrated.accessibleView.closeOnKeyPress', "按键时，关闭辅助视图并聚焦到调用它的元素。"),
			type: 'boolean',
			default: true
		},
		[AccessibilityVerbositySettingId.SourceControl]: {
			description: localize('verbosity.scm', '当输入获得焦点时，提供有关如何访问源代码管理辅助功能帮助菜单的信息。'),
			...baseVerbosityProperty
		},
		'accessibility.signalOptions.volume': {
			'description': localize('accessibility.signalOptions.volume', "声音的音量百分比 (0-100)。"),
			'type': 'number',
			'minimum': 0,
			'maximum': 100,
			'default': 70,
			'tags': ['accessibility']
		},
		'accessibility.signalOptions.debouncePositionChanges': {
			'description': localize('accessibility.signalOptions.debouncePositionChanges', "是否应对位置更改进行防抖处理"),
			'type': 'boolean',
			'default': false,
			'tags': ['accessibility']
		},
		'accessibility.signalOptions.experimental.delays.general': {
			'type': 'object',
			'description': '除位置处的错误和警告外，所有信号的延迟',
			'additionalProperties': false,
			'properties': {
				'announcement': {
					'description': localize('accessibility.signalOptions.delays.general.announcement', "播报前的延迟时间（毫秒）。"),
					'type': 'number',
					'minimum': 0,
					'default': 3000
				},
				'sound': {
					'description': localize('accessibility.signalOptions.delays.general.sound', "播放声音前的延迟时间（毫秒）。"),
					'type': 'number',
					'minimum': 0,
					'default': 400
				}
			},
			'tags': ['accessibility']
		},
		'accessibility.signalOptions.experimental.delays.warningAtPosition': {
			'type': 'object',
			'additionalProperties': false,
			'properties': {
				'announcement': {
					'description': localize('accessibility.signalOptions.delays.warningAtPosition.announcement', "当位置处有警告时，播报前的延迟时间（毫秒）。"),
					'type': 'number',
					'minimum': 0,
					'default': 3000
				},
				'sound': {
					'description': localize('accessibility.signalOptions.delays.warningAtPosition.sound', "当位置处有警告时，播放声音前的延迟时间（毫秒）。"),
					'type': 'number',
					'minimum': 0,
					'default': 1000
				}
			},
			'tags': ['accessibility']
		},
		'accessibility.signalOptions.experimental.delays.errorAtPosition': {
			'type': 'object',
			'additionalProperties': false,
			'properties': {
				'announcement': {
					'description': localize('accessibility.signalOptions.delays.errorAtPosition.announcement', "当位置处有错误时，播报前的延迟时间（毫秒）。"),
					'type': 'number',
					'minimum': 0,
					'default': 3000
				},
				'sound': {
					'description': localize('accessibility.signalOptions.delays.errorAtPosition.sound', "当位置处有错误时，播放声音前的延迟时间（毫秒）。"),
					'type': 'number',
					'minimum': 0,
					'default': 1000
				}
			},
			'tags': ['accessibility']
		},
		'accessibility.signals.lineHasBreakpoint': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.lineHasBreakpoint', "当活动行有断点时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.lineHasBreakpoint.sound', "当活动行有断点时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.lineHasBreakpoint.announcement', "当活动行有断点时进行播报。"),
					...announcementFeatureBase
				},
			},
		},
		'accessibility.signals.lineHasInlineSuggestion': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.lineHasInlineSuggestion', "当活动行有内联建议时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.lineHasInlineSuggestion.sound', "当活动行有内联建议时播放声音。"),
					...soundFeatureBase,
					'default': 'off'
				}
			}
		},
		'accessibility.signals.nextEditSuggestion': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.nextEditSuggestion', "当有下一个编辑建议时播放信号 - 声音/音频提示和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.nextEditSuggestion.sound', "当有下一个编辑建议时播放声音。"),
					...soundFeatureBase,
				},
				'announcement': {
					'description': localize('accessibility.signals.nextEditSuggestion.announcement', "当有下一个编辑建议时进行播报。"),
					...announcementFeatureBase,
				},
			}
		},
		'accessibility.signals.lineHasError': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.lineHasError', "当活动行有错误时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.lineHasError.sound', "当活动行有错误时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.lineHasError.announcement', "当活动行有错误时进行播报。"),
					...announcementFeatureBase,
					default: 'off'
				},
			},
		},
		'accessibility.signals.lineHasFoldedArea': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.lineHasFoldedArea', "当活动行有可展开的折叠区域时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.lineHasFoldedArea.sound', "当活动行有可展开的折叠区域时播放声音。"),
					...soundFeatureBase,
					default: 'off'
				},
				'announcement': {
					'description': localize('accessibility.signals.lineHasFoldedArea.announcement', "当活动行有可展开的折叠区域时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.lineHasWarning': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.lineHasWarning', "当活动行有警告时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.lineHasWarning.sound', "当活动行有警告时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.lineHasWarning.announcement', "当活动行有警告时进行播报。"),
					...announcementFeatureBase,
					default: 'off'
				},
			},
		},
		'accessibility.signals.positionHasError': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.positionHasError', "当活动行有错误时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.positionHasError.sound', "当活动行有错误时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.positionHasError.announcement', "当活动行有错误时进行播报。"),
					...announcementFeatureBase,
					default: 'on'
				},
			},
		},
		'accessibility.signals.positionHasWarning': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.positionHasWarning', "当活动行有警告时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.positionHasWarning.sound', "当活动行有警告时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.positionHasWarning.announcement', "当活动行有警告时进行播报。"),
					...announcementFeatureBase,
					default: 'on'
				},
			},
		},
		'accessibility.signals.onDebugBreak': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.onDebugBreak', "当调试器在断点处停止时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.onDebugBreak.sound', "当调试器在断点处停止时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.onDebugBreak.announcement', "当调试器在断点处停止时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.noInlayHints': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.noInlayHints', "当尝试读取没有内嵌提示的行时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.noInlayHints.sound', "当尝试读取没有内嵌提示的行时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.noInlayHints.announcement', "当尝试读取没有内嵌提示的行时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.taskCompleted': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.taskCompleted', "当任务完成时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.taskCompleted.sound', "当任务完成时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.taskCompleted.announcement', "当任务完成时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.taskFailed': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.taskFailed', "当任务失败（非零退出代码）时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.taskFailed.sound', "当任务失败（非零退出代码）时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.taskFailed.announcement', "当任务失败（非零退出代码）时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.terminalCommandFailed': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.terminalCommandFailed', "当终端命令失败（非零退出代码）或在辅助视图中导航到具有此类退出代码的命令时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.terminalCommandFailed.sound', "当终端命令失败（非零退出代码）或在辅助视图中导航到具有此类退出代码的命令时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.terminalCommandFailed.announcement', "当终端命令失败（非零退出代码）或在辅助视图中导航到具有此类退出代码的命令时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.terminalCommandSucceeded': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.terminalCommandSucceeded', "当终端命令成功（零退出代码）或在辅助视图中导航到具有此类退出代码的命令时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.terminalCommandSucceeded.sound', "当终端命令成功（零退出代码）或在辅助视图中导航到具有此类退出代码的命令时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.terminalCommandSucceeded.announcement', "当终端命令成功（零退出代码）或在辅助视图中导航到具有此类退出代码的命令时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.terminalQuickFix': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.terminalQuickFix', "当终端快速修复可用时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.terminalQuickFix.sound', "当终端快速修复可用时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.terminalQuickFix.announcement', "当终端快速修复可用时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.terminalBell': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.terminalBell', "当终端响铃时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.terminalBell.sound', "当终端响铃时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.terminalBell.announcement', "当终端响铃时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.diffLineInserted': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.diffLineInserted', "当焦点移动到辅助差异查看器模式中的插入行或移动到下一个/上一个更改时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.sound', "当焦点移动到辅助差异查看器模式中的插入行或移动到下一个/上一个更改时播放声音。"),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.diffLineModified': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.diffLineModified', "当焦点移动到辅助差异查看器模式中的修改行或移动到下一个/上一个更改时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.diffLineModified.sound', "当焦点移动到辅助差异查看器模式中的修改行或移动到下一个/上一个更改时播放声音。"),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.diffLineDeleted': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.diffLineDeleted', "当焦点移动到辅助差异查看器模式中的删除行或移动到下一个/上一个更改时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.diffLineDeleted.sound', "当焦点移动到辅助差异查看器模式中的删除行或移动到下一个/上一个更改时播放声音。"),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.chatEditModifiedFile': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.chatEditModifiedFile', "当显示聊天编辑更改的文件时播放声音/音频提示"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.chatEditModifiedFile.sound', "当显示聊天编辑更改的文件时播放声音"),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.notebookCellCompleted': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.notebookCellCompleted', "当笔记本单元格执行成功完成时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.notebookCellCompleted.sound', "当笔记本单元格执行成功完成时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.notebookCellCompleted.announcement', "当笔记本单元格执行成功完成时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.notebookCellFailed': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.notebookCellFailed', "当笔记本单元格执行失败时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.notebookCellFailed.sound', "当笔记本单元格执行失败时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.notebookCellFailed.announcement', "当笔记本单元格执行失败时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.progress': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.progress', "在进度进行时循环播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'default': {
				'sound': 'auto',
				'announcement': 'off'
			},
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.progress.sound', "在进度进行时循环播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.progress.announcement', "在进度进行时循环播报。"),
					...announcementFeatureBase
				},
			},
		},
		'accessibility.signals.chatRequestSent': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.chatRequestSent', "当发送聊天请求时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.chatRequestSent.sound', "当发送聊天请求时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.chatRequestSent.announcement', "当发送聊天请求时进行播报。"),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.chatResponseReceived': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.chatResponseReceived', "当收到响应时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.chatResponseReceived.sound', "当收到响应时播放声音。"),
					...soundFeatureBase
				},
			}
		},
		'accessibility.signals.codeActionTriggered': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.codeActionTriggered', "当触发代码操作时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.codeActionTriggered.sound', "当触发代码操作时播放声音。"),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.codeActionApplied': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.codeActionApplied', "当应用代码操作时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.codeActionApplied.sound', "当应用代码操作时播放声音。"),
					...soundFeatureBase
				},
			}
		},
		'accessibility.signals.voiceRecordingStarted': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.voiceRecordingStarted', "当语音录制开始时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.voiceRecordingStarted.sound', "当语音录制开始时播放声音。"),
					...soundFeatureBase,
				},
			},
			'default': {
				'sound': 'on'
			}
		},
		'accessibility.signals.voiceRecordingStopped': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.voiceRecordingStopped', "当语音录制停止时播放声音/音频提示。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.voiceRecordingStopped.sound', "当语音录制停止时播放声音。"),
					...soundFeatureBase,
					default: 'off'
				},
			}
		},
		'accessibility.signals.clear': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.clear', "当功能被清除时（例如终端、调试控制台或输出通道）播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.clear.sound', "当功能被清除时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.clear.announcement', "当功能被清除时进行播报。"),
					...announcementFeatureBase
				},
			},
		},
		'accessibility.signals.editsUndone': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.editsUndone', "当编辑被撤消时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.editsUndone.sound', "当编辑被撤消时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.editsUndone.announcement', "当编辑被撤消时进行播报。"),
					...announcementFeatureBase
				},
			},
		},
		'accessibility.signals.editsKept': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.editsKept', "当编辑被保留时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.editsKept.sound', "当编辑被保留时播放声音。"),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.editsKept.announcement', "当编辑被保留时进行播报。"),
					...announcementFeatureBase
				},
			},
		},
		'accessibility.signals.save': {
			'type': 'object',
			'tags': ['accessibility'],
			additionalProperties: false,
			'markdownDescription': localize('accessibility.signals.save', "当保存文件时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.save.sound', "当保存文件时播放声音。"),
					'type': 'string',
					'enum': ['userGesture', 'always', 'never'],
					'default': 'never',
					'enumDescriptions': [
						localize('accessibility.signals.save.sound.userGesture', "当用户显式保存文件时播放声音。"),
						localize('accessibility.signals.save.sound.always', "每当保存文件时播放声音，包括自动保存。"),
						localize('accessibility.signals.save.sound.never', "从不播放声音。")
					],
				},
				'announcement': {
					'description': localize('accessibility.signals.save.announcement', "当保存文件时进行播报。"),
					'type': 'string',
					'enum': ['userGesture', 'always', 'never'],
					'default': 'never',
					'enumDescriptions': [
						localize('accessibility.signals.save.announcement.userGesture', "当用户显式保存文件时进行播报。"),
						localize('accessibility.signals.save.announcement.always', "每当保存文件时进行播报，包括自动保存。"),
						localize('accessibility.signals.save.announcement.never', "从不播报。")
					],
				},
			},
			default: {
				'sound': 'never',
				'announcement': 'never'
			}
		},
		'accessibility.signals.format': {
			'type': 'object',
			'tags': ['accessibility'],
			additionalProperties: false,
			'markdownDescription': localize('accessibility.signals.format', "当格式化文件或笔记本时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.format.sound', "当格式化文件或笔记本时播放声音。"),
					'type': 'string',
					'enum': ['userGesture', 'always', 'never'],
					'default': 'never',
					'enumDescriptions': [
						localize('accessibility.signals.format.userGesture', "当用户显式格式化文件时播放声音。"),
						localize('accessibility.signals.format.always', "每当格式化文件时播放声音，包括保存时格式化、输入时格式化、粘贴时格式化或运行单元格时格式化。"),
						localize('accessibility.signals.format.never', "从不播放声音。")
					],
				},
				'announcement': {
					'description': localize('accessibility.signals.format.announcement', "当格式化文件或笔记本时进行播报。"),
					'type': 'string',
					'enum': ['userGesture', 'always', 'never'],
					'default': 'never',
					'enumDescriptions': [
						localize('accessibility.signals.format.announcement.userGesture', "当用户显式格式化文件时进行播报。"),
						localize('accessibility.signals.format.announcement.always', "每当格式化文件时进行播报，包括保存时格式化、输入时格式化、粘贴时格式化或运行单元格时格式化。"),
						localize('accessibility.signals.format.announcement.never', "从不播报。")
					],
				},
			},
			default: {
				'sound': 'never',
				'announcement': 'never'
			}
		},
		'accessibility.signals.chatUserActionRequired': {
			...signalFeatureBase,
			'markdownDescription': localize('accessibility.signals.chatUserActionRequired', "当聊天中需要用户操作时播放信号 - 声音（音频提示）和/或播报（警报）。"),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.chatUserActionRequired.sound', "当聊天中需要用户操作时播放声音。"),
					'type': 'string',
					'enum': ['auto', 'on', 'off'],
					'enumDescriptions': [
						localize('sound.enabled.autoWindow', "当连接屏幕阅读器时启用声音。"),
						localize('sound.enabled.on', "启用声音。"),
						localize('sound.enabled.off', "禁用声音。")
					],
				},
				'announcement': {
					'description': localize('accessibility.signals.chatUserActionRequired.announcement', "当聊天中需要用户操作时进行播报 - 包括有关操作及如何执行的信息。"),
					...announcementFeatureBase
				},
			},
			default: {
				'sound': 'auto',
				'announcement': 'auto'
			},
			tags: ['accessibility']
		},
		'accessibility.underlineLinks': {
			'type': 'boolean',
			'description': localize('accessibility.underlineLinks', "控制是否应在工作台中为链接添加下划线。"),
			'default': false,
		},
		'accessibility.debugWatchVariableAnnouncements': {
			'type': 'boolean',
			'description': localize('accessibility.debugWatchVariableAnnouncements', "控制是否应在调试监视视图中播报变量更改。"),
			'default': true,
		},
		'accessibility.replEditor.readLastExecutionOutput': {
			'type': 'boolean',
			'description': localize('accessibility.replEditor.readLastExecutedOutput', "控制是否应播报原生 REPL 中执行的输出。"),
			'default': true,
		},
		'accessibility.replEditor.autoFocusReplExecution': {
			type: 'string',
			enum: ['none', 'input', 'lastExecution'],
			default: 'input',
			description: localize('replEditor.autoFocusAppendedCell', "控制执行代码时是否应自动将焦点发送到 REPL。"),
		},
		'accessibility.windowTitleOptimized': {
			'type': 'boolean',
			'default': true,
			'markdownDescription': localize('accessibility.windowTitleOptimized', "控制在屏幕阅读器模式下是否应针对屏幕阅读器优化 {0}。启用后，窗口标题末尾将附加 {1}。", '`#window.title#`', '`activeEditorState`')
		},
		'accessibility.openChatEditedFiles': {
			'type': 'boolean',
			'default': false,
			'markdownDescription': localize('accessibility.openChatEditedFiles', "控制当聊天代理对文件应用编辑后是否应打开这些文件。")
		},
		'accessibility.verboseChatProgressUpdates': {
			'type': 'boolean',
			'default': true,
			'markdownDescription': localize('accessibility.verboseChatProgressUpdates', "控制当聊天请求正在进行时是否应进行详细的进度播报，包括搜索文本 <搜索词> 有 X 个结果、创建文件 <文件名> 或读取文件 <文件路径> 等信息。")
		}
	}
};

export function registerAccessibilityConfiguration() {
	const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
	registry.registerConfiguration(configuration);

	registry.registerConfiguration({
		...workbenchConfigurationNodeBase,
		properties: {
			[AccessibilityWorkbenchSettingId.DimUnfocusedEnabled]: {
				description: localize('dimUnfocusedEnabled', '是否使未聚焦的编辑器和终端变暗，这样可以更清楚地知道键入的输入将发送到哪里。这适用于大多数编辑器，但使用 iframe 的编辑器（如笔记本和扩展 webview 编辑器）除外。'),
				type: 'boolean',
				default: false,
				tags: ['accessibility'],
				scope: ConfigurationScope.APPLICATION,
			},
			[AccessibilityWorkbenchSettingId.DimUnfocusedOpacity]: {
				markdownDescription: localize('dimUnfocusedOpacity', '用于未聚焦的编辑器和终端的不透明度分数 (0.2 到 1.0)。仅当启用 {0} 时此设置才会生效。', `\`#${AccessibilityWorkbenchSettingId.DimUnfocusedEnabled}#\``),
				type: 'number',
				minimum: ViewDimUnfocusedOpacityProperties.Minimum,
				maximum: ViewDimUnfocusedOpacityProperties.Maximum,
				default: ViewDimUnfocusedOpacityProperties.Default,
				tags: ['accessibility'],
				scope: ConfigurationScope.APPLICATION,
			},
			[AccessibilityWorkbenchSettingId.HideAccessibleView]: {
				description: localize('accessibility.hideAccessibleView', "控制是否隐藏辅助视图。"),
				type: 'boolean',
				default: false,
				tags: ['accessibility']
			},
			[AccessibilityWorkbenchSettingId.VerboseChatProgressUpdates]: {
				'type': 'boolean',
				'default': true,
				'markdownDescription': localize('accessibility.verboseChatProgressUpdates', "控制当聊天请求正在进行时是否应进行详细的进度播报，包括搜索文本 <搜索词> 有 X 个结果、创建文件 <文件名> 或读取文件 <文件路径> 等信息。")
			}
		}
	});
}

export { AccessibilityVoiceSettingId };

export const SpeechTimeoutDefault = 0;

export class DynamicSpeechAccessibilityConfiguration extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.dynamicSpeechAccessibilityConfiguration';

	constructor(
		@ISpeechService private readonly speechService: ISpeechService
	) {
		super();

		this._register(Event.runAndSubscribe(speechService.onDidChangeHasSpeechProvider, () => this.updateConfiguration()));
	}

	private updateConfiguration(): void {
		if (!this.speechService.hasSpeechProvider) {
			return; // these settings require a speech provider
		}

		const languages = this.getLanguages();
		const languagesSorted = Object.keys(languages).sort((langA, langB) => {
			return languages[langA].name.localeCompare(languages[langB].name);
		});

		const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
		registry.registerConfiguration({
			...accessibilityConfigurationNodeBase,
			properties: {
				[AccessibilityVoiceSettingId.SpeechTimeout]: {
					'markdownDescription': localize('voice.speechTimeout', "停止说话后语音识别保持活动状态的持续时间（毫秒）。例如，在聊天会话中，超时后转录的文本会自动提交。设置为 `0` 可禁用此功能。"),
					'type': 'number',
					'default': SpeechTimeoutDefault,
					'minimum': 0,
					'tags': ['accessibility']
				},
				[AccessibilityVoiceSettingId.IgnoreCodeBlocks]: {
					'markdownDescription': localize('voice.ignoreCodeBlocks', "是否在文本转语音合成中忽略代码片段。"),
					'type': 'boolean',
					'default': false,
					'tags': ['accessibility']
				},
				[AccessibilityVoiceSettingId.SpeechLanguage]: {
					'markdownDescription': localize('voice.speechLanguage', "文本转语音和语音转文本应使用的语言。选择 `auto` 可在可能的情况下使用配置的显示语言。请注意，并非所有显示语言都可能受语音识别和合成器支持。"),
					'type': 'string',
					'enum': languagesSorted,
					'default': 'auto',
					'tags': ['accessibility'],
					'enumDescriptions': languagesSorted.map(key => languages[key].name),
					'enumItemLabels': languagesSorted.map(key => languages[key].name)
				},
				[AccessibilityVoiceSettingId.AutoSynthesize]: {
					'type': 'string',
					'enum': ['on', 'off'],
					'enumDescriptions': [
						localize('accessibility.voice.autoSynthesize.on', "启用此功能。当启用屏幕阅读器时，请注意这将禁用 aria 更新。"),
						localize('accessibility.voice.autoSynthesize.off', "禁用此功能。"),
					],
					'markdownDescription': localize('autoSynthesize', "当使用语音作为输入时，是否应自动朗读文本响应。例如，在聊天会话中，当使用语音作为聊天请求时，响应会自动合成。"),
					'default': 'off',
					'tags': ['accessibility']
				}
			}
		});
	}

	private getLanguages(): { [locale: string]: { name: string } } {
		return {
			['auto']: {
				name: localize('speechLanguage.auto', "自动（使用显示语言）")
			},
			...SPEECH_LANGUAGES
		};
	}
}

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'audioCues.volume',
		migrateFn: (value, accessor) => {
			return [
				['accessibility.signalOptions.volume', { value }],
				['audioCues.volume', { value: undefined }]
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'audioCues.debouncePositionChanges',
		migrateFn: (value) => {
			return [
				['accessibility.signalOptions.debouncePositionChanges', { value }],
				['audioCues.debouncePositionChanges', { value: undefined }]
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signalOptions',
		migrateFn: (value, accessor) => {
			const delayGeneral = getDelaysFromConfig(accessor, 'general');
			const delayError = getDelaysFromConfig(accessor, 'errorAtPosition');
			const delayWarning = getDelaysFromConfig(accessor, 'warningAtPosition');
			const volume = getVolumeFromConfig(accessor);
			const debouncePositionChanges = getDebouncePositionChangesFromConfig(accessor);
			const result: [key: string, { value: any }][] = [];
			if (!!volume) {
				result.push(['accessibility.signalOptions.volume', { value: volume }]);
			}
			if (!!delayGeneral) {
				result.push(['accessibility.signalOptions.experimental.delays.general', { value: delayGeneral }]);
			}
			if (!!delayError) {
				result.push(['accessibility.signalOptions.experimental.delays.errorAtPosition', { value: delayError }]);
			}
			if (!!delayWarning) {
				result.push(['accessibility.signalOptions.experimental.delays.warningAtPosition', { value: delayWarning }]);
			}
			if (!!debouncePositionChanges) {
				result.push(['accessibility.signalOptions.debouncePositionChanges', { value: debouncePositionChanges }]);
			}
			result.push(['accessibility.signalOptions', { value: undefined }]);
			return result;
		}
	}]);


Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signals.sounds.volume',
		migrateFn: (value) => {
			return [
				['accessibility.signalOptions.volume', { value }],
				['accessibility.signals.sounds.volume', { value: undefined }]
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signals.debouncePositionChanges',
		migrateFn: (value) => {
			return [
				['accessibility.signalOptions.debouncePositionChanges', { value }],
				['accessibility.signals.debouncePositionChanges', { value: undefined }]
			];
		}
	}]);

function getDelaysFromConfig(accessor: (key: string) => any, type: 'general' | 'errorAtPosition' | 'warningAtPosition'): { announcement: number; sound: number } | undefined {
	return accessor(`accessibility.signalOptions.experimental.delays.${type}`) || accessor('accessibility.signalOptions')?.['experimental.delays']?.[`${type}`] || accessor('accessibility.signalOptions')?.['delays']?.[`${type}`];
}

function getVolumeFromConfig(accessor: (key: string) => any): string | undefined {
	return accessor('accessibility.signalOptions.volume') || accessor('accessibility.signalOptions')?.volume || accessor('accessibility.signals.sounds.volume') || accessor('audioCues.volume');
}

function getDebouncePositionChangesFromConfig(accessor: (key: string) => any): number | undefined {
	return accessor('accessibility.signalOptions.debouncePositionChanges') || accessor('accessibility.signalOptions')?.debouncePositionChanges || accessor('accessibility.signals.debouncePositionChanges') || accessor('audioCues.debouncePositionChanges');
}

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: AccessibilityVoiceSettingId.AutoSynthesize,
		migrateFn: (value: boolean) => {
			let newValue: string | undefined;
			if (value === true) {
				newValue = 'on';
			} else if (value === false) {
				newValue = 'off';
			} else {
				return [];
			}
			return [
				[AccessibilityVoiceSettingId.AutoSynthesize, { value: newValue }],
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signals.chatResponsePending',
		migrateFn: (value, accessor) => {
			return [
				['accessibility.signals.progress', { value }],
				['accessibility.signals.chatResponsePending', { value: undefined }],
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations(AccessibilitySignal.allAccessibilitySignals.map<ConfigurationMigration | undefined>(item => item.legacySoundSettingsKey ? ({
		key: item.legacySoundSettingsKey,
		migrateFn: (sound, accessor) => {
			const configurationKeyValuePairs: ConfigurationKeyValuePairs = [];
			const legacyAnnouncementSettingsKey = item.legacyAnnouncementSettingsKey;
			let announcement: string | undefined;
			if (legacyAnnouncementSettingsKey) {
				announcement = accessor(legacyAnnouncementSettingsKey) ?? undefined;
				if (announcement !== undefined && typeof announcement !== 'string') {
					announcement = announcement ? 'auto' : 'off';
				}
			}
			configurationKeyValuePairs.push([`${item.legacySoundSettingsKey}`, { value: undefined }]);
			configurationKeyValuePairs.push([`${item.settingsKey}`, { value: announcement !== undefined ? { announcement, sound } : { sound } }]);
			return configurationKeyValuePairs;
		}
	}) : undefined).filter(isDefined));

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations(AccessibilitySignal.allAccessibilitySignals.filter(i => !!i.legacyAnnouncementSettingsKey && !!i.legacySoundSettingsKey).map(item => ({
		key: item.legacyAnnouncementSettingsKey!,
		migrateFn: (announcement, accessor) => {
			const configurationKeyValuePairs: ConfigurationKeyValuePairs = [];
			const sound = accessor(item.settingsKey)?.sound || accessor(item.legacySoundSettingsKey!);
			if (announcement !== undefined && typeof announcement !== 'string') {
				announcement = announcement ? 'auto' : 'off';
			}
			configurationKeyValuePairs.push([`${item.settingsKey}`, { value: announcement !== undefined ? { announcement, sound } : { sound } }]);
			configurationKeyValuePairs.push([`${item.legacyAnnouncementSettingsKey}`, { value: undefined }]);
			configurationKeyValuePairs.push([`${item.legacySoundSettingsKey}`, { value: undefined }]);
			return configurationKeyValuePairs;
		}
	})));
