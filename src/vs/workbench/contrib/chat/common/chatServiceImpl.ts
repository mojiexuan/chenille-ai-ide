/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { BugIndicatingError, ErrorNoTelemetry } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { Disposable, DisposableResourceMap, DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { Schemas } from '../../../../base/common/network.js';
import { autorun, derived, IObservable } from '../../../../base/common/observable.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { isDefined } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { OffsetRange } from '../../../../editor/common/core/ranges/offsetRange.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IMcpService } from '../../mcp/common/mcpTypes.js';
import { awaitStatsForSession } from './chat.js';
import { IChatAgentData, IChatAgentResult, IChatAgentService } from './chatAgents.js';
import { chatEditingSessionIsReady } from './chatEditingService.js';
import { ChatModel, ChatRequestModel, ChatRequestRemovalReason, IChatModel, IChatRequestModel, IChatRequestVariableData, IChatResponseModel, IExportableChatData, ISerializableChatData, ISerializableChatDataIn, ISerializableChatsData, normalizeSerializableChatData } from './chatModel.js';
import { ChatModelStore, IStartSessionProps } from './chatModelStore.js';
import { chatAgentLeader, ChatRequestAgentPart, ChatRequestAgentSubcommandPart, ChatRequestSlashCommandPart, ChatRequestTextPart, chatSubcommandLeader, getPromptText, IParsedChatRequest } from './chatParserTypes.js';
import { ChatRequestParser } from './chatRequestParser.js';
import { IChatCompleteResponse, IChatDetail, IChatModelReference, IChatProgress, IChatSendRequestData, IChatSendRequestOptions, IChatSendRequestResponseState, IChatService, IChatSessionContext, IChatSessionStartOptions, IChatTransferredSessionData, IChatUserActionEvent, ResponseModelState, IChatToolInvocation, ToolConfirmKind } from './chatService.js';
import { ChatRequestTelemetry, ChatServiceTelemetry } from './chatServiceTelemetry.js';
import { IChatSessionsService } from './chatSessionsService.js';
import { ChatSessionStore, IChatSessionEntryMetadata, IChatTransfer2 } from './chatSessionStore.js';
import { IChatSlashCommandService } from './chatSlashCommands.js';
import { IChatTransferService } from './chatTransferService.js';
import { LocalChatSessionUri } from './chatUri.js';
import { IChatRequestVariableEntry, isImageVariableEntry, IImageVariableEntry } from './chatVariableEntries.js';
import { ChatAgentLocation, ChatConfiguration } from './constants.js';
import { ILanguageModelToolsService, ToolDataSource } from './languageModelToolsService.js';
import { IChenilleChatProvider, IChenilleChatMessage } from '../../../../chenille/common/chatProvider.js';
import { TokenUsage, AiMessageContent } from '../../../../chenille/common/types.js';
import { ChatToolInvocation } from './chatProgressTypes/chatToolInvocation.js';

const serializedChatKey = 'interactive.sessions';

const TransferredGlobalChatKey = 'chat.workspaceTransfer';

const SESSION_TRANSFER_EXPIRATION_IN_MILLISECONDS = 1000 * 60;

/** 上下文收拢阈值（80%） */
const CONTEXT_COLLAPSE_THRESHOLD = 0.8;

/**
 * 会话 token 统计
 */
interface ISessionTokenStats {
	/** 累计总 token */
	totalTokens: number;
	/** 上下文大小限制 */
	contextSize: number;
}

class CancellableRequest implements IDisposable {
	constructor(
		public readonly cancellationTokenSource: CancellationTokenSource,
		public requestId: string | undefined,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService
	) { }

	dispose() {
		this.cancellationTokenSource.dispose();
	}

	cancel() {
		if (this.requestId) {
			this.toolsService.cancelToolCallsForRequest(this.requestId);
		}

		this.cancellationTokenSource.cancel();
	}
}

export class ChatService extends Disposable implements IChatService {
	declare _serviceBrand: undefined;

	private readonly _sessionModels: ChatModelStore;
	private readonly _pendingRequests = this._register(new DisposableResourceMap<CancellableRequest>());
	private _persistedSessions: ISerializableChatsData;
	private _saveModelsEnabled = true;

	/** 会话 token 统计 */
	private readonly _sessionTokenStats = new Map<string, ISessionTokenStats>();

	/** 上下文收拢警告事件 */
	private readonly _onContextCollapseWarning = this._register(new Emitter<{ sessionId: string; usagePercent: number }>());
	readonly onContextCollapseWarning = this._onContextCollapseWarning.event;

	private _transferredSessionData: IChatTransferredSessionData | undefined;
	public get transferredSessionData(): IChatTransferredSessionData | undefined {
		return this._transferredSessionData;
	}

	private readonly _onDidSubmitRequest = this._register(new Emitter<{ readonly chatSessionResource: URI }>());
	public readonly onDidSubmitRequest = this._onDidSubmitRequest.event;

	private readonly _onDidPerformUserAction = this._register(new Emitter<IChatUserActionEvent>());
	public readonly onDidPerformUserAction: Event<IChatUserActionEvent> = this._onDidPerformUserAction.event;

	private readonly _onDidDisposeSession = this._register(new Emitter<{ readonly sessionResource: URI; reason: 'cleared' }>());
	public readonly onDidDisposeSession = this._onDidDisposeSession.event;

	private readonly _chatServiceTelemetry: ChatServiceTelemetry;
	private readonly _chatSessionStore: ChatSessionStore;

	readonly requestInProgressObs: IObservable<boolean>;

	readonly chatModels: IObservable<Iterable<IChatModel>>;

	/**
	 * For test use only
	 */
	setSaveModelsEnabled(enabled: boolean): void {
		this._saveModelsEnabled = enabled;
	}

	/**
	 * For test use only
	 */
	waitForModelDisposals(): Promise<void> {
		return this._sessionModels.waitForModelDisposals();
	}

	public get edits2Enabled(): boolean {
		return this.configurationService.getValue(ChatConfiguration.Edits2Enabled);
	}

	private get isEmptyWindow(): boolean {
		const workspace = this.workspaceContextService.getWorkspace();
		return !workspace.configuration && workspace.folders.length === 0;
	}

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IChatSlashCommandService _chatSlashCommandService: IChatSlashCommandService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IChatTransferService private readonly chatTransferService: IChatTransferService,
		@IChatSessionsService private readonly chatSessionService: IChatSessionsService,
		@IMcpService _mcpService: IMcpService,
		@IChenilleChatProvider private readonly chenilleChatProvider: IChenilleChatProvider,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		this._sessionModels = this._register(instantiationService.createInstance(ChatModelStore, {
			createModel: (props: IStartSessionProps) => this._startSession(props),
			willDisposeModel: async (model: ChatModel) => {
				const localSessionId = LocalChatSessionUri.parseLocalSessionId(model.sessionResource);
				if (localSessionId && this.shouldStoreSession(model)) {
					// Always preserve sessions that have custom titles, even if empty
					if (model.getRequests().length === 0 && !model.customTitle) {
						await this._chatSessionStore.deleteSession(localSessionId);
					} else if (this._saveModelsEnabled) {
						await this._chatSessionStore.storeSessions([model]);
					}
				} else if (!localSessionId && model.getRequests().length > 0) {
					await this._chatSessionStore.storeSessionsMetadataOnly([model]);
				}
			}
		}));
		this._register(this._sessionModels.onDidDisposeModel(model => {
			this._onDidDisposeSession.fire({ sessionResource: model.sessionResource, reason: 'cleared' });
			// 清理 token 统计
			this.clearSessionTokenStats(model.sessionId);
		}));

		this._chatServiceTelemetry = this.instantiationService.createInstance(ChatServiceTelemetry);

		const sessionData = storageService.get(serializedChatKey, this.isEmptyWindow ? StorageScope.APPLICATION : StorageScope.WORKSPACE, '');
		if (sessionData) {
			this._persistedSessions = this.deserializeChats(sessionData);
			const countsForLog = Object.keys(this._persistedSessions).length;
			if (countsForLog > 0) {
				this.trace('constructor', `Restored ${countsForLog} persisted sessions`);
			}
		} else {
			this._persistedSessions = {};
		}

		const transferredData = this.getTransferredSessionData();
		const transferredChat = transferredData?.chat;
		if (transferredChat) {
			this.trace('constructor', `Transferred session ${transferredChat.sessionId}`);
			this._persistedSessions[transferredChat.sessionId] = transferredChat;
			this._transferredSessionData = {
				sessionId: transferredChat.sessionId,
				location: transferredData.location,
				inputState: transferredData.inputState
			};
		}

		this._chatSessionStore = this._register(this.instantiationService.createInstance(ChatSessionStore));
		this._chatSessionStore.migrateDataIfNeeded(() => this._persistedSessions);

		// When using file storage, populate _persistedSessions with session metadata from the index
		// This ensures that getPersistedSessionTitle() can find titles for inactive sessions
		this.initializePersistedSessionsFromFileStorage().then(() => {
			this.reviveSessionsWithEdits();
		});

		this._register(storageService.onWillSaveState(() => this.saveState()));

		this.chatModels = derived(this, reader => [...this._sessionModels.observable.read(reader).values()]);

		this.requestInProgressObs = derived(reader => {
			const models = this._sessionModels.observable.read(reader).values();
			return Iterable.some(models, model => model.requestInProgress.read(reader));
		});
	}

	public get editingSessions() {
		return [...this._sessionModels.values()].map(v => v.editingSession).filter(isDefined);
	}

	isEnabled(location: ChatAgentLocation): boolean {
		return this.chatAgentService.getContributedDefaultAgent(location) !== undefined;
	}

	private saveState(): void {
		if (!this._saveModelsEnabled) {
			return;
		}

		const liveLocalChats = Array.from(this._sessionModels.values())
			.filter(session => this.shouldStoreSession(session));

		this._chatSessionStore.storeSessions(liveLocalChats);

		const liveNonLocalChats = Array.from(this._sessionModels.values())
			.filter(session => !LocalChatSessionUri.parseLocalSessionId(session.sessionResource));
		this._chatSessionStore.storeSessionsMetadataOnly(liveNonLocalChats);
	}

	/**
	 * Only persist local sessions from chat that are not imported.
	 */
	private shouldStoreSession(session: ChatModel): boolean {
		if (!LocalChatSessionUri.parseLocalSessionId(session.sessionResource)) {
			return false;
		}
		return session.initialLocation === ChatAgentLocation.Chat && !session.isImported;
	}

	notifyUserAction(action: IChatUserActionEvent): void {
		this._chatServiceTelemetry.notifyUserAction(action);
		this._onDidPerformUserAction.fire(action);
		if (action.action.kind === 'chatEditingSessionAction') {
			const model = this._sessionModels.get(action.sessionResource);
			if (model) {
				model.notifyEditingAction(action.action);
			}
		}
	}

	async setChatSessionTitle(sessionResource: URI, title: string): Promise<void> {
		const model = this._sessionModels.get(sessionResource);
		if (model) {
			model.setCustomTitle(title);
		}

		// Update the title in the file storage
		const localSessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (localSessionId) {
			await this._chatSessionStore.setSessionTitle(localSessionId, title);
			// Trigger immediate save to ensure consistency
			this.saveState();
		}
	}

	private trace(method: string, message?: string): void {
		if (message) {
			this.logService.trace(`ChatService#${method}: ${message}`);
		} else {
			this.logService.trace(`ChatService#${method}`);
		}
	}

	private error(method: string, message: string): void {
		this.logService.error(`ChatService#${method} ${message}`);
	}

	private deserializeChats(sessionData: string): ISerializableChatsData {
		try {
			const arrayOfSessions: ISerializableChatDataIn[] = revive(JSON.parse(sessionData)); // Revive serialized URIs in session data
			if (!Array.isArray(arrayOfSessions)) {
				throw new Error('Expected array');
			}

			const sessions = arrayOfSessions.reduce<ISerializableChatsData>((acc, session) => {
				// Revive serialized markdown strings in response data
				for (const request of session.requests) {
					if (Array.isArray(request.response)) {
						request.response = request.response.map((response) => {
							if (typeof response === 'string') {
								return new MarkdownString(response);
							}
							return response;
						});
					} else if (typeof request.response === 'string') {
						request.response = [new MarkdownString(request.response)];
					}
				}

				acc[session.sessionId] = normalizeSerializableChatData(session);
				return acc;
			}, {});
			return sessions;
		} catch (err) {
			this.error('deserializeChats', `Malformed session data: ${err}. [${sessionData.substring(0, 20)}${sessionData.length > 20 ? '...' : ''}]`);
			return {};
		}
	}

	private getTransferredSessionData(): IChatTransfer2 | undefined {
		const data: IChatTransfer2[] = this.storageService.getObject(TransferredGlobalChatKey, StorageScope.PROFILE, []);
		const workspaceUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceUri) {
			return;
		}

		const thisWorkspace = workspaceUri.toString();
		const currentTime = Date.now();
		// Only use transferred data if it was created recently
		const transferred = data.find(item => URI.revive(item.toWorkspace).toString() === thisWorkspace && (currentTime - item.timestampInMilliseconds < SESSION_TRANSFER_EXPIRATION_IN_MILLISECONDS));
		// Keep data that isn't for the current workspace and that hasn't expired yet
		const filtered = data.filter(item => URI.revive(item.toWorkspace).toString() !== thisWorkspace && (currentTime - item.timestampInMilliseconds < SESSION_TRANSFER_EXPIRATION_IN_MILLISECONDS));
		this.storageService.store(TransferredGlobalChatKey, JSON.stringify(filtered), StorageScope.PROFILE, StorageTarget.MACHINE);
		return transferred;
	}

	/**
	 * todo@connor4312 This will be cleaned up with the globalization of edits.
	 */
	private async reviveSessionsWithEdits(): Promise<void> {
		await Promise.all(Object.values(this._persistedSessions).map(async session => {
			if (!session.hasPendingEdits) {
				return;
			}

			const sessionResource = LocalChatSessionUri.forSession(session.sessionId);
			const sessionRef = await this.getOrRestoreSession(sessionResource);
			if (sessionRef?.object.editingSession) {
				await chatEditingSessionIsReady(sessionRef.object.editingSession);
				// the session will hold a self-reference as long as there are modified files
				sessionRef.dispose();
			}
		}));
	}

	private async initializePersistedSessionsFromFileStorage(): Promise<void> {

		const index = await this._chatSessionStore.getIndex();
		const sessionIds = Object.keys(index);

		for (const sessionId of sessionIds) {
			const metadata = index[sessionId];
			if (metadata && !this._persistedSessions[sessionId]) {
				// Create a minimal session entry with the title information
				// This allows getPersistedSessionTitle() to find the title without loading the full session
				const minimalSession: ISerializableChatData = {
					version: 3,
					sessionId: sessionId,
					customTitle: metadata.title,
					creationDate: Date.now(), // Use current time as fallback
					lastMessageDate: metadata.lastMessageDate,
					initialLocation: metadata.initialLocation,
					requests: [], // Empty requests array - this is just for title lookup
					responderUsername: '',
					responderAvatarIconUri: undefined,
					hasPendingEdits: metadata.hasPendingEdits,
				};

				this._persistedSessions[sessionId] = minimalSession;
			}
		}
	}

	/**
	 * Returns an array of chat details for all persisted chat sessions that have at least one request.
	 * Chat sessions that have already been loaded into the chat view are excluded from the result.
	 * Imported chat sessions are also excluded from the result.
	 * TODO this is only used by the old "show chats" command which can be removed when the pre-agents view
	 * options are removed.
	 */
	async getLocalSessionHistory(): Promise<IChatDetail[]> {
		const liveSessionItems = await this.getLiveSessionItems();
		const historySessionItems = await this.getHistorySessionItems();

		return [...liveSessionItems, ...historySessionItems];
	}

	/**
	 * Returns an array of chat details for all local live chat sessions.
	 */
	async getLiveSessionItems(): Promise<IChatDetail[]> {
		return await Promise.all(Array.from(this._sessionModels.values())
			.filter(session => this.shouldBeInHistory(session))
			.map(async (session): Promise<IChatDetail> => {
				const title = session.title || localize('newChat', "新聊天");
				return {
					sessionResource: session.sessionResource,
					title,
					lastMessageDate: session.lastMessageDate,
					timing: session.timing,
					isActive: true,
					stats: await awaitStatsForSession(session),
					lastResponseState: session.lastRequest?.response?.state ?? ResponseModelState.Pending,
				};
			}));
	}

	/**
	 * Returns an array of chat details for all local chat sessions in history (not currently loaded).
	 */
	async getHistorySessionItems(): Promise<IChatDetail[]> {
		const index = await this._chatSessionStore.getIndex();
		return Object.values(index)
			.filter(entry => !entry.isExternal)
			.filter(entry => !this._sessionModels.has(LocalChatSessionUri.forSession(entry.sessionId)) && entry.initialLocation === ChatAgentLocation.Chat && !entry.isEmpty)
			.map((entry): IChatDetail => {
				const sessionResource = LocalChatSessionUri.forSession(entry.sessionId);
				return ({
					...entry,
					sessionResource,
					// TODO@roblourens- missing for old data- normalize inside the store
					timing: entry.timing ?? { startTime: entry.lastMessageDate },
					isActive: this._sessionModels.has(sessionResource),
					// TODO@roblourens- missing for old data- normalize inside the store
					lastResponseState: entry.lastResponseState ?? ResponseModelState.Complete,
				});
			});
	}

	async getMetadataForSession(sessionResource: URI): Promise<IChatDetail | undefined> {
		const index = await this._chatSessionStore.getIndex();
		const metadata: IChatSessionEntryMetadata | undefined = index[sessionResource.toString()];
		if (metadata) {
			return {
				...metadata,
				sessionResource,
				// TODO@roblourens- missing for old data- normalize inside the store
				timing: metadata.timing ?? { startTime: metadata.lastMessageDate },
				isActive: this._sessionModels.has(sessionResource),
				// TODO@roblourens- missing for old data- normalize inside the store
				lastResponseState: metadata.lastResponseState ?? ResponseModelState.Complete,
			};
		}

		return undefined;
	}

	private shouldBeInHistory(entry: ChatModel): boolean {
		return !entry.isImported && !!LocalChatSessionUri.parseLocalSessionId(entry.sessionResource) && entry.initialLocation === ChatAgentLocation.Chat;
	}

	async removeHistoryEntry(sessionResource: URI): Promise<void> {
		await this._chatSessionStore.deleteSession(this.toLocalSessionId(sessionResource));
	}

	async clearAllHistoryEntries(): Promise<void> {
		await this._chatSessionStore.clearAllSessions();
	}

	startSession(location: ChatAgentLocation, options?: IChatSessionStartOptions): IChatModelReference {
		this.trace('startSession');
		const sessionId = generateUuid();
		const sessionResource = LocalChatSessionUri.forSession(sessionId);
		return this._sessionModels.acquireOrCreate({
			initialData: undefined,
			location,
			sessionResource,
			sessionId,
			canUseTools: options?.canUseTools ?? true,
			disableBackgroundKeepAlive: options?.disableBackgroundKeepAlive
		});
	}

	private _startSession(props: IStartSessionProps): ChatModel {
		const { initialData, location, sessionResource, sessionId, canUseTools, transferEditingSession, disableBackgroundKeepAlive, inputState } = props;
		const model = this.instantiationService.createInstance(ChatModel, initialData, { initialLocation: location, canUseTools, resource: sessionResource, sessionId, disableBackgroundKeepAlive, inputState });
		if (location === ChatAgentLocation.Chat) {
			model.startEditingSession(true, transferEditingSession);
		}

		this.initializeSession(model);
		return model;
	}

	private initializeSession(model: ChatModel): void {
		this.trace('initializeSession', `Initialize session ${model.sessionResource}`);

		// Activate the default extension provided agent but do not wait
		// for it to be ready so that the session can be used immediately
		// without having to wait for the agent to be ready.
		this.activateDefaultAgent(model.initialLocation).catch(e => this.logService.error(e));
	}

	async activateDefaultAgent(location: ChatAgentLocation): Promise<void> {
		await this.extensionService.whenInstalledExtensionsRegistered();

		const defaultAgentData = this.chatAgentService.getContributedDefaultAgent(location) ?? this.chatAgentService.getContributedDefaultAgent(ChatAgentLocation.Chat);
		if (!defaultAgentData) {
			throw new ErrorNoTelemetry('No default agent contributed');
		}

		// Await activation of the extension provided agent
		// Using `activateById` as workaround for the issue
		// https://github.com/microsoft/vscode/issues/250590
		if (!defaultAgentData.isCore) {
			await this.extensionService.activateById(defaultAgentData.extensionId, {
				activationEvent: `onChatParticipant:${defaultAgentData.id}`,
				extensionId: defaultAgentData.extensionId,
				startup: false
			});
		}

		const defaultAgent = this.chatAgentService.getActivatedAgents().find(agent => agent.id === defaultAgentData.id);
		if (!defaultAgent) {
			throw new ErrorNoTelemetry('No default agent registered');
		}
	}

	getSession(sessionResource: URI): IChatModel | undefined {
		return this._sessionModels.get(sessionResource);
	}

	getActiveSessionReference(sessionResource: URI): IChatModelReference | undefined {
		return this._sessionModels.acquireExisting(sessionResource);
	}

	async getOrRestoreSession(sessionResource: URI): Promise<IChatModelReference | undefined> {
		this.trace('getOrRestoreSession', `${sessionResource}`);
		const existingRef = this._sessionModels.acquireExisting(sessionResource);
		if (existingRef) {
			return existingRef;
		}

		const sessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (!sessionId) {
			throw new Error(`Cannot restore non-local session ${sessionResource}`);
		}

		let sessionData: ISerializableChatData | undefined;
		if (this.transferredSessionData?.sessionId === sessionId) {
			sessionData = revive(this._persistedSessions[sessionId]);
		} else {
			sessionData = revive(await this._chatSessionStore.readSession(sessionId));
		}

		if (!sessionData) {
			return undefined;
		}

		const sessionRef = this._sessionModels.acquireOrCreate({
			initialData: sessionData,
			location: sessionData.initialLocation ?? ChatAgentLocation.Chat,
			sessionResource,
			sessionId,
			canUseTools: true,
		});

		const isTransferred = this.transferredSessionData?.sessionId === sessionId;
		if (isTransferred) {
			this._transferredSessionData = undefined;
		}

		return sessionRef;
	}

	/**
	 * This is really just for migrating data from the edit session location to the panel.
	 */
	isPersistedSessionEmpty(sessionResource: URI): boolean {
		const sessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (!sessionId) {
			throw new Error(`Cannot restore non-local session ${sessionResource}`);
		}

		const session = this._persistedSessions[sessionId];
		if (session) {
			return session.requests.length === 0;
		}

		return this._chatSessionStore.isSessionEmpty(sessionId);
	}

	getPersistedSessionTitle(sessionResource: URI): string | undefined {
		const sessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (!sessionId) {
			return undefined;
		}

		// First check the memory cache (_persistedSessions)
		const session = this._persistedSessions[sessionId];
		if (session) {
			const title = session.customTitle || ChatModel.getDefaultTitle(session.requests);
			return title;
		}

		// Try to read directly from file storage index
		// This handles the case where getName() is called before initialization completes
		// Access the internal synchronous index method via reflection
		// This is a workaround for the timing issue where initialization hasn't completed
		// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
		const internalGetIndex = (this._chatSessionStore as any).internalGetIndex;
		if (typeof internalGetIndex === 'function') {
			const indexData = internalGetIndex.call(this._chatSessionStore);
			const metadata = indexData.entries[sessionId];
			if (metadata && metadata.title) {
				return metadata.title;
			}
		}

		return undefined;
	}

	loadSessionFromContent(data: IExportableChatData | ISerializableChatData): IChatModelReference | undefined {
		const sessionId = 'sessionId' in data && data.sessionId ? data.sessionId : generateUuid();
		const sessionResource = LocalChatSessionUri.forSession(sessionId);
		return this._sessionModels.acquireOrCreate({
			initialData: data,
			location: data.initialLocation ?? ChatAgentLocation.Chat,
			sessionResource,
			sessionId,
			canUseTools: true,
		});
	}

	async loadSessionForResource(chatSessionResource: URI, location: ChatAgentLocation, token: CancellationToken): Promise<IChatModelReference | undefined> {
		// TODO: Move this into a new ChatModelService

		if (chatSessionResource.scheme === Schemas.vscodeLocalChatSession) {
			return this.getOrRestoreSession(chatSessionResource);
		}

		const existingRef = this._sessionModels.acquireExisting(chatSessionResource);
		if (existingRef) {
			return existingRef;
		}

		const providedSession = await this.chatSessionService.getOrCreateChatSession(chatSessionResource, CancellationToken.None);
		const chatSessionType = chatSessionResource.scheme;

		// Contributed sessions do not use UI tools
		const modelRef = this._sessionModels.acquireOrCreate({
			initialData: undefined,
			location,
			sessionResource: chatSessionResource,
			canUseTools: false,
			transferEditingSession: providedSession.transferredState?.editingSession,
			inputState: providedSession.transferredState?.inputState,
		});

		modelRef.object.setContributedChatSession({
			chatSessionResource,
			chatSessionType,
			isUntitled: chatSessionResource.path.startsWith('/untitled-')  //TODO(jospicer)
		});

		const model = modelRef.object;
		const disposables = new DisposableStore();
		disposables.add(modelRef.object.onDidDispose(() => {
			disposables.dispose();
			providedSession.dispose();
		}));

		let lastRequest: ChatRequestModel | undefined;
		for (const message of providedSession.history) {
			if (message.type === 'request') {
				if (lastRequest) {
					lastRequest.response?.completeResponseIfNeeded();
				}

				const requestText = message.prompt;

				const parsedRequest: IParsedChatRequest = {
					text: requestText,
					parts: [new ChatRequestTextPart(
						new OffsetRange(0, requestText.length),
						{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: requestText.length + 1 },
						requestText
					)]
				};
				const agent =
					message.participant
						? this.chatAgentService.getAgent(message.participant) // TODO(jospicer): Remove and always hardcode?
						: this.chatAgentService.getAgent(chatSessionType);
				lastRequest = model.addRequest(parsedRequest,
					message.variableData ?? { variables: [] },
					0, // attempt
					undefined,
					agent,
					undefined, // slashCommand
					undefined, // confirmation
					undefined, // locationData
					undefined, // attachments
					false, // Do not treat as requests completed, else edit pills won't show.
					undefined,
					undefined,
					message.id
				);
			} else {
				// response
				if (lastRequest) {
					for (const part of message.parts) {
						model.acceptResponseProgress(lastRequest, part);
					}
				}
			}
		}

		if (providedSession.isCompleteObs?.get()) {
			lastRequest?.response?.completeResponseIfNeeded();
		}

		if (providedSession.progressObs && lastRequest && providedSession.interruptActiveResponseCallback) {
			const initialCancellationRequest = this.instantiationService.createInstance(CancellableRequest, new CancellationTokenSource(), undefined);
			this._pendingRequests.set(model.sessionResource, initialCancellationRequest);
			const cancellationListener = disposables.add(new MutableDisposable());

			const createCancellationListener = (token: CancellationToken) => {
				return token.onCancellationRequested(() => {
					providedSession.interruptActiveResponseCallback?.().then(userConfirmedInterruption => {
						if (!userConfirmedInterruption) {
							// User cancelled the interruption
							const newCancellationRequest = this.instantiationService.createInstance(CancellableRequest, new CancellationTokenSource(), undefined);
							this._pendingRequests.set(model.sessionResource, newCancellationRequest);
							cancellationListener.value = createCancellationListener(newCancellationRequest.cancellationTokenSource.token);
						}
					});
				});
			};

			cancellationListener.value = createCancellationListener(initialCancellationRequest.cancellationTokenSource.token);

			let lastProgressLength = 0;
			disposables.add(autorun(reader => {
				const progressArray = providedSession.progressObs?.read(reader) ?? [];
				const isComplete = providedSession.isCompleteObs?.read(reader) ?? false;

				// Process only new progress items
				if (progressArray.length > lastProgressLength && lastRequest) {
					const newProgress = progressArray.slice(lastProgressLength);
					for (const progress of newProgress) {
						model?.acceptResponseProgress(lastRequest, progress);
					}
					lastProgressLength = progressArray.length;
				}

				// Handle completion
				if (isComplete && lastRequest) {
					lastRequest.response?.completeResponseIfNeeded();
					cancellationListener.clear();
				}
			}));
		} else {
			if (lastRequest && model.editingSession) {
				// wait for timeline to load so that a 'changes' part is added when the response completes
				await chatEditingSessionIsReady(model.editingSession);
				lastRequest.response?.completeResponseIfNeeded();
			}
		}

		return modelRef;
	}

	getChatSessionFromInternalUri(sessionResource: URI): IChatSessionContext | undefined {
		const model = this._sessionModels.get(sessionResource);
		if (!model) {
			return;
		}
		const { contributedChatSession } = model;
		return contributedChatSession;
	}

	async resendRequest(request: IChatRequestModel, options?: IChatSendRequestOptions): Promise<void> {
		const model = this._sessionModels.get(request.session.sessionResource);
		if (!model && model !== request.session) {
			throw new Error(`Unknown session: ${request.session.sessionResource}`);
		}

		const cts = this._pendingRequests.get(request.session.sessionResource);
		if (cts) {
			this.trace('resendRequest', `Session ${request.session.sessionResource} already has a pending request, cancelling...`);
			cts.cancel();
		}

		const location = options?.location ?? model.initialLocation;
		const attempt = options?.attempt ?? 0;
		const enableCommandDetection = !options?.noCommandDetection;
		const defaultAgent = this.chatAgentService.getDefaultAgent(location, options?.modeInfo?.kind)!;

		model.removeRequest(request.id, ChatRequestRemovalReason.Resend);

		const resendOptions: IChatSendRequestOptions = {
			...options,
			locationData: request.locationData,
			attachedContext: request.attachedContext,
		};
		await this._sendRequestAsync(model, model.sessionResource, request.message, attempt, enableCommandDetection, defaultAgent, location, resendOptions).responseCompletePromise;
	}

	async sendRequest(sessionResource: URI, request: string, options?: IChatSendRequestOptions): Promise<IChatSendRequestData | undefined> {
		this.trace('sendRequest', `sessionResource: ${sessionResource.toString()}, message: ${request.substring(0, 20)}${request.length > 20 ? '[...]' : ''}}`);


		if (!request.trim() && !options?.slashCommand && !options?.agentId && !options?.agentIdSilent) {
			this.trace('sendRequest', 'Rejected empty message');
			return;
		}

		const model = this._sessionModels.get(sessionResource);
		if (!model) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}

		if (this._pendingRequests.has(sessionResource)) {
			this.trace('sendRequest', `Session ${sessionResource} already has a pending request`);
			return;
		}

		const requests = model.getRequests();
		for (let i = requests.length - 1; i >= 0; i -= 1) {
			const request = requests[i];
			if (request.shouldBeRemovedOnSend) {
				if (request.shouldBeRemovedOnSend.afterUndoStop) {
					request.response?.finalizeUndoState();
				} else {
					await this.removeRequest(sessionResource, request.id);
				}
			}
		}

		const location = options?.location ?? model.initialLocation;
		const attempt = options?.attempt ?? 0;
		const defaultAgent = this.chatAgentService.getDefaultAgent(location, options?.modeInfo?.kind)!;

		const parsedRequest = this.parseChatRequest(sessionResource, request, location, options);
		const silentAgent = options?.agentIdSilent ? this.chatAgentService.getAgent(options.agentIdSilent) : undefined;
		const agent = silentAgent ?? parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart)?.agent ?? defaultAgent;
		const agentSlashCommandPart = parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);

		// This method is only returning whether the request was accepted - don't block on the actual request
		return {
			...this._sendRequestAsync(model, sessionResource, parsedRequest, attempt, !options?.noCommandDetection, silentAgent ?? defaultAgent, location, options),
			agent,
			slashCommand: agentSlashCommandPart?.command,
		};
	}

	private parseChatRequest(sessionResource: URI, request: string, location: ChatAgentLocation, options: IChatSendRequestOptions | undefined): IParsedChatRequest {
		let parserContext = options?.parserContext;
		if (options?.agentId) {
			const agent = this.chatAgentService.getAgent(options.agentId);
			if (!agent) {
				throw new Error(`Unknown agent: ${options.agentId}`);
			}
			parserContext = { selectedAgent: agent, mode: options.modeInfo?.kind };
			const commandPart = options.slashCommand ? ` ${chatSubcommandLeader}${options.slashCommand}` : '';
			request = `${chatAgentLeader}${agent.name}${commandPart} ${request}`;
		}

		const parsedRequest = this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(sessionResource, request, location, parserContext);
		return parsedRequest;
	}

	private _sendRequestAsync(model: ChatModel, sessionResource: URI, parsedRequest: IParsedChatRequest, attempt: number, enableCommandDetection: boolean, defaultAgent: IChatAgentData, location: ChatAgentLocation, options?: IChatSendRequestOptions): IChatSendRequestResponseState {
		let request: ChatRequestModel;
		const agentPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart);
		const agentSlashCommandPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);
		const commandPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestSlashCommandPart => r instanceof ChatRequestSlashCommandPart);
		const requests = [...model.getRequests()];
		const requestTelemetry = this.instantiationService.createInstance(ChatRequestTelemetry, {
			agent: agentPart?.agent ?? defaultAgent,
			agentSlashCommandPart,
			commandPart,
			sessionId: model.sessionId,
			location: model.initialLocation,
			options,
			enableCommandDetection
		});

		let gotProgress = false;
		const requestType = commandPart ? 'slashCommand' : 'string';

		const responseCreated = new DeferredPromise<IChatResponseModel>();
		let responseCreatedComplete = false;
		function completeResponseCreated(): void {
			if (!responseCreatedComplete && request?.response) {
				responseCreated.complete(request.response);
				responseCreatedComplete = true;
			}
		}

		const store = new DisposableStore();
		const source = store.add(new CancellationTokenSource());
		const token = source.token;

		const sendRequestInternal = async () => {
			const progressCallback = (progress: IChatProgress[]) => {
				if (token.isCancellationRequested) {
					return;
				}

				gotProgress = true;

				for (let i = 0; i < progress.length; i++) {
					const isLast = i === progress.length - 1;
					const progressItem = progress[i];

					if (progressItem.kind === 'markdownContent') {
						this.trace('sendRequest', `Chenille returned progress for session ${model.sessionResource}, ${progressItem.content.value.length} chars`);
					} else {
						this.trace('sendRequest', `Chenille returned progress: ${JSON.stringify(progressItem)}`);
					}

					model.acceptResponseProgress(request, progressItem, !isLast);
				}
				completeResponseCreated();
			};

			const stopWatch = new StopWatch(false);
			store.add(token.onCancellationRequested(() => {
				this.trace('sendRequest', `Request for session ${model.sessionResource} was cancelled`);
				if (!request) {
					return;
				}

				requestTelemetry.complete({
					timeToFirstProgress: undefined,
					result: 'cancelled',
					totalTime: stopWatch.elapsed(),
					requestType,
					detectedAgent: undefined,
					request,
				});

				model.cancelRequest(request);
				this.chenilleChatProvider.cancel();
			}));

			try {
				// Chenille: 检查配置
				const isConfigured = await this.chenilleChatProvider.isConfigured();
				if (!isConfigured) {
					this.chenilleChatProvider.promptConfiguration();
					const configError = await this.chenilleChatProvider.getConfigurationError();
					throw new Error(configError ?? localize('chenille.notConfigured', "Chenille 智能体未配置"));
				}

				// 初始化会话 token 统计
				await this.initSessionTokenStats(model.sessionId);

				// 创建请求
				const agent = agentPart?.agent ?? defaultAgent;
				const command = agentSlashCommandPart?.command;
				const initVariableData: IChatRequestVariableData = { variables: [] };
				request = model.addRequest(parsedRequest, initVariableData, attempt, options?.modeInfo, agent, command, options?.confirmation, options?.locationData, options?.attachedContext, undefined, options?.userSelectedModelId, options?.userSelectedTools?.get());

				// 准备变量数据
				const variableData: IChatRequestVariableData = { variables: this.prepareContext(request.attachedContext) };
				model.updateRequest(request, variableData);

				const promptTextResult = getPromptText(request.message);
				const message = promptTextResult.message;

				// 更新 pending request
				const pendingRequest = this._pendingRequests.get(sessionResource);
				if (pendingRequest && !pendingRequest.requestId) {
					pendingRequest.requestId = request.id;
				}
				completeResponseCreated();

				// 构建历史消息
				const history: IChenilleChatMessage[] = [];
				for (const modelRequest of requests) {
					if (!modelRequest.response) {
						continue;
					}
					history.push({
						role: 'user',
						content: modelRequest.message.text
					});
					history.push({
						role: 'assistant',
						content: modelRequest.response.response.toString()
					});
				}

				// 构建当前消息（包含附件内容）
				let currentMessage = message;
				let multiContent: AiMessageContent[] | undefined;

				if (request.attachedContext && request.attachedContext.length > 0) {
					const attachmentContents: string[] = [];
					const imageContents: AiMessageContent[] = [];

					for (const attachment of request.attachedContext) {
						// 检查是否为图片附件
						if (isImageVariableEntry(attachment)) {
							const imageData = this.extractImageData(attachment);
							if (imageData) {
								imageContents.push(imageData);
							}
						} else {
							const attachmentContent = await this.formatAttachmentForAI(attachment);
							if (attachmentContent) {
								attachmentContents.push(attachmentContent);
							}
						}
					}

					// 如果有图片，构建 multiContent
					if (imageContents.length > 0) {
						// 先添加文本内容
						let textContent = message;
						if (attachmentContents.length > 0) {
							textContent = `${attachmentContents.join('\n\n')}\n\n用户问题：${message}`;
						}
						multiContent = [
							{ type: 'text', text: textContent },
							...imageContents
						];
					} else if (attachmentContents.length > 0) {
						currentMessage = `${attachmentContents.join('\n\n')}\n\n用户问题：${message}`;
					}
				}

				// 监听 Chenille 响应流
				// 使用统一的 MarkdownString 选项，确保 canMergeMarkdownStrings 返回 true
				const markdownOptions = { isTrusted: false, supportThemeIcons: true, supportHtml: false };

				// 用于累积推理内容，避免多次发送 thinking
				let accumulatedReasoning = '';

				const chunkDisposable = this.chenilleChatProvider.onResponseChunk(chunk => {
					if (token.isCancellationRequested) {
						return;
					}

					// 收集所有要发送的进度项，然后一次性发送
					const progressItems: IChatProgress[] = [];

					// 文本内容
					if (chunk.content) {
						progressItems.push({
							kind: 'markdownContent',
							content: new MarkdownString(chunk.content, markdownOptions)
						});
					}

					// 推理内容 - 累积后发送，避免多次创建 thinking 块
					if (chunk.reasoning) {
						accumulatedReasoning += chunk.reasoning;
						// 只在有内容时发送，thinking 类型会自动合并相邻的内容
						progressItems.push({
							kind: 'thinking',
							value: chunk.reasoning
						});
					}

					// 工具调用 - 使用 progressMessage 类型
					if (chunk.toolCall) {
						const { name, status } = chunk.toolCall;
						if (status === 'calling') {
							progressItems.push({
								kind: 'progressMessage',
								content: new MarkdownString(`正在调用工具: \`${name}\``, markdownOptions)
							});
						} else {
							const statusText = status === 'success' ? '执行成功' : '执行失败';
							progressItems.push({
								kind: 'progressMessage',
								content: new MarkdownString(`工具 \`${name}\` ${statusText}`, markdownOptions)
							});
						}
					}

					// 工具确认请求 - 创建 ChatToolInvocation 显示确认 UI
					if (chunk.toolConfirmation) {
						const { toolCallId, toolName, message, resolve } = chunk.toolConfirmation;

						// 创建简化的 toolData
						const toolData = {
							id: `chenille.${toolName}`,
							source: ToolDataSource.Internal,
							displayName: toolName,
							modelDescription: '',
						};

						// 创建带确认消息的 preparedInvocation
						const preparedInvocation = {
							invocationMessage: new MarkdownString(`正在请求执行: \`${toolName}\``, markdownOptions),
							confirmationMessages: {
								title: localize('chenille.toolConfirmation.title', '确认执行'),
								message: new MarkdownString(message, markdownOptions),
							},
						};

						// 创建 ChatToolInvocation 实例
						const toolInvocation = new ChatToolInvocation(
							preparedInvocation,
							toolData,
							toolCallId,
							false, // fromSubAgent
							{} // parameters
						);

						// 发送到 UI
						progressItems.push(toolInvocation);

						// 异步等待用户确认
						IChatToolInvocation.awaitConfirmation(toolInvocation, token).then(confirmedReason => {
							const confirmed = confirmedReason.type !== ToolConfirmKind.Denied && confirmedReason.type !== ToolConfirmKind.Skipped;
							resolve(confirmed);

							// 标记工具执行完成
							if (confirmed) {
								toolInvocation.didExecuteTool(undefined);
							}
						});
					}

					// 文件编辑事件 - 发送 textEdit 到 ChatEditingService 实现 diff 预览
					if (chunk.fileEdit && model.editingSession) {
						const { uri, newContent, originalContent, done } = chunk.fileEdit;

						if (!done) {
							// 发送 textEdit 开始信号
							model.acceptResponseProgress(request, {
								kind: 'textEdit',
								edits: [],
								uri
							});
						} else {
							// 计算行数
							const originalLineCount = originalContent ? originalContent.split('\n').length : 1;
							const lastLineLength = originalContent
								? (originalContent.split('\n').pop()?.length ?? 0) + 1
								: 1;

							// 创建全文替换的 TextEdit
							const textEdit = {
								range: {
									startLineNumber: 1,
									startColumn: 1,
									endLineNumber: originalLineCount,
									endColumn: lastLineLength
								},
								text: newContent
							};

							// 发送编辑
							model.acceptResponseProgress(request, {
								kind: 'textEdit',
								uri,
								edits: [textEdit]
							});

							// 发送 textEdit 结束信号
							model.acceptResponseProgress(request, {
								kind: 'textEdit',
								uri,
								edits: [],
								done: true
							});
						}
					}

					// 错误
					if (chunk.error && !chunk.done) {
						progressItems.push({
							kind: 'warning',
							content: new MarkdownString(chunk.error, markdownOptions)
						});
					}

					// 一次性发送所有进度项
					if (progressItems.length > 0) {
						progressCallback(progressItems);
					}
				});
				store.add(chunkDisposable);

				// 调用 Chenille AI
				const result = await this.chenilleChatProvider.chat({
					input: currentMessage,
					multiContent,
					history,
					enableTools: true,
					sessionContext: {
						sessionResource: model.sessionResource,
						requestId: request.id,
						hasEditingSession: !!model.editingSession,
					},
				}, token);

				// 更新 token 统计
				if (result.usage) {
					this.updateSessionTokenStats(model.sessionId, result.usage);
				}

				// 处理结果
				const rawResult: IChatAgentResult = result.success
					? { timings: { totalElapsed: result.elapsed ?? 0 } }
					: { errorDetails: { message: result.error ?? localize('chenille.unknownError', "未知错误") } };

				const telemetryResult = result.success ? 'success' : (gotProgress ? 'errorWithOutput' : 'error');

				requestTelemetry.complete({
					timeToFirstProgress: undefined,
					totalTime: result.elapsed,
					result: telemetryResult,
					requestType,
					detectedAgent: undefined,
					request,
				});

				model.setResponse(request, rawResult);
				completeResponseCreated();
				this.trace('sendRequest', `Chenille returned response for session ${model.sessionResource}`);

				request.response?.complete();

				// 生成标题（使用第一条消息）
				if (model.getRequests().length === 1 && !model.customTitle && result.success) {
					const title = this.generateChatTitle(message);
					if (title) {
						model.setCustomTitle(title);
					}
				}

			} catch (err) {
				this.logService.error(`Error while handling Chenille chat request: ${toErrorMessage(err, true)}`);
				requestTelemetry.complete({
					timeToFirstProgress: undefined,
					totalTime: undefined,
					result: 'error',
					requestType,
					detectedAgent: undefined,
					request,
				});
				if (request) {
					const rawResult: IChatAgentResult = { errorDetails: { message: err.message } };
					model.setResponse(request, rawResult);
					completeResponseCreated();
					request.response?.complete();
				}
			} finally {
				store.dispose();
			}
		};

		const rawResponsePromise = sendRequestInternal();
		this._pendingRequests.set(model.sessionResource, this.instantiationService.createInstance(CancellableRequest, source, undefined));
		rawResponsePromise.finally(() => {
			this._pendingRequests.deleteAndDispose(model.sessionResource);
		});
		this._onDidSubmitRequest.fire({ chatSessionResource: model.sessionResource });
		return {
			responseCreatedPromise: responseCreated.p,
			responseCompletePromise: rawResponsePromise,
		};
	}

	/**
	 * 生成聊天标题（取用户消息前 30 个字符）
	 */
	private generateChatTitle(message: string): string | undefined {
		if (!message) {
			return undefined;
		}
		const trimmed = message.trim();
		if (trimmed.length <= 30) {
			return trimmed;
		}
		return trimmed.substring(0, 30) + '...';
	}

	private prepareContext(attachedContextVariables: IChatRequestVariableEntry[] | undefined): IChatRequestVariableEntry[] {
		attachedContextVariables ??= [];

		// "reverse", high index first so that replacement is simple
		attachedContextVariables.sort((a, b) => {
			// If either range is undefined, sort it to the back
			if (!a.range && !b.range) {
				return 0; // Keep relative order if both ranges are undefined
			}
			if (!a.range) {
				return 1; // a goes after b
			}
			if (!b.range) {
				return -1; // a goes before b
			}
			return b.range.start - a.range.start;
		});

		return attachedContextVariables;
	}

	/**
	 * 从图片附件中提取 base64 数据
	 */
	private extractImageData(attachment: IImageVariableEntry): AiMessageContent | undefined {
		const { value, mimeType } = attachment;

		// value 是 Uint8Array
		if (value instanceof Uint8Array) {
			// 将 Uint8Array 转换为 base64
			let binary = '';
			const bytes = value;
			const len = bytes.byteLength;
			for (let i = 0; i < len; i++) {
				binary += String.fromCharCode(bytes[i]);
			}
			const base64Data = btoa(binary);

			// 确定 MIME 类型
			const detectedMimeType = mimeType || this.detectImageMimeType(bytes) || 'image/png';

			return {
				type: 'image',
				data: base64Data,
				mimeType: detectedMimeType
			};
		}

		return undefined;
	}

	/**
	 * 检测图片的 MIME 类型
	 */
	private detectImageMimeType(bytes: Uint8Array): string | undefined {
		// PNG: 89 50 4E 47
		if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
			return 'image/png';
		}
		// JPEG: FF D8 FF
		if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
			return 'image/jpeg';
		}
		// GIF: 47 49 46 38
		if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
			return 'image/gif';
		}
		// WebP: 52 49 46 46 ... 57 45 42 50
		if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
			bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
			return 'image/webp';
		}
		return undefined;
	}

	/**
	 * 将附件格式化为 AI 可理解的文本（异步读取文件内容）
	 */
	private async formatAttachmentForAI(attachment: IChatRequestVariableEntry): Promise<string | undefined> {
		const { kind, name, value } = attachment;

		switch (kind) {
			case 'file': {
				// 文件附件 - 尝试读取文件内容
				if (typeof value === 'string') {
					return `<file name="${name}">\n${value}\n</file>`;
				} else if (URI.isUri(value)) {
					try {
						const content = await this.fileService.readFile(value);
						const text = content.value.toString();
						// 限制文件大小，避免发送过大的内容
						const maxLength = 50000;
						const truncated = text.length > maxLength ? text.substring(0, maxLength) + '\n... (内容已截断)' : text;
						return `<file name="${name}" path="${value.fsPath}">\n${truncated}\n</file>`;
					} catch {
						return `<file name="${name}" path="${value.fsPath}">\n（无法读取文件内容，请使用 readFile 工具读取）\n</file>`;
					}
				} else if (value && typeof value === 'object' && 'uri' in value) {
					// Location 类型
					const loc = value as { uri: URI; range?: { startLineNumber: number; endLineNumber: number } };
					try {
						const content = await this.fileService.readFile(loc.uri);
						const text = content.value.toString();
						const lines = text.split('\n');
						// 如果有范围，只取指定行
						if (loc.range) {
							const start = Math.max(0, loc.range.startLineNumber - 1);
							const end = Math.min(lines.length, loc.range.endLineNumber);
							const selectedLines = lines.slice(start, end).join('\n');
							return `<file name="${name}" path="${loc.uri.fsPath}" lines="${loc.range.startLineNumber}-${loc.range.endLineNumber}">\n${selectedLines}\n</file>`;
						}
						const maxLength = 50000;
						const truncated = text.length > maxLength ? text.substring(0, maxLength) + '\n... (内容已截断)' : text;
						return `<file name="${name}" path="${loc.uri.fsPath}">\n${truncated}\n</file>`;
					} catch {
						const rangeInfo = loc.range ? `，行 ${loc.range.startLineNumber}-${loc.range.endLineNumber}` : '';
						return `<file name="${name}" path="${loc.uri.fsPath}">\n（无法读取文件内容${rangeInfo}，请使用 readFile 工具读取）\n</file>`;
					}
				}
				return undefined;
			}

			case 'directory': {
				// 文件夹附件 - 提供路径，AI 可以使用 listDirectory 工具查看内容
				if (URI.isUri(value)) {
					return `<directory name="${name}" path="${value.fsPath}">\n（用户选择了此文件夹，请使用 listDirectory 工具查看内容）\n</directory>`;
				}
				return `<directory name="${name}">\n（用户选择了此文件夹）\n</directory>`;
			}

			case 'symbol': {
				// 符号附件（函数、类等）- 尝试读取符号所在的代码
				if (value && typeof value === 'object' && 'uri' in value) {
					const loc = value as { uri: URI; range?: { startLineNumber: number; endLineNumber: number } };
					try {
						const content = await this.fileService.readFile(loc.uri);
						const text = content.value.toString();
						const lines = text.split('\n');
						if (loc.range) {
							const start = Math.max(0, loc.range.startLineNumber - 1);
							const end = Math.min(lines.length, loc.range.endLineNumber);
							const selectedLines = lines.slice(start, end).join('\n');
							return `<symbol name="${name}" path="${loc.uri.fsPath}" lines="${loc.range.startLineNumber}-${loc.range.endLineNumber}">\n${selectedLines}\n</symbol>`;
						}
					} catch {
						const rangeInfo = loc.range ? `，行 ${loc.range.startLineNumber}-${loc.range.endLineNumber}` : '';
						return `<symbol name="${name}" path="${loc.uri.fsPath}">\n（无法读取符号内容${rangeInfo}，请使用 readFile 工具读取）\n</symbol>`;
					}
				}
				return `<symbol name="${name}" />`;
			}

			case 'paste': {
				// 粘贴的代码
				const pasteEntry = attachment as { code: string; language: string };
				if (pasteEntry.code) {
					return `<code language="${pasteEntry.language || 'text'}">\n${pasteEntry.code}\n</code>`;
				}
				return undefined;
			}

			case 'image': {
				// 图片附件通过 multiContent 处理，这里不需要返回文本
				// 如果走到这里说明是不支持的图片格式
				return undefined;
			}

			case 'implicit': {
				// 隐式上下文（如当前选中的文本）
				if (typeof value === 'string') {
					return `<context name="${name}">\n${value}\n</context>`;
				} else if (value && typeof value === 'object' && 'value' in value) {
					const strValue = value as { value?: string };
					if (strValue.value) {
						return `<context name="${name}">\n${strValue.value}\n</context>`;
					}
				}
				return undefined;
			}

			case 'diagnostic': {
				// 诊断信息（错误、警告等）
				if (typeof value === 'string') {
					return `<diagnostic name="${name}">\n${value}\n</diagnostic>`;
				}
				return `<diagnostic name="${name}" />`;
			}

			case 'terminalCommand': {
				// 终端命令
				const termEntry = attachment as { command: string; output?: string };
				let content = `命令: ${termEntry.command}`;
				if (termEntry.output) {
					content += `\n输出:\n${termEntry.output}`;
				}
				return `<terminal name="${name}">\n${content}\n</terminal>`;
			}

			case 'string': {
				// 字符串值
				if (typeof value === 'string') {
					return `<context name="${name}">\n${value}\n</context>`;
				}
				return undefined;
			}

			case 'workspace': {
				// 工作区信息
				if (typeof value === 'string') {
					return `<workspace>\n${value}\n</workspace>`;
				}
				return undefined;
			}

			default: {
				// 其他类型，尝试转换为字符串
				if (typeof value === 'string') {
					return `<attachment name="${name}" kind="${kind}">\n${value}\n</attachment>`;
				}
				return undefined;
			}
		}
	}

	async removeRequest(sessionResource: URI, requestId: string): Promise<void> {
		const model = this._sessionModels.get(sessionResource);
		if (!model) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}

		const pendingRequest = this._pendingRequests.get(sessionResource);
		if (pendingRequest?.requestId === requestId) {
			pendingRequest.cancel();
			this._pendingRequests.deleteAndDispose(sessionResource);
		}

		model.removeRequest(requestId);
	}

	async adoptRequest(sessionResource: URI, request: IChatRequestModel) {
		if (!(request instanceof ChatRequestModel)) {
			throw new TypeError('Can only adopt requests of type ChatRequestModel');
		}
		const target = this._sessionModels.get(sessionResource);
		if (!target) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}

		const oldOwner = request.session;
		target.adoptRequest(request);

		if (request.response && !request.response.isComplete) {
			const cts = this._pendingRequests.deleteAndLeak(oldOwner.sessionResource);
			if (cts) {
				cts.requestId = request.id;
				this._pendingRequests.set(target.sessionResource, cts);
			}
		}
	}

	async addCompleteRequest(sessionResource: URI, message: IParsedChatRequest | string, variableData: IChatRequestVariableData | undefined, attempt: number | undefined, response: IChatCompleteResponse): Promise<void> {
		this.trace('addCompleteRequest', `message: ${message}`);

		const model = this._sessionModels.get(sessionResource);
		if (!model) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}

		const parsedRequest = typeof message === 'string' ?
			this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(sessionResource, message) :
			message;
		const request = model.addRequest(parsedRequest, variableData || { variables: [] }, attempt ?? 0, undefined, undefined, undefined, undefined, undefined, undefined, true);
		if (typeof response.message === 'string') {
			// TODO is this possible?
			model.acceptResponseProgress(request, { content: new MarkdownString(response.message), kind: 'markdownContent' });
		} else {
			for (const part of response.message) {
				model.acceptResponseProgress(request, part, true);
			}
		}
		model.setResponse(request, response.result || {});
		if (response.followups !== undefined) {
			model.setFollowups(request, response.followups);
		}
		request.response?.complete();
	}

	cancelCurrentRequestForSession(sessionResource: URI): void {
		this.trace('cancelCurrentRequestForSession', `session: ${sessionResource}`);
		this._pendingRequests.get(sessionResource)?.cancel();
		this._pendingRequests.deleteAndDispose(sessionResource);
	}

	public hasSessions(): boolean {
		return this._chatSessionStore.hasSessions();
	}

	transferChatSession(transferredSessionData: IChatTransferredSessionData, toWorkspace: URI): void {
		const model = Iterable.find(this._sessionModels.values(), model => model.sessionId === transferredSessionData.sessionId);
		if (!model) {
			throw new Error(`Failed to transfer session. Unknown session ID: ${transferredSessionData.sessionId}`);
		}

		const existingRaw: IChatTransfer2[] = this.storageService.getObject(TransferredGlobalChatKey, StorageScope.PROFILE, []);
		existingRaw.push({
			chat: model.toJSON(),
			timestampInMilliseconds: Date.now(),
			toWorkspace: toWorkspace,
			inputState: transferredSessionData.inputState,
			location: transferredSessionData.location,
		});

		this.storageService.store(TransferredGlobalChatKey, JSON.stringify(existingRaw), StorageScope.PROFILE, StorageTarget.MACHINE);
		this.chatTransferService.addWorkspaceToTransferred(toWorkspace);
		this.trace('transferChatSession', `Transferred session ${model.sessionResource} to workspace ${toWorkspace.toString()}`);
	}

	getChatStorageFolder(): URI {
		return this._chatSessionStore.getChatStorageFolder();
	}

	logChatIndex(): void {
		this._chatSessionStore.logIndex();
	}

	setTitle(sessionResource: URI, title: string): void {
		this._sessionModels.get(sessionResource)?.setCustomTitle(title);
	}

	appendProgress(request: IChatRequestModel, progress: IChatProgress): void {
		const model = this._sessionModels.get(request.session.sessionResource);
		if (!(request instanceof ChatRequestModel)) {
			throw new BugIndicatingError('Can only append progress to requests of type ChatRequestModel');
		}

		model?.acceptResponseProgress(request, progress);
	}

	private toLocalSessionId(sessionResource: URI) {
		const localSessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (!localSessionId) {
			throw new Error(`Invalid local chat session resource: ${sessionResource}`);
		}
		return localSessionId;
	}

	/**
	 * 初始化会话的 token 统计
	 */
	private async initSessionTokenStats(sessionId: string): Promise<void> {
		if (this._sessionTokenStats.has(sessionId)) {
			return;
		}

		try {
			const contextSize = await this.chenilleChatProvider.getContextSize();
			this._sessionTokenStats.set(sessionId, {
				totalTokens: 0,
				contextSize,
			});
		} catch {
			// 使用默认值
			this._sessionTokenStats.set(sessionId, {
				totalTokens: 0,
				contextSize: 128000,
			});
		}
	}

	/**
	 * 更新会话的 token 统计
	 */
	private updateSessionTokenStats(sessionId: string, usage: TokenUsage): void {
		let stats = this._sessionTokenStats.get(sessionId);
		if (!stats) {
			// 如果没有初始化，使用默认值
			stats = { totalTokens: 0, contextSize: 128000 };
			this._sessionTokenStats.set(sessionId, stats);
		}

		// 累加 token 使用量
		stats.totalTokens += usage.totalTokens;

		// 检查是否需要发出警告
		const usagePercent = stats.totalTokens / stats.contextSize;
		if (usagePercent >= CONTEXT_COLLAPSE_THRESHOLD) {
			this.logService.warn(`Session ${sessionId} context usage: ${(usagePercent * 100).toFixed(1)}% (${stats.totalTokens}/${stats.contextSize})`);
			this._onContextCollapseWarning.fire({ sessionId, usagePercent });
		}
	}

	/**
	 * 获取会话的 token 统计
	 */
	getSessionTokenStats(sessionId: string): { totalTokens: number; contextSize: number; usagePercent: number } | undefined {
		const stats = this._sessionTokenStats.get(sessionId);
		if (!stats) {
			return undefined;
		}
		return {
			totalTokens: stats.totalTokens,
			contextSize: stats.contextSize,
			usagePercent: stats.totalTokens / stats.contextSize,
		};
	}

	/**
	 * 清理会话的 token 统计
	 */
	private clearSessionTokenStats(sessionId: string): void {
		this._sessionTokenStats.delete(sessionId);
	}
}
