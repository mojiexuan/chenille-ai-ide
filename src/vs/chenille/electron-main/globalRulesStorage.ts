/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStateService } from '../../platform/state/node/state.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { Emitter, Event } from '../../base/common/event.js';
import { IGlobalRulesStorageService, IGlobalRulesConfig, DEFAULT_GLOBAL_RULES } from '../common/globalRulesStorage.js';

const STORAGE_KEY = 'chenille.globalRules';

/**
 * 全局规则存储服务（主进程实现）
 */
export class GlobalRulesStorageMainService extends Disposable implements IGlobalRulesStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeRules = this._register(new Emitter<void>());
	readonly onDidChangeRules: Event<void> = this._onDidChangeRules.event;

	constructor(
		@IStateService private readonly stateService: IStateService,
	) {
		super();
	}

	async get(): Promise<IGlobalRulesConfig> {
		const data = this.stateService.getItem<string>(STORAGE_KEY);
		if (!data) {
			return { ...DEFAULT_GLOBAL_RULES };
		}
		try {
			const config = JSON.parse(data) as IGlobalRulesConfig;
			// 合并默认值，确保新字段有默认值
			return { ...DEFAULT_GLOBAL_RULES, ...config };
		} catch {
			return { ...DEFAULT_GLOBAL_RULES };
		}
	}

	async save(config: IGlobalRulesConfig): Promise<void> {
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(config));
		this._onDidChangeRules.fire();
	}
}
