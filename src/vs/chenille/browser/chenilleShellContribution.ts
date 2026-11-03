/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';
import { Codicon } from '../../base/common/codicons.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { ThemeIcon } from '../../base/common/themables.js';
import { MenuId, MenuRegistry } from '../../platform/actions/common/actions.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../workbench/common/contributions.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../workbench/services/statusbar/browser/statusbar.js';
import { IAiAgentStorageService, IAiModelStorageService } from '../common/storageIpc.js';
import { AgentType } from '../common/types.js';
import {
	CHENILLE_MENU_ID,
	CHENILLE_SETTINGS_ACTION_ID,
	CHENILLE_SETTINGS_MCP_ACTION_ID,
	CHENILLE_SETTINGS_MODEL_ACTION_ID,
	CHENILLE_SETTINGS_RULES_ACTION_ID,
	CHENILLE_SETTINGS_SKILLS_ACTION_ID,
} from './settingsPanel/constants.js';

const ACCOUNTS_VISIBILITY_KEY = 'workbench.activity.showAccounts';
const STATUS_BAR_HIDDEN_ENTRIES_KEY = 'workbench.statusbar.hidden';
const HIDDEN_STATUS_ENTRIES = ['chat.statusBarEntry', 'codex.statusBarEntry'];
const HIDDEN_WELCOME_CATEGORIES_KEY = 'workbench.welcomePage.hiddenCategories';
const HIDDEN_WELCOME_CATEGORIES = ['GitHub.copilot-chat#copilotWelcome'];

/** 默认关闭官方 Copilot 登录/引导入口，并通过主题默认值启用 Chenille 配色。 */
export function registerChenilleDefaultConfigurations(): void {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
		overrides: {
			'chat.titleBar.signIn.enabled': false,
			'chat.welcomePage.signIn.enabled': false,
			'workbench.welcomePage.experimentalOnboarding': false,
			'workbench.colorTheme': 'Chenille Dark',
		}
	}]);
}

/** 在顶部菜单栏添加显眼的 Chenille 入口。 */
export function registerChenilleMenu(): void {
	MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
		submenu: CHENILLE_MENU_ID,
		title: {
			value: 'Chenille',
			original: 'Chenille',
			mnemonicTitle: localize('mChenille', "&&Chenille"),
		},
		order: 0.5,
	});

	registerMenuCommand(CHENILLE_SETTINGS_ACTION_ID, "打开 Chenille 设置", Codicon.gear, 1);
	registerMenuCommand(CHENILLE_SETTINGS_MODEL_ACTION_ID, "模型配置", Codicon.server, 2);
	registerMenuCommand(CHENILLE_SETTINGS_MCP_ACTION_ID, "MCP 服务器", Codicon.plug, 3);
	registerMenuCommand(CHENILLE_SETTINGS_RULES_ACTION_ID, "规则管理", Codicon.law, 4);
	registerMenuCommand(CHENILLE_SETTINGS_SKILLS_ACTION_ID, "技能管理", Codicon.lightbulb, 5);
}

function registerMenuCommand(id: string, title: string, icon: ThemeIcon, order: number): void {
	MenuRegistry.appendMenuItem(CHENILLE_MENU_ID, {
		command: { id, title, icon },
		group: '1_settings',
		order,
	});
}

/** 隐藏账号入口与 Copilot 状态栏入口。 */
export class ChenilleLoginSuppressionContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chenille.loginSuppression';

	constructor(
		@IStorageService storageService: IStorageService,
	) {
		super();

		if (storageService.getBoolean(ACCOUNTS_VISIBILITY_KEY, StorageScope.PROFILE, true)) {
			storageService.store(ACCOUNTS_VISIBILITY_KEY, false, StorageScope.PROFILE, StorageTarget.USER);
		}

		mergeStoredEntries(storageService, STATUS_BAR_HIDDEN_ENTRIES_KEY, HIDDEN_STATUS_ENTRIES);
		mergeStoredEntries(storageService, HIDDEN_WELCOME_CATEGORIES_KEY, HIDDEN_WELCOME_CATEGORIES);
	}
}

/** 把需要隐藏的条目合并进 PROFILE 存储里的 JSON 字符串数组。 */
function mergeStoredEntries(storageService: IStorageService, key: string, entries: readonly string[]): void {
	let existing: string[] = [];
	const raw = storageService.get(key, StorageScope.PROFILE);
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				existing = parsed.filter((entry): entry is string => typeof entry === 'string');
			}
		} catch {
			// 忽略损坏的存储内容
		}
	}

	const missing = entries.filter(entry => !existing.includes(entry));
	if (missing.length) {
		storageService.store(key, JSON.stringify([...existing, ...missing]), StorageScope.PROFILE, StorageTarget.USER);
	}
}

/** 状态栏常驻 Chenille 入口，显示当前模型并打开配置面板。 */
export class ChenilleStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chenille.statusBar';

	private readonly entry: IStatusbarEntryAccessor;
	private modelName: string | undefined;

	constructor(
		@IStatusbarService statusbarService: IStatusbarService,
		@IAiAgentStorageService private readonly agentStorage: IAiAgentStorageService,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
	) {
		super();

		this.entry = this._register(statusbarService.addEntry({
			name: localize('chenille.statusBar.name', "Chenille"),
			text: '$(sparkle) Chenille',
			ariaLabel: localize('chenille.statusBar.ariaLabel', "Chenille 模型配置"),
			tooltip: localize('chenille.statusBar.tooltip', "打开 Chenille 设置"),
			command: CHENILLE_SETTINGS_ACTION_ID,
			kind: 'prominent',
		}, 'chenille.statusBarEntry', StatusbarAlignment.RIGHT, 1000));

		this._register(this.agentStorage.onDidChangeAgents(() => this.update()));
		this._register(this.modelStorage.onDidChangeModels(() => this.update()));
		void this.update();
	}

	private async update(): Promise<void> {
		const [config, models] = await Promise.all([
			this.agentStorage.get(AgentType.CODE_WRITER),
			this.modelStorage.getAll(),
		]);
		const active = config?.modelName && models.some(model => model.name === config.modelName)
			? config.modelName
			: models[0]?.name;

		if (active === this.modelName) {
			return;
		}
		this.modelName = active;
		this.entry.update({
			name: localize('chenille.statusBar.name', "Chenille"),
			text: active ? `$(sparkle) Chenille · ${active}` : '$(sparkle) Chenille',
			ariaLabel: localize('chenille.statusBar.ariaLabel', "Chenille 模型配置"),
			tooltip: active
				? localize('chenille.statusBar.modelTooltip', "当前模型：{0}（点击打开 Chenille 设置）", active)
				: localize('chenille.statusBar.tooltip', "打开 Chenille 设置"),
			command: CHENILLE_SETTINGS_ACTION_ID,
			kind: 'prominent',
		});
	}
}

registerWorkbenchContribution2(ChenilleLoginSuppressionContribution.ID, ChenilleLoginSuppressionContribution, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(ChenilleStatusBarContribution.ID, ChenilleStatusBarContribution, WorkbenchPhase.AfterRestored);
