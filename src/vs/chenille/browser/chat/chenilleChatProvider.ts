/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { StopWatch } from '../../../base/common/stopwatch.js';
import {
	IChenilleChatProvider,
	IChenilleChatRequest,
	IChenilleChatResult,
	IChenilleChatResponseChunk
} from '../../common/chatProvider.js';
import { IChenilleChatController, IChenilleChatChunk } from './chenilleChatController.js';
import { TokenUsage } from '../../common/types.js';

/**
 * Chenille Chat Provider 实现
 * 桥接 IChenilleChatController 和 IChenilleChatProvider 接口
 */
export class ChenilleChatProviderImpl extends Disposable implements IChenilleChatProvider {
	declare readonly _serviceBrand: undefined;

	private readonly _onResponseChunk = this._register(new Emitter<IChenilleChatResponseChunk>());
	readonly onResponseChunk: Event<IChenilleChatResponseChunk> = this._onResponseChunk.event;

	private _currentCts: CancellationTokenSource | undefined;

	constructor(
		@IChenilleChatController private readonly chatController: IChenilleChatController,
	) {
		super();
	}

	async isConfigured(): Promise<boolean> {
		return this.chatController.isConfigured();
	}

	async getConfigurationError(): Promise<string | undefined> {
		return this.chatController.getConfigurationError();
	}

	promptConfiguration(): void {
		this.chatController.promptConfiguration();
	}

	async getContextSize(): Promise<number> {
		return this.chatController.getContextSize();
	}

	async supportsVision(): Promise<boolean> {
		return this.chatController.supportsVision();
	}

	cancel(): void {
		this._currentCts?.cancel();
		this._currentCts = undefined;
		this.chatController.cancel();
	}

	async chat(request: IChenilleChatRequest, token?: CancellationToken): Promise<IChenilleChatResult> {
		// 创建取消令牌并确保正确释放
		const cts = new CancellationTokenSource(token);
		this._currentCts = cts;

		const disposables = new DisposableStore();
		const stopWatch = new StopWatch(true);
		let fullContent = '';
		let hasError = false;
		let errorMessage: string | undefined;
		let finalUsage: TokenUsage | undefined;

		try {
			// 监听 controller 的响应块并转换格式
			disposables.add(this.chatController.onChunk((chunk: IChenilleChatChunk) => {
				if (cts.token.isCancellationRequested) {
					return;
				}

				// 文本内容
				if (chunk.content) {
					fullContent += chunk.content;
					this._onResponseChunk.fire({
						content: chunk.content,
						done: false,
					});
				}

				// 推理内容
				if (chunk.reasoning) {
					this._onResponseChunk.fire({
						reasoning: chunk.reasoning,
						done: false,
					});
				}

				// 工具调用开始
				if (chunk.toolCalls?.length) {
					const toolNames = chunk.toolCalls
						.map(tc => tc.function.name)
						.filter(Boolean);
					for (const name of toolNames) {
						this._onResponseChunk.fire({
							toolCall: {
								name: name ?? 'unknown',
								status: 'calling',
							},
							done: false,
						});
					}
				}

				// 工具执行结果
				if (chunk.toolResult) {
					this._onResponseChunk.fire({
						toolCall: {
							name: chunk.toolResult.toolName,
							status: chunk.toolResult.success ? 'success' : 'error',
							result: chunk.toolResult.result,
						},
						done: false,
					});
				}

				// 工具确认请求
				if (chunk.toolConfirmation) {
					this._onResponseChunk.fire({
						toolConfirmation: chunk.toolConfirmation,
						done: false,
					});
				}

				// 错误
				if (chunk.error) {
					hasError = true;
					errorMessage = chunk.error;
					this._onResponseChunk.fire({
						error: chunk.error,
						done: chunk.done,
					});
				}

				// Token 使用量
				if (chunk.usage) {
					finalUsage = chunk.usage;
				}

				// 完成信号（只在没有错误时单独发送）
				if (chunk.done && !chunk.error) {
					this._onResponseChunk.fire({
						done: true,
						usage: finalUsage,
					});
				}
			}));

			// 转换历史消息格式（保留 tool_calls 和 tool_call_id）
			const aiHistory = request.history.map(msg => ({
				role: msg.role as 'user' | 'assistant' | 'tool',
				content: msg.content,
				multiContent: msg.multiContent,
				tool_calls: msg.tool_calls,
				tool_call_id: msg.tool_call_id,
			}));

			// 发起请求
			const response = await this.chatController.chat({
				input: request.input,
				multiContent: request.multiContent,
				history: aiHistory,
				enableTools: request.enableTools ?? true,
				sessionContext: request.sessionContext,
			}, cts.token);

			return {
				success: !hasError,
				content: response,
				error: errorMessage,
				elapsed: stopWatch.elapsed(),
				usage: finalUsage,
			};

		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);

			// 发送错误响应块
			this._onResponseChunk.fire({
				error: errMsg,
				done: true,
			});

			return {
				success: false,
				content: fullContent,
				error: errMsg,
				elapsed: stopWatch.elapsed(),
			};
		} finally {
			disposables.dispose();
			// 正确释放 CancellationTokenSource
			if (this._currentCts === cts) {
				this._currentCts = undefined;
			}
			cts.dispose();
		}
	}
}
