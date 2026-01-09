/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ChatContextKeys } from '../../common/chatContextKeys.js';
import { ConfirmedReason, IChatToolInvocation, ToolConfirmKind } from '../../common/chatService.js';
import { isResponseVM } from '../../common/chatViewModel.js';
import { IChatWidgetService } from '../chat.js';
import { CHAT_CATEGORY } from './chatActions.js';

// Chenille: 以下 import 用于被注释掉的 ConfigureToolsAction
// import { Codicon } from '../../../../../base/common/codicons.js';
// import { IChatWidget } from '../chat.js';
// import { $ } from '../../../../../base/browser/dom.js';
// import { Iterable } from '../../../../../base/common/iterator.js';
// import { markAsSingleton } from '../../../../../base/common/lifecycle.js';
// import { ThemeIcon } from '../../../../../base/common/themables.js';
// import { localize } from '../../../../../nls.js';
// import { IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
// import { MenuEntryActionViewItem } from '../../../../../platform/actions/browser/menuEntryActionViewItem.js';
// import { MenuId, MenuItemAction } from '../../../../../platform/actions/common/actions.js';
// import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
// import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
// import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
// import { ChatModeKind } from '../../common/constants.js';
// import { ToolsScope } from '../chatSelectedTools.js';
// import { showToolsPicker } from './chatToolPicker.js';


// Chenille: 以下类型定义用于被注释掉的 ConfigureToolsAction
// type SelectedToolData = {
// 	enabled: number;
// 	total: number;
// };
// type SelectedToolClassification = {
// 	owner: 'connor4312';
// 	comment: 'Details the capabilities of the MCP server';
// 	enabled: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Number of enabled chat tools' };
// 	total: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Number of total chat tools' };
// };

export const AcceptToolConfirmationActionId = 'workbench.action.chat.acceptTool';
export const SkipToolConfirmationActionId = 'workbench.action.chat.skipTool';
export const AcceptToolPostConfirmationActionId = 'workbench.action.chat.acceptToolPostExecution';
export const SkipToolPostConfirmationActionId = 'workbench.action.chat.skipToolPostExecution';

abstract class ToolConfirmationAction extends Action2 {
	protected abstract getReason(): ConfirmedReason;

	run(accessor: ServicesAccessor, ...args: unknown[]) {
		const chatWidgetService = accessor.get(IChatWidgetService);
		const widget = chatWidgetService.lastFocusedWidget;
		const lastItem = widget?.viewModel?.getItems().at(-1);
		if (!isResponseVM(lastItem)) {
			return;
		}

		for (const item of lastItem.model.response.value) {
			const state = item.kind === 'toolInvocation' ? item.state.get() : undefined;
			if (state?.type === IChatToolInvocation.StateKind.WaitingForConfirmation || state?.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
				state.confirm(this.getReason());
				break;
			}
		}

		// Return focus to the chat input, in case it was in the tool confirmation editor
		widget?.focusInput();
	}
}

class AcceptToolConfirmation extends ToolConfirmationAction {
	constructor() {
		super({
			id: AcceptToolConfirmationActionId,
			title: localize2('chat.accept', "同意"),
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(ChatContextKeys.inChatSession, ChatContextKeys.Editing.hasToolConfirmation),
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				// Override chatEditor.action.accept
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	protected override getReason(): ConfirmedReason {
		return { type: ToolConfirmKind.UserAction };
	}
}

class SkipToolConfirmation extends ToolConfirmationAction {
	constructor() {
		super({
			id: SkipToolConfirmationActionId,
			title: localize2('chat.skip', "跳过"),
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(ChatContextKeys.inChatSession, ChatContextKeys.Editing.hasToolConfirmation),
				primary: KeyMod.CtrlCmd | KeyCode.Enter | KeyMod.Alt,
				// Override chatEditor.action.accept
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	protected override getReason(): ConfirmedReason {
		return { type: ToolConfirmKind.Skipped };
	}
}

// Chenille: 使用自定义工具系统，禁用原有的配置工具按钮
/*
class ConfigureToolsAction extends Action2 {
	public static ID = 'workbench.action.chat.configureTools';

	constructor() {
		super({
			id: ConfigureToolsAction.ID,
			title: localize('label', "配置工具..."),
			icon: Codicon.tools,
			f1: false,
			category: CHAT_CATEGORY,
			precondition: ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
			menu: [{
				when: ContextKeyExpr.and(ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent), ChatContextKeys.lockedToCodingAgent.negate()),
				id: MenuId.ChatInput,
				group: 'navigation',
				order: 100,
			}]
		});
	}

	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {

		const instaService = accessor.get(IInstantiationService);
		const chatWidgetService = accessor.get(IChatWidgetService);
		const telemetryService = accessor.get(ITelemetryService);

		let widget = chatWidgetService.lastFocusedWidget;
		if (!widget) {
			type ChatActionContext = { widget: IChatWidget };
			function isChatActionContext(obj: unknown): obj is ChatActionContext {
				return !!obj && typeof obj === 'object' && !!(obj as ChatActionContext).widget;
			}
			const context = args[0];
			if (isChatActionContext(context)) {
				widget = context.widget;
			}
		}

		if (!widget) {
			return;
		}

		let placeholder;
		let description;
		const { entriesScope, entriesMap } = widget.input.selectedToolsModel;
		switch (entriesScope) {
			case ToolsScope.Session:
				placeholder = localize('chat.tools.placeholder.session', "为此聊天会话选择工具");
				description = localize('chat.tools.description.session', "所选工具仅为此聊天会话配置。");
				break;
			case ToolsScope.Agent:
				placeholder = localize('chat.tools.placeholder.agent', "为此自定义代理选择工具");
				description = localize('chat.tools.description.agent', "所选工具由｛0｝自定义代理配置。对工具的更改也将应用于自定义代理文件。", widget.input.currentModeObs.get().label.get());
				break;
			case ToolsScope.Agent_ReadOnly:
				placeholder = localize('chat.tools.placeholder.readOnlyAgent', "为此自定义代理选择工具");
				description = localize('chat.tools.description.readOnlyAgent', "所选工具由｛0｝自定义代理配置。对工具的更改将仅用于此会话，不会更改｛0｝自定义代理。", widget.input.currentModeObs.get().label.get());
				break;
			case ToolsScope.Global:
				placeholder = localize('chat.tools.placeholder.global', "选择可用于聊天的工具。");
				description = localize('chat.tools.description.global', "所选工具将全局应用于使用默认代理的所有聊天会话。");
				break;

		}

		const result = await instaService.invokeFunction(showToolsPicker, placeholder, description, () => entriesMap.get());
		if (result) {
			widget.input.selectedToolsModel.set(result, false);
		}

		const tools = widget.input.selectedToolsModel.entriesMap.get();
		telemetryService.publicLog2<SelectedToolData, SelectedToolClassification>('chat/selectedTools', {
			total: tools.size,
			enabled: Iterable.reduce(tools, (prev, [_, enabled]) => enabled ? prev + 1 : prev, 0),
		});
	}
}

class ConfigureToolsActionRendering implements IWorkbenchContribution {

	static readonly ID = 'chat.configureToolsActionRendering';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
	) {
		const disposable = actionViewItemService.register(MenuId.ChatInput, ConfigureToolsAction.ID, (action, _opts, instantiationService) => {
			if (!(action instanceof MenuItemAction)) {
				return undefined;
			}
			return instantiationService.createInstance(class extends MenuEntryActionViewItem {
				private warningElement!: HTMLElement;

				override render(container: HTMLElement): void {
					super.render(container);

					// Add warning indicator element
					this.warningElement = $(`.tool-warning-indicator${ThemeIcon.asCSSSelector(Codicon.warning)}`);
					this.warningElement.style.display = 'none';
					container.appendChild(this.warningElement);
					container.style.position = 'relative';

					// Set up context key listeners
					this.updateWarningState();
					this._register(this._contextKeyService.onDidChangeContext(() => {
						this.updateWarningState();
					}));
				}

				private updateWarningState(): void {
					const wasShown = this.warningElement.style.display === 'block';
					const shouldBeShown = this.isAboveToolLimit();

					if (!wasShown && shouldBeShown) {
						this.warningElement.style.display = 'block';
						this.updateTooltip();
					} else if (wasShown && !shouldBeShown) {
						this.warningElement.style.display = 'none';
						this.updateTooltip();
					}
				}

				protected override getTooltip(): string {
					if (this.isAboveToolLimit()) {
						const warningMessage = localize('chatTools.tooManyEnabled', '启用了｛0｝个以上的工具，您可能会遇到工具调用降级。', this._contextKeyService.getContextKeyValue(ChatContextKeys.chatToolGroupingThreshold.key));
						return `${warningMessage}`;
					}

					return super.getTooltip();
				}

				private isAboveToolLimit() {
					const rawToolLimit = this._contextKeyService.getContextKeyValue(ChatContextKeys.chatToolGroupingThreshold.key);
					const rawToolCount = this._contextKeyService.getContextKeyValue(ChatContextKeys.chatToolCount.key);
					if (rawToolLimit === undefined || rawToolCount === undefined) {
						return false;
					}

					const toolLimit = Number(rawToolLimit || 0);
					const toolCount = Number(rawToolCount || 0);
					return toolCount > toolLimit;
				}
			}, action, undefined);
		});

		// Reduces flicker a bit on reload/restart
		markAsSingleton(disposable);
	}
}
*/

export function registerChatToolActions() {
	registerAction2(AcceptToolConfirmation);
	registerAction2(SkipToolConfirmation);
	// Chenille: 使用自定义工具系统，禁用原有的配置工具按钮
	// registerAction2(ConfigureToolsAction);
	// registerWorkbenchContribution2(ConfigureToolsActionRendering.ID, ConfigureToolsActionRendering, WorkbenchPhase.BlockRestore);
}
