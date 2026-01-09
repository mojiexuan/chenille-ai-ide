/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IMcpServerStorageService } from '../../common/storageIpc.js';
import { McpServerConfig, McpTransportType } from '../../common/types.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';

const TRANSPORT_OPTIONS: { value: McpTransportType; label: string }[] = [
	{ value: 'stdio', label: 'Stdio (命令行)' },
	{ value: 'sse', label: 'SSE (HTTP)' },
];

interface FormInputs {
	name: HTMLInputElement;
	displayName: HTMLInputElement;
	description: HTMLInputElement;
	transport: HTMLSelectElement;
	command: HTMLInputElement;
	args: HTMLInputElement;
	env: HTMLTextAreaElement;
	url: HTMLInputElement;
	enabled: HTMLInputElement;
	autoApprove: HTMLInputElement;
}

export class McpManagementPanel extends Disposable {
	private container: HTMLElement;
	private listContainer: HTMLElement | undefined;
	private formContainer: HTMLElement | undefined;
	private editingServer: McpServerConfig | undefined;
	private formInputs: FormInputs | undefined;
	private addBtn: HTMLElement | undefined;
	private headerActions: HTMLElement | undefined;

	constructor(
		parent: HTMLElement,
		@IMcpServerStorageService private readonly mcpStorage: IMcpServerStorageService,
	) {
		super();
		this.container = parent;
		this.render();
	}

	private render(): void {
		// 头部
		const header = append(this.container, $('.chenille-panel-header'));
		append(header, $('.chenille-panel-title')).textContent = localize('mcpManagement', "MCP 服务器");

		// 右侧操作区域
		this.headerActions = append(header, $('.chenille-panel-header-actions'));

		this.addBtn = append(this.headerActions, $('button.chenille-btn.chenille-btn-primary'));
		append(this.addBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
		append(this.addBtn, document.createTextNode(localize('addMcpServer', "添加服务器")));
		this.addBtn.addEventListener('click', () => this.showForm());

		// 列表
		this.listContainer = append(this.container, $('.chenille-panel-list'));
		this.renderList();

		// 表单（最初隐藏）
		this.formContainer = append(this.container, $('.chenille-form'));
		this.formContainer.style.display = 'none';
	}

	private async renderList(): Promise<void> {
		if (!this.listContainer) {
			return;
		}
		clearNode(this.listContainer);

		const servers = await this.mcpStorage.getAll();

		if (servers.length === 0) {
			const empty = append(this.listContainer, $('.chenille-empty-state'));
			empty.textContent = localize('noMcpServers', "暂无 MCP 服务器，点击上方按钮添加");
			return;
		}

		for (const server of servers) {
			const item = append(this.listContainer, $('.chenille-list-item'));
			if (!server.enabled) {
				item.style.opacity = '0.6';
			}

			const info = append(item, $('.chenille-list-item-info'));
			const nameContainer = append(info, $('.chenille-list-item-name-container'));
			append(nameContainer, $('.chenille-list-item-name')).textContent = server.displayName || server.name;

			if (!server.enabled) {
				const badge = append(nameContainer, $('.chenille-badge.chenille-badge-builtin'));
				badge.textContent = localize('disabled', "已禁用");
			}

			const desc = server.transport === 'stdio'
				? `${server.command} ${(server.args || []).join(' ')}`
				: server.url || '';
			append(info, $('.chenille-list-item-desc')).textContent = `${this.getTransportLabel(server.transport)} | ${desc}`;

			const actions = append(item, $('.chenille-list-item-actions'));

			const editBtn = append(actions, $('button.chenille-btn.chenille-btn-secondary'));
			append(editBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`));
			editBtn.title = localize('edit', "编辑");
			editBtn.addEventListener('click', () => this.showForm(server));

			const deleteBtn = append(actions, $('button.chenille-btn.chenille-btn-danger'));
			append(deleteBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.trash)}`));
			deleteBtn.title = localize('delete', "删除");
			deleteBtn.addEventListener('click', () => this.deleteServer(server.name));
		}
	}

	private showForm(server?: McpServerConfig): void {
		if (!this.formContainer || !this.listContainer || !this.headerActions || !this.addBtn) {
			return;
		}

		this.editingServer = server;
		this.listContainer.style.display = 'none';
		this.formContainer.style.display = 'flex';

		// 隐藏添加按钮，显示保存/取消按钮
		this.addBtn.style.display = 'none';
		this.renderHeaderActions();

		clearNode(this.formContainer);

		// 名称
		const nameInput = this.createInputGroup(this.formContainer, localize('serverName', "名称"), 'text', server?.name ?? '');
		nameInput.placeholder = 'my-mcp-server';
		if (server) {
			nameInput.readOnly = true;
		}

		// 显示名称
		const displayNameInput = this.createInputGroup(this.formContainer, localize('displayName', "显示名称"), 'text', server?.displayName ?? '');
		displayNameInput.placeholder = localize('optional', "可选");

		// 描述
		const descriptionInput = this.createInputGroup(this.formContainer, localize('description', "描述"), 'text', server?.description ?? '');
		descriptionInput.placeholder = localize('optional', "可选");

		// 传输类型
		const transportGroup = append(this.formContainer, $('.chenille-form-group'));
		append(transportGroup, $('.chenille-form-label')).textContent = localize('transport', "传输类型");
		const transportSelect = append(transportGroup, $('select.chenille-form-select')) as HTMLSelectElement;
		for (const opt of TRANSPORT_OPTIONS) {
			const option = append(transportSelect, $('option')) as HTMLOptionElement;
			option.value = opt.value;
			option.textContent = opt.label;
			if (server?.transport === opt.value) {
				option.selected = true;
			}
		}

		// Stdio 配置
		const stdioGroup = append(this.formContainer, $('.chenille-form-group'));
		stdioGroup.id = 'stdio-config';
		append(stdioGroup, $('.chenille-form-label')).textContent = localize('command', "命令");
		const commandInput = append(stdioGroup, $('input.chenille-form-input')) as HTMLInputElement;
		commandInput.type = 'text';
		commandInput.value = server?.command ?? '';
		commandInput.placeholder = 'uvx';

		const argsGroup = append(this.formContainer, $('.chenille-form-group'));
		argsGroup.id = 'args-config';
		append(argsGroup, $('.chenille-form-label')).textContent = localize('args', "参数");
		const argsInput = append(argsGroup, $('input.chenille-form-input')) as HTMLInputElement;
		argsInput.type = 'text';
		argsInput.value = (server?.args || []).join(' ');
		argsInput.placeholder = 'mcp-server-fetch';
		const argsHint = append(argsGroup, $('.chenille-form-hint'));
		argsHint.textContent = localize('argsHint', "多个参数用空格分隔");

		const envGroup = append(this.formContainer, $('.chenille-form-group'));
		envGroup.id = 'env-config';
		append(envGroup, $('.chenille-form-label')).textContent = localize('env', "环境变量");
		const envInput = append(envGroup, $('textarea.chenille-form-textarea')) as HTMLTextAreaElement;
		envInput.value = server?.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '';
		envInput.placeholder = 'KEY=value\nANOTHER_KEY=another_value';
		envInput.style.minHeight = '80px';

		// SSE 配置
		const sseGroup = append(this.formContainer, $('.chenille-form-group'));
		sseGroup.id = 'sse-config';
		append(sseGroup, $('.chenille-form-label')).textContent = localize('url', "URL");
		const urlInput = append(sseGroup, $('input.chenille-form-input')) as HTMLInputElement;
		urlInput.type = 'text';
		urlInput.value = server?.url ?? '';
		urlInput.placeholder = 'http://localhost:3000/sse';

		// 根据传输类型显示/隐藏配置
		const updateTransportConfig = () => {
			const isStdio = transportSelect.value === 'stdio';
			stdioGroup.style.display = isStdio ? 'flex' : 'none';
			argsGroup.style.display = isStdio ? 'flex' : 'none';
			envGroup.style.display = isStdio ? 'flex' : 'none';
			sseGroup.style.display = isStdio ? 'none' : 'flex';
		};
		transportSelect.addEventListener('change', updateTransportConfig);
		updateTransportConfig();

		// 启用
		const enabledGroup = append(this.formContainer, $('.chenille-form-group.chenille-form-group-checkbox'));
		const enabledLabel = append(enabledGroup, $('label.chenille-form-checkbox-label'));
		const enabledInput = append(enabledLabel, $('input.chenille-form-checkbox')) as HTMLInputElement;
		enabledInput.type = 'checkbox';
		enabledInput.checked = server?.enabled ?? true;
		append(enabledLabel, document.createTextNode(localize('enabled', "启用")));

		// 自动批准工具
		const autoApproveGroup = append(this.formContainer, $('.chenille-form-group'));
		append(autoApproveGroup, $('.chenille-form-label')).textContent = localize('autoApprove', "自动批准工具");
		const autoApproveInput = append(autoApproveGroup, $('input.chenille-form-input')) as HTMLInputElement;
		autoApproveInput.type = 'text';
		autoApproveInput.value = (server?.autoApprove || []).join(', ');
		autoApproveInput.placeholder = localize('autoApproveHint', "工具名称，逗号分隔，留空需手动确认");

		this.formInputs = {
			name: nameInput,
			displayName: displayNameInput,
			description: descriptionInput,
			transport: transportSelect,
			command: commandInput,
			args: argsInput,
			env: envInput,
			url: urlInput,
			enabled: enabledInput,
			autoApprove: autoApproveInput,
		};
	}

	private renderHeaderActions(): void {
		if (!this.headerActions || !this.addBtn) {
			return;
		}

		// 清除除了 addBtn 之外的所有元素
		const children = Array.from(this.headerActions.children);
		for (const child of children) {
			if (child !== this.addBtn) {
				child.remove();
			}
		}

		// 添加取消按钮
		const cancelBtn = append(this.headerActions, $('button.chenille-btn.chenille-btn-secondary'));
		append(cancelBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.close)}`));
		append(cancelBtn, document.createTextNode(localize('cancel', "取消")));
		cancelBtn.style.marginRight = '8px';
		cancelBtn.addEventListener('click', () => this.hideForm());

		// 添加保存按钮
		const saveBtn = append(this.headerActions, $('button.chenille-btn.chenille-btn-primary'));
		append(saveBtn, $(`span${ThemeIcon.asCSSSelector(Codicon.check)}`));
		append(saveBtn, document.createTextNode(localize('save', "保存")));
		saveBtn.addEventListener('click', () => this.saveServer());
	}

	private createInputGroup(parent: HTMLElement, label: string, type: string, value: string): HTMLInputElement {
		const group = append(parent, $('.chenille-form-group'));
		append(group, $('.chenille-form-label')).textContent = label;
		const input = append(group, $('input.chenille-form-input')) as HTMLInputElement;
		input.type = type;
		input.value = value;
		return input;
	}

	private hideForm(): void {
		if (!this.formContainer || !this.listContainer || !this.headerActions || !this.addBtn) {
			return;
		}

		this.editingServer = undefined;
		this.formInputs = undefined;
		this.formContainer.style.display = 'none';
		this.listContainer.style.display = 'flex';

		// 恢复添加按钮，移除保存/取消按钮
		this.addBtn.style.display = '';
		const children = Array.from(this.headerActions.children);
		for (const child of children) {
			if (child !== this.addBtn) {
				child.remove();
			}
		}

		this.renderList();
	}

	private async saveServer(): Promise<void> {
		if (!this.formInputs) {
			return;
		}

		const name = this.formInputs.name.value.trim();
		if (!name) {
			alert(localize('nameRequired', "名称不能为空"));
			return;
		}

		// 解析环境变量
		const envLines = this.formInputs.env.value.trim().split('\n').filter(l => l.trim());
		const env: Record<string, string> = {};
		for (const line of envLines) {
			const idx = line.indexOf('=');
			if (idx > 0) {
				env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
			}
		}

		// 解析参数
		const args = this.formInputs.args.value.trim().split(/\s+/).filter(a => a);

		// 解析自动批准工具
		const autoApprove = this.formInputs.autoApprove.value.trim()
			.split(',')
			.map(s => s.trim())
			.filter(s => s);

		const server: McpServerConfig = {
			name,
			displayName: this.formInputs.displayName.value.trim() || undefined,
			description: this.formInputs.description.value.trim() || undefined,
			transport: this.formInputs.transport.value as McpTransportType,
			command: this.formInputs.command.value.trim() || undefined,
			args: args.length > 0 ? args : undefined,
			env: Object.keys(env).length > 0 ? env : undefined,
			url: this.formInputs.url.value.trim() || undefined,
			enabled: this.formInputs.enabled.checked,
			autoApprove: autoApprove.length > 0 ? autoApprove : undefined,
		};

		// 验证
		if (server.transport === 'stdio' && !server.command) {
			alert(localize('commandRequired', "Stdio 传输需要指定命令"));
			return;
		}
		if (server.transport === 'sse' && !server.url) {
			alert(localize('urlRequired', "SSE 传输需要指定 URL"));
			return;
		}

		// 添加新时检查重复名称
		if (!this.editingServer && await this.mcpStorage.get(server.name)) {
			alert(localize('nameDuplicate', "名称已存在"));
			return;
		}

		await this.mcpStorage.save(server);
		this.hideForm();
	}

	private async deleteServer(name: string): Promise<void> {
		if (confirm(localize('confirmDelete', "确定要删除服务器 '{0}' 吗？", name))) {
			await this.mcpStorage.delete(name);
			this.renderList();
		}
	}

	private getTransportLabel(transport: McpTransportType): string {
		return TRANSPORT_OPTIONS.find(t => t.value === transport)?.label ?? transport;
	}
}
