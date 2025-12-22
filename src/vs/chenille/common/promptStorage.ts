/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { AiPrompt } from './types.js';

const STORAGE_KEY = 'chenille.aiPrompts';

export const IAiPromptStorageService = createDecorator<IAiPromptStorageService>('aiPromptStorageService');

export interface IAiPromptStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangePrompts: Event<void>;

	getAll(): AiPrompt[];
	get(name: string): AiPrompt | undefined;
	save(prompt: AiPrompt): void;
	delete(name: string): void;
	clear(): void;
}

export class AiPromptStorageService extends Disposable implements IAiPromptStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePrompts = this._register(new Emitter<void>());
	readonly onDidChangePrompts: Event<void> = this._onDidChangePrompts.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
	}

	getAll(): AiPrompt[] {
		const data = this.storageService.get(STORAGE_KEY, StorageScope.APPLICATION);
		if (!data) {
			return [];
		}
		try {
			return JSON.parse(data) as AiPrompt[];
		} catch {
			return [];
		}
	}

	get(name: string): AiPrompt | undefined {
		return this.getAll().find(p => p.name === name);
	}

	save(prompt: AiPrompt): void {
		const prompts = this.getAll();
		const index = prompts.findIndex(p => p.name === prompt.name);
		if (index >= 0) {
			prompts[index] = prompt;
		} else {
			prompts.push(prompt);
		}
		this.storageService.store(STORAGE_KEY, JSON.stringify(prompts), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangePrompts.fire();
	}

	delete(name: string): void {
		const prompts = this.getAll().filter(p => p.name !== name);
		this.storageService.store(STORAGE_KEY, JSON.stringify(prompts), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangePrompts.fire();
	}

	clear(): void {
		this.storageService.remove(STORAGE_KEY, StorageScope.APPLICATION);
		this._onDidChangePrompts.fire();
	}
}
