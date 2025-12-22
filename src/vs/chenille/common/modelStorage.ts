/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { AiModel } from './types.js';

const STORAGE_KEY = 'chenille.aiModels';

export const IAiModelStorageService = createDecorator<IAiModelStorageService>('aiModelStorageService');

export interface IAiModelStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeModels: Event<void>;

	getAll(): AiModel[];
	get(name: string): AiModel | undefined;
	save(model: AiModel): void;
	delete(name: string): void;
	clear(): void;
}

export class AiModelStorageService extends Disposable implements IAiModelStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeModels = this._register(new Emitter<void>());
	readonly onDidChangeModels: Event<void> = this._onDidChangeModels.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
	}

	getAll(): AiModel[] {
		const data = this.storageService.get(STORAGE_KEY, StorageScope.APPLICATION);
		if (!data) {
			return [];
		}
		try {
			return JSON.parse(data) as AiModel[];
		} catch {
			return [];
		}
	}

	get(name: string): AiModel | undefined {
		return this.getAll().find(m => m.name === name);
	}

	save(model: AiModel): void {
		const models = this.getAll();
		const index = models.findIndex(m => m.name === model.name);
		if (index >= 0) {
			models[index] = model;
		} else {
			models.push(model);
		}
		this.storageService.store(STORAGE_KEY, JSON.stringify(models), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeModels.fire();
	}

	delete(name: string): void {
		const models = this.getAll().filter(m => m.name !== name);
		this.storageService.store(STORAGE_KEY, JSON.stringify(models), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeModels.fire();
	}

	clear(): void {
		this.storageService.remove(STORAGE_KEY, StorageScope.APPLICATION);
		this._onDidChangeModels.fire();
	}
}
