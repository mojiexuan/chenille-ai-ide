/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './chenilleSettingsPanel.css';
import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IAiModelStorageService } from '../../common/modelStorage.js';
import { IAiPromptStorageService } from '../../common/promptStorage.js';
import { ModelManagementPanel } from './modelManagementPanel.js';
import { PromptManagementPanel } from './promptManagementPanel.js';

export type PanelType = 'model' | 'prompt' | 'agent';

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
	];

	constructor(
		parent: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAiModelStorageService _modelStorage: IAiModelStorageService,
		@IAiPromptStorageService _promptStorage: IAiPromptStorageService,
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

			if (item.id === 'agent') {
				menuItem.classList.add('disabled');
				menuItem.title = localize('comingSoon', "即将推出");
			} else {
				menuItem.addEventListener('click', () => this.switchPanel(item.id));
			}
		}
	}

	private switchPanel(panelType: PanelType): void {
		if (panelType === 'agent') {
			return;
		}

		this.currentPanel = panelType;

		// Update menu active state
		this.menuItemElements.forEach((element, id) => {
			element.classList.toggle('active', id === panelType);
		});

		// Clear and render content
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
		}
	}
}
