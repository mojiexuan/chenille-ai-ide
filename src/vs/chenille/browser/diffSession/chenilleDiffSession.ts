/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { ICodeEditor } from '../../../editor/browser/editorBrowser.js';
import { ITextModel } from '../../../editor/common/model.js';
import { Range } from '../../../editor/common/core/range.js';
import { ISingleEditOperation } from '../../../editor/common/core/editOperation.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { registerColor, transparent } from '../../../platform/theme/common/colorRegistry.js';
import { diffInserted, diffRemoved } from '../../../platform/theme/common/colors/editorColors.js';
import { localize } from '../../../nls.js';
import { RawContextKey } from '../../../platform/contextkey/common/contextkey.js';

// Context Key: 是否有活跃的 diff session
export const CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE = new RawContextKey<boolean>('chenilleDiffSessionActive', false, localize('chenilleDiffSessionActive', 'Whether a Chenille diff session is active'));

// 定义 Chenille diff 高亮颜色 - 插入
export const chenilleDiffInsertedColor = registerColor(
	'chenille.diffInserted',
	transparent(diffInserted, 0.5),
	localize('chenille.diffInserted', 'Background color for inserted lines in Chenille diff view')
);

export const chenilleDiffInsertedOutlineColor = registerColor(
	'chenille.diffInsertedOutline',
	'#9ccc65',
	localize('chenille.diffInsertedOutline', 'Outline color for inserted lines in Chenille diff view')
);

// 定义 Chenille diff 高亮颜色 - 删除
export const chenilleDiffRemovedColor = registerColor(
	'chenille.diffRemoved',
	transparent(diffRemoved, 0.5),
	localize('chenille.diffRemoved', 'Background color for removed lines in Chenille diff view')
);

export const chenilleDiffRemovedOutlineColor = registerColor(
	'chenille.diffRemovedOutline',
	'#f44336',
	localize('chenille.diffRemovedOutline', 'Outline color for removed lines in Chenille diff view')
);

/**
 * Hunk 状态
 */
export const enum ChenilleHunkState {
	Pending = 0,
	Accepted = 1,
	Rejected = 2
}

/**
 * Hunk 信息接口
 */
export interface IChenilleHunkInfo {
	/** 获取当前状态 */
	getState(): ChenilleHunkState;
	/** 是否为纯插入 */
	isInsertion(): boolean;
	/** 获取修改后的范围 */
	getModifiedRanges(): Range[];
	/** 获取原始范围 */
	getOriginalRanges(): Range[];
	/** 接受变更 */
	accept(): void;
	/** 拒绝变更 */
	reject(): void;
}

/**
 * Diff Session 接口
 */
export interface IChenilleDiffSession extends IDisposable {
	/** Session ID */
	readonly id: string;
	/** 目标文件 URI */
	readonly uri: URI;
	/** 原始文本模型（快照） */
	readonly originalModel: ITextModel;
	/** 修改后的文本模型 */
	readonly modifiedModel: ITextModel;
	/** 关联的编辑器 */
	readonly editor: ICodeEditor | undefined;

	/** 当 hunks 变化时触发 */
	readonly onDidChangeHunks: Event<void>;
	/** 当 session 结束时触发 */
	readonly onDidEnd: Event<{ accepted: boolean }>;

	/** 获取所有 hunks */
	getHunks(): IChenilleHunkInfo[];
	/** 获取待处理的 hunk 数量 */
	getPendingCount(): number;
	/** 接受所有变更 */
	acceptAll(): Promise<void>;
	/** 拒绝所有变更 */
	rejectAll(): Promise<void>;
	/** 应用编辑并更新 diff */
	applyEdits(edits: ISingleEditOperation[]): Promise<void>;
	/** 刷新 diff 计算 */
	recomputeDiff(): Promise<void>;
}

/**
 * Chenille Diff Session 服务接口
 */
export const IChenilleDiffSessionService = createDecorator<IChenilleDiffSessionService>('chenilleDiffSessionService');

export interface IChenilleDiffSessionService {
	readonly _serviceBrand: undefined;

	/** 当 session 创建时触发 */
	readonly onDidCreateSession: Event<IChenilleDiffSession>;
	/** 当 session 结束时触发 */
	readonly onDidEndSession: Event<IChenilleDiffSession>;

	/**
	 * 为指定文件创建 diff session
	 * @param uri 文件 URI
	 * @param editor 可选的关联编辑器
	 */
	createSession(uri: URI, editor?: ICodeEditor): Promise<IChenilleDiffSession>;

	/**
	 * 获取指定文件的 session
	 */
	getSession(uri: URI): IChenilleDiffSession | undefined;

	/**
	 * 获取所有活跃的 sessions
	 */
	getAllSessions(): IChenilleDiffSession[];

	/**
	 * 结束指定 session
	 */
	endSession(uri: URI): void;

	/**
	 * 接受所有 sessions 的所有变更
	 */
	acceptAllSessions(): Promise<void>;

	/**
	 * 拒绝所有 sessions 的所有变更
	 */
	rejectAllSessions(): Promise<void>;

	/**
	 * 获取所有 sessions 中待处理的变更总数
	 */
	getTotalPendingCount(): number;
}
