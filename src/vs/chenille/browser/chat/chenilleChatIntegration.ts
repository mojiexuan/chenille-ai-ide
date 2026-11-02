/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IChenilleChatController, IChenilleChatChunk } from './chenilleChatController.js';
import { MarkdownString } from '../../../base/common/htmlContent.js';

/**
 * Chenille Chat 集成服务接口
 * 负责将 Chenille 的 AI 响应集成到 VS Code 的 Chat UI 中
 */
export const IChenilleChatIntegration = createDecorator<IChenilleChatIntegration>('chenilleChatIntegration');

/**
 * Chat 进度回调类型
 */
export interface IChenilleChatProgress {
	kind: 'markdownContent';
	content: MarkdownString;
}

/**
 * 历史消息
 */
export interface IChenilleChatHistoryMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface IChenilleChatIntegration {
	readonly _serviceBrand: undefined;

	/**
	 * 检查 Chenille 是否已配置
	 */
	isConfigured(): Promise<boolean>;

	/**
	 * 提示用户配置 Chenille
	 */
	promptConfiguration(): void;

	/**
	 * 处理 Chat 请求
	 * @param input 用户输入
	 * @param history 历史消息
	 * @param progressCallback 进度回调
	 * @param token 取消令牌
	 */
	handleRequest(
		input: string,
		history: IChenilleChatHistoryMessage[],
		progressCallback: (progress: IChenilleChatProgress[]) => void,
		token: CancellationToken
	): Promise<IChenilleChatResult>;

	/**
	 * 取消当前请求
	 */
	cancel(): void;
}

/**
 * Chenille Chat 结果
 */
export interface IChenilleChatResult {
	/** 是否成功 */
	success: boolean;
	/** 完整响应文本 */
	content: string;
	/** 错误信息 */
	error?: string;
}

/**
 * Chenille Chat 集成实现
 */
export class ChenilleChatIntegrationImpl extends Disposable implements IChenilleChatIntegration {
	declare readonly _serviceBrand: undefined;

	private _currentCts: CancellationTokenSource | undefined;

	constructor(
		@IChenilleChatController private readonly chatController: IChenilleChatController,
	) {
		super();
	}

	async isConfigured(): Promise<boolean> {
		return this.chatController.isConfigured();
	}

	promptConfiguration(): void {
		this.chatController.promptConfiguration();
	}

	cancel(): void {
		this._currentCts?.cancel();
		this._currentCts = undefined;
		this.chatController.cancel();
	}

	async handleRequest(
		input: string,
		history: IChenilleChatHistoryMessage[],
		progressCallback: (progress: IChenilleChatProgress[]) => void,
		token: CancellationToken
	): Promise<IChenilleChatResult> {
		// 创建取消令牌
		this._currentCts = new CancellationTokenSource(token);
		const cts = this._currentCts;

		const disposables = new DisposableStore();
		let fullContent = '';
		let hasError = false;
		let errorMessage: string | undefined;

		try {
			// 监听响应块
			disposables.add(this.chatController.onChunk((chunk: IChenilleChatChunk) => {
				if (cts.token.isCancellationRequested) {
					return;
				}

				// 处理文本内容
				if (chunk.content) {
					fullContent += chunk.content;
					progressCallback([{
						kind: 'markdownContent',
						content: new MarkdownString(chunk.content)
					}]);
				}

				// 处理推理内容（作为思考过程显示）
				if (chunk.reasoning) {
					progressCallback([{
						kind: 'markdownContent',
						content: new MarkdownString(`\n\n> 💭 ${chunk.reasoning}\n\n`)
					}]);
				}

				// 处理工具调用
				if (chunk.toolCalls?.length) {
					const toolNames = chunk.toolCalls
						.map(tc => tc.function.name)
						.filter(Boolean)
						.join(', ');
					progressCallback([{
						kind: 'markdownContent',
						content: new MarkdownString(`\n\n🔧 正在调用工具: ${toolNames}\n\n`)
					}]);
				}

				// 处理工具结果
				if (chunk.toolResult) {
					const { toolName, success, result } = chunk.toolResult;
					const icon = success ? '✅' : '❌';
					const status = success ? '成功' : '失败';
					progressCallback([{
						kind: 'markdownContent',
						content: new MarkdownString(`\n\n${icon} 工具 \`${toolName}\` 执行${status}\n\n\`\`\`\n${this.truncateResult(result)}\n\`\`\`\n\n`)
					}]);
				}

				// 处理错误
				if (chunk.error) {
					hasError = true;
					errorMessage = chunk.error;
					progressCallback([{
						kind: 'markdownContent',
						content: new MarkdownString(`\n\n❌ 错误: ${chunk.error}\n\n`)
					}]);
				}
			}));

			// 转换历史消息格式
			const aiHistory = history.map(msg => ({
				role: msg.role as 'user' | 'assistant',
				content: msg.content,
			}));

			// 发起请求
			const response = await this.chatController.chat({
				input,
				history: aiHistory,
				enableTools: true,
			}, cts.token);

			return {
				success: !hasError,
				content: response,
				error: errorMessage,
			};

		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: fullContent,
				error: errMsg,
			};
		} finally {
			disposables.dispose();
			if (this._currentCts === cts) {
				this._currentCts = undefined;
			}
		}
	}

	/**
	 * 截断过长的工具结果
	 */
	private truncateResult(result: string, maxLength: number = 500): string {
		if (result.length <= maxLength) {
			return result;
		}
		return result.substring(0, maxLength) + '\n... (已截断)';
	}
}
