/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { ICommitMessageService } from '../common/commitMessage.js';
import { AIClient } from '../node/ai/aiClient.js';
import { AiProvider, AiAgent, AiModel, AiPrompt } from '../common/types.js';

const DEEPSEEK_API_KEY = 'xxx';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat';

const COMMIT_PROMPT = `你是一个专业的 Git commit message 生成器。根据提供的代码变更信息，生成简洁、规范的 commit message。

规则：
1. 使用中文
2. 第一行是简短的摘要（不超过50个字符）
3. 如果需要，可以空一行后添加详细描述
4. 使用常见的 commit 类型前缀：feat、fix、docs、style、refactor、test、chore 等
5. 描述要准确反映代码变更的内容和目的
6. 根据变更的文件路径和名称推断变更的意图

只输出 commit message，不要有其他解释。`;

/**
 * 创建 DeepSeek Agent
 */
function createDeepSeekAgent(): AiAgent {
	const model: AiModel = {
		name: 'DeepSeek Chat',
		provider: AiProvider.DEEPSEEK,
		model: DEEPSEEK_MODEL,
		baseUrl: DEEPSEEK_BASE_URL,
		apiKey: DEEPSEEK_API_KEY,
	};

	const prompt: AiPrompt = {
		name: 'commit-generator',
		description: '生成 Git commit message',
		content: COMMIT_PROMPT,
	};

	return {
		name: 'commit-agent',
		model,
		prompt,
		maxTokens: 500,
		temperature: 0.3,
	};
}

/**
 * 提交消息生成服务实现（主进程）
 */
export class CommitMessageMainService extends Disposable implements ICommitMessageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onStreamChunk = this._register(new Emitter<string>());
	readonly onStreamChunk: Event<string> = this._onStreamChunk.event;

	constructor() {
		super();
	}

	/**
	 * 生成提交消息
	 */
	async generateCommitMessage(changes: string, token?: CancellationToken): Promise<string> {
		const agent = createDeepSeekAgent();

		const result = await AIClient.chat({
			agent,
			messages: [
				{ role: 'system', content: agent.prompt.content },
				{ role: 'user', content: `请根据以下代码变更信息生成 commit message：\n\n${changes}` },
			],
		});

		return result.content.trim();
	}

	/**
	 * 流式生成提交消息
	 */
	async generateCommitMessageStream(changes: string, token?: CancellationToken): Promise<void> {
		const agent = createDeepSeekAgent();

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
