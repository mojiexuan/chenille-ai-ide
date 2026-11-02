/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { ICodeEditor, IViewZone, IViewZoneChangeAccessor } from '../../../editor/browser/editorBrowser.js';
import { IModelDecorationsChangeAccessor, ITextModel, TrackedRangeStickiness, OverviewRulerLane, MinimapPosition } from '../../../editor/common/model.js';
import { ModelDecorationOptions } from '../../../editor/common/model/textModel.js';
import { Range } from '../../../editor/common/core/range.js';
import { IEditorWorkerService } from '../../../editor/common/services/editorWorker.js';
import { themeColorFromId } from '../../../base/common/themables.js';
import { EditOperation, ISingleEditOperation } from '../../../editor/common/core/editOperation.js';
import { DetailedLineRangeMapping, RangeMapping } from '../../../editor/common/diff/rangeMapping.js';
import { LineRange } from '../../../editor/common/core/ranges/lineRange.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { LineSource, RenderOptions, renderLines } from '../../../editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import { LineTokens } from '../../../editor/common/tokens/lineTokens.js';
import { StableEditorScrollState } from '../../../editor/browser/stableEditorScroll.js';
import {
	IChenilleDiffSession,
	IChenilleHunkInfo,
	ChenilleHunkState,
	chenilleDiffInsertedColor,
	chenilleDiffInsertedOutlineColor,
} from './chenilleDiffSession.js';
import { ChenilleHunkWidgetFactory, createHunkActions } from './chenilleHunkWidget.js';

// Hunk 合并阈值
const HUNK_MERGE_THRESHOLD = 8;

// 装饰器选项 - 插入行高亮
const DECORATION_INSERTED_LINE = ModelDecorationOptions.register({
	description: 'chenille-diff-inserted-line',
	className: 'chenille-diff-inserted-line',
	isWholeLine: true,
	overviewRuler: {
		position: OverviewRulerLane.Full,
		color: themeColorFromId(chenilleDiffInsertedOutlineColor),
	},
	minimap: {
		position: MinimapPosition.Inline,
		color: themeColorFromId(chenilleDiffInsertedColor),
	}
});

// 装饰器选项 - 插入范围高亮
const DECORATION_INSERTED_RANGE = ModelDecorationOptions.register({
	description: 'chenille-diff-inserted-range',
	className: 'chenille-diff-inserted-range',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
});

// 内部 Hunk 显示数据
interface HunkDisplayData {
	hunk: HunkData;
	decorationIds: string[];
	diffViewZoneId: string | undefined;
	diffViewZone: IViewZone | undefined;
	actionsViewZoneIds: string[];
	actionsDisposable: DisposableStore | undefined;
	showingDiff: boolean;
}

// 内部 Hunk 数据
interface HunkData {
	original: LineRange;
	modified: LineRange;
	changes: RangeMapping[];
	state: ChenilleHunkState;
}

// Chenille Diff Session 实现
export class ChenilleDiffSessionImpl extends Disposable implements IChenilleDiffSession {
	readonly id: string;
	readonly uri: URI;
	readonly originalModel: ITextModel;
	readonly modifiedModel: ITextModel;

	private _editor: ICodeEditor | undefined;
	private readonly _hunks: HunkData[] = [];
	private readonly _hunkDisplayData = new Map<HunkData, HunkDisplayData>();
	private _ignoreModelChanges = false;
	private _widgetFactory: ChenilleHunkWidgetFactory | undefined;

	private readonly _onDidChangeHunks = this._register(new Emitter<void>());
	readonly onDidChangeHunks: Event<void> = this._onDidChangeHunks.event;

	private readonly _onDidEnd = this._register(new Emitter<{ accepted: boolean }>());
	readonly onDidEnd: Event<{ accepted: boolean }> = this._onDidEnd.event;

	get editor(): ICodeEditor | undefined {
		return this._editor;
	}

	constructor(
		uri: URI,
		originalModel: ITextModel,
		modifiedModel: ITextModel,
		editor: ICodeEditor | undefined,
		@IEditorWorkerService private readonly _editorWorkerService: IEditorWorkerService,
	) {
		super();
		this.id = generateUuid();
		this.uri = uri;
		this.originalModel = originalModel;
		this.modifiedModel = modifiedModel;
		this._editor = editor;

		// 创建 Widget 工厂
		if (editor) {
			this._widgetFactory = this._register(new ChenilleHunkWidgetFactory(editor));
		}

		this._register(modifiedModel.onDidChangeContent(e => {
			if (!this._ignoreModelChanges) {
				this._mirrorChangesToOriginal(e.changes);
			}
		}));
	}

	private _mirrorChangesToOriginal(changes: readonly { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string }[]): void {
		const edits: ISingleEditOperation[] = [];

		for (const change of changes) {
			let isInPendingHunk = false;
			const changeRange = new Range(change.range.startLineNumber, change.range.startColumn, change.range.endLineNumber, change.range.endColumn);

			for (const hunk of this._hunks) {
				if (hunk.state === ChenilleHunkState.Pending) {
					const displayData = this._hunkDisplayData.get(hunk);
					if (displayData && displayData.decorationIds.length > 0) {
						const hunkRange = this.modifiedModel.getDecorationRange(displayData.decorationIds[0]);
						if (hunkRange && Range.areIntersectingOrTouching(hunkRange, changeRange)) {
							isInPendingHunk = true;
							break;
						}
					}
				}
			}

			if (!isInPendingHunk) {
				const offset = this.modifiedModel.getOffsetAt(changeRange.getStartPosition());
				const start = this.originalModel.getPositionAt(offset);
				const end = this.originalModel.getPositionAt(offset + changeRange.endColumn - changeRange.startColumn);
				edits.push(EditOperation.replace(Range.fromPositions(start, end), change.text));
			}
		}

		if (edits.length > 0) {
			this.originalModel.pushEditOperations(null, edits, () => null);
		}
	}

	private _getHunkModifiedRange(hunk: HunkData): Range | undefined {
		const displayData = this._hunkDisplayData.get(hunk);
		if (!displayData || displayData.decorationIds.length === 0) {
			return this._lineRangeToRange(hunk.modified);
		}
		return this.modifiedModel.getDecorationRange(displayData.decorationIds[0]) ?? undefined;
	}

	private _getHunkOriginalRange(hunk: HunkData): Range {
		return this._lineRangeToRange(hunk.original);
	}

	private _lineRangeToRange(lineRange: LineRange): Range {
		if (lineRange.isEmpty) {
			return new Range(lineRange.startLineNumber, 1, lineRange.startLineNumber, Number.MAX_SAFE_INTEGER);
		}
		return new Range(lineRange.startLineNumber, 1, lineRange.endLineNumberExclusive - 1, Number.MAX_SAFE_INTEGER);
	}

	getHunks(): IChenilleHunkInfo[] {
		return this._hunks.map(hunk => this._createHunkInfo(hunk));
	}

	getPendingCount(): number {
		return this._hunks.filter(h => h.state === ChenilleHunkState.Pending).length;
	}

	private _createHunkInfo(hunk: HunkData): IChenilleHunkInfo {
		return {
			getState: () => hunk.state,
			isInsertion: () => hunk.original.isEmpty,
			getModifiedRanges: () => {
				const displayData = this._hunkDisplayData.get(hunk);
				if (!displayData) {
					return [this._lineRangeToRange(hunk.modified)];
				}
				const ranges: Range[] = [];
				for (const id of displayData.decorationIds) {
					const range = this.modifiedModel.getDecorationRange(id);
					if (range) {
						ranges.push(range);
					}
				}
				return ranges;
			},
			getOriginalRanges: () => [this._getHunkOriginalRange(hunk)],
			accept: () => this._acceptHunk(hunk),
			reject: () => this._rejectHunk(hunk),
		};
	}

	private _acceptHunk(hunk: HunkData): void {
		if (hunk.state !== ChenilleHunkState.Pending) {
			return;
		}

		const modifiedRange = this._getHunkModifiedRange(hunk);
		const originalRange = this._getHunkOriginalRange(hunk);

		if (modifiedRange) {
			const modifiedContent = this.modifiedModel.getValueInRange(modifiedRange);
			this.originalModel.pushEditOperations(null, [
				EditOperation.replace(originalRange, modifiedContent)
			], () => null);
		}

		hunk.state = ChenilleHunkState.Accepted;
		this._renderHunks();
		this._onDidChangeHunks.fire();
		this._checkAllSettled();
	}

	private _rejectHunk(hunk: HunkData): void {
		if (hunk.state !== ChenilleHunkState.Pending) {
			return;
		}

		const modifiedRange = this._getHunkModifiedRange(hunk);
		const originalRange = this._getHunkOriginalRange(hunk);

		if (modifiedRange) {
			const originalContent = this.originalModel.getValueInRange(originalRange);
			this._ignoreModelChanges = true;
			this.modifiedModel.pushEditOperations(null, [
				EditOperation.replace(modifiedRange, originalContent)
			], () => null);
			this._ignoreModelChanges = false;
		}

		hunk.state = ChenilleHunkState.Rejected;
		this._renderHunks();
		this._onDidChangeHunks.fire();
		this._checkAllSettled();
	}

	private _toggleDiff(hunk: HunkData): void {
		const displayData = this._hunkDisplayData.get(hunk);
		if (!displayData || !this._editor) {
			return;
		}

		const scrollState = StableEditorScrollState.capture(this._editor);

		this._editor.changeViewZones(viewZoneAccessor => {
			if (displayData.showingDiff && displayData.diffViewZoneId) {
				// 隐藏 diff
				viewZoneAccessor.removeZone(displayData.diffViewZoneId);
				displayData.diffViewZoneId = undefined;
				displayData.showingDiff = false;
			} else if (!displayData.showingDiff && displayData.diffViewZone) {
				// 显示 diff
				const modifiedRange = this._getHunkModifiedRange(hunk);
				if (modifiedRange) {
					displayData.diffViewZone.afterLineNumber = modifiedRange.startLineNumber - 1;
					displayData.diffViewZoneId = viewZoneAccessor.addZone(displayData.diffViewZone);
					displayData.showingDiff = true;
				}
			}
		});

		// 更新操作按钮
		this._updateHunkActions(hunk, displayData);

		scrollState.restore(this._editor);
	}

	private _updateHunkActions(hunk: HunkData, displayData: HunkDisplayData): void {
		if (!this._editor || !this._widgetFactory) {
			return;
		}

		// 清理旧的 actions
		if (displayData.actionsDisposable) {
			displayData.actionsDisposable.dispose();
			displayData.actionsDisposable = undefined;
		}

		if (hunk.state !== ChenilleHunkState.Pending) {
			return;
		}

		// 创建新的 actions
		displayData.actionsDisposable = new DisposableStore();
		displayData.actionsViewZoneIds = [];

		const modifiedRange = this._getHunkModifiedRange(hunk);
		if (!modifiedRange) {
			return;
		}

		const actions = createHunkActions(
			() => this._acceptHunk(hunk),
			() => this._rejectHunk(hunk),
			!hunk.original.isEmpty ? () => this._toggleDiff(hunk) : undefined,
			displayData.showingDiff
		);

		this._editor.changeViewZones(viewZoneAccessor => {
			const widget = this._widgetFactory!.createWidget(
				viewZoneAccessor,
				modifiedRange.startLineNumber - 1,
				actions,
				displayData.actionsViewZoneIds
			);
			displayData.actionsDisposable!.add(widget);
		});
	}

	private _checkAllSettled(): void {
		const pending = this.getPendingCount();
		if (pending === 0 && this._hunks.length > 0) {
			const hasAccepted = this._hunks.some(h => h.state === ChenilleHunkState.Accepted);
			this._onDidEnd.fire({ accepted: hasAccepted });
		}
	}

	async acceptAll(): Promise<void> {
		for (const hunk of this._hunks) {
			if (hunk.state === ChenilleHunkState.Pending) {
				this._acceptHunk(hunk);
			}
		}
	}

	async rejectAll(): Promise<void> {
		for (const hunk of [...this._hunks].reverse()) {
			if (hunk.state === ChenilleHunkState.Pending) {
				this._rejectHunk(hunk);
			}
		}
	}

	async applyEdits(edits: ISingleEditOperation[]): Promise<void> {
		this._ignoreModelChanges = true;
		try {
			this.modifiedModel.pushEditOperations(null, edits, () => null);
		} finally {
			this._ignoreModelChanges = false;
		}
		await this.recomputeDiff();
	}

	async recomputeDiff(): Promise<void> {
		const diff = await this._editorWorkerService.computeDiff(
			this.originalModel.uri,
			this.modifiedModel.uri,
			{ ignoreTrimWhitespace: false, maxComputationTimeMs: Number.MAX_SAFE_INTEGER, computeMoves: false },
			'advanced'
		);

		this._clearAllDisplayData();
		this._hunks.length = 0;

		if (!diff || diff.changes.length === 0) {
			this._onDidChangeHunks.fire();
			return;
		}

		const mergedChanges = this._mergeChanges(diff.changes);

		for (const change of mergedChanges) {
			this._hunks.push({
				original: change.original,
				modified: change.modified,
				changes: change.innerChanges ?? [],
				state: ChenilleHunkState.Pending,
			});
		}

		this._renderHunks();
		this._onDidChangeHunks.fire();
	}

	private _mergeChanges(changes: readonly DetailedLineRangeMapping[]): DetailedLineRangeMapping[] {
		if (changes.length === 0) {
			return [];
		}

		const merged: DetailedLineRangeMapping[] = [changes[0]];

		for (let i = 1; i < changes.length; i++) {
			const last = merged[merged.length - 1];
			const current = changes[i];

			if (current.modified.startLineNumber - last.modified.endLineNumberExclusive <= HUNK_MERGE_THRESHOLD) {
				merged[merged.length - 1] = new DetailedLineRangeMapping(
					last.original.join(current.original),
					last.modified.join(current.modified),
					(last.innerChanges ?? []).concat(current.innerChanges ?? [])
				);
			} else {
				merged.push(current);
			}
		}

		return merged;
	}

	private _renderHunks(): void {
		if (!this._editor) {
			return;
		}

		const keysNow = new Set(this._hunkDisplayData.keys());

		this._editor.changeDecorations(decorationsAccessor => {
			this._editor!.changeViewZones(viewZoneAccessor => {
				for (const hunk of this._hunks) {
					keysNow.delete(hunk);

					let displayData = this._hunkDisplayData.get(hunk);

					if (!displayData) {
						// 首次创建显示数据
						displayData = this._createHunkDisplayData(hunk, decorationsAccessor, viewZoneAccessor);
						this._hunkDisplayData.set(hunk, displayData);
					} else {
						// 更新现有显示数据
						this._updateHunkDisplayData(hunk, displayData, decorationsAccessor, viewZoneAccessor);
					}
				}

				// 清理不再存在的 hunk
				for (const oldHunk of keysNow) {
					const displayData = this._hunkDisplayData.get(oldHunk);
					if (displayData) {
						this._removeHunkDisplayData(displayData, decorationsAccessor, viewZoneAccessor);
						this._hunkDisplayData.delete(oldHunk);
					}
				}
			});
		});
	}

	private _createHunkDisplayData(
		hunk: HunkData,
		decorationsAccessor: IModelDecorationsChangeAccessor,
		viewZoneAccessor: IViewZoneChangeAccessor
	): HunkDisplayData {
		const decorationIds: string[] = [];
		const actionsViewZoneIds: string[] = [];

		// 添加插入行的装饰器
		if (!hunk.modified.isEmpty && hunk.state === ChenilleHunkState.Pending) {
			const modifiedRange = this._lineRangeToRange(hunk.modified);
			decorationIds.push(decorationsAccessor.addDecoration(modifiedRange, DECORATION_INSERTED_LINE));

			for (const change of hunk.changes) {
				if (!change.modifiedRange.isEmpty()) {
					decorationIds.push(decorationsAccessor.addDecoration(change.modifiedRange, DECORATION_INSERTED_RANGE));
				}
			}
		}

		// 创建删除行的 ViewZone（预先创建但不显示）
		let diffViewZone: IViewZone | undefined;
		if (!hunk.original.isEmpty) {
			diffViewZone = this._createDeletedViewZone(hunk);
		}

		const displayData: HunkDisplayData = {
			hunk,
			decorationIds,
			diffViewZoneId: undefined,
			diffViewZone,
			actionsViewZoneIds,
			actionsDisposable: undefined,
			showingDiff: false,
		};

		// 创建操作按钮
		if (hunk.state === ChenilleHunkState.Pending && this._widgetFactory) {
			const modifiedRange = this._getHunkModifiedRange(hunk);
			if (modifiedRange) {
				displayData.actionsDisposable = new DisposableStore();

				const actions = createHunkActions(
					() => this._acceptHunk(hunk),
					() => this._rejectHunk(hunk),
					!hunk.original.isEmpty ? () => this._toggleDiff(hunk) : undefined,
					false
				);

				const widget = this._widgetFactory.createWidget(
					viewZoneAccessor,
					modifiedRange.startLineNumber - 1,
					actions,
					actionsViewZoneIds
				);
				displayData.actionsDisposable.add(widget);
			}
		}

		return displayData;
	}

	private _updateHunkDisplayData(
		hunk: HunkData,
		displayData: HunkDisplayData,
		decorationsAccessor: IModelDecorationsChangeAccessor,
		viewZoneAccessor: IViewZoneChangeAccessor
	): void {
		// 如果 hunk 不再是 pending 状态，清理所有显示
		if (hunk.state !== ChenilleHunkState.Pending) {
			// 清理装饰器
			for (const id of displayData.decorationIds) {
				decorationsAccessor.removeDecoration(id);
			}
			displayData.decorationIds = [];

			// 清理 diff ViewZone
			if (displayData.diffViewZoneId) {
				viewZoneAccessor.removeZone(displayData.diffViewZoneId);
				displayData.diffViewZoneId = undefined;
			}

			// 清理 actions ViewZone
			for (const id of displayData.actionsViewZoneIds) {
				viewZoneAccessor.removeZone(id);
			}
			displayData.actionsViewZoneIds = [];

			// 清理 actions disposable
			if (displayData.actionsDisposable) {
				displayData.actionsDisposable.dispose();
				displayData.actionsDisposable = undefined;
			}
		}
	}

	private _removeHunkDisplayData(
		displayData: HunkDisplayData,
		decorationsAccessor: IModelDecorationsChangeAccessor,
		viewZoneAccessor: IViewZoneChangeAccessor
	): void {
		// 清理装饰器
		for (const id of displayData.decorationIds) {
			decorationsAccessor.removeDecoration(id);
		}

		// 清理 diff ViewZone
		if (displayData.diffViewZoneId) {
			viewZoneAccessor.removeZone(displayData.diffViewZoneId);
		}

		// 清理 actions ViewZone
		for (const id of displayData.actionsViewZoneIds) {
			viewZoneAccessor.removeZone(id);
		}

		// 清理 actions disposable
		if (displayData.actionsDisposable) {
			displayData.actionsDisposable.dispose();
		}
	}

	private _createDeletedViewZone(hunk: HunkData): IViewZone | undefined {
		if (!this._editor || hunk.original.isEmpty) {
			return undefined;
		}

		const originalRange = hunk.original;

		// 获取删除行的 tokens
		const lineTokens: LineTokens[] = [];
		for (let lineNumber = originalRange.startLineNumber; lineNumber < originalRange.endLineNumberExclusive; lineNumber++) {
			const tokens = this.originalModel.tokenization.getLineTokens(lineNumber);
			lineTokens.push(tokens);
		}

		// 创建 LineSource 用于渲染删除的行
		const mightContainNonBasicASCII = this.originalModel.mightContainNonBasicASCII();
		const mightContainRTL = this.originalModel.mightContainRTL();
		const source = new LineSource(
			lineTokens,
			lineTokens.map(() => null),
			mightContainNonBasicASCII,
			mightContainRTL
		);

		// 使用 RenderOptions.fromEditor 获取正确的渲染选项
		const renderOptions = RenderOptions.fromEditor(this._editor);

		// 创建 DOM 节点
		const domNode = document.createElement('div');
		domNode.className = 'chenille-diff-deleted-zone';

		const result = renderLines(source, renderOptions, [], domNode);

		return {
			afterLineNumber: -1, // 稍后设置
			heightInLines: result.heightInLines,
			domNode,
			ordinal: 50000,
		};
	}

	private _clearAllDisplayData(): void {
		if (!this._editor) {
			return;
		}

		this._editor.changeDecorations(decorationsAccessor => {
			this._editor!.changeViewZones(viewZoneAccessor => {
				for (const displayData of this._hunkDisplayData.values()) {
					this._removeHunkDisplayData(displayData, decorationsAccessor, viewZoneAccessor);
				}
			});
		});

		this._hunkDisplayData.clear();
	}

	override dispose(): void {
		this._clearAllDisplayData();
		super.dispose();
	}
}
