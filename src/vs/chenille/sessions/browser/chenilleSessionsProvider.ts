/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Codicon } from '../../../base/common/codicons.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import { autorun, constObservable, IObservable, IReader, ISettableObservable, observableValue } from '../../../base/common/observable.js';
import { basename, dirname, isEqual } from '../../../base/common/resources.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize } from '../../../nls.js';
import { IChatService, IChatSendRequestOptions } from '../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatModel } from '../../../workbench/contrib/chat/common/model/chatModel.js';
import { ChatAgentLocation, ChatModeKind, ChatPermissionLevel } from '../../../workbench/contrib/chat/common/constants.js';
import { ILanguageModelsService } from '../../../workbench/contrib/chat/common/languageModels.js';
import { getRegisteredLanguageModels, resolveModelIdentifierFromLanguageModels } from '../../../workbench/contrib/chat/common/modelSelection.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { getSessionApplication } from '../../../sessions/common/sessionApplication.js';
import {
	ChatInteractivity,
	ChatModelSource,
	IChat,
	IChatCapabilities,
	IChatCheckpoints,
	ISession,
	ISessionCapabilities,
	ISessionChangeset,
	ISessionEnvironment,
	ISessionFileChange,
	ISessionType,
	ISessionWorkspace,
	ISessionWorkspaceBrowseAction,
	SESSION_WORKSPACE_GROUP_LOCAL,
	SessionStatus,
	SessionTypeAuthRequirement,
	getUntitledSessionTitle,
	toSessionId,
} from '../../../sessions/services/sessions/common/session.js';
import {
	IChatMovedEvent,
	IDeleteChatOptions,
	IForkChatOptions,
	INestedChatFolderInfo,
	INestedChatWorkspace,
	INestedChatWorkspaceSupport,
	ISendRequestOptions,
	ISessionChangeEvent,
	ISessionChatMoveDestination,
	ISessionModelPickerOptions,
	ISessionModelsSnapshot,
	ISessionsProvider,
	ISessionsProviderCreateSessionOptions,
	SessionMoveRefusedError,
} from '../../../sessions/services/sessions/common/sessionsProvider.js';
import { CHENILLE_AGENT_ID, CHENILLE_MODEL_VENDOR } from '../../common/modelIdentifier.js';

/** Agents 窗口中的 Chenille provider 标识 */
export const CHENILLE_PROVIDER_ID = 'chenille';

/** Chenille 聊天会话类型标识，同时也是内容提供者使用的 scheme */
export const CHENILLE_SESSION_TYPE_ID = 'chenille-local';

/** Chenille 会话资源的 scheme */
export const CHENILLE_SESSION_SCHEME = CHENILLE_SESSION_TYPE_ID;

const CHENILLE_ENVIRONMENT: ISessionEnvironment = { id: 'local', label: localize('chenille.environment.local', "本机") };

const ChenilleSessionType: ISessionType = {
	id: CHENILLE_SESSION_TYPE_ID,
	label: 'Chenille',
	icon: Codicon.sparkle,
	authRequirement: SessionTypeAuthRequirement.None,
	initializationOnSelection: { canInitializeWithoutGitHub: true },
};

/**
 * 单个 Chenille 会话。Chenille 只做本地单聊，因此会话与主聊天共享同一份状态。
 */
export class ChenilleSession implements ISession {
	readonly sessionId: string;
	readonly resource: URI;
	readonly providerId = CHENILLE_PROVIDER_ID;
	readonly sessionType = CHENILLE_SESSION_TYPE_ID;
	readonly harness = CHENILLE_SESSION_TYPE_ID;
	readonly environment = CHENILLE_ENVIRONMENT.id;
	readonly application = constObservable(getSessionApplication('chenille', 'Chenille'));
	readonly icon: ThemeIcon = Codicon.sparkle;
	readonly createdAt = new Date();

	readonly title: ISettableObservable<string>;
	readonly updatedAt: ISettableObservable<Date>;
	readonly status: ISettableObservable<SessionStatus>;
	readonly modelId: ISettableObservable<string | undefined>;
	readonly mode: ISettableObservable<{ readonly id: string; readonly kind: string } | undefined>;
	readonly isArchived: ISettableObservable<boolean>;
	readonly isRead: ISettableObservable<boolean>;
	readonly lastTurnEnd: ISettableObservable<Date | undefined>;
	readonly loading = constObservable(false);
	readonly description = constObservable<IMarkdownString | undefined>(undefined);
	readonly capabilities = constObservable<ISessionCapabilities>({ supportsMultipleChats: false, supportsRename: true, supportsDelete: true });
	readonly workspace: IObservable<ISessionWorkspace | undefined>;
	readonly chat: ChenilleChat;
	readonly mainChat: IObservable<IChat>;
	readonly chats: IObservable<readonly IChat[]>;

	constructor(resource: URI, workspace: ISessionWorkspace | undefined, modelId: string | undefined) {
		this.resource = resource;
		this.sessionId = toSessionId(CHENILLE_PROVIDER_ID, resource);
		this.workspace = constObservable(workspace);
		this.title = observableValue(this, getUntitledSessionTitle(false));
		this.updatedAt = observableValue(this, this.createdAt);
		this.status = observableValue(this, SessionStatus.Untitled);
		this.modelId = observableValue<string | undefined>(this, modelId);
		this.mode = observableValue(this, { id: ChatModeKind.Agent, kind: ChatModeKind.Agent });
		this.isArchived = observableValue(this, false);
		this.isRead = observableValue(this, true);
		this.lastTurnEnd = observableValue<Date | undefined>(this, undefined);
		this.chat = new ChenilleChat(resource, this);
		this.mainChat = constObservable(this.chat);
		this.chats = constObservable([this.chat]);
	}

	setTitle(title: string): void {
		const trimmed = title.trim();
		if (trimmed) {
			this.title.set(trimmed.substring(0, 100), undefined);
		}
	}
}

/**
 * Chenille 会话中的唯一聊天。状态直接复用会话的 observable，保证列表与聊天界面一致。
 */
export class ChenilleChat implements IChat {
	readonly createdAt: Date;
	readonly workspace: IObservable<ISessionWorkspace | undefined>;
	readonly title: IObservable<string>;
	readonly updatedAt: IObservable<Date | undefined>;
	readonly status: IObservable<SessionStatus>;
	readonly modelId: IObservable<string | undefined>;
	readonly mode: IObservable<{ readonly id: string; readonly kind: string } | undefined>;
	readonly isArchived: IObservable<boolean>;
	readonly isRead: IObservable<boolean>;
	readonly lastTurnEnd: IObservable<Date | undefined>;
	readonly changes = constObservable<readonly ISessionFileChange[]>([]);
	readonly changesets = constObservable<readonly ISessionChangeset[] | undefined>(undefined);
	readonly checkpoints = constObservable<IChatCheckpoints | undefined>(undefined);
	readonly interactivity = constObservable(ChatInteractivity.Full);
	readonly description = constObservable<IMarkdownString | undefined>(undefined);
	readonly modelSource = constObservable<ChatModelSource | undefined>(ChatModelSource.Chosen);
	readonly capabilities = constObservable<IChatCapabilities>({ canRename: true, canArchive: false, canDelete: false });

	constructor(readonly resource: URI, session: ChenilleSession) {
		this.createdAt = session.createdAt;
		this.workspace = session.workspace;
		this.title = session.title;
		this.updatedAt = session.updatedAt;
		this.status = session.status;
		this.modelId = session.modelId;
		this.mode = session.mode;
		this.isArchived = session.isArchived;
		this.isRead = session.isRead;
		this.lastTurnEnd = session.lastTurnEnd;
	}
}

/**
 * 把 Chenille 本地模型和聊天接入 VS Code 官方 Agents 窗口。
 */
export class ChenilleSessionsProvider extends Disposable implements ISessionsProvider {

	readonly id = CHENILLE_PROVIDER_ID;
	readonly label = 'Chenille';
	readonly environment = CHENILLE_ENVIRONMENT;
	readonly icon: ThemeIcon = Codicon.sparkle;
	// 比 VS Code 内置的本地 Agent Host（同为 -1）更靠前，确保新会话默认使用 Chenille。
	readonly order = -2;
	readonly sessionTypes: readonly ISessionType[] = [ChenilleSessionType];
	readonly browseActions: readonly ISessionWorkspaceBrowseAction[] = [];
	readonly supportsLocalWorkspaces = true;
	readonly supportsQuickChats = false;
	readonly onDidMoveChat: Event<IChatMovedEvent> = Event.None;

	private readonly _onDidChangeSessionTypes = this._register(new Emitter<void>());
	readonly onDidChangeSessionTypes: Event<void> = this._onDidChangeSessionTypes.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<ISessionChangeEvent>());
	readonly onDidChangeSessions: Event<ISessionChangeEvent> = this._onDidChangeSessions.event;

	private readonly _sessions = new Map<string, ChenilleSession>();
	private readonly _newSessions = new Map<string, ChenilleSession>();
	private readonly _modelTrackers = new Map<string, IDisposable>();

	readonly onDidChangeModels: Event<void>;

	constructor(
		@IChatService private readonly chatService: IChatService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		// 已提交会话的状态跟随官方聊天模型，这样从输入框发起的后续请求也能正确反映到列表。
		this._register(this.chatService.onDidCreateModel(model => this._trackChatModel(model)));
		this.onDidChangeModels = Event.signal(this.languageModelsService.onDidChangeLanguageModels);
	}

	getSessions(): ISession[] {
		return Array.from(this._sessions.values());
	}

	getSessionTypes(workspaceUri: URI): ISessionType[] {
		return this.resolveWorkspace(workspaceUri) ? [ChenilleSessionType] : [];
	}

	resolveWorkspace(uri: URI): ISessionWorkspace | undefined {
		if (uri.scheme !== Schemas.file) {
			return undefined;
		}
		return {
			uri,
			label: basename(uri) || uri.fsPath,
			description: dirname(uri).fsPath,
			group: SESSION_WORKSPACE_GROUP_LOCAL,
			icon: Codicon.folder,
			folders: [{
				root: uri,
				workingDirectory: uri,
				name: basename(uri) || uri.fsPath,
				description: undefined,
			}],
			requiresWorkspaceTrust: true,
			isVirtualWorkspace: false,
		};
	}

	createNewSession(workspaceUri: URI, sessionTypeId: string, options?: ISessionsProviderCreateSessionOptions): ISession {
		if (sessionTypeId !== CHENILLE_SESSION_TYPE_ID) {
			throw new Error(`Unsupported session type '${sessionTypeId}'`);
		}
		const workspace = this.resolveWorkspace(workspaceUri);
		if (!workspace) {
			throw new Error(`无法为 ${workspaceUri.toString()} 创建 Chenille 会话`);
		}
		const resource = URI.from({ scheme: CHENILLE_SESSION_SCHEME, path: `/untitled-${generateUuid()}` });
		const session = new ChenilleSession(resource, workspace, options?.modelId);
		this._newSessions.set(session.sessionId, session);
		return session;
	}

	createQuickChat(_sessionTypeId: string, _options?: ISessionsProviderCreateSessionOptions): ISession {
		throw new Error('Chenille 会话需要一个本地文件夹');
	}

	deleteNewSession(sessionId: string): void {
		this._newSessions.delete(sessionId);
		this._disposeModelTracker(sessionId);
	}

	async createNewChat(sessionId: string, _prompt?: string): Promise<IChat> {
		return this._requireSession(sessionId).mainChat.get();
	}

	async sendRequest(sessionId: string, chatResource: URI, options: ISendRequestOptions): Promise<ISession> {
		const session = this._requireSession(sessionId);
		if (!isEqual(session.chat.resource, chatResource)) {
			throw new Error('聊天资源与 Chenille 会话不匹配');
		}

		session.setTitle(options.title || options.query.split('\n')[0]);
		session.status.set(SessionStatus.InProgress, undefined);
		session.updatedAt.set(new Date(), undefined);

		const isDraft = this._newSessions.delete(sessionId);
		if (isDraft) {
			this._sessions.set(sessionId, session);
			this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
		} else {
			this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
		}

		const modelId = session.modelId.get();
		const sendOptions: IChatSendRequestOptions = {
			location: ChatAgentLocation.Chat,
			userSelectedModelId: modelId,
			modeInfo: {
				kind: ChatModeKind.Agent,
				isBuiltin: true,
				modeInstructions: undefined,
				telemetryModeId: ChatModeKind.Agent,
				applyCodeBlockSuggestionId: undefined,
				permissionLevel: ChatPermissionLevel.Default,
			},
			agentIdSilent: CHENILLE_AGENT_ID,
			attachedContext: options.attachedContext,
			hideFromTranscript: options.hideFromTranscript,
			onDidCreateResponse: options.onDidCreateResponse,
		};

		const ref = await this.chatService.acquireOrLoadSession(chatResource, ChatAgentLocation.Chat, CancellationToken.None);
		try {
			const model = ref?.object;
			if (model && modelId) {
				const metadata = this.languageModelsService.lookupLanguageModel(modelId);
				if (metadata) {
					model.inputModel.setState({ selectedModel: { identifier: modelId, metadata } });
				}
			}

			const result = await this.chatService.sendRequest(chatResource, options.query, sendOptions);
			const finalResult = result.kind === 'queued' ? await result.deferred : result;
			if (finalResult.kind === 'rejected') {
				session.status.set(SessionStatus.Error, undefined);
				session.updatedAt.set(new Date(), undefined);
				this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
				throw new Error(`Chenille 会话发送失败：${finalResult.reason}`);
			}
			return session;
		} catch (error) {
			this.logService.error('[Chenille] Agents 会话发送失败', error);
			throw error;
		} finally {
			ref?.dispose();
		}
	}

	renameChat(sessionId: string, _chatUri: URI, title: string): Promise<void> {
		const session = this._requireSession(sessionId);
		session.setTitle(title);
		this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
		return Promise.resolve();
	}

	renameSession(sessionId: string, title: string): Promise<void> {
		return this.renameChat(sessionId, this._requireSession(sessionId).chat.resource, title);
	}

	async archiveSession(sessionId: string): Promise<void> {
		const session = this._requireSession(sessionId);
		session.isArchived.set(true, undefined);
		this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
	}

	async unarchiveSession(sessionId: string): Promise<void> {
		const session = this._requireSession(sessionId);
		session.isArchived.set(false, undefined);
		this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
	}

	async setSessionReadState(sessionId: string, isRead: boolean): Promise<void> {
		const session = this._requireSession(sessionId);
		session.isRead.set(isRead, undefined);
		this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
	}

	async deleteSession(sessionId: string): Promise<void> {
		const session = this._sessions.get(sessionId) ?? this._newSessions.get(sessionId);
		if (!session) {
			return;
		}
		this._sessions.delete(sessionId);
		this._newSessions.delete(sessionId);
		this._disposeModelTracker(sessionId);
		this._onDidChangeSessions.fire({ added: [], removed: [session], changed: [] });
	}

	async deleteSessions(sessionIds: readonly string[]): Promise<void> {
		for (const sessionId of sessionIds) {
			await this.deleteSession(sessionId);
		}
	}

	async deleteChat(_sessionId: string, _chatUri: URI, _options?: IDeleteChatOptions): Promise<boolean> {
		return false;
	}

	canMoveChat(_sessionId: string, _chatUri: URI): boolean {
		return false;
	}

	async moveChat(_sessionId: string, _chatUri: URI, _destination: ISessionChatMoveDestination): Promise<void> {
		throw new SessionMoveRefusedError(localize('chenille.moveChatUnsupported', "Chenille 会话中的聊天无法移动。"));
	}

	canMoveSessionUnder(_sessionId: string): boolean {
		return false;
	}

	async moveSessionUnder(_sessionId: string, _destinationSessionId: string, _after: URI | undefined): Promise<void> {
		throw new SessionMoveRefusedError(localize('chenille.moveSessionUnsupported', "Chenille 会话无法移动到其他会话下。"));
	}

	async forkChat(sessionId: string, _sourceChat: URI, _turnId: string, _options?: IForkChatOptions): Promise<IChat> {
		throw new Error(`Chenille 会话 '${sessionId}' 不支持 fork`);
	}

	async createSideChat(sessionId: string, _sourceChat: URI, _turnId: string): Promise<IChat> {
		throw new Error(`Chenille 会话 '${sessionId}' 不支持侧边聊天`);
	}

	getNestedChatWorkspaceSupport(_sessionId: string, _reader: IReader | undefined): INestedChatWorkspaceSupport | undefined {
		return undefined;
	}

	async resolveNestedChatFolder(_sessionId: string, _folder: URI, _token: CancellationToken): Promise<INestedChatFolderInfo> {
		return { supportsWorktree: false, defaultBranch: undefined };
	}

	async getNestedChatBranches(_sessionId: string, _folder: URI, _query: string, _token: CancellationToken): Promise<readonly string[]> {
		return [];
	}

	async applyNestedChatWorkspace(_sessionId: string, _chat: URI, _workspace: INestedChatWorkspace, _prompt: string): Promise<void> {
		throw new Error('Chenille 会话不支持嵌套聊天工作区');
	}

	getModelsSnapshot(_sessionId: string, desiredModelId?: string): ISessionModelsSnapshot {
		return this._modelsSnapshot(desiredModelId);
	}

	getModelsSnapshotForCreation(_workspaceUri: URI | undefined, _sessionTypeId: string, desiredModelId?: string): ISessionModelsSnapshot {
		return this._modelsSnapshot(desiredModelId);
	}

	getModelPickerOptions(_sessionId: string): ISessionModelPickerOptions {
		return { showUnavailableFeatured: false, showManageModelsAction: false, showAutoModel: false };
	}

	setModel(sessionId: string, chatResource: URI, modelId: string, _source: ChatModelSource): void {
		const session = this._requireSession(sessionId);
		if (!isEqual(session.chat.resource, chatResource)) {
			return;
		}
		session.modelId.set(modelId, undefined);

		const metadata = this.languageModelsService.lookupLanguageModel(modelId);
		const model = this.chatService.getSession(chatResource);
		if (metadata && model) {
			model.inputModel.setState({ selectedModel: { identifier: modelId, metadata } });
		}
	}

	setMode(sessionId: string, modeId: string): void {
		const session = this._requireSession(sessionId);
		session.mode.set({ id: modeId, kind: modeId }, undefined);
	}

	private _modelsSnapshot(desiredModelId: string | undefined): ISessionModelsSnapshot {
		const allModels = getRegisteredLanguageModels(this.languageModelsService);
		const models = allModels.filter(model => model.metadata.vendor === CHENILLE_MODEL_VENDOR);
		return {
			models,
			desiredModelResolution: resolveModelIdentifierFromLanguageModels(models, desiredModelId, this.languageModelsService, allModels),
			modelTarget: CHENILLE_SESSION_TYPE_ID,
		};
	}

	private _requireSession(sessionId: string): ChenilleSession {
		const session = this._sessions.get(sessionId) ?? this._newSessions.get(sessionId);
		if (!session) {
			throw new Error(`Chenille 会话 '${sessionId}' 不存在`);
		}
		return session;
	}

	private _findSessionByResource(resource: URI): ChenilleSession | undefined {
		for (const session of [...this._newSessions.values(), ...this._sessions.values()]) {
			if (isEqual(session.resource, resource)) {
				return session;
			}
		}
		return undefined;
	}

	private _trackChatModel(model: IChatModel): void {
		if (model.sessionResource.scheme !== CHENILLE_SESSION_SCHEME) {
			return;
		}
		const key = model.sessionResource.toString();
		if (this._modelTrackers.has(key)) {
			return;
		}
		const store = new DisposableStore();
		store.add(autorun(reader => {
			// 先订阅模型状态，再查找会话：新会话在首次发送前仍属于草稿，
			// 如果提前返回会导致后续状态变化无法触发。
			const needsInput = model.requestNeedsInput.read(reader);
			const inProgress = model.requestInProgress.read(reader);
			const hasActive = model.hasActiveRequest.read(reader);
			const lastRequest = model.lastRequestObs.read(reader);
			const response = lastRequest?.response;

			const session = this._findSessionByResource(model.sessionResource);
			if (!session) {
				return;
			}

			let status: SessionStatus;
			if (needsInput) {
				status = SessionStatus.NeedsInput;
			} else if (inProgress || hasActive) {
				status = SessionStatus.InProgress;
			} else if (response) {
				status = SessionStatus.Completed;
			} else if (lastRequest) {
				status = SessionStatus.Completed;
			} else {
				return;
			}

			const previous = session.status.read(reader);
			if (previous === status) {
				return;
			}
			session.status.set(status, undefined);
			session.updatedAt.set(new Date(), undefined);
			if (status === SessionStatus.Completed) {
				session.lastTurnEnd.set(response?.completedAt ? new Date(response.completedAt) : new Date(), undefined);
			}
			this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
		}));
		store.add(model.onDidDispose(() => {
			store.dispose();
			if (this._modelTrackers.get(key) === store) {
				this._modelTrackers.delete(key);
			}
		}));
		this._modelTrackers.set(key, store);
	}

	private _disposeModelTracker(sessionId: string): void {
		const session = this._sessions.get(sessionId) ?? this._newSessions.get(sessionId);
		if (!session) {
			return;
		}
		const key = session.resource.toString();
		const tracker = this._modelTrackers.get(key);
		if (tracker) {
			this._modelTrackers.delete(key);
			tracker.dispose();
		}
	}
}
