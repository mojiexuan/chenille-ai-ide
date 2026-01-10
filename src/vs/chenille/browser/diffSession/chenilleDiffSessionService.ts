/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { ICodeEditor } from '../../../editor/browser/editorBrowser.js';
import { IEditorWorkerService } from '../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../editor/common/services/model.js';
import { ITextModelService } from '../../../editor/common/services/resolverService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { Schemas } from '../../../base/common/network.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createTextBufferFactoryFromSnapshot } from '../../../editor/common/model/textModel.js';
import { ResourceMap } from '../../../base/common/map.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import {
	IChenilleDiffSession,
	IChenilleDiffSessionService,
	CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
} from './chenilleDiffSession.js';
import { ChenilleDiffSessionImpl } from './chenilleDiffSessionImpl.js';

/**
 * Chenille Diff Session 服务实现
 */
export class ChenilleDiffSessionService extends Disposable implements IChenilleDiffSessionService {
	declare readonly _serviceBrand: undefined;

	private readonly _sessions = new ResourceMap<{ session: IChenilleDiffSession; store: DisposableStore }>();
	private readonly _ctxDiffSessionActive;

	private readonly _onDidCreateSession = this._register(new Emitter<IChenilleDiffSession>());
	readonly onDidCreateSession: Event<IChenilleDiffSession> = this._onDidCreateSession.event;

	private readonly _onDidEndSession = this._register(new Emitter<IChenilleDiffSession>());
	readonly onDidEndSession: Event<IChenilleDiffSession> = this._onDidEndSession.event;

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@ITextModelService private readonly _textModelService: ITextModelService,
		@IEditorWorkerService _editorWorkerService: IEditorWorkerService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._ctxDiffSessionActive = CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE.bindTo(contextKeyService);
	}

	async createSession(uri: URI, editor?: ICodeEditor): Promise<IChenilleDiffSession> {
		// 检查是否已存在 session
		const existing = this._sessions.get(uri);
		if (existing) {
			return existing.session;
		}

		// 获取或创建编辑器
		if (!editor) {
			const editors = this._codeEditorService.listCodeEditors();
			for (const e of editors) {
				if (e.getModel()?.uri.toString() === uri.toString()) {
					editor = e;
					break;
				}
			}
		}

		// 获取文本模型
		const modelRef = await this._textModelService.createModelReference(uri);
		const modifiedModel = modelRef.object.textEditorModel;

		// 创建原始模型的快照
		const sessionId = generateUuid();
		const originalModel = this._modelService.createModel(
			createTextBufferFactoryFromSnapshot(modifiedModel.createSnapshot()),
			{ languageId: modifiedModel.getLanguageId(), onDidChange: Event.None },
			uri.with({
				scheme: Schemas.vscode,
				authority: 'chenille-diff',
				path: '',
				query: new URLSearchParams({ id: sessionId, type: 'original' }).toString()
			}),
			true
		);

		// 创建 session
		const session = this._instantiationService.createInstance(
			ChenilleDiffSessionImpl,
			uri,
			originalModel,
			modifiedModel,
			editor
		);

		// 创建 store 管理生命周期
		const store = new DisposableStore();
		store.add(modelRef);
		store.add(originalModel);
		store.add(session);

		// 监听 session 结束
		store.add(session.onDidEnd(() => {
			this._endSession(uri);
		}));

		// 存储 session
		this._sessions.set(uri, { session, store });
		this._ctxDiffSessionActive.set(true);
		this._onDidCreateSession.fire(session);

		return session;
	}

	getSession(uri: URI): IChenilleDiffSession | undefined {
		return this._sessions.get(uri)?.session;
	}

	getAllSessions(): IChenilleDiffSession[] {
		return [...this._sessions.values()].map(v => v.session);
	}

	endSession(uri: URI): void {
		this._endSession(uri);
	}

	private _endSession(uri: URI): void {
		const data = this._sessions.get(uri);
		if (data) {
			this._sessions.delete(uri);
			this._onDidEndSession.fire(data.session);
			data.store.dispose();

			// 如果没有活跃的 session，更新 context key
			if (this._sessions.size === 0) {
				this._ctxDiffSessionActive.set(false);
			}
		}
	}

	async acceptAllSessions(): Promise<void> {
		const sessions = this.getAllSessions();
		for (const session of sessions) {
			await session.acceptAll();
		}
	}

	async rejectAllSessions(): Promise<void> {
		const sessions = this.getAllSessions();
		for (const session of sessions) {
			await session.rejectAll();
		}
	}

	getTotalPendingCount(): number {
		let total = 0;
		for (const session of this.getAllSessions()) {
			total += session.getPendingCount();
		}
		return total;
	}

	override dispose(): void {
		for (const [uri] of this._sessions) {
			this._endSession(uri);
		}
		super.dispose();
	}
}
