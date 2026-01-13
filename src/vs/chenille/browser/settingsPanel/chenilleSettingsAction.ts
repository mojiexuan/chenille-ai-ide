/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { ChenilleSettingsDialog } from './chenilleSettingsDialog.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { CHENILLE_SETTINGS_ACTION_ID } from './constants.js';

export { CHENILLE_SETTINGS_ACTION_ID };

let currentDialog: ChenilleSettingsDialog | undefined;
let currentListener: IDisposable | undefined;

class OpenChenilleSettingsAction extends Action2 {
	constructor() {
		super({
			id: CHENILLE_SETTINGS_ACTION_ID,
			title: localize2('openChenilleSettings', "打开 Chenille 设置"),
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
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
		currentDialog.show();

		// 监听关闭事件
		currentListener = currentDialog.onDidClose(() => {
			currentListener?.dispose();
			currentDialog?.dispose();
			currentDialog = undefined;
			currentListener = undefined;
		});
	}
}

export function registerChenilleSettingsAction(): void {
	registerAction2(OpenChenilleSettingsAction);
}
