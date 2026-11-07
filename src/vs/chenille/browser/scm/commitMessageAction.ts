/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { relativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IPathService } from '../../../platform/path/common/pathService.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { ISCMInputValueProviderContext, ISCMService } from '../../../workbench/contrib/scm/common/scm.js';
import { ICommitMessageService } from '../../common/commitMessage.js';
import { CHENILLE_HOME_DIR_NAME, COMMIT_MESSAGE_RULES_DISPLAY_PATH, COMMIT_MESSAGE_RULES_FILE_NAME, DEFAULT_COMMIT_MESSAGE_RULES } from '../../common/commitMessageRules.js';
import * as nls from '../../../nls.js';

/**
 * Command id executed by the Chenille commit message action. The official SCM
 * input action delegates to this command when it is registered.
 */
export const ChenilleGenerateCommitMessageCommandId = 'chenille.scm.generateCommitMessage';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ChenilleGenerateCommitMessageCommandId,
			title: nls.localize('chenille.scm.generateCommitMessage', "Generate Commit Message"),
			icon: Codicon.sparkle,
			f1: false,
			menu: {
				id: MenuId.SCMInputBox,
				order: 1,
				when: ContextKeyExpr.equals('scmProvider', 'git')
			}
		});
	}

	override async run(accessor: ServicesAccessor, provider: URI | undefined, context: ISCMInputValueProviderContext[] | undefined, token: CancellationToken | undefined): Promise<void> {
		if (!provider || !context) {
			return;
		}

		const scmService = accessor.get(ISCMService);
		const notificationService = accessor.get(INotificationService);
		const commitMessageService = accessor.get(ICommitMessageService);
		const configurationService = accessor.get(IConfigurationService);

		const repository = [...scmService.repositories].find(r => r.provider.rootUri?.toString() === provider.toString());
		if (!repository?.provider.rootUri) {
			return;
		}

		const stagedPaths: string[] = [];
		const workingTreePaths: string[] = [];
		const untrackedPaths: string[] = [];

		for (const group of context) {
			const target = group.resourceGroupId === 'index' ? stagedPaths
				: group.resourceGroupId === 'workingTree' ? workingTreePaths
					: group.resourceGroupId === 'untracked' ? untrackedPaths
						: undefined;
			if (!target) {
				continue;
			}

			for (const resource of group.resources) {
				const path = relativePath(repository.provider.rootUri, resource);
				if (path) {
					target.push(path);
				}
			}
		}

		if (stagedPaths.length + workingTreePaths.length + untrackedPaths.length === 0) {
			notificationService.info(nls.localize('chenille.scm.noChanges', "没有检测到代码变更"));
			return;
		}

		const gitPathConfig = configurationService.getValue<string | string[] | null>('git.path');
		const gitPathHints = Array.isArray(gitPathConfig) ? gitPathConfig : gitPathConfig ? [gitPathConfig] : [];

		try {
			repository.input.setValue('', false);

			let content = '';
			const disposable = commitMessageService.onStreamChunk(chunk => {
				if (token?.isCancellationRequested) {
					return;
				}
				content += chunk;
				repository.input.setValue(content, false);
			});

			try {
				await commitMessageService.generateCommitMessageStream({
					rootPath: repository.provider.rootUri.fsPath,
					gitPathHints,
					stagedPaths,
					workingTreePaths,
					untrackedPaths,
				}, token);
			} finally {
				disposable.dispose();
			}
		} catch (error) {
			notificationService.error(nls.localize('chenille.scm.generateCommitMessageError', "生成提交消息失败: {0}", String(error)));
		}
	}
});

/**
 * 打开（必要时创建）全局提交消息规则文件，供用户编辑生成 commit message 的提示词。
 */
export const ChenilleEditCommitMessageRulesCommandId = 'chenille.scm.editCommitMessageRules';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ChenilleEditCommitMessageRulesCommandId,
			title: nls.localize('chenille.scm.editCommitMessageRules', "变更 Commit 规则"),
			icon: Codicon.settings,
			f1: false,
			menu: {
				id: MenuId.SCMInputBox,
				order: 2,
				when: ContextKeyExpr.equals('scmProvider', 'git')
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const fileService = accessor.get(IFileService);
		const openerService = accessor.get(IOpenerService);
		const userHome = await accessor.get(IPathService).userHome();

		const chenilleHome = URI.joinPath(userHome, CHENILLE_HOME_DIR_NAME);
		const rulesUri = URI.joinPath(chenilleHome, COMMIT_MESSAGE_RULES_FILE_NAME);

		try {
			if (!(await fileService.exists(rulesUri))) {
				await fileService.createFolder(chenilleHome);
				await fileService.writeFile(rulesUri, VSBuffer.fromString(DEFAULT_COMMIT_MESSAGE_RULES));
				notificationService.info(nls.localize('chenille.scm.commitMessageRulesCreated', "已创建提交消息规则文件: {0}", COMMIT_MESSAGE_RULES_DISPLAY_PATH));
			}
			await openerService.open(rulesUri);
		} catch (error) {
			notificationService.error(nls.localize('chenille.scm.editCommitMessageRulesError', "打开提交消息规则文件失败: {0}", String(error)));
		}
	}
});
