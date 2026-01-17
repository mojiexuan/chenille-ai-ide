/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../../base/common/path.js';
import { FileAccess, nodeModulesPath, nodeModulesAsarUnpackedPath } from '../../../../base/common/network.js';
import { canASAR, importAMDNodeModule } from '../../../../amdX.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import {
	LANGUAGE_TO_GRAMMAR,
	generateContentHash,
	type CodeChunk,
	type ICodeChunker,
} from '../../../common/indexing/types.js';

/**
 * 语言 ID 到 Tree-sitter WASM 文件名的映射
 */
const GRAMMAR_TO_WASM: Record<string, string> = {
	'typescript': 'tree-sitter-typescript',
	'tsx': 'tree-sitter-tsx',
	'javascript': 'tree-sitter-javascript',
	'python': 'tree-sitter-python',
	'java': 'tree-sitter-java',
	'go': 'tree-sitter-go',
	'rust': 'tree-sitter-rust',
	'cpp': 'tree-sitter-cpp',
	'c': 'tree-sitter-cpp', // C 使用 C++ 解析器
	'c_sharp': 'tree-sitter-c-sharp',
	'ruby': 'tree-sitter-ruby',
	'php': 'tree-sitter-php',
	'bash': 'tree-sitter-bash',
	'css': 'tree-sitter-css',
};

/**
 * Tree-sitter 节点接口
 */
interface TreeSitterNode {
	type: string;
	startIndex: number;
	endIndex: number;
	startPosition: { row: number; column: number };
	endPosition: { row: number; column: number };
	text: string;
	children: TreeSitterNode[];
	childCount: number;
	namedChildCount: number;
	namedChildren: TreeSitterNode[];
	parent: TreeSitterNode | null;
}

/**
 * Tree-sitter 解析树接口
 */
interface TreeSitterTree {
	rootNode: TreeSitterNode;
}

/**
 * Tree-sitter 解析器接口
 */
interface TreeSitterParser {
	parse(content: string): TreeSitterTree;
}

/**
 * 可折叠的语法节点类型
 * 这些节点会被智能切分，保留签名但折叠实现
 */
const COLLAPSIBLE_NODE_TYPES = new Set([
	// 类/结构体
	'class_definition',
	'class_declaration',
	'class_specifier',
	'struct_specifier',
	'impl_item',
	'interface_declaration',
	'trait_item',
	// 函数/方法
	'function_definition',
	'function_declaration',
	'method_definition',
	'method_declaration',
	'function_item',
	'arrow_function',
	'function_expression',
	// 模块
	'module',
	'namespace_definition',
]);

/**
 * 函数体节点类型
 */
const FUNCTION_BODY_TYPES = new Set([
	'block',
	'statement_block',
	'compound_statement',
	'function_body',
]);

/**
 * 获取 Tree-sitter WASM 文件的基础路径
 */
function getTreeSitterWasmPath(isBuilt: boolean): string {
	const basePath = (canASAR && isBuilt) ? nodeModulesAsarUnpackedPath : nodeModulesPath;
	return `${basePath}/@vscode/tree-sitter-wasm/wasm`;
}

/**
 * 基于 Tree-sitter 的智能代码切分器
 */
export class TreeSitterCodeChunker implements ICodeChunker {
	private parserCache: Map<string, TreeSitterParser> = new Map();
	private treeSitterModule: typeof import('@vscode/tree-sitter-wasm') | null = null;
	private initPromise: Promise<void> | null = null;
	private isBuilt: boolean = false;

	constructor(environmentService?: IEnvironmentService) {
		this.isBuilt = environmentService?.isBuilt ?? false;
	}

	/**
	 * 将代码切分为多个块
	 */
	async *chunk(
		filepath: string,
		content: string,
		maxChunkSize: number,
	): AsyncGenerator<CodeChunk> {
		const extension = path.extname(filepath).toLowerCase();
		const language = LANGUAGE_TO_GRAMMAR[extension];

		if (!language) {
			// 不支持的语言，使用简单按行切分
			yield* this.simpleChunk(filepath, content, maxChunkSize);
			return;
		}

		try {
			const parser = await this.getParser(language);
			if (!parser) {
				yield* this.simpleChunk(filepath, content, maxChunkSize);
				return;
			}

			const tree = parser.parse(content);
			yield* this.smartChunk(filepath, content, tree.rootNode, maxChunkSize, language);
		} catch (error) {
			console.warn(`[CodeChunker] Failed to parse ${filepath}:`, error);
			yield* this.simpleChunk(filepath, content, maxChunkSize);
		}
	}

	/**
	 * 初始化 Tree-sitter 模块
	 */
	private async initTreeSitter(): Promise<void> {
		if (this.treeSitterModule) {
			return;
		}

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = (async () => {
			try {
				// 使用 VS Code 官方的加载方式
				const TreeSitter = await importAMDNodeModule<typeof import('@vscode/tree-sitter-wasm')>(
					'@vscode/tree-sitter-wasm',
					'wasm/tree-sitter.js'
				);

				// 初始化 Parser，指定 WASM 文件位置
				const wasmBasePath = getTreeSitterWasmPath(this.isBuilt);
				await TreeSitter.Parser.init({
					locateFile: (_file: string, _folder: string) => {
						const wasmLocation = `${wasmBasePath}/tree-sitter.wasm`;
						return FileAccess.asFileUri(wasmLocation as any).toString(true);
					}
				});

				this.treeSitterModule = TreeSitter;
				console.log('[CodeChunker] Tree-sitter initialized successfully');
			} catch (error) {
				console.warn('[CodeChunker] Failed to initialize Tree-sitter:', error);
				this.treeSitterModule = null;
			}
		})();

		return this.initPromise;
	}

	/**
	 * 获取或创建解析器
	 */
	private async getParser(language: string): Promise<TreeSitterParser | null> {
		if (this.parserCache.has(language)) {
			return this.parserCache.get(language)!;
		}

		// 检查是否有对应的 WASM 文件
		const wasmName = GRAMMAR_TO_WASM[language];
		if (!wasmName) {
			console.warn(`[CodeChunker] No Tree-sitter grammar for ${language}`);
			return null;
		}

		try {
			await this.initTreeSitter();

			if (!this.treeSitterModule) {
				return null;
			}

			const TreeSitter = this.treeSitterModule;

			// 加载语言 WASM - 使用 VS Code 官方路径
			const wasmBasePath = getTreeSitterWasmPath(this.isBuilt);
			const wasmLocation = `${wasmBasePath}/${wasmName}.wasm`;
			const wasmUri = FileAccess.asFileUri(wasmLocation as any);

			// 读取 WASM 文件并转换为 ArrayBuffer
			const wasmBuffer = await fs.promises.readFile(wasmUri.fsPath);
			const arrayBuffer = wasmBuffer.buffer.slice(
				wasmBuffer.byteOffset,
				wasmBuffer.byteOffset + wasmBuffer.byteLength
			);
			const languageObj = await TreeSitter.Language.load(new Uint8Array(arrayBuffer));

			// 创建解析器
			const parser = new TreeSitter.Parser();
			parser.setLanguage(languageObj);

			// 封装为我们的接口
			const wrappedParser: TreeSitterParser = {
				parse: (content: string) => {
					const tree = parser.parse(content);
					if (!tree) {
						throw new Error('Failed to parse content');
					}
					return { rootNode: tree.rootNode as unknown as TreeSitterNode };
				}
			};

			this.parserCache.set(language, wrappedParser);
			console.log(`[CodeChunker] Loaded Tree-sitter parser for ${language}`);

			return wrappedParser;
		} catch (error) {
			console.warn(`[CodeChunker] Failed to load Tree-sitter for ${language}:`, error);
			return null;
		}
	}

	/**
	 * 智能切分（基于 AST）
	 */
	private async *smartChunk(
		filepath: string,
		content: string,
		rootNode: TreeSitterNode,
		maxChunkSize: number,
		language: string,
	): AsyncGenerator<CodeChunk> {
		const lines = content.split('\n');
		const chunks: CodeChunk[] = [];

		// 遍历顶层节点
		for (const child of rootNode.namedChildren) {
			const nodeChunks = this.processNode(child, content, lines, maxChunkSize, filepath, language);
			chunks.push(...nodeChunks);
		}

		// 如果没有生成任何块，使用整个文件
		if (chunks.length === 0) {
			yield* this.simpleChunk(filepath, content, maxChunkSize);
			return;
		}

		for (const chunk of chunks) {
			yield chunk;
		}
	}

	/**
	 * 处理单个 AST 节点
	 */
	private processNode(
		node: TreeSitterNode,
		content: string,
		lines: string[],
		maxChunkSize: number,
		filepath: string,
		language: string,
	): CodeChunk[] {
		const nodeText = content.slice(node.startIndex, node.endIndex);
		const estimatedTokens = this.estimateTokens(nodeText);

		// 如果节点足够小，直接作为一个块
		if (estimatedTokens <= maxChunkSize) {
			return [{
				filepath,
				content: nodeText,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				digest: generateContentHash(nodeText),
				language,
			}];
		}

		// 对于可折叠的节点，尝试智能折叠
		if (COLLAPSIBLE_NODE_TYPES.has(node.type)) {
			return this.collapseNode(node, content, lines, maxChunkSize, filepath, language);
		}

		// 对于其他大节点，递归处理子节点
		const chunks: CodeChunk[] = [];
		for (const child of node.namedChildren) {
			chunks.push(...this.processNode(child, content, lines, maxChunkSize, filepath, language));
		}

		// 如果没有子节点生成块，强制分割
		if (chunks.length === 0) {
			return this.forceSplitNode(node, content, maxChunkSize, filepath, language);
		}

		return chunks;
	}

	/**
	 * 折叠节点（保留签名，折叠实现）
	 */
	private collapseNode(
		node: TreeSitterNode,
		content: string,
		lines: string[],
		maxChunkSize: number,
		filepath: string,
		language: string,
	): CodeChunk[] {
		const chunks: CodeChunk[] = [];

		// 查找函数体/类体
		const bodyNode = this.findBodyNode(node);

		if (!bodyNode) {
			// 没有函数体，直接返回整个节点
			const nodeText = content.slice(node.startIndex, node.endIndex);
			return [{
				filepath,
				content: nodeText,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				digest: generateContentHash(nodeText),
				language,
			}];
		}

		// 1. 创建概览块（签名 + 折叠的函数体）
		const signatureText = content.slice(node.startIndex, bodyNode.startIndex);
		const overviewText = signatureText.trimEnd() + ' { ... }';

		if (this.estimateTokens(overviewText) <= maxChunkSize) {
			chunks.push({
				filepath,
				content: overviewText,
				startLine: node.startPosition.row + 1,
				endLine: node.startPosition.row + 1,
				digest: generateContentHash(overviewText),
				language,
			});
		}

		// 2. 创建完整实现块（如果函数体不太大）
		const fullText = content.slice(node.startIndex, node.endIndex);
		if (this.estimateTokens(fullText) <= maxChunkSize * 2) {
			// 添加上下文（如果在类内部）
			const contextText = this.addClassContext(node, content, fullText);
			chunks.push({
				filepath,
				content: contextText,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				digest: generateContentHash(contextText),
				language,
			});
		} else {
			// 函数体太大，递归处理
			for (const child of bodyNode.namedChildren) {
				chunks.push(...this.processNode(child, content, lines, maxChunkSize, filepath, language));
			}
		}

		return chunks;
	}

	/**
	 * 查找函数体节点
	 */
	private findBodyNode(node: TreeSitterNode): TreeSitterNode | null {
		for (const child of node.children) {
			if (FUNCTION_BODY_TYPES.has(child.type)) {
				return child;
			}
		}

		// 对于某些语言，函数体可能是最后一个子节点
		const lastChild = node.children[node.children.length - 1];
		if (lastChild && FUNCTION_BODY_TYPES.has(lastChild.type)) {
			return lastChild;
		}

		return null;
	}

	/**
	 * 添加类上下文
	 */
	private addClassContext(node: TreeSitterNode, content: string, nodeText: string): string {
		let parent = node.parent;

		while (parent) {
			if (parent.type.includes('class') || parent.type.includes('impl') || parent.type.includes('interface')) {
				// 找到类声明的开始
				const classStart = content.slice(parent.startIndex, parent.startIndex + 200);
				const firstBrace = classStart.indexOf('{');
				if (firstBrace > 0) {
					const classHeader = classStart.slice(0, firstBrace).trim();
					const indent = this.getIndent(node, content);
					return `${classHeader} {\n  ...\n\n${indent}${nodeText}\n}`;
				}
			}
			parent = parent.parent;
		}

		return nodeText;
	}

	/**
	 * 获取节点缩进
	 */
	private getIndent(node: TreeSitterNode, content: string): string {
		const lineStart = content.lastIndexOf('\n', node.startIndex) + 1;
		const beforeNode = content.slice(lineStart, node.startIndex);
		const match = beforeNode.match(/^(\s*)/);
		return match ? match[1] : '';
	}

	/**
	 * 强制分割大节点
	 */
	private forceSplitNode(
		node: TreeSitterNode,
		content: string,
		maxChunkSize: number,
		filepath: string,
		language: string,
	): CodeChunk[] {
		const nodeText = content.slice(node.startIndex, node.endIndex);
		const lines = nodeText.split('\n');
		const chunks: CodeChunk[] = [];

		let currentChunk: string[] = [];
		let currentTokens = 0;
		let chunkStartLine = node.startPosition.row + 1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineTokens = this.estimateTokens(line);

			if (currentTokens + lineTokens > maxChunkSize && currentChunk.length > 0) {
				// 保存当前块
				const chunkContent = currentChunk.join('\n');
				chunks.push({
					filepath,
					content: chunkContent,
					startLine: chunkStartLine,
					endLine: chunkStartLine + currentChunk.length - 1,
					digest: generateContentHash(chunkContent),
					language,
				});

				currentChunk = [];
				currentTokens = 0;
				chunkStartLine = node.startPosition.row + 1 + i;
			}

			currentChunk.push(line);
			currentTokens += lineTokens;
		}

		// 保存最后一个块
		if (currentChunk.length > 0) {
			const chunkContent = currentChunk.join('\n');
			chunks.push({
				filepath,
				content: chunkContent,
				startLine: chunkStartLine,
				endLine: chunkStartLine + currentChunk.length - 1,
				digest: generateContentHash(chunkContent),
				language,
			});
		}

		return chunks;
	}

	/**
	 * 简单按行切分（用于不支持的语言）
	 */
	private async *simpleChunk(
		filepath: string,
		content: string,
		maxChunkSize: number,
	): AsyncGenerator<CodeChunk> {
		const lines = content.split('\n');
		const extension = path.extname(filepath).toLowerCase();
		const language = LANGUAGE_TO_GRAMMAR[extension];

		let currentChunk: string[] = [];
		let currentTokens = 0;
		let chunkStartLine = 1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineTokens = this.estimateTokens(line);

			if (currentTokens + lineTokens > maxChunkSize && currentChunk.length > 0) {
				const chunkContent = currentChunk.join('\n');
				yield {
					filepath,
					content: chunkContent,
					startLine: chunkStartLine,
					endLine: chunkStartLine + currentChunk.length - 1,
					digest: generateContentHash(chunkContent),
					language,
				};

				currentChunk = [];
				currentTokens = 0;
				chunkStartLine = i + 1;
			}

			currentChunk.push(line);
			currentTokens += lineTokens;
		}

		if (currentChunk.length > 0) {
			const chunkContent = currentChunk.join('\n');
			yield {
				filepath,
				content: chunkContent,
				startLine: chunkStartLine,
				endLine: chunkStartLine + currentChunk.length - 1,
				digest: generateContentHash(chunkContent),
				language,
			};
		}
	}

	/**
	 * 估算 token 数量（简单估算：4个字符约等于1个token）
	 */
	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		this.parserCache.clear();
	}
}

/**
 * 创建代码切分器
 */
export function createCodeChunker(environmentService?: IEnvironmentService): ICodeChunker {
	return new TreeSitterCodeChunker(environmentService);
}
