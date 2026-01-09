/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { Event } from '../../base/common/event.js';
import { IChannel, IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { AiModel, AiPrompt, AgentType, AiAgentConfig, McpServerConfig } from './types.js';

// ============ Model Storage IPC ============

export const IAiModelStorageService = createDecorator<IAiModelStorageService>('aiModelStorageService');

export interface IAiModelStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeModels: Event<void>;
	getAll(): Promise<AiModel[]>;
	get(name: string): Promise<AiModel | undefined>;
	save(model: AiModel): Promise<void>;
	delete(name: string): Promise<void>;
}

export const ModelStorageChannelName = 'chenille.modelStorage';

export class ModelStorageChannel implements IServerChannel {
	constructor(private readonly service: IAiModelStorageService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onDidChangeModels': return this.service.onDidChangeModels as Event<T>;
		}
		throw new Error(`No event: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'getAll': return this.service.getAll() as Promise<T>;
			case 'get': return this.service.get(args?.[0] as string) as Promise<T>;
			case 'save': return this.service.save(args?.[0] as AiModel) as Promise<T>;
			case 'delete': return this.service.delete(args?.[0] as string) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class ModelStorageChannelClient implements IAiModelStorageService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeModels: Event<void>;

	constructor(private readonly channel: IChannel) {
		this.onDidChangeModels = this.channel.listen<void>('onDidChangeModels');
	}

	getAll(): Promise<AiModel[]> {
		return this.channel.call('getAll');
	}

	get(name: string): Promise<AiModel | undefined> {
		return this.channel.call('get', [name]);
	}

	save(model: AiModel): Promise<void> {
		return this.channel.call('save', [model]);
	}

	delete(name: string): Promise<void> {
		return this.channel.call('delete', [name]);
	}
}

// ============ Prompt Storage IPC ============

export const IAiPromptStorageService = createDecorator<IAiPromptStorageService>('aiPromptStorageService');

export interface IAiPromptStorageService {
	readonly _serviceBrand: undefined;
	getAll(): Promise<AiPrompt[]>;
	get(name: string): Promise<AiPrompt | undefined>;
	save(prompt: AiPrompt): Promise<void>;
	delete(name: string): Promise<void>;
}

export const PromptStorageChannelName = 'chenille.promptStorage';

export class PromptStorageChannel implements IServerChannel {
	constructor(private readonly service: IAiPromptStorageService) { }

	listen<T>(_context: unknown, _event: string): Event<T> {
		throw new Error('No events');
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'getAll': return this.service.getAll() as Promise<T>;
			case 'get': return this.service.get(args?.[0] as string) as Promise<T>;
			case 'save': return this.service.save(args?.[0] as AiPrompt) as Promise<T>;
			case 'delete': return this.service.delete(args?.[0] as string) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class PromptStorageChannelClient implements IAiPromptStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly channel: IChannel) { }

	getAll(): Promise<AiPrompt[]> {
		return this.channel.call('getAll');
	}

	get(name: string): Promise<AiPrompt | undefined> {
		return this.channel.call('get', [name]);
	}

	save(prompt: AiPrompt): Promise<void> {
		return this.channel.call('save', [prompt]);
	}

	delete(name: string): Promise<void> {
		return this.channel.call('delete', [name]);
	}
}

// ============ Agent Storage IPC ============

export const IAiAgentStorageService = createDecorator<IAiAgentStorageService>('aiAgentStorageService');

export interface IAiAgentStorageService {
	readonly _serviceBrand: undefined;
	getAll(): Promise<AiAgentConfig[]>;
	get(type: AgentType): Promise<AiAgentConfig | undefined>;
	save(config: AiAgentConfig): Promise<void>;
}

export const AgentStorageChannelName = 'chenille.agentStorage';

export class AgentStorageChannel implements IServerChannel {
	constructor(private readonly service: IAiAgentStorageService) { }

	listen<T>(_context: unknown, _event: string): Event<T> {
		throw new Error('No events');
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'getAll': return this.service.getAll() as Promise<T>;
			case 'get': return this.service.get(args?.[0] as AgentType) as Promise<T>;
			case 'save': return this.service.save(args?.[0] as AiAgentConfig) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class AgentStorageChannelClient implements IAiAgentStorageService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly channel: IChannel) { }

	getAll(): Promise<AiAgentConfig[]> {
		return this.channel.call('getAll');
	}

	get(type: AgentType): Promise<AiAgentConfig | undefined> {
		return this.channel.call('get', [type]);
	}

	save(config: AiAgentConfig): Promise<void> {
		return this.channel.call('save', [config]);
	}
}


// ============ MCP Server Storage IPC ============

export const IMcpServerStorageService = createDecorator<IMcpServerStorageService>('mcpServerStorageService');

export interface IMcpServerStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeServers: Event<void>;
	getAll(): Promise<McpServerConfig[]>;
	get(name: string): Promise<McpServerConfig | undefined>;
	save(server: McpServerConfig): Promise<void>;
	delete(name: string): Promise<void>;
}

export const McpServerStorageChannelName = 'chenille.mcpServerStorage';

export class McpServerStorageChannel implements IServerChannel {
	constructor(private readonly service: IMcpServerStorageService) { }

	listen<T>(_context: unknown, event: string): Event<T> {
		switch (event) {
			case 'onDidChangeServers': return this.service.onDidChangeServers as Event<T>;
		}
		throw new Error(`No event: ${event}`);
	}

	call<T>(_context: unknown, command: string, args?: unknown[]): Promise<T> {
		switch (command) {
			case 'getAll': return this.service.getAll() as Promise<T>;
			case 'get': return this.service.get(args?.[0] as string) as Promise<T>;
			case 'save': return this.service.save(args?.[0] as McpServerConfig) as Promise<T>;
			case 'delete': return this.service.delete(args?.[0] as string) as Promise<T>;
		}
		throw new Error(`Invalid command: ${command}`);
	}
}

export class McpServerStorageChannelClient implements IMcpServerStorageService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeServers: Event<void>;

	constructor(private readonly channel: IChannel) {
		this.onDidChangeServers = this.channel.listen<void>('onDidChangeServers');
	}

	getAll(): Promise<McpServerConfig[]> {
		return this.channel.call('getAll');
	}

	get(name: string): Promise<McpServerConfig | undefined> {
		return this.channel.call('get', [name]);
	}

	save(server: McpServerConfig): Promise<void> {
		return this.channel.call('save', [server]);
	}

	delete(name: string): Promise<void> {
		return this.channel.call('delete', [name]);
	}
}
