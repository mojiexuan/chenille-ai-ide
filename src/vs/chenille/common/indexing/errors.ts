/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 索引错误代码
 */
export enum IndexingErrorCode {
	// 通用错误 (1000-1099)
	Unknown = 1000,
	Cancelled = 1001,
	Timeout = 1002,

	// 初始化错误 (1100-1199)
	InitFailed = 1100,
	EmbeddingsProviderFailed = 1101,
	TreeSitterFailed = 1102,
	VectorIndexFailed = 1103,
	CacheFailed = 1104,

	// 文件操作错误 (1200-1299)
	FileNotFound = 1200,
	FileReadFailed = 1201,
	FileAccessDenied = 1202,
	DirectoryNotFound = 1203,

	// 索引操作错误 (1300-1399)
	WorkspaceNotFound = 1300,
	AlreadyIndexing = 1301,
	IndexNotFound = 1302,
	IndexCorrupted = 1303,

	// 嵌入操作错误 (1400-1499)
	EmbeddingFailed = 1400,
	ModelLoadFailed = 1401,
	ModelNotSupported = 1402,

	// 检索错误 (1500-1599)
	RetrieveFailed = 1500,
	QueryTooLong = 1501,
	NoIndexAvailable = 1502,

	// Worker 进程错误 (1600-1699)
	WorkerNotReady = 1600,
	WorkerCrashed = 1601,
	WorkerTimeout = 1602,
	Disposed = 1603,
	IndexFailed = 1604,
}

/**
 * 错误代码对应的中文消息
 */
const ERROR_MESSAGES: Record<IndexingErrorCode, string> = {
	// 通用错误
	[IndexingErrorCode.Unknown]: '发生未知错误',
	[IndexingErrorCode.Cancelled]: '操作已取消',
	[IndexingErrorCode.Timeout]: '操作超时',

	// 初始化错误
	[IndexingErrorCode.InitFailed]: '索引服务初始化失败',
	[IndexingErrorCode.EmbeddingsProviderFailed]: '嵌入模型加载失败',
	[IndexingErrorCode.TreeSitterFailed]: 'Tree-sitter 解析器加载失败',
	[IndexingErrorCode.VectorIndexFailed]: '向量索引初始化失败',
	[IndexingErrorCode.CacheFailed]: '缓存服务初始化失败',

	// 文件操作错误
	[IndexingErrorCode.FileNotFound]: '文件不存在',
	[IndexingErrorCode.FileReadFailed]: '文件读取失败',
	[IndexingErrorCode.FileAccessDenied]: '文件访问被拒绝',
	[IndexingErrorCode.DirectoryNotFound]: '目录不存在',

	// 索引操作错误
	[IndexingErrorCode.WorkspaceNotFound]: '工作区不存在',
	[IndexingErrorCode.AlreadyIndexing]: '该工作区正在索引中，请稍后再试',
	[IndexingErrorCode.IndexNotFound]: '未找到该工作区的索引',
	[IndexingErrorCode.IndexCorrupted]: '索引数据已损坏，请重建索引',

	// 嵌入操作错误
	[IndexingErrorCode.EmbeddingFailed]: '生成嵌入向量失败',
	[IndexingErrorCode.ModelLoadFailed]: '嵌入模型加载失败',
	[IndexingErrorCode.ModelNotSupported]: '不支持的嵌入模型',

	// 检索错误
	[IndexingErrorCode.RetrieveFailed]: '检索失败',
	[IndexingErrorCode.QueryTooLong]: '查询文本过长',
	[IndexingErrorCode.NoIndexAvailable]: '该工作区尚未建立索引',

	// Worker 进程错误
	[IndexingErrorCode.WorkerNotReady]: 'Worker 进程未就绪',
	[IndexingErrorCode.WorkerCrashed]: 'Worker 进程崩溃',
	[IndexingErrorCode.WorkerTimeout]: 'Worker 请求超时',
	[IndexingErrorCode.Disposed]: '服务已释放',
	[IndexingErrorCode.IndexFailed]: '索引失败',
};

/**
 * 索引错误类
 */
export class IndexingError extends Error {
	readonly code: IndexingErrorCode;
	readonly details?: unknown;

	constructor(code: IndexingErrorCode, details?: unknown, customMessage?: string) {
		const message = customMessage || ERROR_MESSAGES[code] || '发生未知错误';
		super(message);

		this.name = 'IndexingError';
		this.code = code;
		this.details = details;

		// 保持原型链
		Object.setPrototypeOf(this, IndexingError.prototype);
	}

	/**
	 * 获取完整的错误信息（包含详情）
	 */
	getFullMessage(): string {
		if (this.details) {
			const detailStr = typeof this.details === 'string'
				? this.details
				: JSON.stringify(this.details, null, 2);
			return `${this.message}\n详情: ${detailStr}`;
		}
		return this.message;
	}

	/**
	 * 转换为 JSON
	 */
	toJSON(): { code: IndexingErrorCode; message: string; details?: unknown } {
		return {
			code: this.code,
			message: this.message,
			details: this.details,
		};
	}
}

/**
 * 从未知错误创建 IndexingError
 */
export function wrapError(error: unknown, defaultCode: IndexingErrorCode = IndexingErrorCode.Unknown): IndexingError {
	if (error instanceof IndexingError) {
		return error;
	}

	if (error instanceof Error) {
		// 检查是否是取消错误
		if (error.message.toLowerCase().includes('cancel')) {
			return new IndexingError(IndexingErrorCode.Cancelled, error.message);
		}

		// 检查是否是超时错误
		if (error.message.toLowerCase().includes('timeout')) {
			return new IndexingError(IndexingErrorCode.Timeout, error.message);
		}

		// 检查是否是文件不存在错误
		if (error.message.includes('ENOENT')) {
			return new IndexingError(IndexingErrorCode.FileNotFound, error.message);
		}

		// 检查是否是权限错误
		if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
			return new IndexingError(IndexingErrorCode.FileAccessDenied, error.message);
		}

		return new IndexingError(defaultCode, error.message);
	}

	return new IndexingError(defaultCode, String(error));
}

/**
 * 获取用户友好的错误消息
 */
export function getErrorMessage(code: IndexingErrorCode): string {
	return ERROR_MESSAGES[code] || '发生未知错误';
}

/**
 * 判断是否是可重试的错误
 */
export function isRetryableError(error: IndexingError): boolean {
	const retryableCodes = [
		IndexingErrorCode.Timeout,
		IndexingErrorCode.FileReadFailed,
		IndexingErrorCode.EmbeddingFailed,
	];
	return retryableCodes.includes(error.code);
}
