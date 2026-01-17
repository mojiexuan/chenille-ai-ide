/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 核心组件导出
export { CodebaseIndexer, getCodebaseIndexer, resetCodebaseIndexer } from './codebaseIndexer.js';

// 嵌入模型
export {
	LocalEmbeddingsProvider,
	JinaCodeEmbeddingsProvider,
	createEmbeddingsProvider,
} from './embeddings/localEmbeddings.js';

// 代码切分
export { TreeSitterCodeChunker, createCodeChunker } from './chunk/codeChunker.js';

// 向量索引
export { LanceDbIndex, createLanceDbIndex } from './vectorIndex/lanceDbIndex.js';

// 缓存
export { SqliteIndexCache, createIndexCache } from './cache/sqliteCache.js';
