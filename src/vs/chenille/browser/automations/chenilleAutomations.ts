/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, disposableTimeout, raceTimeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import { autorun, constObservable, derived, IObservable, observableValue } from '../../../base/common/observable.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize } from '../../../nls.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { assertAutomationSessionTemplate, AutomationRunTrigger, AutomationTarget, IAutomationDescriptor, IAutomationRun, IAutomationSchedule, IAutomationSessionTemplate } from '../../../workbench/contrib/chat/common/automations/automation.js';
import { assertAutomationSessionTemplateAuthority, AutomationCatalogueState, AutomationMutationGuard, AutomationUnavailableError, IAutomationRunRequestResult, ICreateAutomationOptions, IGuardedAutomationUpdateResult, IUpdateAutomationOptions, serializeAutomationEditableState } from '../../../workbench/contrib/chat/common/automations/automationService.js';
import { CHAT_AUTOMATIONS_ENABLED_SETTING } from '../../../workbench/contrib/chat/common/automations/automationsEnabled.js';
import { IChatService, ResponseModelState } from '../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatModel } from '../../../workbench/contrib/chat/common/model/chatModel.js';
import { CHENILLE_PROVIDER_ID, CHENILLE_SESSION_TYPE_ID } from '../../sessions/browser/chenilleSessionsProvider.js';

const STORAGE_KEY = 'chenille.automations.v1';
const STORAGE_VERSION = 1;
/** 每个自动化最多保留的运行记录，避免本地存档无限增长。 */
const MAX_RUNS = 200;
/** 定时器最长跳一次，保证系统休眠或时钟漂移后仍能重新对齐。 */
const MAX_TIMER_DELAY_MS = 60_000;
/** 到期时间超过该阈值才视为错过运行，记作 catch_up。 */
const CATCH_UP_THRESHOLD_MS = 5 * 60_000;
/** 取消后等待会话进入终态的时间，超时后直接结束运行。 */
const CANCEL_GRACE_PERIOD_MS = 3_000;

/** Chenille 本地自动化创建的会话句柄。 */
export interface IChenilleAutomationSession {
	readonly sessionId: string;
	readonly chatResource: URI;
}

/**
 * 调度器需要的会话能力，由 ChenilleSessionsProvider 实现。
 * 调度与持久化留在本地，不依赖任何远端 Agent Host。
 */
export interface IChenilleAutomationHost {
	createAutomationSession(folderUri: URI, modelId: string | undefined): IChenilleAutomationSession;
	sendAutomationPrompt(session: IChenilleAutomationSession, prompt: string, title: string): Promise<void>;
	cancelAutomationSession(sessionResource: URI): Promise<void>;
}

interface IRunTracker {
	readonly completed: Promise<void>;
	cancel(): void;
	dispose(): void;
}

interface IStoredAutomationState {
	readonly version?: unknown;
	readonly automations?: unknown;
	readonly runs?: unknown;
}

/**
 * Chenille 的本地自动化实现：定义与运行历史保存在应用存储中，
 * 由窗口内的定时器触发调度，运行即是一次普通的本机会话。
 */
export class ChenilleAutomationStore extends Disposable {

	readonly catalogueState: IObservable<AutomationCatalogueState> = constObservable('ready');
	readonly canCreateAutomation: IObservable<boolean> = constObservable(true);

	readonly automations: IObservable<readonly IAutomationDescriptor[]>;
	readonly runs: IObservable<readonly IAutomationRun[]>;

	private readonly _automationById = new Map<string, IAutomationDescriptor>();
	private readonly _runList: IAutomationRun[] = [];
	private readonly _automationsObservable = observableValue<readonly IAutomationDescriptor[]>(this, []);
	private readonly _runsObservable = observableValue<readonly IAutomationRun[]>(this, []);
	private readonly _runsForCache = new Map<string, IObservable<readonly IAutomationRun[]>>();
	private readonly _trackers = new Map<string, IRunTracker>();
	private readonly _scheduler = this._register(new MutableDisposable<IDisposable>());
	private _disposed = false;

	constructor(
		private readonly _host: IChenilleAutomationHost,
		private readonly _chatService: IChatService,
		private readonly _configurationService: IConfigurationService,
		private readonly _logService: ILogService,
		private readonly _storageService: IStorageService,
	) {
		super();
		this.automations = this._automationsObservable;
		this.runs = this._runsObservable;
		this._restore();
		this._register(this._configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(CHAT_AUTOMATIONS_ENABLED_SETTING)) {
				this._armScheduler();
			}
		}));
		this._armScheduler();
	}

	override dispose(): void {
		this._disposed = true;
		for (const tracker of [...this._trackers.values()]) {
			tracker.dispose();
		}
		this._trackers.clear();
		super.dispose();
	}

	getAutomation(id: string): IAutomationDescriptor | undefined {
		return this._automationById.get(id);
	}

	runsFor(automationId: string): IObservable<readonly IAutomationRun[]> {
		let result = this._runsForCache.get(automationId);
		if (!result) {
			result = derived(this, reader => this._runsObservable.read(reader).filter(run => run.automationId === automationId));
			this._runsForCache.set(automationId, result);
		}
		return result;
	}

	async createAutomation(options: ICreateAutomationOptions, mutationGuard?: AutomationMutationGuard): Promise<IAutomationDescriptor> {
		this._assertReady();
		mutationGuard?.();
		const schedule = validateSchedule(options.schedule);
		const target = validateTarget(options.target);
		const sessionTemplate = normalizeSessionTemplate(options.sessionTemplate ?? (options.modelId ? { modelId: options.modelId } : undefined));
		const enabled = options.enabled ?? true;
		const now = new Date();
		const nextRunAt = enabled ? computeNextRunAt(schedule, now)?.toISOString() : undefined;
		const descriptor: IAutomationDescriptor = {
			id: generateUuid(),
			name: requireName(options.name),
			prompt: requirePrompt(options.prompt),
			schedule,
			target,
			enabled,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			...(sessionTemplate ? { sessionTemplate } : {}),
			...(nextRunAt ? { nextRunAt } : {}),
		};
		this._automationById.set(descriptor.id, descriptor);
		this._publishAutomations();
		this._persist();
		this._armScheduler();
		return descriptor;
	}

	async updateAutomation(id: string, patch: IUpdateAutomationOptions): Promise<IAutomationDescriptor> {
		this._assertReady();
		return this._applyUpdate(id, patch);
	}

	async updateAutomationIfUnchanged(id: string, patch: IUpdateAutomationOptions, expected: IAutomationDescriptor, mutationGuard?: AutomationMutationGuard): Promise<IGuardedAutomationUpdateResult> {
		const current = this.getAutomation(id);
		if (!current || serializeAutomationEditableState(current) !== serializeAutomationEditableState(expected)) {
			return { kind: 'conflict', current };
		}
		return { kind: 'updated', automation: this._applyUpdate(id, patch, mutationGuard) };
	}

	async deleteAutomation(id: string, mutationGuard?: AutomationMutationGuard): Promise<void> {
		const automation = this._automationById.get(id);
		if (!automation) {
			return;
		}
		mutationGuard?.();
		const activeRun = this.getActiveRunFor(id);
		if (activeRun) {
			this._trackers.get(activeRun.id)?.cancel();
		}
		this._automationById.delete(id);
		this._publishAutomations();
		this._setRuns(this._runList.filter(run => run.automationId !== id));
		this._runsForCache.delete(id);
		this._armScheduler();
	}

	async runAutomation(automationId: string, token: CancellationToken = CancellationToken.None): Promise<IAutomationRunRequestResult> {
		this._assertReady();
		const automation = this._automationById.get(automationId);
		if (!automation) {
			throw new AutomationUnavailableError(localize('chenille.automations.missing', "自动化不存在或已被删除。"));
		}
		if (!automation.enabled) {
			throw new AutomationUnavailableError(localize('chenille.automations.disabled', "自动化已停用，请先启用后再运行。"));
		}
		const activeRun = this.getActiveRunFor(automationId);
		if (activeRun) {
			return { kind: 'alreadyRunning', run: activeRun };
		}
		return this._dispatchRun(automation, 'manual', token);
	}

	getActiveRunFor(automationId: string): IAutomationRun | undefined {
		return this._runList.find(run => run.automationId === automationId && (run.status === 'pending' || run.status === 'running'));
	}

	canRunAutomation(automationId: string): boolean {
		return this._automationById.get(automationId)?.enabled === true;
	}

	canUpdateAutomation(automationId: string): boolean {
		return this._automationById.has(automationId);
	}

	canDeleteAutomation(automationId: string): boolean {
		return this._automationById.has(automationId);
	}

	canStopRun(run: IAutomationRun): boolean {
		return (run.status === 'pending' || run.status === 'running') && this._trackers.has(run.id);
	}

	async stopRun(run: IAutomationRun): Promise<void> {
		const tracker = this._trackers.get(run.id);
		if (!tracker) {
			return;
		}
		tracker.cancel();
		await raceTimeout(tracker.completed, CANCEL_GRACE_PERIOD_MS + 2_000);
	}

	private _assertReady(): void {
		if (this._disposed) {
			throw new AutomationUnavailableError(localize('chenille.automations.disposed', "Chenille 自动化服务已关闭。"));
		}
	}

	private _applyUpdate(id: string, patch: IUpdateAutomationOptions, mutationGuard?: AutomationMutationGuard): IAutomationDescriptor {
		const current = this._automationById.get(id);
		if (!current) {
			throw new Error(`Automation does not exist: ${id}`);
		}
		assertAutomationSessionTemplateAuthority(current, patch);
		mutationGuard?.();

		const name = patch.name !== undefined ? requireName(patch.name) : current.name;
		const prompt = patch.prompt !== undefined ? requirePrompt(patch.prompt) : current.prompt;
		const schedule = patch.schedule !== undefined ? validateSchedule(patch.schedule) : current.schedule;
		const target = patch.target !== undefined ? validateTarget(patch.target) : current.target;
		const enabled = patch.enabled ?? current.enabled;

		let sessionTemplate: IAutomationSessionTemplate | undefined = current.sessionTemplate;
		if (patch.sessionTemplate === null) {
			sessionTemplate = undefined;
		} else if (patch.sessionTemplate !== undefined) {
			sessionTemplate = normalizeSessionTemplate(patch.sessionTemplate);
		} else if (patch.modelId !== undefined) {
			sessionTemplate = patch.modelId === null ? undefined : normalizeSessionTemplate({ modelId: patch.modelId });
		}

		const now = new Date();
		let nextRunAt: string | undefined;
		if (!enabled || schedule.interval === 'manual') {
			nextRunAt = undefined;
		} else if (patch.schedule !== undefined || patch.enabled !== undefined) {
			nextRunAt = computeNextRunAt(schedule, now)?.toISOString();
		} else {
			nextRunAt = current.nextRunAt ?? computeNextRunAt(schedule, now)?.toISOString();
		}

		const updated: IAutomationDescriptor = {
			...current,
			name,
			prompt,
			schedule,
			target,
			sessionTemplate,
			enabled,
			updatedAt: now.toISOString(),
			nextRunAt,
		};
		this._automationById.set(id, updated);
		this._publishAutomations();
		this._persist();
		this._armScheduler();
		return updated;
	}

	private async _dispatchRun(automation: IAutomationDescriptor, trigger: AutomationRunTrigger, token: CancellationToken): Promise<IAutomationRunRequestResult> {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		if (automation.target.kind !== 'workspace') {
			throw new AutomationUnavailableError(localize('chenille.automations.workspaceRequired', "Chenille 自动化需要一个本地文件夹。"));
		}
		const startedAt = new Date();
		const runId = generateUuid();
		this._insertRun({
			id: runId,
			automationId: automation.id,
			status: 'pending',
			trigger,
			startedAt: startedAt.toISOString(),
			updatedAt: startedAt.toISOString(),
		});
		this._replaceAutomation({ ...automation, lastRunAt: startedAt.toISOString() });

		let session: IChenilleAutomationSession;
		try {
			session = this._host.createAutomationSession(automation.target.folderUri, automation.sessionTemplate?.modelId);
		} catch (error) {
			this._failRun(runId, error);
			throw error;
		}
		this._updateRun(runId, { status: 'running', sessionResource: session.chatResource });

		const model = this._chatService.getSession(session.chatResource);
		if (!model) {
			const error = new Error(localize('chenille.automations.sessionUnavailable', "无法创建自动化会话。"));
			this._failRun(runId, error);
			throw error;
		}

		try {
			await this._host.sendAutomationPrompt(session, automation.prompt, automation.name);
		} catch (error) {
			this._failRun(runId, error);
			throw error;
		}

		const run = this._findRun(runId);
		if (!run) {
			throw new AutomationUnavailableError(localize('chenille.automations.runMissing', "自动化运行记录已丢失。"));
		}
		const tracker = this._trackRun(run, model, token);
		return {
			kind: 'dispatched',
			run: this._findRun(runId) ?? run,
			whenCompleted: tracker.completed,
			cancel: () => tracker.cancel(),
		};
	}

	/**
	 * 观察会话的请求状态，并把终态写回运行记录。
	 * 会话需要输入时保持 running，与 Agent Host 的语义一致。
	 */
	private _trackRun(run: IAutomationRun, model: IChatModel, token: CancellationToken): IRunTracker {
		const completed = new DeferredPromise<void>();
		const store = new DisposableStore();
		let settled = false;
		let cancelling = false;

		const settle = (patch: Partial<IAutomationRun> | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			store.dispose();
			this._trackers.delete(run.id);
			if (patch) {
				this._updateRun(run.id, { ...patch, completedAt: patch.completedAt ?? new Date().toISOString() });
			}
			if (!completed.isSettled) {
				completed.complete();
			}
		};

		const cancelledMessage = localize('chenille.automations.cancelledRun', "自动化运行已取消。");
		const fail = (message: string) => settle({ status: 'failed', errorMessage: message, needsInput: false });

		const cancel = () => {
			if (settled || cancelling) {
				return;
			}
			cancelling = true;
			if (run.sessionResource) {
				void this._host.cancelAutomationSession(run.sessionResource).catch(error => this._logService.warn('[Chenille] 取消自动化运行失败', error));
			}
			store.add(disposableTimeout(() => {
				if (!settled) {
					fail(cancelledMessage);
				}
			}, CANCEL_GRACE_PERIOD_MS));
		};

		const tracker: IRunTracker = {
			completed: completed.p,
			cancel,
			dispose: () => settle(undefined),
		};
		// 先登记再观察：首次计算可能立刻进入终态，settle 需要能找到并移除记录。
		this._trackers.set(run.id, tracker);

		store.add(token.onCancellationRequested(cancel));
		store.add(model.onDidDispose(() => fail(localize('chenille.automations.sessionClosed', "自动化会话已关闭。"))));
		store.add(autorun(reader => {
			if (settled) {
				return;
			}
			const inProgress = model.requestInProgress.read(reader);
			const hasActiveRequest = model.hasActiveRequest.read(reader);
			const needsInputInfo = model.requestNeedsInput.read(reader);
			const lastRequest = model.lastRequestObs.read(reader);
			const response = lastRequest?.response;
			if (!response) {
				return;
			}
			switch (response.state) {
				case ResponseModelState.Pending:
					if (inProgress || hasActiveRequest) {
						this._updateRun(run.id, { status: 'running' });
					}
					break;
				case ResponseModelState.NeedsInput:
					this._updateRun(run.id, { status: 'running', needsInput: true, statusDescription: needsInputInfo?.detail });
					break;
				case ResponseModelState.Complete:
					settle({ status: 'completed', needsInput: false, statusDescription: undefined });
					break;
				case ResponseModelState.Cancelled:
					fail(cancelledMessage);
					break;
				case ResponseModelState.Failed:
					fail(response.result?.errorDetails?.message ?? localize('chenille.automations.failedRun', "自动化运行失败。"));
					break;
			}
		}));

		return tracker;
	}

	private _insertRun(run: IAutomationRun): void {
		this._setRuns([run, ...this._runList]);
	}

	private _findRun(runId: string): IAutomationRun | undefined {
		return this._runList.find(run => run.id === runId);
	}

	private _updateRun(runId: string, patch: Partial<IAutomationRun>): IAutomationRun | undefined {
		const index = this._runList.findIndex(run => run.id === runId);
		if (index < 0) {
			return undefined;
		}
		const current = this._runList[index];
		// 会话状态会频繁重算，字段没变时不要触发 UI 更新。
		const changed = Object.entries(patch).some(([key, value]) => (current as unknown as Record<string, unknown>)[key] !== value);
		if (!changed) {
			return current;
		}
		const updated: IAutomationRun = { ...current, ...patch, updatedAt: new Date().toISOString() };
		const next = this._runList.slice();
		next[index] = updated;
		this._setRuns(next);
		return updated;
	}

	private _failRun(runId: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this._updateRun(runId, { status: 'failed', errorMessage: message, needsInput: false, completedAt: new Date().toISOString() });
	}

	private _setRuns(runs: readonly IAutomationRun[]): void {
		const sorted = [...runs]
			.sort((first, second) => second.startedAt.localeCompare(first.startedAt))
			.slice(0, MAX_RUNS);
		this._runList.length = 0;
		this._runList.push(...sorted);
		this._runsObservable.set(sorted, undefined);
		this._persist();
	}

	private _replaceAutomation(automation: IAutomationDescriptor): void {
		if (!this._automationById.has(automation.id)) {
			return;
		}
		this._automationById.set(automation.id, automation);
		this._publishAutomations();
		this._persist();
		this._armScheduler();
	}

	private _publishAutomations(): void {
		const sorted = [...this._automationById.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
		this._automationsObservable.set(sorted, undefined);
	}

	private _persist(): void {
		if (this._disposed) {
			return;
		}
		const payload = {
			version: STORAGE_VERSION,
			automations: [...this._automationById.values()],
			runs: this._runList,
		};
		this._storageService.store(STORAGE_KEY, JSON.stringify(payload), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private _restore(): void {
		const raw = this._storageService.get(STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return;
		}
		let stored: IStoredAutomationState;
		try {
			stored = JSON.parse(raw);
		} catch (error) {
			this._logService.warn('[Chenille] 无法解析自动化存档', error);
			return;
		}
		if (!stored || stored.version !== STORAGE_VERSION || !Array.isArray(stored.automations) || !Array.isArray(stored.runs)) {
			this._logService.warn('[Chenille] 忽略无法识别的自动化存档', stored?.version);
			return;
		}

		const now = new Date();
		for (const entry of stored.automations) {
			const automation = parseStoredAutomation(entry, now);
			if (automation) {
				this._automationById.set(automation.id, automation);
			}
		}
		if (stored.automations.length > 0 && this._automationById.size === 0) {
			// 存档无法解析时保留原数据，避免下一次写入把它覆盖成空列表。
			this._logService.warn('[Chenille] 自动化存档无法解析，已保留原数据');
			return;
		}

		const runs: IAutomationRun[] = [];
		for (const entry of stored.runs) {
			const run = parseStoredRun(entry);
			if (!run || !this._automationById.has(run.automationId)) {
				continue;
			}
			if (run.status === 'pending' || run.status === 'running') {
				// 窗口关闭时仍在运行的任务无法恢复，统一标记为失败。
				runs.push({
					...run,
					status: 'failed',
					completedAt: run.completedAt ?? run.updatedAt ?? run.startedAt,
					errorMessage: run.errorMessage ?? localize('chenille.automations.interrupted', "窗口关闭导致自动化运行中断。"),
					updatedAt: now.toISOString(),
				});
			} else {
				runs.push(run);
			}
		}

		this._publishAutomations();
		this._setRuns(runs);
	}

	private _armScheduler(): void {
		this._scheduler.clear();
		if (this._disposed || !this._isSchedulingEnabled()) {
			return;
		}
		const now = Date.now();
		let earliest = Number.POSITIVE_INFINITY;
		for (const automation of this._automationById.values()) {
			if (!isScheduled(automation)) {
				continue;
			}
			const next = automation.nextRunAt ? Date.parse(automation.nextRunAt) : NaN;
			if (Number.isFinite(next)) {
				earliest = Math.min(earliest, next);
			}
		}
		if (!Number.isFinite(earliest)) {
			return;
		}
		const delay = Math.min(Math.max(earliest - now, 0), MAX_TIMER_DELAY_MS);
		this._scheduler.value = disposableTimeout(() => {
			void this._tick().catch(error => this._logService.error('[Chenille] 自动化调度失败', error));
		}, delay);
	}

	private async _tick(): Promise<void> {
		if (this._disposed) {
			return;
		}
		if (!this._isSchedulingEnabled()) {
			this._armScheduler();
			return;
		}

		const now = new Date();
		const due = [...this._automationById.values()].filter(automation => isScheduled(automation)
			&& !!automation.nextRunAt && Date.parse(automation.nextRunAt) <= now.getTime());

		for (const dueAutomation of due) {
			if (this._disposed) {
				return;
			}
			const automation = this._automationById.get(dueAutomation.id) ?? dueAutomation;
			const scheduledAt = automation.nextRunAt ? Date.parse(automation.nextRunAt) : now.getTime();
			const trigger: AutomationRunTrigger = now.getTime() - scheduledAt > CATCH_UP_THRESHOLD_MS ? 'catch_up' : 'schedule';
			// 先推进下次时间，避免运行失败后在同一分钟内反复重试。
			this._replaceAutomation(advanceNextRun(automation, now));
			if (this.getActiveRunFor(automation.id)) {
				continue;
			}
			try {
				await this._dispatchRun(automation, trigger, CancellationToken.None);
			} catch (error) {
				this._logService.error(`[Chenille] 自动化 '${automation.name}' 运行失败`, error);
			}
		}

		this._armScheduler();
	}

	private _isSchedulingEnabled(): boolean {
		return this._configurationService.getValue<boolean>(CHAT_AUTOMATIONS_ENABLED_SETTING) !== false;
	}
}

function isScheduled(automation: IAutomationDescriptor): boolean {
	return automation.enabled
		&& automation.schedule.interval !== 'manual'
		&& automation.schedule.interval !== 'custom';
}

function advanceNextRun(automation: IAutomationDescriptor, now: Date): IAutomationDescriptor {
	if (!isScheduled(automation)) {
		return { ...automation, nextRunAt: undefined };
	}
	return { ...automation, nextRunAt: computeNextRunAt(automation.schedule, now)?.toISOString() };
}

/** 计算下一次本地触发时间；手动与自定义调度返回 undefined。 */
export function computeNextRunAt(schedule: IAutomationSchedule, from: Date): Date | undefined {
	if (schedule.interval === 'manual' || schedule.interval === 'custom') {
		return undefined;
	}
	const hour = schedule.scheduleHour;
	const minute = schedule.scheduleMinute;

	if (schedule.interval === 'hourly') {
		let candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), minute, 0, 0);
		if (candidate.getTime() <= from.getTime()) {
			candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours() + 1, minute, 0, 0);
		}
		return candidate;
	}

	const at = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);

	if (schedule.interval === 'daily') {
		const today = at(from);
		return today.getTime() > from.getTime()
			? today
			: at(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1));
	}

	if (schedule.interval === 'weekdays') {
		for (let offset = 0; offset <= 7; offset++) {
			const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
			const dayOfWeek = day.getDay();
			const candidate = at(day);
			if (dayOfWeek >= 1 && dayOfWeek <= 5 && candidate.getTime() > from.getTime()) {
				return candidate;
			}
		}
		return undefined;
	}

	for (let offset = 0; offset <= 7; offset++) {
		const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
		if (day.getDay() !== schedule.scheduleDay) {
			continue;
		}
		const candidate = at(day);
		if (candidate.getTime() > from.getTime()) {
			return candidate;
		}
	}
	return undefined;
}

function validateSchedule(schedule: IAutomationSchedule | undefined): IAutomationSchedule {
	if (!schedule || (schedule.interval !== 'manual' && schedule.interval !== 'hourly' && schedule.interval !== 'daily' && schedule.interval !== 'weekdays' && schedule.interval !== 'weekly')) {
		throw new Error(localize('chenille.automations.scheduleUnsupported', "Chenille 自动化不支持该调度方式。"));
	}
	if (schedule.timeZone !== undefined) {
		throw new Error(localize('chenille.automations.timeZoneUnsupported', "Chenille 自动化只支持本地时间。"));
	}
	return {
		interval: schedule.interval,
		scheduleHour: intOrDefault(schedule.scheduleHour, 0, 23, 9),
		scheduleMinute: intOrDefault(schedule.scheduleMinute, 0, 59, 0),
		scheduleDay: intOrDefault(schedule.scheduleDay, 0, 6, 1),
	};
}

function validateTarget(target: AutomationTarget | undefined): AutomationTarget {
	if (!target || target.kind !== 'workspace') {
		throw new Error(localize('chenille.automations.workspaceRequiredForCreate', "Chenille 自动化需要一个本地文件夹。"));
	}
	if (target.providerId !== undefined && target.providerId !== CHENILLE_PROVIDER_ID) {
		throw new Error(localize('chenille.automations.providerMismatch', "该自动化不属于 Chenille 会话。"));
	}
	if (target.sessionTypeId !== undefined && target.sessionTypeId !== CHENILLE_SESSION_TYPE_ID) {
		throw new Error(localize('chenille.automations.sessionTypeMismatch', "Chenille 自动化只能使用 Chenille 会话。"));
	}
	if (target.folderUri.scheme !== Schemas.file) {
		throw new Error(localize('chenille.automations.localFolderRequired', "Chenille 自动化需要一个本地文件夹。"));
	}
	if (target.isolation.kind === 'worktree') {
		throw new Error(localize('chenille.automations.worktreeUnsupported', "Chenille 自动化暂不支持 worktree 隔离。"));
	}
	return {
		kind: 'workspace',
		folderUri: target.folderUri,
		providerId: CHENILLE_PROVIDER_ID,
		sessionTypeId: CHENILLE_SESSION_TYPE_ID,
		isolation: target.isolation.kind === 'folder' ? { kind: 'folder' } : { kind: 'default' },
	};
}

function normalizeSessionTemplate(template: IAutomationSessionTemplate | undefined): IAutomationSessionTemplate | undefined {
	if (!template) {
		return undefined;
	}
	assertAutomationSessionTemplate(template);
	const normalized: IAutomationSessionTemplate = {
		...(template.modelId ? { modelId: template.modelId } : {}),
		...(template.modelConfiguration !== undefined ? { modelConfiguration: template.modelConfiguration } : {}),
		...(template.agent ? { agent: { uri: template.agent.uri } } : {}),
		...(template.config !== undefined ? { config: template.config } : {}),
	};
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function requireName(value: string): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (!trimmed) {
		throw new Error(localize('chenille.automations.nameRequired', "请填写自动化名称。"));
	}
	return trimmed;
}

function requirePrompt(value: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(localize('chenille.automations.promptRequired', "请填写自动化提示词。"));
	}
	return value;
}

function intOrDefault(value: unknown, minimum: number, maximum: number, fallback: number): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parseSchedule(value: unknown): IAutomationSchedule | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const interval = value.interval;
	if (interval !== 'manual' && interval !== 'hourly' && interval !== 'daily' && interval !== 'weekdays' && interval !== 'weekly') {
		return undefined;
	}
	if (value.timeZone !== undefined) {
		return undefined;
	}
	return {
		interval,
		scheduleHour: intOrDefault(value.scheduleHour, 0, 23, 9),
		scheduleMinute: intOrDefault(value.scheduleMinute, 0, 59, 0),
		scheduleDay: intOrDefault(value.scheduleDay, 0, 6, 1),
	};
}

function parseStoredTarget(value: unknown): AutomationTarget | undefined {
	if (!isRecord(value) || value.kind !== 'workspace') {
		return undefined;
	}
	const folder = readString(value.folderUri);
	if (!folder) {
		return undefined;
	}
	let folderUri: URI;
	try {
		folderUri = URI.parse(folder);
	} catch {
		return undefined;
	}
	if (folderUri.scheme !== Schemas.file) {
		return undefined;
	}
	const isolationValue = value.isolation;
	const isolation = isRecord(isolationValue) && isolationValue.kind === 'folder'
		? { kind: 'folder' as const }
		: { kind: 'default' as const };
	return {
		kind: 'workspace',
		folderUri,
		providerId: CHENILLE_PROVIDER_ID,
		sessionTypeId: CHENILLE_SESSION_TYPE_ID,
		isolation,
	};
}

function parseStoredSessionTemplate(value: unknown): IAutomationSessionTemplate | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const modelId = readString(value.modelId);
	const modelConfigurationValue = value.modelConfiguration;
	const modelConfiguration = isRecord(modelConfigurationValue) ? modelConfigurationValue as IAutomationSessionTemplate['modelConfiguration'] : undefined;
	const agentValue = value.agent;
	const agent = isRecord(agentValue) && typeof agentValue.uri === 'string' ? { uri: agentValue.uri } : undefined;
	const configValue = value.config;
	const config = isRecord(configValue) ? configValue : undefined;
	if (!modelId && !agent && !config) {
		return undefined;
	}
	return {
		...(modelId ? { modelId } : {}),
		...(modelId && modelConfiguration ? { modelConfiguration } : {}),
		...(agent ? { agent } : {}),
		...(config ? { config } : {}),
	};
}

function parseStoredAutomation(value: unknown, now: Date): IAutomationDescriptor | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const id = readString(value.id);
	const name = readString(value.name);
	const prompt = readString(value.prompt);
	const createdAt = readString(value.createdAt);
	const updatedAt = readString(value.updatedAt);
	const schedule = parseSchedule(value.schedule);
	const target = parseStoredTarget(value.target);
	if (!id || !name || !prompt || !createdAt || !updatedAt || !schedule || !target) {
		return undefined;
	}
	if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
		return undefined;
	}
	const enabled = value.enabled !== false;
	const sessionTemplate = parseStoredSessionTemplate(value.sessionTemplate);
	const lastRunAt = readString(value.lastRunAt);
	let nextRunAt = readString(value.nextRunAt);
	if (!enabled || schedule.interval === 'manual') {
		nextRunAt = undefined;
	} else if (!nextRunAt || !Number.isFinite(Date.parse(nextRunAt))) {
		nextRunAt = computeNextRunAt(schedule, now)?.toISOString();
	}
	return {
		id,
		name,
		prompt,
		schedule,
		target,
		enabled,
		createdAt,
		updatedAt,
		...(sessionTemplate ? { sessionTemplate } : {}),
		...(lastRunAt ? { lastRunAt } : {}),
		...(nextRunAt ? { nextRunAt } : {}),
	};
}

function parseStoredRun(value: unknown): IAutomationRun | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const id = readString(value.id);
	const automationId = readString(value.automationId);
	const status = value.status;
	const trigger = value.trigger;
	const startedAt = readString(value.startedAt);
	if (!id || !automationId || !startedAt) {
		return undefined;
	}
	if (status !== 'pending' && status !== 'running' && status !== 'completed' && status !== 'failed') {
		return undefined;
	}
	if (trigger !== 'schedule' && trigger !== 'catch_up' && trigger !== 'manual' && trigger !== 'external') {
		return undefined;
	}
	let sessionResource: URI | undefined;
	const session = readString(value.sessionResource);
	if (session) {
		try {
			sessionResource = URI.parse(session);
		} catch {
			return undefined;
		}
	}
	const updatedAt = readString(value.updatedAt);
	const completedAt = readString(value.completedAt);
	const errorMessage = readString(value.errorMessage);
	const statusDescription = readString(value.statusDescription);
	return {
		id,
		automationId,
		status,
		trigger,
		startedAt,
		...(sessionResource ? { sessionResource } : {}),
		...(updatedAt ? { updatedAt } : {}),
		...(completedAt ? { completedAt } : {}),
		...(errorMessage ? { errorMessage } : {}),
		...(value.needsInput === true ? { needsInput: true } : {}),
		...(statusDescription ? { statusDescription } : {}),
	};
}
