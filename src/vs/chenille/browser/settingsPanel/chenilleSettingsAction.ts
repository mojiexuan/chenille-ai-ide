/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { ChenilleSettingsDialog } from './chenilleSettingsDialog.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import {
	CHENILLE_SETTINGS_ACTION_ID,
	CHENILLE_SETTINGS_MCP_ACTION_ID,
	CHENILLE_SETTINGS_MODEL_ACTION_ID,
	CHENILLE_SETTINGS_RULES_ACTION_ID,
	CHENILLE_SETTINGS_SKILLS_ACTION_ID,
} from './constants.js';
import { PanelType } from './chenilleSettingsPanel.js';

export {
	CHENILLE_SETTINGS_ACTION_ID,
	CHENILLE_SETTINGS_MCP_ACTION_ID,
	CHENILLE_SETTINGS_MODEL_ACTION_ID,
	CHENILLE_SETTINGS_RULES_ACTION_ID,
	CHENILLE_SETTINGS_SKILLS_ACTION_ID,
};

let currentDialog: ChenilleSettingsDialog | undefined;
let currentListener: IDisposable | undefined;

function openChenilleSettings(accessor: ServicesAccessor, panel: PanelType): void {
	// 如果已有弹窗，先关闭
	if (currentDialog) {
		currentListener?.dispose();
		currentDialog.dispose();
		currentDialog = undefined;
		currentListener = undefined;
		return;
	}

	const instantiationService = accessor.get(IInstantiationService);
	currentDialog = instantiationService.createInstance(ChenilleSettingsDialog);
	currentDialog.show(panel);

	// 监听关闭事件
	currentListener = currentDialog.onDidClose(() => {
		currentListener?.dispose();
		currentDialog?.dispose();
		currentDialog = undefined;
		currentListener = undefined;
	});
}

class OpenChenilleSettingsAction extends Action2 {
	constructor() {
		super({
			id: CHENILLE_SETTINGS_ACTION_ID,
			title: localize2('openChenilleSettings', "打开 Chenille 设置"),
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		openChenilleSettings(accessor, 'model');
	}
}

class OpenChenilleModelSettingsAction extends Action2 {
	constructor() {
		super({
			id: CHENILLE_SETTINGS_MODEL_ACTION_ID,
			title: localize2('chenilleSettings.model', "模型配置"),
			f1: false,
		});
	}

	run(accessor: ServicesAccessor): void {
		openChenilleSettings(accessor, 'model');
	}
}

class OpenChenilleMcpSettingsAction extends Action2 {
	constructor() {
		super({
			id: CHENILLE_SETTINGS_MCP_ACTION_ID,
			title: localize2('chenilleSettings.mcp', "MCP 服务器"),
			f1: false,
		});
	}

	run(accessor: ServicesAccessor): void {
		openChenilleSettings(accessor, 'mcp');
	}
}

class OpenChenilleRulesSettingsAction extends Action2 {
	constructor() {
		super({
			id: CHENILLE_SETTINGS_RULES_ACTION_ID,
			title: localize2('chenilleSettings.rules', "规则管理"),
			f1: false,
		});
	}

	run(accessor: ServicesAccessor): void {
		openChenilleSettings(accessor, 'rules');
	}
}

class OpenChenilleSkillsSettingsAction extends Action2 {
	constructor() {
		super({
			id: CHENILLE_SETTINGS_SKILLS_ACTION_ID,
			title: localize2('chenilleSettings.skills', "技能管理"),
			f1: false,
		});
	}

	run(accessor: ServicesAccessor): void {
		openChenilleSettings(accessor, 'skills');
	}
}

export function registerChenilleSettingsAction(): void {
	registerAction2(OpenChenilleSettingsAction);
	registerAction2(OpenChenilleModelSettingsAction);
	registerAction2(OpenChenilleMcpSettingsAction);
	registerAction2(OpenChenilleRulesSettingsAction);
	registerAction2(OpenChenilleSkillsSettingsAction);
}
