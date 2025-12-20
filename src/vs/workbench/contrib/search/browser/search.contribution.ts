/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import * as platform from '../../../../base/common/platform.js';
import { AbstractGotoLineQuickAccessProvider } from '../../../../editor/contrib/quickAccess/browser/gotoLineQuickAccess.js';
import * as nls from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Extensions as QuickAccessExtensions, IQuickAccessRegistry } from '../../../../platform/quickinput/common/quickAccess.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { defaultQuickAccessContextKeyValue } from '../../../browser/quickaccess.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { GotoSymbolQuickAccessProvider } from '../../codeEditor/browser/quickaccess/gotoSymbolQuickAccess.js';
import { AnythingQuickAccessProvider } from './anythingQuickAccess.js';
import { registerContributions as replaceContributions } from './replaceContributions.js';
import { registerContributions as notebookSearchContributions } from './notebookSearch/notebookSearchContributions.js';
import { searchViewIcon } from './searchIcons.js';
import { SearchView } from './searchView.js';
import { registerContributions as searchWidgetContributions } from './searchWidget.js';
import { SymbolsQuickAccessProvider } from './symbolsQuickAccess.js';
import { ISearchHistoryService, SearchHistoryService } from '../common/searchHistoryService.js';
import { SearchViewModelWorkbenchService } from './searchTreeModel/searchModel.js';
import { ISearchViewModelWorkbenchService } from './searchTreeModel/searchViewModelWorkbenchService.js';
import { SearchSortOrder, SEARCH_EXCLUDE_CONFIG, VIEWLET_ID, ViewMode, VIEW_ID, DEFAULT_MAX_SEARCH_RESULTS, SemanticSearchBehavior } from '../../../services/search/common/search.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { assertType } from '../../../../base/common/types.js';
import { getWorkspaceSymbols, IWorkspaceSymbol } from '../common/search.js';
import * as Constants from '../common/constants.js';
import { SearchChatContextContribution } from './searchChatContext.js';

import './searchActionsCopy.js';
import './searchActionsFind.js';
import './searchActionsNav.js';
import './searchActionsRemoveReplace.js';
import './searchActionsSymbol.js';
import './searchActionsTopBar.js';
import './searchActionsTextQuickAccess.js';
import { TEXT_SEARCH_QUICK_ACCESS_PREFIX, TextSearchQuickAccess } from './quickTextSearch/textSearchQuickAccess.js';
import { Extensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

registerSingleton(ISearchViewModelWorkbenchService, SearchViewModelWorkbenchService, InstantiationType.Delayed);
registerSingleton(ISearchHistoryService, SearchHistoryService, InstantiationType.Delayed);

replaceContributions();
notebookSearchContributions();
searchWidgetContributions();

registerWorkbenchContribution2(SearchChatContextContribution.ID, SearchChatContextContribution, WorkbenchPhase.AfterRestored);

const SEARCH_MODE_CONFIG = 'search.mode';

const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VIEWLET_ID,
	title: nls.localize2('search', "搜索"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }]),
	hideIfEmpty: true,
	icon: searchViewIcon,
	order: 1,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: true });

const viewDescriptor: IViewDescriptor = {
	id: VIEW_ID,
	containerIcon: searchViewIcon,
	name: nls.localize2('search', "搜索"),
	ctorDescriptor: new SyncDescriptor(SearchView),
	canToggleVisibility: false,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: viewContainer.id,
		mnemonicTitle: nls.localize({ key: 'miViewSearch', comment: ['&& denotes a mnemonic'] }, "搜索(&&S)"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF,
			// Yes, this is weird. See #116188, #115556, #115511, and now #124146, for examples of what can go wrong here.
			when: ContextKeyExpr.regex('neverMatch', /doesNotMatch/)
		},
		order: 1
	}
};

// Register search default location to sidebar
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([viewDescriptor], viewContainer);

// Register Quick Access Handler
const quickAccessRegistry = Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess);

quickAccessRegistry.registerQuickAccessProvider({
	ctor: AnythingQuickAccessProvider,
	prefix: AnythingQuickAccessProvider.PREFIX,
	placeholder: nls.localize('anythingQuickAccessPlaceholder', "按名称搜索文件 (追加 {0} 转到行或 {1} 转到符号)", AbstractGotoLineQuickAccessProvider.GO_TO_LINE_PREFIX, GotoSymbolQuickAccessProvider.PREFIX),
	contextKey: defaultQuickAccessContextKeyValue,
	helpEntries: [{
		description: nls.localize('anythingQuickAccess', "转到文件"),
		commandId: 'workbench.action.quickOpen',
		commandCenterOrder: 10
	}]
});

quickAccessRegistry.registerQuickAccessProvider({
	ctor: SymbolsQuickAccessProvider,
	prefix: SymbolsQuickAccessProvider.PREFIX,
	placeholder: nls.localize('symbolsQuickAccessPlaceholder', "键入要打开的符号名称。"),
	contextKey: 'inWorkspaceSymbolsPicker',
	helpEntries: [{ description: nls.localize('symbolsQuickAccess', "转到工作区中的符号"), commandId: Constants.SearchCommandIds.ShowAllSymbolsActionId }]
});

quickAccessRegistry.registerQuickAccessProvider({
	ctor: TextSearchQuickAccess,
	prefix: TEXT_SEARCH_QUICK_ACCESS_PREFIX,
	contextKey: 'inTextSearchPicker',
	placeholder: nls.localize('textSearchPickerPlaceholder', "在工作区文件中搜索文本。"),
	helpEntries: [
		{
			description: nls.localize('textSearchPickerHelp', "搜索文本"),
			commandId: Constants.SearchCommandIds.QuickTextSearchActionId,
			commandCenterOrder: 25,
		}
	]
});

// Configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'search',
	order: 13,
	title: nls.localize('searchConfigurationTitle', "搜索"),
	type: 'object',
	properties: {
		[SEARCH_EXCLUDE_CONFIG]: {
			type: 'object',
			markdownDescription: nls.localize('exclude', "配置 [glob 模式](https://code.visualstudio.com/docs/editor/codebasics#_advanced-search-options)，用于在全文搜索和快速打开的文件搜索中排除文件和文件夹。若要从快速打开的最近打开列表中排除文件，模式必须是绝对路径(例如 `**/node_modules/**`)。继承 `#files.exclude#` 设置中的所有 glob 模式。"),
			default: { '**/node_modules': true, '**/bower_components': true, '**/*.code-search': true },
			additionalProperties: {
				anyOf: [
					{
						type: 'boolean',
						description: nls.localize('exclude.boolean', "用于匹配文件路径的 glob 模式。设置为 true 或 false 以启用或禁用该模式。"),
					},
					{
						type: 'object',
						properties: {
							when: {
								type: 'string', // expression ({ "**/*.js": { "when": "$(basename).js" } })
								pattern: '\\w*\\$\\(basename\\)\\w*',
								default: '$(basename).ext',
								markdownDescription: nls.localize({ key: 'exclude.when', comment: ['\\$(basename) should not be translated'] }, '对匹配文件的同级文件进行额外检查。使用 \\$(basename) 作为匹配文件名的变量。')
							}
						}
					}
				]
			},
			scope: ConfigurationScope.RESOURCE
		},
		[SEARCH_MODE_CONFIG]: {
			type: 'string',
			enum: ['view', 'reuseEditor', 'newEditor'],
			default: 'view',
			markdownDescription: nls.localize('search.mode', "控制新的 `搜索: 在文件中查找` 和 `在文件夹中查找` 操作的位置: 在搜索视图中或在搜索编辑器中。"),
			enumDescriptions: [
				nls.localize('search.mode.view', "在搜索视图中搜索，可以在面板或侧边栏中。"),
				nls.localize('search.mode.reuseEditor', "如果存在搜索编辑器则在其中搜索，否则在新的搜索编辑器中搜索。"),
				nls.localize('search.mode.newEditor', "在新的搜索编辑器中搜索。"),
			]
		},
		'search.useRipgrep': {
			type: 'boolean',
			description: nls.localize('useRipgrep', "此设置已弃用，现在回退到 \"search.usePCRE2\"。"),
			deprecationMessage: nls.localize('useRipgrepDeprecated', "已弃用。请考虑使用 \"search.usePCRE2\" 以获得高级正则表达式功能支持。"),
			default: true
		},
		'search.maintainFileSearchCache': {
			type: 'boolean',
			deprecationMessage: nls.localize('maintainFileSearchCacheDeprecated', "搜索缓存保存在扩展主机中，扩展主机永不关闭，因此不再需要此设置。"),
			description: nls.localize('search.maintainFileSearchCache', "启用后，searchService 进程将保持活动状态，而不是在一小时不活动后关闭。这将使文件搜索缓存保留在内存中。"),
			default: false
		},
		'search.useIgnoreFiles': {
			type: 'boolean',
			markdownDescription: nls.localize('useIgnoreFiles', "控制在搜索文件时是否使用 `.gitignore` 和 `.ignore` 文件。"),
			default: true,
			scope: ConfigurationScope.RESOURCE
		},
		'search.useGlobalIgnoreFiles': {
			type: 'boolean',
			markdownDescription: nls.localize('useGlobalIgnoreFiles', "控制在搜索文件时是否使用全局 gitignore 文件(例如 `$HOME/.config/git/ignore`)。需要启用 {0}。", '`#search.useIgnoreFiles#`'),
			default: false,
			scope: ConfigurationScope.RESOURCE
		},
		'search.useParentIgnoreFiles': {
			type: 'boolean',
			markdownDescription: nls.localize('useParentIgnoreFiles', "控制在搜索文件时是否使用父目录中的 `.gitignore` 和 `.ignore` 文件。需要启用 {0}。", '`#search.useIgnoreFiles#`'),
			default: false,
			scope: ConfigurationScope.RESOURCE
		},
		'search.quickOpen.includeSymbols': {
			type: 'boolean',
			description: nls.localize('search.quickOpen.includeSymbols', "是否在快速打开的文件结果中包含全局符号搜索的结果。"),
			default: false
		},
		'search.ripgrep.maxThreads': {
			type: 'number',
			description: nls.localize('search.ripgrep.maxThreads', "用于搜索的线程数。设置为 0 时，引擎会自动确定此值。"),
			default: 0
		},
		'search.quickOpen.includeHistory': {
			type: 'boolean',
			description: nls.localize('search.quickOpen.includeHistory', "是否在快速打开的文件结果中包含最近打开的文件的结果。"),
			default: true
		},
		'search.quickOpen.history.filterSortOrder': {
			type: 'string',
			enum: ['default', 'recency'],
			default: 'default',
			enumDescriptions: [
				nls.localize('filterSortOrder.default', '历史记录条目根据所使用的筛选值按相关性排序。相关性更高的条目显示在前面。'),
				nls.localize('filterSortOrder.recency', '历史记录条目按最近使用时间排序。最近打开的条目显示在前面。')
			],
			description: nls.localize('filterSortOrder', "控制筛选时快速打开中编辑器历史记录的排序顺序。")
		},
		'search.followSymlinks': {
			type: 'boolean',
			description: nls.localize('search.followSymlinks', "控制搜索时是否跟踪符号链接。"),
			default: true
		},
		'search.smartCase': {
			type: 'boolean',
			description: nls.localize('search.smartCase', "如果模式全为小写，则不区分大小写搜索，否则区分大小写搜索。"),
			default: false
		},
		'search.globalFindClipboard': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.globalFindClipboard', "控制搜索视图是否应在 macOS 上读取或修改共享的查找剪贴板。"),
			included: platform.isMacintosh
		},
		'search.location': {
			type: 'string',
			enum: ['sidebar', 'panel'],
			default: 'sidebar',
			description: nls.localize('search.location', "控制搜索是作为侧边栏中的视图显示，还是作为面板区域中的面板显示以获得更多水平空间。"),
			deprecationMessage: nls.localize('search.location.deprecationMessage', "此设置已弃用。您可以将搜索图标拖动到新位置。")
		},
		'search.maxResults': {
			type: ['number', 'null'],
			default: DEFAULT_MAX_SEARCH_RESULTS,
			markdownDescription: nls.localize('search.maxResults', "控制搜索结果的最大数量，可以设置为 `null`(空)以返回无限结果。")
		},
		'search.collapseResults': {
			type: 'string',
			enum: ['auto', 'alwaysCollapse', 'alwaysExpand'],
			enumDescriptions: [
				nls.localize('search.collapseResults.auto', "结果少于 10 个的文件会展开。其他文件会折叠。"),
				'',
				''
			],
			default: 'alwaysExpand',
			description: nls.localize('search.collapseAllResults', "控制搜索结果是折叠还是展开。"),
		},
		'search.useReplacePreview': {
			type: 'boolean',
			default: true,
			description: nls.localize('search.useReplacePreview', "控制在选择或替换匹配项时是否打开替换预览。"),
		},
		'search.showLineNumbers': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.showLineNumbers', "控制是否显示搜索结果的行号。"),
		},
		'search.usePCRE2': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.usePCRE2', "是否在文本搜索中使用 PCRE2 正则表达式引擎。这可以使用一些高级正则表达式功能，如前瞻和反向引用。但是，并非所有 PCRE2 功能都受支持 - 仅支持 JavaScript 也支持的功能。"),
			deprecationMessage: nls.localize('usePCRE2Deprecated', "已弃用。当使用仅 PCRE2 支持的正则表达式功能时，将自动使用 PCRE2。"),
		},
		'search.actionsPosition': {
			type: 'string',
			enum: ['auto', 'right'],
			enumDescriptions: [
				nls.localize('search.actionsPositionAuto', "当搜索视图较窄时，将操作栏定位到右侧；当搜索视图较宽时，将操作栏定位到内容之后。"),
				nls.localize('search.actionsPositionRight', "始终将操作栏定位到右侧。"),
			],
			default: 'right',
			description: nls.localize('search.actionsPosition', "控制搜索视图中行上操作栏的位置。")
		},
		'search.searchOnType': {
			type: 'boolean',
			default: true,
			description: nls.localize('search.searchOnType', "键入时搜索所有文件。")
		},
		'search.seedWithNearestWord': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.seedWithNearestWord', "当活动编辑器没有选择内容时，启用从光标最近的单词开始搜索。")
		},
		'search.seedOnFocus': {
			type: 'boolean',
			default: false,
			markdownDescription: nls.localize('search.seedOnFocus', "聚焦搜索视图时，将搜索查询更新为编辑器的选定文本。这会在单击或触发 `workbench.views.search.focus` 命令时发生。")
		},
		'search.searchOnTypeDebouncePeriod': {
			type: 'number',
			default: 300,
			markdownDescription: nls.localize('search.searchOnTypeDebouncePeriod', "启用 {0} 时，控制键入字符和开始搜索之间的超时时间(毫秒)。禁用 {0} 时无效。", '`#search.searchOnType#`')
		},
		'search.searchEditor.doubleClickBehaviour': {
			type: 'string',
			enum: ['selectWord', 'goToLocation', 'openLocationToSide'],
			default: 'goToLocation',
			enumDescriptions: [
				nls.localize('search.searchEditor.doubleClickBehaviour.selectWord', "双击选择光标下的单词。"),
				nls.localize('search.searchEditor.doubleClickBehaviour.goToLocation', "双击在活动编辑器组中打开结果。"),
				nls.localize('search.searchEditor.doubleClickBehaviour.openLocationToSide', "双击在侧边的编辑器组中打开结果，如果不存在则创建一个。"),
			],
			markdownDescription: nls.localize('search.searchEditor.doubleClickBehaviour', "配置在搜索编辑器中双击结果的效果。")
		},
		'search.searchEditor.singleClickBehaviour': {
			type: 'string',
			enum: ['default', 'peekDefinition',],
			default: 'default',
			enumDescriptions: [
				nls.localize('search.searchEditor.singleClickBehaviour.default', "单击不执行任何操作。"),
				nls.localize('search.searchEditor.singleClickBehaviour.peekDefinition', "单击打开速览定义窗口。"),
			],
			markdownDescription: nls.localize('search.searchEditor.singleClickBehaviour', "配置在搜索编辑器中单击结果的效果。")
		},
		'search.searchEditor.reusePriorSearchConfiguration': {
			type: 'boolean',
			default: false,
			markdownDescription: nls.localize({ key: 'search.searchEditor.reusePriorSearchConfiguration', comment: ['"Search Editor" is a type of editor that can display search results. "includes, excludes, and flags" refers to the "files to include" and "files to exclude" input boxes, and the flags that control whether a query is case-sensitive or a regex.'] }, "启用后，新的搜索编辑器将重用之前打开的搜索编辑器的包含、排除和标志设置。")
		},
		'search.searchEditor.defaultNumberOfContextLines': {
			type: ['number', 'null'],
			default: 1,
			markdownDescription: nls.localize('search.searchEditor.defaultNumberOfContextLines', "创建新搜索编辑器时使用的默认上下文行数。如果使用 `#search.searchEditor.reusePriorSearchConfiguration#`，可以将其设置为 `null`(空)以使用之前搜索编辑器的配置。")
		},
		'search.searchEditor.focusResultsOnSearch': {
			type: 'boolean',
			default: false,
			markdownDescription: nls.localize('search.searchEditor.focusResultsOnSearch', "触发搜索时，聚焦搜索编辑器结果而不是搜索编辑器输入框。")
		},
		'search.sortOrder': {
			type: 'string',
			enum: [SearchSortOrder.Default, SearchSortOrder.FileNames, SearchSortOrder.Type, SearchSortOrder.Modified, SearchSortOrder.CountDescending, SearchSortOrder.CountAscending],
			default: SearchSortOrder.Default,
			enumDescriptions: [
				nls.localize('searchSortOrder.default', "结果按文件夹和文件名的字母顺序排序。"),
				nls.localize('searchSortOrder.filesOnly', "结果按文件名的字母顺序排序，忽略文件夹顺序。"),
				nls.localize('searchSortOrder.type', "结果按文件扩展名的字母顺序排序。"),
				nls.localize('searchSortOrder.modified', "结果按文件最后修改日期降序排序。"),
				nls.localize('searchSortOrder.countDescending', "结果按每个文件的匹配数降序排序。"),
				nls.localize('searchSortOrder.countAscending', "结果按每个文件的匹配数升序排序。")
			],
			description: nls.localize('search.sortOrder', "控制搜索结果的排序顺序。")
		},
		'search.decorations.colors': {
			type: 'boolean',
			description: nls.localize('search.decorations.colors', "控制搜索文件装饰是否应使用颜色。"),
			default: true
		},
		'search.decorations.badges': {
			type: 'boolean',
			description: nls.localize('search.decorations.badges', "控制搜索文件装饰是否应使用徽章。"),
			default: true
		},
		'search.defaultViewMode': {
			type: 'string',
			enum: [ViewMode.Tree, ViewMode.List],
			default: ViewMode.List,
			enumDescriptions: [
				nls.localize('scm.defaultViewMode.tree', "以树形结构显示搜索结果。"),
				nls.localize('scm.defaultViewMode.list', "以列表形式显示搜索结果。")
			],
			description: nls.localize('search.defaultViewMode', "控制默认的搜索结果视图模式。")
		},
		'search.quickAccess.preserveInput': {
			type: 'boolean',
			description: nls.localize('search.quickAccess.preserveInput', "控制下次打开快速搜索时是否恢复上次键入的输入。"),
			default: false
		},
		'search.experimental.closedNotebookRichContentResults': {
			type: 'boolean',
			description: nls.localize('search.experimental.closedNotebookResults', "显示已关闭笔记本的笔记本编辑器富内容结果。更改此设置后请刷新搜索结果。"),
			default: false
		},
		'search.searchView.semanticSearchBehavior': {
			type: 'string',
			description: nls.localize('search.searchView.semanticSearchBehavior', "控制搜索视图中显示的语义搜索结果的行为。"),
			enum: [SemanticSearchBehavior.Manual, SemanticSearchBehavior.RunOnEmpty, SemanticSearchBehavior.Auto],
			default: SemanticSearchBehavior.Manual,
			enumDescriptions: [
				nls.localize('search.searchView.semanticSearchBehavior.manual', "仅手动请求语义搜索结果。"),
				nls.localize('search.searchView.semanticSearchBehavior.runOnEmpty', "仅当文本搜索结果为空时自动请求语义结果。"),
				nls.localize('search.searchView.semanticSearchBehavior.auto', "每次搜索时自动请求语义结果。")
			],
			tags: ['preview'],
		},
		'search.searchView.keywordSuggestions': {
			type: 'boolean',
			description: nls.localize('search.searchView.keywordSuggestions', "在搜索视图中启用关键字建议。"),
			default: false,
			tags: ['preview'],
		},
	}
});

CommandsRegistry.registerCommand('_executeWorkspaceSymbolProvider', async function (accessor, ...args): Promise<IWorkspaceSymbol[]> {
	const [query] = args;
	assertType(typeof query === 'string');
	const result = await getWorkspaceSymbols(query);
	return result.map(item => item.symbol);
});

// todo: @andreamah get rid of this after a few iterations
Registry.as<IConfigurationMigrationRegistry>(Extensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'search.experimental.quickAccess.preserveInput',
		migrateFn: (value, _accessor) => ([
			['search.quickAccess.preserveInput', { value }],
			['search.experimental.quickAccess.preserveInput', { value: undefined }]
		])
	}]);
