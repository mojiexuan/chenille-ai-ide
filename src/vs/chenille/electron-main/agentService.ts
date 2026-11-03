/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IAiAgentStorageMainService } from './agentStorage.js';
import { IAiModelStorageMainService } from './modelStorage.js';
import { AgentType, AiAgent, AiModel, AiPrompt } from '../common/types.js';
import { ChenilleError } from '../common/errors.js';
import { localize } from '../../nls.js';
import { BUILTIN_PROMPTS, getDefaultPromptNameForAgentType } from '../common/builtinPrompts.js';

export const IAiAgentMainService = createDecorator<IAiAgentMainService>('aiAgentMainService');

export interface IAiAgentMainService {
	readonly _serviceBrand: undefined;
	getAgent(type: AgentType, modelName?: string): Promise<AiAgent>;
}

/**
 * 所有智能体共用同一个模型配置。
 * 用户在设置面板中保存的模型直接生效，无需再为每个智能体单独绑定模型和提示词。
 */
export class AiAgentMainService extends Disposable implements IAiAgentMainService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IAiAgentStorageMainService private readonly agentStorage: IAiAgentStorageMainService,
		@IAiModelStorageMainService private readonly modelStorage: IAiModelStorageMainService,
	) {
		super();
	}

	async getAgent(type: AgentType, modelName?: string): Promise<AiAgent> {
		const model = await this.getActiveModel(type, modelName);
		const prompt = this.getBuiltinPrompt(type);

		this.validateModel(model);

		return { model, prompt };
	}

	private async getActiveModel(type: AgentType, modelName?: string): Promise<AiModel> {
		const models = await this.modelStorage.getAll();

		if (models.length === 0) {
			throw new ChenilleError(localize('noModelConfigured', "尚未配置 AI 模型，请在 Chenille 设置中添加模型"));
		}

		// 聊天模型选择器传入的模型优先；其次是设置面板保存的激活模型；最后回退到第一个模型
		if (modelName) {
			const requested = models.find(model => model.name === modelName);
			if (requested) {
				return requested;
			}
		}

		const config = await this.agentStorage.get(type);
		const selected = config?.modelName ? models.find(model => model.name === config.modelName) : undefined;
		return selected ?? models[0];
	}

	private getBuiltinPrompt(type: AgentType): AiPrompt {
		const promptName = getDefaultPromptNameForAgentType(type);
		const prompt = BUILTIN_PROMPTS.find(item => item.name === promptName);

		if (!prompt) {
			throw new ChenilleError(localize('promptNotFound', "内置提示词 '{0}' 不存在", promptName));
		}

		return prompt;
	}

	private validateModel(model: AiModel): void {
		if (!model.name?.trim()) {
			throw new ChenilleError(localize('modelNameEmpty', "模型名称不能为空"));
		}

		if (!model.baseUrl?.trim()) {
			throw new ChenilleError(localize('modelBaseUrlEmpty', "模型 '{0}' 的 Base URL 不能为空", model.name));
		}

		if (!model.apiKey?.trim()) {
			throw new ChenilleError(localize('modelApiKeyEmpty', "模型 '{0}' 的 API Key 不能为空", model.name));
		}

		if (!model.model?.trim()) {
			throw new ChenilleError(localize('modelIdEmpty', "模型 '{0}' 的模型标识不能为空", model.name));
		}

		if (typeof model.contextSize !== 'number' || model.contextSize < 1) {
			throw new ChenilleError(localize('modelContextSizeInvalid', "模型 '{0}' 的上下文大小必须大于 0", model.name));
		}

		if (typeof model.maxTokens !== 'number' || model.maxTokens < 1 || model.maxTokens > model.contextSize) {
			throw new ChenilleError(localize('modelMaxTokensInvalid', "模型 '{0}' 的最大输出Token必须在 1-{1} 之间", model.name, model.contextSize));
		}

		if (typeof model.temperature !== 'number' || model.temperature < 0 || model.temperature > 2) {
			throw new ChenilleError(localize('modelTemperatureInvalid', "模型 '{0}' 的温度必须在 0-2 之间", model.name));
		}
	}
}
