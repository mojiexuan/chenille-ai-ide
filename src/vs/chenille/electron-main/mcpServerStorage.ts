/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStateService } from '../../platform/state/node/state.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { Emitter, Event } from '../../base/common/event.js';
import { McpServerConfig } from '../common/types.js';
import { IMcpServerStorageService } from '../common/storageIpc.js';

const STORAGE_KEY = 'chenille.mcpServers';

export const IMcpServerStorageMainService = IMcpServerStorageService;
export type IMcpServerStorageMainService = IMcpServerStorageService;

export class McpServerStorageMainService extends Disposable implements IMcpServerStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeServers = this._register(new Emitter<void>());
	readonly onDidChangeServers: Event<void> = this._onDidChangeServers.event;

	constructor(
		@IStateService private readonly stateService: IStateService
	) {
		super();
	}

	async getAll(): Promise<McpServerConfig[]> {
		const data = this.stateService.getItem<string>(STORAGE_KEY);
		if (!data) {
			return [];
		}
		try {
			return JSON.parse(data) as McpServerConfig[];
		} catch {
			return [];
		}
	}

	async get(name: string): Promise<McpServerConfig | undefined> {
		const servers = await this.getAll();
		return servers.find(s => s.name === name);
	}

	async save(server: McpServerConfig): Promise<void> {
		const servers = await this.getAll();
		const index = servers.findIndex(s => s.name === server.name);
		if (index >= 0) {
			servers[index] = server;
		} else {
			servers.push(server);
		}
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(servers));
		this._onDidChangeServers.fire();
	}

	async delete(name: string): Promise<void> {
		const servers = (await this.getAll()).filter(s => s.name !== name);
		this.stateService.setItem(STORAGE_KEY, JSON.stringify(servers));
		this._onDidChangeServers.fire();
	}
}
