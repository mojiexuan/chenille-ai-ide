/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../workbench/common/contributions.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../platform/workspace/common/workspace.js';
import { IChenilleIndexingService } from '../../common/indexing/indexingService.js';

/**
 * 索引激活 Contribution
 * 在工作区恢复后自动激活已启用的索引
 */
export class IndexActivationContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chenilleIndexActivation';

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IChenilleIndexingService private readonly indexingService: IChenilleIndexingService,
	) {
		super();

		// 激活当前所有工作区
		this.activateWorkspaces();
	}

	private async activateWorkspaces(): Promise<void> {
		const workspace = this.workspaceContextService.getWorkspace();
		const folders = workspace.folders;

		if (folders.length === 0) {
			console.log('[IndexActivationContribution] 没有打开的工作区');
			return;
		}

		console.log(`[IndexActivationContribution] 激活 ${folders.length} 个工作区...`);

		// 并行激活所有工作区（但不等待完成，避免阻塞启动）
		for (const folder of folders) {
			this.activateFolder(folder);
		}
	}

	private async activateFolder(folder: IWorkspaceFolder): Promise<void> {
		try {
			await this.indexingService.activateWorkspace(folder.uri.fsPath);
		} catch (error) {
			console.error(`[IndexActivationContribution] 激活工作区失败: ${folder.uri.fsPath}`, error);
		}
	}
}
