/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IAiAgentStorageService, IAiModelStorageService, IAiPromptStorageService } from '../../common/storageIpc.js';
import { AgentType, AiAgentConfig } from '../../common/types.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';

interface AgentDefinition {
	type: AgentType;
	name: string;
	description: string;
	icon: ThemeIcon;
}

const AGENT_DEFINITIONS: AgentDefinition[] = [
	{
		type: AgentType.COMMIT_MESSAGE,
		name: localize('commitMessageAgent', "Commit 消息生成"),
		description: localize('commitMessageAgentDesc', "自动生成 Git 提交消息"),
		icon: Codicon.gitCommit,
	},
	{
		type: AgentType.CODE_WRITER,
		name: localize('codeWriterAgent', "代码编写"),
		description: localize('codeWriterAgentDesc', "辅助编写和生成代码"),
		icon: Codicon.code,
	},
];

export class AgentManagementPanel extends Disposable {
	private container: HTMLElement;
	private listContainer: HTMLElement | undefined;

	constructor(
		parent: HTMLElement,
		@IAiAgentStorageService private readonly agentStorage: IAiAgentStorageService,
		@IAiModelStorageService private readonly modelStorage: IAiModelStorageService,
		@IAiPromptStorageService private readonly promptStorage: IAiPromptStorageService,
	) {
		super();
		this.container = parent;
		this.render();
	}

	private render(): void {
		const header = append(this.container, $('.chenille-panel-header'));
		append(header, $('.chenille-panel-title')).textContent = localize('agentManagement', "智能体管理");

		this.listContainer = append(this.container, $('.chenille-panel-list'));
		this.renderList();
	}

	private async renderList(): Promise<void> {
		if (!this.listContainer) {
			return;
		}
		clearNode(this.listContainer);

		const models = await this.modelStorage.getAll();
		const prompts = await this.promptStorage.getAll();

		for (const agent of AGENT_DEFINITIONS) {
			const config = await this.agentStorage.get(agent.type);
			const item = append(this.listContainer, $('.chenille-agent-item'));

			// 头部：图标 + 名称 + 描述
			const headerRow = append(item, $('.chenille-agent-header'));
			const iconSpan = append(headerRow, $(`span${ThemeIcon.asCSSSelector(agent.icon)}`));
			iconSpan.classList.add('chenille-agent-icon');

			const info = append(headerRow, $('.chenille-agent-info'));
			append(info, $('.chenille-agent-name')).textContent = agent.name;
			append(info, $('.chenille-agent-desc')).textContent = agent.description;

			// 配置区域
			const configRow = append(item, $('.chenille-agent-config'));

			// 模型选择
			const modelGroup = append(configRow, $('.chenille-config-group'));
			append(modelGroup, $('.chenille-config-label')).textContent = localize('model', "模型");
			const modelSelect = append(modelGroup, $('select.chenille-form-select')) as HTMLSelectElement;

			const defaultModelOption = append(modelSelect, $('option')) as HTMLOptionElement;
			defaultModelOption.value = '';
			defaultModelOption.textContent = localize('selectModel', "-- 请选择模型 --");

			for (const model of models) {
				const option = append(modelSelect, $('option')) as HTMLOptionElement;
				option.value = model.name;
				option.textContent = model.name;
				if (config?.modelName === model.name) {
					option.selected = true;
				}
			}

			// 提示词选择
			const promptGroup = append(configRow, $('.chenille-config-group'));
			append(promptGroup, $('.chenille-config-label')).textContent = localize('prompt', "提示词");
			const promptSelect = append(promptGroup, $('select.chenille-form-select')) as HTMLSelectElement;

			const defaultPromptOption = append(promptSelect, $('option')) as HTMLOptionElement;
			defaultPromptOption.value = '';
			defaultPromptOption.textContent = localize('selectPrompt', "-- 请选择提示词 --");

			for (const prompt of prompts) {
				const option = append(promptSelect, $('option')) as HTMLOptionElement;
				option.value = prompt.name;
				option.textContent = prompt.name;
				if (config?.promptName === prompt.name) {
					option.selected = true;
				}
			}

			// 监听变化并保存
			const saveConfig = async () => {
				const newConfig: AiAgentConfig = {
					type: agent.type,
					modelName: modelSelect.value,
					promptName: promptSelect.value,
				};
				await this.agentStorage.save(newConfig);
			};

			modelSelect.addEventListener('change', saveConfig);
			promptSelect.addEventListener('change', saveConfig);
		}

		// 空提示
		if (models.length === 0 || prompts.length === 0) {
			const tip = append(this.listContainer, $('.chenille-agent-tip'));
			if (models.length === 0 && prompts.length === 0) {
				tip.textContent = localize('noModelsAndPrompts', "请先添加模型和提示词");
			} else if (models.length === 0) {
				tip.textContent = localize('noModelsForAgent', "请先添加模型");
			} else {
				tip.textContent = localize('noPromptsForAgent', "请先添加提示词");
			}
		}
	}
}
