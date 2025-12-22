/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { AiAgent } from './types.js';

const STORAGE_KEY = 'chenille.aiAgents';

export const IAiAgentStorageService = createDecorator<IAiAgentStorageService>('aiAgentStorageService');

export interface IAiAgentStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeAgents: Event<void>;

	getAll(): AiAgent[];
	get(name: string): AiAgent | undefined;
	save(agent: AiAgent): void;
	delete(name: string): void;
	clear(): void;
}

export class AiAgentStorageService extends Disposable implements IAiAgentStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAgents = this._register(new Emitter<void>());
	readonly onDidChangeAgents: Event<void> = this._onDidChangeAgents.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
	}

	getAll(): AiAgent[] {
		const data = this.storageService.get(STORAGE_KEY, StorageScope.APPLICATION);
		if (!data) {
			return [];
		}
		try {
			return JSON.parse(data) as AiAgent[];
		} catch {
			return [];
		}
	}

	get(name: string): AiAgent | undefined {
		return this.getAll().find(a => a.name === name);
	}

	save(agent: AiAgent): void {
		const agents = this.getAll();
		const index = agents.findIndex(a => a.name === agent.name);
		if (index >= 0) {
			agents[index] = agent;
		} else {
			agents.push(agent);
		}
		this.storageService.store(STORAGE_KEY, JSON.stringify(agents), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeAgents.fire();
	}

	delete(name: string): void {
		const agents = this.getAll().filter(a => a.name !== name);
		this.storageService.store(STORAGE_KEY, JSON.stringify(agents), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeAgents.fire();
	}

	clear(): void {
		this.storageService.remove(STORAGE_KEY, StorageScope.APPLICATION);
		this._onDidChangeAgents.fire();
	}
}
