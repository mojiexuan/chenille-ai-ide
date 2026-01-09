/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { ICommitMessageService } from '../common/commitMessage.js';
import { AIClient } from '../node/ai/aiClient.js';
import { AgentType } from '../common/types.js';
import { IAiAgentMainService } from './agentService.js';

/**
 * 提交消息生成服务实现（主进程）
 * 内部加载 agent 配置执行 AI 调用
 */
export class CommitMessageMainService extends Disposable implements ICommitMessageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onStreamChunk = this._register(new Emitter<string>());
	readonly onStreamChunk: Event<string> = this._onStreamChunk.event;

	constructor(
		@IAiAgentMainService private readonly agentService: IAiAgentMainService,
	) {
		super();
	}

	async generateCommitMessage(changes: string, _token?: CancellationToken): Promise<string> {
		const agent = await this.agentService.getAgent(AgentType.COMMIT_MESSAGE);

		const result = await AIClient.chat({
			agent,
			messages: [
				{ role: 'system', content: agent.prompt.content },
				{ role: 'user', content: `请根据以下代码变更信息生成 commit message：\n\n${changes}` },
			],
		});

		return result.content.trim();
	}

	async generateCommitMessageStream(changes: string, token?: CancellationToken): Promise<void> {
		const agent = await this.agentService.getAgent(AgentType.COMMIT_MESSAGE);

		await AIClient.stream({
			agent,
			messages: [
				{ role: 'system', content: agent.prompt.content },
				{ role: 'user', content: `请根据以下代码变更信息生成 commit message：\n\n${changes}` },
			],
			call: (result) => {
				if (token?.isCancellationRequested) {
					return;
				}
				if (result.content) {
					this._onStreamChunk.fire(result.content);
				}
			},
		});
	}
}
