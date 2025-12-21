/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb, isWindows } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { ISetting, ISettingsGroup } from '../../../services/preferences/common/preferences.js';

export interface ITOCFilter {
	include?: {
		keyPatterns?: string[];
		tags?: string[];
	};
	exclude?: {
		keyPatterns?: string[];
		tags?: string[];
	};
}

export interface ITOCEntry<T> {
	id: string;
	label: string;
	order?: number;
	children?: ITOCEntry<T>[];
	settings?: Array<T>;
	hide?: boolean;
}

const defaultCommonlyUsedSettings: string[] = [
	'editor.fontSize',
	'editor.formatOnSave',
	'files.autoSave',
	'editor.defaultFormatter',
	'editor.fontFamily',
	'editor.wordWrap',
	'files.exclude',
	'workbench.colorTheme',
	'editor.tabSize',
	'editor.mouseWheelZoom',
	'editor.formatOnPaste'
];

export function getCommonlyUsedData(settingGroups: ISettingsGroup[], commonlyUsed: string[] = defaultCommonlyUsedSettings): ITOCEntry<ISetting> {
	const allSettings = new Map<string, ISetting>();
	for (const group of settingGroups) {
		for (const section of group.sections) {
			for (const s of section.settings) {
				allSettings.set(s.key, s);
			}
		}
	}
	const settings: ISetting[] = [];
	for (const id of commonlyUsed) {
		const setting = allSettings.get(id);
		if (setting) {
			settings.push(setting);
		}
	}
	return {
		id: 'commonlyUsed',
		label: localize('commonlyUsed', "常用"),
		settings
	};
}

export const tocData: ITOCEntry<string> = {
	id: 'root',
	label: 'root',
	children: [
		{
			id: 'editor',
			label: localize('textEditor', "文本编辑器"),
			settings: ['editor.*'],
			children: [
				{
					id: 'editor/cursor',
					label: localize('cursor', "光标"),
					settings: ['editor.cursor*']
				},
				{
					id: 'editor/find',
					label: localize('find', "查找"),
					settings: ['editor.find.*']
				},
				{
					id: 'editor/font',
					label: localize('font', "字体"),
					settings: ['editor.font*']
				},
				{
					id: 'editor/format',
					label: localize('formatting', "格式化"),
					settings: ['editor.format*']
				},
				{
					id: 'editor/diffEditor',
					label: localize('diffEditor', "差异编辑器"),
					settings: ['diffEditor.*']
				},
				{
					id: 'editor/multiDiffEditor',
					label: localize('multiDiffEditor', "多文件差异编辑器"),
					settings: ['multiDiffEditor.*']
				},
				{
					id: 'editor/minimap',
					label: localize('minimap', "小地图"),
					settings: ['editor.minimap.*']
				},
				{
					id: 'editor/suggestions',
					label: localize('suggestions', "建议"),
					settings: ['editor.*suggest*']
				},
				{
					id: 'editor/files',
					label: localize('files', "文件"),
					settings: ['files.*']
				}
			]
		},
		{
			id: 'workbench',
			label: localize('workbench', "工作台"),
			settings: ['workbench.*'],
			children: [
				{
					id: 'workbench/appearance',
					label: localize('appearance', "外观"),
					settings: ['workbench.activityBar.*', 'workbench.*color*', 'workbench.fontAliasing', 'workbench.iconTheme', 'workbench.sidebar.location', 'workbench.*.visible', 'workbench.tips.enabled', 'workbench.tree.*', 'workbench.view.*']
				},
				{
					id: 'workbench/breadcrumbs',
					label: localize('breadcrumbs', "面包屑"),
					settings: ['breadcrumbs.*']
				},
				{
					id: 'workbench/editor',
					label: localize('editorManagement', "编辑管理"),
					settings: ['workbench.editor.*']
				},
				{
					id: 'workbench/settings',
					label: localize('settings', "设置编辑器"),
					settings: ['workbench.settings.*']
				},
				{
					id: 'workbench/zenmode',
					label: localize('zenMode', "禅模式"),
					settings: ['zenmode.*']
				},
				{
					id: 'workbench/screencastmode',
					label: localize('screencastMode', "屏幕放映模式"),
					settings: ['screencastMode.*']
				}
			]
		},
		{
			id: 'window',
			label: localize('window', "窗口"),
			settings: ['window.*'],
			children: [
				{
					id: 'window/newWindow',
					label: localize('newWindow', "新建窗口"),
					settings: ['window.*newwindow*']
				}
			]
		},
		{
			id: 'features',
			label: localize('features', "功能"),
			children: [
				{
					id: 'features/accessibilitySignals',
					label: localize('accessibility.signals', '无障碍信号'),
					settings: ['accessibility.signal*']
				},
				{
					id: 'features/accessibility',
					label: localize('accessibility', "无障碍"),
					settings: ['accessibility.*']
				},
				{
					id: 'features/explorer',
					label: localize('fileExplorer', "资源管理器"),
					settings: ['explorer.*', 'outline.*']
				},
				{
					id: 'features/search',
					label: localize('search', "搜索"),
					settings: ['search.*']
				},
				{
					id: 'features/debug',
					label: localize('debug', "调试"),
					settings: ['debug.*', 'launch']
				},
				{
					id: 'features/testing',
					label: localize('testing', "测试"),
					settings: ['testing.*']
				},
				{
					id: 'features/scm',
					label: localize('scm', "源码管理"),
					settings: ['scm.*']
				},
				{
					id: 'features/extensions',
					label: localize('extensions', "扩展"),
					settings: ['extensions.*']
				},
				{
					id: 'features/terminal',
					label: localize('terminal', "终端"),
					settings: ['terminal.*']
				},
				{
					id: 'features/task',
					label: localize('task', "任务"),
					settings: ['task.*']
				},
				{
					id: 'features/problems',
					label: localize('problems', "问题"),
					settings: ['problems.*']
				},
				{
					id: 'features/output',
					label: localize('output', "输出"),
					settings: ['output.*']
				},
				{
					id: 'features/comments',
					label: localize('comments', "评论"),
					settings: ['comments.*']
				},
				{
					id: 'features/remote',
					label: localize('remote', "远程"),
					settings: ['remote.*']
				},
				{
					id: 'features/timeline',
					label: localize('timeline', "时间线"),
					settings: ['timeline.*']
				},
				{
					id: 'features/notebook',
					label: localize('notebook', '笔记本'),
					settings: ['notebook.*', 'interactiveWindow.*']
				},
				{
					id: 'features/mergeEditor',
					label: localize('mergeEditor', '合并编辑器'),
					settings: ['mergeEditor.*']
				},
				{
					id: 'features/chat',
					label: localize('chat', '聊天'),
					settings: ['chat.*', 'inlineChat.*', 'mcp']
				},
				{
					id: 'features/issueReporter',
					label: localize('issueReporter', '问题报告员'),
					settings: ['issueReporter.*'],
					hide: !isWeb
				}
			]
		},
		{
			id: 'application',
			label: localize('application', "应用"),
			children: [
				{
					id: 'application/http',
					label: localize('proxy', "代理"),
					settings: ['http.*']
				},
				{
					id: 'application/keyboard',
					label: localize('keyboard', "键盘"),
					settings: ['keyboard.*']
				},
				{
					id: 'application/update',
					label: localize('update', "更新"),
					settings: ['update.*']
				},
				{
					id: 'application/telemetry',
					label: localize('telemetry', "遥测"),
					settings: ['telemetry.*']
				},
				{
					id: 'application/settingsSync',
					label: localize('settingsSync', "设置同步"),
					settings: ['settingsSync.*']
				},
				{
					id: 'application/experimental',
					label: localize('experimental', "实验性"),
					settings: ['application.experimental.*']
				},
				{
					id: 'application/other',
					label: localize('other', "其他"),
					settings: ['application.*'],
					hide: isWindows
				}
			]
		},
		{
			id: 'security',
			label: localize('security', "安全"),
			settings: ['security.*'],
			children: [
				{
					id: 'security/workspace',
					label: localize('workspace', "工作区"),
					settings: ['security.workspace.*']
				}
			]
		}
	]
};
