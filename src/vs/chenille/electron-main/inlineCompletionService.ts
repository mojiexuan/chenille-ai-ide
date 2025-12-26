/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import {
	IChenilleInlineCompletionService,
	IInlineCompletionRequest,
	IInlineCompletionResponse
} from '../common/inlineCompletionService.js';
import { AIClient } from '../node/ai/aiClient.js';
import { AgentType } from '../common/types.js';
import { IAiAgentMainService } from './agentService.js';
import { ChenilleError } from '../common/errors.js';

/**
 * Inline Completion 服务实现（主进程）
 */
export class ChenilleInlineCompletionMainService extends Disposable implements IChenilleInlineCompletionService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IAiAgentMainService private readonly agentService: IAiAgentMainService,
	) {
		super();
	}

	async isAgentConfigured(): Promise<boolean> {
		try {
			await this.agentService.getAgent(AgentType.INLINE_COMPLETION);
			return true;
		} catch {
			return false;
		}
	}

	async getCompletion(request: IInlineCompletionRequest, token?: CancellationToken): Promise<IInlineCompletionResponse> {
		try {
			const agent = await this.agentService.getAgent(AgentType.INLINE_COMPLETION);

			// 构建提示消息
			const userMessage = this.buildPrompt(request);

			const result = await AIClient.chat({
				agent,
				messages: [
					{ role: 'system', content: agent.prompt.content },
					{ role: 'user', content: userMessage },
				],
				token,
			});

			if (token?.isCancellationRequested) {
				return { text: '', success: false, error: '已取消' };
			}

			if (result.error) {
				return { text: '', success: false, error: result.error };
			}

			// 提取补全文本（去除可能的代码块标记）
			const completionText = this.extractCompletion(result.content);

			return {
				text: completionText,
				success: true,
			};

		} catch (error) {
			const errorMessage = error instanceof ChenilleError ? error.message : String(error);
			return { text: '', success: false, error: errorMessage };
		}
	}

	/**
	 * 构建发送给 AI 的提示
	 */
	private buildPrompt(request: IInlineCompletionRequest): string {
		return `文件: ${request.filePath}
语言: ${request.languageId}

光标前的代码:
\`\`\`${request.languageId}
${request.prefix}
\`\`\`

光标后的代码:
\`\`\`${request.languageId}
${request.suffix}
\`\`\`

请在光标位置生成合适的代码补全。只输出要插入的代码，不要包含任何解释。`;
	}

	/**
	 * 从 AI 响应中提取补全文本
	 */
	private extractCompletion(content: string): string {
		if (!content) {
			return '';
		}

		// 去除代码块标记
		let text = content.trim();

		// 匹配 ```language\n...\n``` 格式
		const codeBlockMatch = text.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
		if (codeBlockMatch) {
			text = codeBlockMatch[1];
		}

		return text;
	}
}
