/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStateService } from '../../platform/state/node/state.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { AiModel } from '../common/types.js';
import { IAiModelStorageService } from '../common/storageIpc.js';

const STORAGE_KEY = 'chenille.aiModels';

export const IAiModelStorageMainService = IAiModelStorageService;
export type IAiModelStorageMainService = IAiModelStorageService;

export class AiModelStorageMainService extends Disposable implements IAiModelStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IStateService private readonly stateService: IStateService
	) {
		super();
	}

	async getAll(): Promise<AiModel[]> {
		const data = this.stateService.getItem<string>(STORAGE_KEY);
		if (!data) {
			return [];
		}
		try {
			return JSON.parse(data) as AiModel[];
		} catch {
			return [];
		}
	}

	async get(name: string): Promise<AiModel | undefined> {
		const models = await this.getAll();
		return models.find(m => m.name === name);
	}

	async save(model: AiModel): Promise<void> {
		const models = await this.getAll();
		const index = models.findIndex(m => m.name === model.name);
		if (index >= 0) {
			models[index] = model;
		} else {
			models.push(model);
		}
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(models));
	}

	async delete(name: string): Promise<void> {
		const models = (await this.getAll()).filter(m => m.name !== name);
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(models));
	}
}
