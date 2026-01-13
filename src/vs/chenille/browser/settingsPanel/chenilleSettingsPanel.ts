/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './chenilleSettingsPanel.css';
import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ModelManagementPanel } from './modelManagementPanel.js';
import { PromptManagementPanel } from './promptManagementPanel.js';
import { AgentManagementPanel } from './agentManagementPanel.js';
import { McpManagementPanel } from './mcpManagementPanel.js';
import { GlobalRulesPanel } from './globalRulesPanel.js';

export type PanelType = 'model' | 'prompt' | 'agent' | 'mcp' | 'rules';

interface MenuItem {
	id: PanelType;
	label: string;
	icon: string;
}

export class ChenilleSettingsPanel extends Disposable {
	private container: HTMLElement;
	private menuContainer: HTMLElement;
	private contentContainer: HTMLElement;
	private currentPanel: PanelType = 'model';
	private readonly panelDisposables = this._register(new DisposableStore());
	private menuItemElements: Map<PanelType, HTMLElement> = new Map();

	private readonly menuItems: MenuItem[] = [
		{ id: 'model', label: localize('modelManagement', "模型管理"), icon: 'codicon-server' },
		{ id: 'prompt', label: localize('promptManagement', "提示词管理"), icon: 'codicon-note' },
		{ id: 'agent', label: localize('agentManagement', "智能体管理"), icon: 'codicon-hubot' },
		{ id: 'mcp', label: localize('mcpManagement', "MCP 服务器"), icon: 'codicon-plug' },
		{ id: 'rules', label: localize('rulesManagement', "规则管理"), icon: 'codicon-law' },
	];

	constructor(
		parent: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.container = append(parent, $('.chenille-settings-panel'));
		this.menuContainer = append(this.container, $('.chenille-settings-menu'));
		this.contentContainer = append(this.container, $('.chenille-settings-content'));

		this.renderMenu();
		this.switchPanel('model');
	}

	private renderMenu(): void {
		for (const item of this.menuItems) {
			const menuItem = append(this.menuContainer, $('.chenille-menu-item'));
			menuItem.dataset.id = item.id;
			this.menuItemElements.set(item.id, menuItem);

			const icon = append(menuItem, $(`span.codicon.${item.icon}`));
			icon.style.marginRight = '8px';

			append(menuItem, document.createTextNode(item.label));

			if (item.id === this.currentPanel) {
				menuItem.classList.add('active');
			}

			menuItem.addEventListener('click', () => this.switchPanel(item.id));
		}
	}

	private switchPanel(panelType: PanelType): void {
		this.currentPanel = panelType;

		// 更新菜单活动状态
		this.menuItemElements.forEach((element, id) => {
			element.classList.toggle('active', id === panelType);
		});

		// 清除并呈现内容
		this.panelDisposables.clear();
		clearNode(this.contentContainer);

		switch (panelType) {
			case 'model':
				this.panelDisposables.add(
					this.instantiationService.createInstance(ModelManagementPanel, this.contentContainer)
				);
				break;
			case 'prompt':
				this.panelDisposables.add(
					this.instantiationService.createInstance(PromptManagementPanel, this.contentContainer)
				);
				break;
			case 'agent':
				this.panelDisposables.add(
					this.instantiationService.createInstance(AgentManagementPanel, this.contentContainer)
				);
				break;
			case 'mcp':
				this.panelDisposables.add(
					this.instantiationService.createInstance(McpManagementPanel, this.contentContainer)
				);
				break;
			case 'rules':
				this.panelDisposables.add(
					this.instantiationService.createInstance(GlobalRulesPanel, this.contentContainer)
				);
				break;
		}
	}
}
