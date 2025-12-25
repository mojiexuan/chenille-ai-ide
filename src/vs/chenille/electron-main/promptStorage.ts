/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStateService } from '../../platform/state/node/state.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { AiPrompt } from '../common/types.js';
import { IAiPromptStorageService } from '../common/storageIpc.js';

const STORAGE_KEY = 'chenille.aiPrompts';

export const IAiPromptStorageMainService = IAiPromptStorageService;
export type IAiPromptStorageMainService = IAiPromptStorageService;

export class AiPromptStorageMainService extends Disposable implements IAiPromptStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IStateService private readonly stateService: IStateService
	) {
		super();
	}

	async getAll(): Promise<AiPrompt[]> {
		const data = this.stateService.getItem<string>(STORAGE_KEY);
		if (!data) {
			return [];
		}
		try {
			return JSON.parse(data) as AiPrompt[];
		} catch {
			return [];
		}
	}

	async get(name: string): Promise<AiPrompt | undefined> {
		const prompts = await this.getAll();
		return prompts.find(p => p.name === name);
	}

	async save(prompt: AiPrompt): Promise<void> {
		const prompts = await this.getAll();
		const index = prompts.findIndex(p => p.name === prompt.name);
		if (index >= 0) {
			prompts[index] = prompt;
		} else {
			prompts.push(prompt);
		}
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(prompts));
	}

	async delete(name: string): Promise<void> {
		const prompts = (await this.getAll()).filter(p => p.name !== name);
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(prompts));
	}
}
