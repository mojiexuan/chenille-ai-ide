/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { EditorResourceAccessor, EditorsOrder } from '../../../workbench/common/editor.js';
import {
	FileToolResult,
	GetOpenEditorsParams,
	GetOpenEditorsResult,
	OpenEditorInfo
} from './types.js';
import { toRelativePath } from './fileUtils.js';

/**
 * 获取当前打开的编辑器列表
 */
export async function getOpenEditors(
	params: GetOpenEditorsParams,
	editorService: IEditorService,
	workspaceService: IWorkspaceContextService
): Promise<FileToolResult<GetOpenEditorsResult>> {
	try {
		const activeOnly = params.activeOnly ?? false;
		const editors: OpenEditorInfo[] = [];
		let activeEditorPath: string | null = null;

		// 获取活动编辑器
		const activeEditor = editorService.activeEditor;
		const activeEditorUri = activeEditor ? EditorResourceAccessor.getOriginalUri(activeEditor) : null;

		if (activeEditorUri) {
			activeEditorPath = toRelativePath(activeEditorUri, workspaceService);
		}

		if (activeOnly) {
			// 只返回活动编辑器
			if (activeEditor && activeEditorUri) {
				editors.push({
					path: activeEditorPath!,
					name: activeEditor.getName(),
					isActive: true,
					isDirty: activeEditor.isDirty(),
					groupIndex: 0
				});
			}
		} else {
			// 返回所有打开的编辑器，使用 getEditors 方法
			const allEditors = editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);

			for (const editorIdentifier of allEditors) {
				const editor = editorIdentifier.editor;
				const uri = EditorResourceAccessor.getOriginalUri(editor);
				if (uri) {
					const relativePath = toRelativePath(uri, workspaceService);
					const isActive = activeEditorUri?.toString() === uri.toString();

					editors.push({
						path: relativePath,
						name: editor.getName(),
						isActive,
						isDirty: editor.isDirty(),
						groupIndex: editorIdentifier.groupId
					});
				}
			}
		}

		// 按活动状态排序，活动编辑器在前
		editors.sort((a, b) => {
			if (a.isActive && !b.isActive) return -1;
			if (!a.isActive && b.isActive) return 1;
			return 0;
		});

		return {
			success: true,
			data: {
				editors,
				activeEditorPath,
				totalCount: editors.length
			}
		};

	} catch (error) {
		return {
			success: false,
			error: `获取打开的编辑器失败: ${error instanceof Error ? error.message : String(error)}`,
			errorCode: 'UNKNOWN_ERROR'
		};
	}
}
