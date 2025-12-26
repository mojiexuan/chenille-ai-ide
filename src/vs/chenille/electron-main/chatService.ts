/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { IChenilleAiService, IAiCallRequest, IStreamChunkWithId } from '../common/chatService.js';
import { AIClient } from '../node/ai/aiClient.js';
import { AgentType } from '../common/types.js';
import { IAiAgentMainService } from './agentService.js';
import { ChenilleError } from '../common/errors.js';

/**
 * AI 调用服务实现（主进程）
 * 只负责调用 AI，工具执行由渲染进程处理
 */
export class ChenilleAiMainService extends Disposable implements IChenilleAiService {
	declare readonly _serviceBrand: undefined;

	private readonly _onStreamChunk = this._register(new Emitter<IStreamChunkWithId>());
	readonly onStreamChunk: Event<IStreamChunkWithId> = this._onStreamChunk.event;

	private _lastConfigError: string | undefined;

	constructor(
		@IAiAgentMainService private readonly agentService: IAiAgentMainService,
	) {
		super();
	}

	async isAgentConfigured(): Promise<boolean> {
		try {
			await this.agentService.getAgent(AgentType.CODE_WRITER);
			this._lastConfigError = undefined;
			return true;
		} catch (error) {
			this._lastConfigError = error instanceof ChenilleError ? error.message : String(error);
			return false;
		}
	}

	async getConfigurationError(): Promise<string | undefined> {
		if (this._lastConfigError === undefined) {
			await this.isAgentConfigured();
		}
		return this._lastConfigError;
	}

	async streamChat(request: IAiCallRequest, token?: CancellationToken): Promise<void> {
		const agent = await this.agentService.getAgent(AgentType.CODE_WRITER);
		const requestId = request.requestId;

		try {
			await AIClient.stream({
				agent,
				messages: request.messages,
				tools: request.tools,
				token,
				call: (result) => {
					if (token?.isCancellationRequested) {
						return;
					}
					this._onStreamChunk.fire({ ...result, requestId });
				},
			});

			// AIClient.stream 内部已经发送了 done: true，这里不需要再发送

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._onStreamChunk.fire({
				content: '',
				done: true,
				error: errorMessage,
				requestId,
			});
		}
	}
}
