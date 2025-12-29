/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStateService } from '../../platform/state/node/state.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { AiPrompt } from '../common/types.js';
import { IAiPromptStorageService } from '../common/storageIpc.js';
import { BUILTIN_PROMPTS, isBuiltinPrompt } from '../common/builtinPrompts.js';

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
		const userPrompts = await this.getUserPrompts();
		// 内置提示词在前，用户提示词在后
		return [...BUILTIN_PROMPTS, ...userPrompts];
	}

	private async getUserPrompts(): Promise<AiPrompt[]> {
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
		// 先查内置提示词
		const builtin = BUILTIN_PROMPTS.find(p => p.name === name);
		if (builtin) {
			return builtin;
		}
		// 再查用户提示词
		const userPrompts = await this.getUserPrompts();
		return userPrompts.find(p => p.name === name);
	}

	async save(prompt: AiPrompt): Promise<void> {
		// 不允许保存/修改内置提示词
		if (isBuiltinPrompt(prompt.name)) {
			return;
		}
		const prompts = await this.getUserPrompts();
		const index = prompts.findIndex(p => p.name === prompt.name);
		if (index >= 0) {
			prompts[index] = prompt;
		} else {
			prompts.push(prompt);
		}
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(prompts));
	}

	async delete(name: string): Promise<void> {
		// 不允许删除内置提示词
		if (isBuiltinPrompt(name)) {
			return;
		}
		const prompts = (await this.getUserPrompts()).filter(p => p.name !== name);
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(prompts));
	}
}
