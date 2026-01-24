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

/** diff 最大字符数限制（约 4000 tokens，作为最后防线） */
const MAX_DIFF_LENGTH = 16000;

/** diff 截断后保留的头部字符数 */
const TRUNCATE_HEAD_LENGTH = 12000;

/** diff 截断后保留的尾部字符数 */
const TRUNCATE_TAIL_LENGTH = 2000;

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

	/**
	 * 截断过长的 diff 内容
	 */
	private truncateDiff(changes: string): string {
		if (changes.length <= MAX_DIFF_LENGTH) {
			return changes;
		}

		const head = changes.substring(0, TRUNCATE_HEAD_LENGTH);
		const tail = changes.substring(changes.length - TRUNCATE_TAIL_LENGTH);
		const truncatedLength = changes.length - TRUNCATE_HEAD_LENGTH - TRUNCATE_TAIL_LENGTH;

		return `${head}\n\n... [已省略 ${truncatedLength} 字符] ...\n\n${tail}`;
	}

	async generateCommitMessage(changes: string, _token?: CancellationToken): Promise<string> {
		const agent = await this.agentService.getAgent(AgentType.COMMIT_MESSAGE);
		const truncatedChanges = this.truncateDiff(changes);

		const result = await AIClient.chat({
			agent,
			messages: [
				{ role: 'system', content: agent.prompt.content },
				{ role: 'user', content: `请根据以下代码变更信息生成 commit message：\n\n${truncatedChanges}` },
			],
		});

		return result.content.trim();
	}

	async generateCommitMessageStream(changes: string, token?: CancellationToken): Promise<void> {
		const agent = await this.agentService.getAgent(AgentType.COMMIT_MESSAGE);
		const truncatedChanges = this.truncateDiff(changes);

		await AIClient.stream({
			agent,
			messages: [
				{ role: 'system', content: agent.prompt.content },
				{ role: 'user', content: `请根据以下代码变更信息生成 commit message：\n\n${truncatedChanges}` },
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
