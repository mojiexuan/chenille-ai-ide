/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ITextModel } from '../../../editor/common/model.js';
import { Position } from '../../../editor/common/core/position.js';
import { Range } from '../../../editor/common/core/range.js';
import {
	InlineCompletion,
	InlineCompletionContext,
	InlineCompletionTriggerKind,
	InlineCompletions,
	InlineCompletionsProvider,
} from '../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../editor/common/services/languageFeatures.js';
import { IChenilleInlineCompletionService } from '../../common/inlineCompletionService.js';

/**
 * 上下文获取的最大行数 / 字符数（补全只需要光标附近的上下文）
 */
const MAX_PREFIX_LINES = 20;
const MAX_SUFFIX_LINES = 10;
const MAX_PREFIX_CHARS = 3000;
const MAX_SUFFIX_CHARS = 1500;

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
		const text = model.getValueInRange(range);
		if (text.length <= MAX_PREFIX_CHARS) {
			return text;
		}

		// 保留离光标最近的部分，并从行首开始截断
		const tail = text.slice(text.length - MAX_PREFIX_CHARS);
		const firstNewline = tail.indexOf('\n');
		return firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail;
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
		const text = model.getValueInRange(range);
		if (text.length <= MAX_SUFFIX_CHARS) {
			return text;
		}

		// 保留离光标最近的部分，并在行尾截断
		const head = text.slice(0, MAX_SUFFIX_CHARS);
		const lastNewline = head.lastIndexOf('\n');
		return lastNewline >= 0 ? head.slice(0, lastNewline) : head;
	}
}
