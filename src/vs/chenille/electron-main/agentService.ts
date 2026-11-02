/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IAiAgentStorageMainService } from './agentStorage.js';
import { IAiModelStorageMainService } from './modelStorage.js';
import { IAiPromptStorageMainService } from './promptStorage.js';
import { AgentType, AiAgent, AiModel, AiPrompt } from '../common/types.js';
import { ChenilleError } from '../common/errors.js';
import { localize } from '../../nls.js';

export const IAiAgentMainService = createDecorator<IAiAgentMainService>('aiAgentMainService');

export interface IAiAgentMainService {
	readonly _serviceBrand: undefined;
	getAgent(type: AgentType): Promise<AiAgent>;
}

export class AiAgentMainService extends Disposable implements IAiAgentMainService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IAiAgentStorageMainService private readonly agentStorage: IAiAgentStorageMainService,
		@IAiModelStorageMainService private readonly modelStorage: IAiModelStorageMainService,
		@IAiPromptStorageMainService private readonly promptStorage: IAiPromptStorageMainService,
	) {
		super();
	}

	async getAgent(type: AgentType): Promise<AiAgent> {
		const config = await this.agentStorage.get(type);
		const agentName = this.getAgentDisplayName(type);

		if (!config) {
			throw new ChenilleError(localize('agentNotConfigured', "智能体 '{0}' 未配置", agentName));
		}

		if (!config.modelName) {
			throw new ChenilleError(localize('agentModelNotSet', "智能体 '{0}' 未设置模型", agentName));
		}

		if (!config.promptName) {
			throw new ChenilleError(localize('agentPromptNotSet', "智能体 '{0}' 未设置提示词", agentName));
		}

		const model = await this.modelStorage.get(config.modelName);
		const prompt = await this.promptStorage.get(config.promptName);

		if (!model) {
			throw new ChenilleError(localize('modelNotFound', "模型 '{0}' 不存在，可能已被删除", config.modelName));
		}

		if (!prompt) {
			throw new ChenilleError(localize('promptNotFound', "提示词 '{0}' 不存在，可能已被删除", config.promptName));
		}

		this.validateModel(model);
		this.validatePrompt(prompt);

		return { model, prompt };
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

		if (typeof model.contextSize !== 'number' || model.contextSize < 1 || model.contextSize > 1000000) {
			throw new ChenilleError(localize('modelContextSizeInvalid', "模型 '{0}' 的上下文大小必须在 1-1000000 之间", model.name));
		}

		if (typeof model.maxTokens !== 'number' || model.maxTokens < 1 || model.maxTokens > model.contextSize) {
			throw new ChenilleError(localize('modelMaxTokensInvalid', "模型 '{0}' 的最大输出Token必须在 1-{1} 之间", model.name, model.contextSize));
		}

		if (typeof model.temperature !== 'number' || model.temperature < 0 || model.temperature > 2) {
			throw new ChenilleError(localize('modelTemperatureInvalid', "模型 '{0}' 的温度必须在 0-2 之间", model.name));
		}
	}

	private validatePrompt(prompt: AiPrompt): void {
		if (!prompt.name?.trim()) {
			throw new ChenilleError(localize('promptNameEmpty', "提示词名称不能为空"));
		}

		if (!prompt.content?.trim()) {
			throw new ChenilleError(localize('promptContentEmpty', "提示词 '{0}' 的内容不能为空", prompt.name));
		}
	}

	private getAgentDisplayName(type: AgentType): string {
		switch (type) {
			case AgentType.COMMIT_MESSAGE:
				return localize('commitMessageAgent', "Commit 消息生成");
			case AgentType.CODE_WRITER:
				return localize('codeWriterAgent', "代码编写");
			case AgentType.INLINE_COMPLETION:
				return localize('inlineCompletionAgent', "代码补全");
			default:
				return type;
		}
	}
}
