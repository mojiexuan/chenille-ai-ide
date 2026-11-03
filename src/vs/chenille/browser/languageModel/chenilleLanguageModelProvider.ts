/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize } from '../../../nls.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { ChatAgentLocation } from '../../../workbench/contrib/chat/common/constants.js';
import {
	ChatMessageRole,
	IChatMessage,
	IChatResponsePart,
	IChatResponseTextPart,
	ILanguageModelChatInfoOptions,
	ILanguageModelChatMetadataAndIdentifier,
	ILanguageModelChatProvider,
	ILanguageModelChatRequestOptions,
	ILanguageModelChatResponse,
} from '../../../workbench/contrib/chat/common/languageModels.js';
import { nullExtensionDescription } from '../../../workbench/services/extensions/common/extensions.js';
import { IChenilleAiService, IStreamChunkWithId } from '../../common/chatService.js';
import { CHENILLE_MODEL_VENDOR, toChenilleModelIdentifier } from '../../common/modelIdentifier.js';
import { IAiAgentStorageService, IAiModelStorageService } from '../../common/storageIpc.js';
import { AgentType, AiModel, AiModelMessage, AiProvider } from '../../common/types.js';

function providerLabel(provider: AiProvider): string {
	switch (provider) {
		case AiProvider.ANTHROPIC: return 'Anthropic';
		case AiProvider.GOOGLE: return 'Google';
		default: return 'OpenAI 兼容';
	}
}

function messageToText(message: IChatMessage): string {
	const parts: string[] = [];
	for (const part of message.content) {
		if (part.type === 'text') {
			parts.push(part.value);
		} else if (part.type === 'tool_result') {
			for (const value of part.value) {
				if (value.type === 'text') {
					parts.push(value.value);
				}
			}
		}
	}
	return parts.join('\n');
}

/**
 * 把 Chenille 中配置的模型暴露给 VS Code 官方 Chat 模型选择器。
 * 聊天请求仍由 Chenille Agent 处理，选择结果通过 `userSelectedModelId` 传回。
 */
export class ChenilleLanguageModelProvider extends Disposable implements ILanguageModelChatProvider {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
		@IAiAgentStorageService private readonly agentStorage: IAiAgentStorageService,
		@IChenilleAiService private readonly aiService: IChenilleAiService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(this.modelStorage.onDidChangeModels(() => this._onDidChange.fire()));
		this._register(this.agentStorage.onDidChangeAgents(() => this._onDidChange.fire()));
	}

	async provideLanguageModelChatInfo(_options: ILanguageModelChatInfoOptions, _token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
		const [models, config] = await Promise.all([
			this.modelStorage.getAll(),
			this.agentStorage.get(AgentType.CODE_WRITER),
		]);

		const activeName = config?.modelName && models.some(model => model.name === config.modelName)
			? config.modelName
			: models[0]?.name;

		return models.map(model => ({
			identifier: toChenilleModelIdentifier(model.name),
			metadata: {
				extension: nullExtensionDescription.identifier,
				name: model.name,
				id: model.name,
				vendor: CHENILLE_MODEL_VENDOR,
				version: model.model,
				family: model.model,
				detail: `${providerLabel(model.provider)} · ${model.model}`,
				tooltip: localize('chenille.model.tooltip', "{0} · {1} 上下文", model.name, model.contextSize.toLocaleString()),
				maxInputTokens: Math.max(1, model.contextSize - model.maxTokens),
				maxOutputTokens: model.maxTokens,
				maxContextWindowTokens: model.contextSize,
				isDefaultForLocation: {
					[ChatAgentLocation.Chat]: model.name === activeName,
					[ChatAgentLocation.EditorInline]: model.name === activeName,
				},
				isUserSelectable: true,
				isBYOK: true,
				capabilities: {
					vision: model.supportsVision ?? false,
					toolCalling: true,
					agentMode: true,
				},
			},
		}));
	}

	async sendChatRequest(modelId: string, messages: IChatMessage[], _from: ExtensionIdentifier | undefined, _options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		const modelName = modelId.startsWith(`${CHENILLE_MODEL_VENDOR}/`) ? modelId.slice(CHENILLE_MODEL_VENDOR.length + 1) : undefined;
		const requestId = generateUuid();
		const converted: AiModelMessage[] = [];
		for (const message of messages) {
			const text = messageToText(message);
			if (!text && message.role !== ChatMessageRole.Assistant) {
				continue;
			}
			converted.push({
				role: message.role === ChatMessageRole.System ? 'system' : message.role === ChatMessageRole.User ? 'user' : 'assistant',
				content: text,
			});
		}

		let content = '';
		let subscription: { dispose(): void } | undefined;
		await new Promise<void>((resolve, reject) => {
			subscription = this.aiService.onStreamChunk((chunk: IStreamChunkWithId) => {
				if (chunk.requestId !== requestId) {
					return;
				}
				if (chunk.content) {
					content += chunk.content;
				}
				if (chunk.error) {
					subscription?.dispose();
					reject(new Error(chunk.error));
				} else if (chunk.done) {
					subscription?.dispose();
					resolve();
				}
			});
			this.aiService.streamChat({ requestId, messages: converted, modelName }, token).catch(error => {
				this.logService.error('[Chenille] 语言模型请求失败', error);
				subscription?.dispose();
				reject(error);
			});
		});

		const part: IChatResponseTextPart = { type: 'text', value: content };
		return {
			stream: (async function* (): AsyncIterable<IChatResponsePart> {
				yield part;
			})(),
			result: Promise.resolve([part]),
		};
	}

	async provideTokenCount(_modelId: string, message: string | IChatMessage, _token: CancellationToken): Promise<number> {
		const text = typeof message === 'string' ? message : messageToText(message);
		return Math.max(1, Math.ceil(text.length / 4));
	}
}

/** 供设置面板复用的模型元数据构造，避免两处格式不一致 */
export function describeChenilleModel(model: AiModel): string {
	return `${providerLabel(model.provider)} · ${model.model}`;
}
