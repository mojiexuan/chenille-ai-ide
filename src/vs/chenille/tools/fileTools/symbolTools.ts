/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { URI } from '../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { ITextModelService } from '../../../editor/common/services/resolverService.js';
import { IOutlineModelService, OutlineElement } from '../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { getWorkspaceSymbols } from '../../../workbench/contrib/search/common/search.js';
import { SymbolKind } from '../../../editor/common/languages.js';
import { FileToolResult, GetWorkspaceSymbolsParams, GetFileOutlineParams } from './types.js';

/**
 * SymbolKind 枚举值转换为可读名称
 */
function symbolKindToString(kind: SymbolKind): string {
	const kindNames: Record<SymbolKind, string> = {
		[SymbolKind.File]: 'File',
		[SymbolKind.Module]: 'Module',
		[SymbolKind.Namespace]: 'Namespace',
		[SymbolKind.Package]: 'Package',
		[SymbolKind.Class]: 'Class',
		[SymbolKind.Method]: 'Method',
		[SymbolKind.Property]: 'Property',
		[SymbolKind.Field]: 'Field',
		[SymbolKind.Constructor]: 'Constructor',
		[SymbolKind.Enum]: 'Enum',
		[SymbolKind.Interface]: 'Interface',
		[SymbolKind.Function]: 'Function',
		[SymbolKind.Variable]: 'Variable',
		[SymbolKind.Constant]: 'Constant',
		[SymbolKind.String]: 'String',
		[SymbolKind.Number]: 'Number',
		[SymbolKind.Boolean]: 'Boolean',
		[SymbolKind.Array]: 'Array',
		[SymbolKind.Object]: 'Object',
		[SymbolKind.Key]: 'Key',
		[SymbolKind.Null]: 'Null',
		[SymbolKind.EnumMember]: 'EnumMember',
		[SymbolKind.Struct]: 'Struct',
		[SymbolKind.Event]: 'Event',
		[SymbolKind.Operator]: 'Operator',
		[SymbolKind.TypeParameter]: 'TypeParameter',
	};
	return kindNames[kind] || 'Unknown';
}

/**
 * 搜索工作区符号（类、函数、变量等）
 */
export async function getWorkspaceSymbolsTool(
	params: GetWorkspaceSymbolsParams,
	workspaceService: IWorkspaceContextService,
	token: CancellationToken = CancellationToken.None
): Promise<FileToolResult> {
	const { query, maxResults = 50, kindFilter } = params;

	// 检查是否有工作区
	const folders = workspaceService.getWorkspace().folders;
	if (folders.length === 0) {
		return { success: false, error: '没有打开的工作区' };
	}

	try {
		const symbols = await getWorkspaceSymbols(query || '', token);

		if (token.isCancellationRequested) {
			return { success: false, error: '搜索已取消' };
		}

		// 过滤符号类型
		let filteredSymbols = symbols;
		if (kindFilter && kindFilter.length > 0) {
			const kindSet = new Set(kindFilter.map(k => k.toLowerCase()));
			filteredSymbols = symbols.filter(item => {
				const kindName = symbolKindToString(item.symbol.kind).toLowerCase();
				return kindSet.has(kindName);
			});
		}

		// 限制结果数量
		const limitedSymbols = filteredSymbols.slice(0, maxResults);

		// 格式化输出
		const results = limitedSymbols.map(item => ({
			name: item.symbol.name,
			kind: symbolKindToString(item.symbol.kind),
			containerName: item.symbol.containerName || undefined,
			location: {
				file: item.symbol.location.uri.fsPath,
				line: item.symbol.location.range.startLineNumber,
				column: item.symbol.location.range.startColumn
			}
		}));

		const output = {
			query: query || '',
			totalFound: filteredSymbols.length,
			returned: results.length,
			symbols: results
		};

		return { success: true, data: JSON.stringify(output, null, 2) };
	} catch (error) {
		return { success: false, error: `搜索符号失败: ${error instanceof Error ? error.message : String(error)}` };
	}
}

/**
 * 递归格式化大纲元素
 */
function formatOutlineElement(element: OutlineElement, indent: number = 0): object {
	const symbol = element.symbol;
	const result: {
		name: string;
		kind: string;
		detail?: string;
		range: { startLine: number; endLine: number };
		children?: object[];
	} = {
		name: symbol.name,
		kind: symbolKindToString(symbol.kind),
		range: {
			startLine: symbol.range.startLineNumber,
			endLine: symbol.range.endLineNumber
		}
	};

	if (symbol.detail) {
		result.detail = symbol.detail;
	}

	// 递归处理子元素
	if (element.children.size > 0) {
		result.children = [];
		for (const [, child] of element.children) {
			result.children.push(formatOutlineElement(child, indent + 1));
		}
	}

	return result;
}

/**
 * 获取文件大纲（类、函数、变量的结构化视图）
 */
export async function getFileOutline(
	params: GetFileOutlineParams,
	workspaceService: IWorkspaceContextService,
	textModelService: ITextModelService,
	outlineModelService: IOutlineModelService,
	token: CancellationToken = CancellationToken.None
): Promise<FileToolResult> {
	const { path } = params;

	if (!path) {
		return { success: false, error: '必须提供文件路径' };
	}

	// 解析文件路径
	let fileUri: URI;
	const folders = workspaceService.getWorkspace().folders;

	if (path.match(/^[a-zA-Z]:\\/) || path.startsWith('/')) {
		// 绝对路径
		fileUri = URI.file(path);
	} else if (folders.length > 0) {
		// 相对路径
		fileUri = URI.joinPath(folders[0].uri, path);
	} else {
		return { success: false, error: '没有打开的工作区，请使用绝对路径' };
	}

	try {
		// 获取文本模型
		const reference = await textModelService.createModelReference(fileUri);

		try {
			const textModel = reference.object.textEditorModel;

			// 获取大纲模型
			const outlineModel = await outlineModelService.getOrCreate(textModel, token);

			if (token.isCancellationRequested) {
				return { success: false, error: '获取大纲已取消' };
			}

			// 获取顶层符号
			const topLevelSymbols = outlineModel.getTopLevelSymbols();

			// 格式化输出（使用树结构）
			const symbols: object[] = [];
			for (const [, child] of outlineModel.children) {
				if (child instanceof OutlineElement) {
					symbols.push(formatOutlineElement(child));
				}
			}

			const output = {
				file: path,
				totalSymbols: topLevelSymbols.length,
				outline: symbols
			};

			return { success: true, data: JSON.stringify(output, null, 2) };
		} finally {
			reference.dispose();
		}
	} catch (error) {
		return { success: false, error: `获取文件大纲失败: ${error instanceof Error ? error.message : String(error)}` };
	}
}
