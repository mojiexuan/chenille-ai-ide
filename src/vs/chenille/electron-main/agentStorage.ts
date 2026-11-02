/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStateService } from '../../platform/state/node/state.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { Emitter, Event } from '../../base/common/event.js';
import { AgentType, AiAgentConfig } from '../common/types.js';
import { IAiAgentStorageService } from '../common/storageIpc.js';

const STORAGE_KEY = 'chenille.aiAgents';

export const IAiAgentStorageMainService = IAiAgentStorageService;
export type IAiAgentStorageMainService = IAiAgentStorageService;

export class AiAgentStorageMainService extends Disposable implements IAiAgentStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAgents = this._register(new Emitter<void>());
	readonly onDidChangeAgents: Event<void> = this._onDidChangeAgents.event;

	constructor(
		@IStateService private readonly stateService: IStateService
	) {
		super();
	}

	async getAll(): Promise<AiAgentConfig[]> {
		const data = this.stateService.getItem<string>(STORAGE_KEY);
		if (!data) {
			return [];
		}
		try {
			return JSON.parse(data) as AiAgentConfig[];
		} catch {
			return [];
		}
	}

	async get(type: AgentType): Promise<AiAgentConfig | undefined> {
		const agents = await this.getAll();
		return agents.find(a => a.type === type);
	}

	async save(config: AiAgentConfig): Promise<void> {
		const agents = await this.getAll();
		const index = agents.findIndex(a => a.type === config.type);
		if (index >= 0) {
			agents[index] = config;
		} else {
			agents.push(config);
		}
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(agents));
		this._onDidChangeAgents.fire();
	}
}
