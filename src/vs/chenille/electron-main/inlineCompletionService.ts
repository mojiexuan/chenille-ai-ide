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
 * 补全内容通常很短，限制输出长度以降低延迟
 */
const INLINE_COMPLETION_MAX_TOKENS = 128;

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

			// 补全需要尽可能低的延迟：禁用思考、限制输出长度、使用低温度采样
			const inlineAgent = {
				...agent,
				model: {
					...agent.model,
					maxTokens: agent.model.maxTokens > 0
						? Math.min(agent.model.maxTokens, INLINE_COMPLETION_MAX_TOKENS)
						: INLINE_COMPLETION_MAX_TOKENS,
					// provider 会把 0 当作未设置，这里用接近确定性采样的低温度
					temperature: 0.1,
				},
			};

			const result = await AIClient.chat({
				agent: inlineAgent,
				messages: [
					{ role: 'system', content: agent.prompt.content },
					{ role: 'user', content: userMessage },
				],
				disableThinking: true,
				disableMcpTools: true,
				token,
			});

			if (token?.isCancellationRequested) {
				return { text: '', success: false, error: '已取消' };
			}

			if (result.error) {
				return { text: '', success: false, error: result.error };
			}

			// 提取补全文本（去除可能的代码块标记和重复内容）
			const completionText = this.cleanCompletion(result.content, request.prefix);

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
		const fileName = request.filePath.split(/[\\/]/).pop() || request.filePath;

		return `文件：${fileName}
语言：${request.languageId}

光标位于 <PREFIX> 的末尾与 <SUFFIX> 的开头之间，请生成应插入在该位置的内容。

<PREFIX>
${request.prefix}
</PREFIX>

<SUFFIX>
${request.suffix}
</SUFFIX>

规则：
- 只输出要插入的文本，不要输出解释、Markdown 代码围栏或任何标签。
- 不要重复 <PREFIX> 末尾已有的内容，也不要重复 <SUFFIX> 开头已有的内容。
- 优先补全到当前行结束；只有语法明显需要时才补全整个代码块。
- 保持与上下文一致的缩进与代码风格。`;
	}

	/**
	 * 清理模型返回的补全文本
	 */
	private cleanCompletion(content: string, prefix: string): string {
		if (!content) {
			return '';
		}

		let text = content.trim();

		// 去除代码块围栏（可能只有开头或成对出现）
		const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/);
		if (fenced) {
			text = fenced[1].trim();
		} else if (text.startsWith('```')) {
			text = text.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '').trim();
		}

		// 模型偶尔会重复光标前当前行的内容，这里去掉重复部分
		const currentLine = prefix.slice(prefix.lastIndexOf('\n') + 1).trimStart();
		if (currentLine.length >= 3) {
			const indentation = text.match(/^[ \t]*/)?.[0] ?? '';
			const body = text.slice(indentation.length);
			if (body.startsWith(currentLine)) {
				text = body.slice(currentLine.length);
			} else if (text.startsWith(currentLine)) {
				text = text.slice(currentLine.length);
			}
		}

		return text.trimEnd();
	}
}
