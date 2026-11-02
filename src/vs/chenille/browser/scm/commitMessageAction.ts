/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { URI } from '../../../base/common/uri.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { ISCMInputValueProviderContext, ISCMService } from '../../../workbench/contrib/scm/common/scm.js';
import { ICommitMessageService } from '../../common/commitMessage.js';
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
		const fileService = accessor.get(IFileService);
		const logService = accessor.get(ILogService);

		const repository = [...scmService.repositories].find(r => r.provider.rootUri?.toString() === provider.toString());
		if (!repository) {
			return;
		}

		interface FileChange {
			uri: URI;
			relativePath: string;
			groupId: string;
		}
		const fileChanges: FileChange[] = [];

		for (const group of context) {
			for (const resource of group.resources) {
				const relativePath = repository.provider.rootUri
					? resource.fsPath.replace(repository.provider.rootUri.fsPath, '').replace(/^[/\\]/, '').replace(/\\/g, '/')
					: resource.fsPath;
				fileChanges.push({
					uri: resource,
					relativePath,
					groupId: group.resourceGroupId
				});
			}
		}

		if (fileChanges.length === 0) {
			notificationService.info(nls.localize('chenille.scm.noChanges', "没有检测到代码变更"));
			return;
		}

		try {
			const diffParts: string[] = [];

			for (const change of fileChanges) {
				try {
					const isStaged = change.groupId.includes('index') || change.groupId.includes('staged');
					const isUntracked = change.groupId.includes('untracked');

					let currentContent = '';
					let fileExists = true;
					try {
						const content = await fileService.readFile(change.uri);
						currentContent = content.value.toString();
					} catch {
						fileExists = false;
					}

					if (isUntracked) {
						if (currentContent) {
							const lines = currentContent.split('\n');
							const maxLines = 80;
							const preview = lines.slice(0, maxLines).map(l => `+ ${l}`).join('\n');
							const suffix = lines.length > maxLines ? `\n... (还有 ${lines.length - maxLines} 行)` : '';
							diffParts.push(`--- /dev/null\n+++ b/${change.relativePath}\n@@ -0,0 +1,${lines.length} @@\n${preview}${suffix}`);
						} else {
							diffParts.push(`新文件: ${change.relativePath} (无法读取内容)`);
						}
					} else if (!fileExists) {
						diffParts.push(`删除文件: ${change.relativePath}`);
					} else {
						const lines = currentContent.split('\n');
						const maxLines = 60;
						const preview = lines.slice(0, maxLines).join('\n');
						const suffix = lines.length > maxLines ? `\n... (文件共 ${lines.length} 行，已省略部分内容)` : '';

						diffParts.push(`修改文件: ${change.relativePath}${isStaged ? ' (已暂存)' : ''}\n当前内容预览:\n\`\`\`\n${preview}${suffix}\n\`\`\``);
					}
				} catch (e) {
					logService.warn(`[Chenille] 处理文件 ${change.relativePath} 失败: ${e}`);
					diffParts.push(`文件: ${change.relativePath} (处理失败)`);
				}
			}

			const diffSummary = `以下是本次提交的变更信息：\n\n变更文件数: ${fileChanges.length}\n\n${diffParts.join('\n\n---\n\n')}`;

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
				await commitMessageService.generateCommitMessageStream(diffSummary, token);
			} finally {
				disposable.dispose();
			}
		} catch (error) {
			notificationService.error(nls.localize('chenille.scm.generateCommitMessageError', "生成提交消息失败: {0}", String(error)));
		}
	}
});
