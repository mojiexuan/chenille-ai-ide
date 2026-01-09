/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import {
	InlineCompletion,
	InlineCompletionContext,
	InlineCompletionTriggerKind,
	InlineCompletions,
	InlineCompletionsProvider,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IChenilleInlineCompletionService } from '../../../../chenille/common/inlineCompletionService.js';

/**
 * 上下文获取的最大行数
 */
const MAX_PREFIX_LINES = 50;
const MAX_SUFFIX_LINES = 20;

/**
 * 防抖延迟（毫秒）
 */
const DEBOUNCE_DELAY = 300;

/**
 * Chenille Inline Completion Provider
 */
export class ChenilleInlineCompletionProvider extends Disposable implements InlineCompletionsProvider {

	private _lastRequestTime = 0;

	constructor(
		@IChenilleInlineCompletionService private readonly inlineCompletionService: IChenilleInlineCompletionService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
	) {
		super();
		this.register();
	}

	private register(): void {
		// 注册为所有语言的 inline completion provider
		this._register(
			this.languageFeaturesService.inlineCompletionsProvider.register(
				{ pattern: '**' },
				this
			)
		);
	}

	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken
	): Promise<InlineCompletions | null> {

		// 检查是否配置了 Agent
		const isConfigured = await this.inlineCompletionService.isAgentConfigured();
		if (!isConfigured) {
			return null;
		}

		// 只在自动触发时进行防抖
		if (context.triggerKind === InlineCompletionTriggerKind.Automatic) {
			const now = Date.now();
			if (now - this._lastRequestTime < DEBOUNCE_DELAY) {
				return null;
			}
			this._lastRequestTime = now;
		}

		// 获取上下文
		const prefix = this.getPrefix(model, position);
		const suffix = this.getSuffix(model, position);

		// 如果上下文太少，不触发补全
		if (prefix.trim().length < 3) {
			return null;
		}

		try {
			const response = await this.inlineCompletionService.getCompletion({
				filePath: model.uri.fsPath || model.uri.path,
				languageId: model.getLanguageId(),
				prefix,
				suffix,
			}, token);

			if (token.isCancellationRequested) {
				return null;
			}

			if (!response.success || !response.text) {
				return null;
			}

			const items: InlineCompletion[] = [{
				insertText: response.text,
				range: new Range(
					position.lineNumber,
					position.column,
					position.lineNumber,
					position.column
				),
			}];

			return { items };

		} catch {
			return null;
		}
	}

	freeInlineCompletions(): void {
		// 清理资源
	}

	disposeInlineCompletions(): void {
		// 清理资源
	}

	/**
	 * 获取光标前的代码
	 */
	private getPrefix(model: ITextModel, position: Position): string {
		const startLine = Math.max(1, position.lineNumber - MAX_PREFIX_LINES);
		const range = new Range(
			startLine,
			1,
			position.lineNumber,
			position.column
		);
		return model.getValueInRange(range);
	}

	/**
	 * 获取光标后的代码
	 */
	private getSuffix(model: ITextModel, position: Position): string {
		const endLine = Math.min(model.getLineCount(), position.lineNumber + MAX_SUFFIX_LINES);
		const lastLineMaxColumn = model.getLineMaxColumn(endLine);
		const range = new Range(
			position.lineNumber,
			position.column,
			endLine,
			lastLineMaxColumn
		);
		return model.getValueInRange(range);
	}
}
