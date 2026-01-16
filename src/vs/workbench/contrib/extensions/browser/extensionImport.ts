/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IExtensionManifest } from '../../../../platform/extensions/common/extensions.js';
import { $, append } from '../../../../base/browser/dom.js';
import { IDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';

/**
 * 支持导入扩展的 IDE 列表
 */
export interface IIDESource {
	readonly name: string;
	readonly folder: string;
}

export const IDE_SOURCES: IIDESource[] = [
	{ name: 'VS Code', folder: '.vscode' },
	{ name: 'VS Code Insiders', folder: '.vscode-insiders' },
	{ name: 'Cursor', folder: '.cursor' },
	{ name: 'Kiro', folder: '.kiro' },
	{ name: 'Trae CN', folder: '.trae-cn' },
	{ name: 'Windsurf', folder: '.windsurf' },
];

/**
 * 可导入的扩展信息
 */
export interface IImportableExtension {
	readonly id: string;
	readonly name: string;
	readonly displayName: string;
	readonly version: string;
	readonly publisher: string;
	readonly description: string;
	readonly extensionPath: URI;
	readonly source: IIDESource;
}

/**
 * IDE 安装信息
 */
export interface IIDEInstallation {
	readonly source: IIDESource;
	readonly extensionsPath: URI;
	readonly extensionCount: number;
}

/**
 * 获取 IDE 扩展目录路径
 */
export function getIDEExtensionsPath(source: IIDESource, userHome: URI): URI {
	return URI.joinPath(userHome, source.folder, 'extensions');
}

/**
 * 扫描可用的 IDE 安装
 */
export async function scanIDEInstallations(fileService: IFileService, userHome: URI): Promise<IIDEInstallation[]> {
	const installations: IIDEInstallation[] = [];

	for (const source of IDE_SOURCES) {
		const extensionsPath = getIDEExtensionsPath(source, userHome);
		try {
			const stat = await fileService.stat(extensionsPath);
			if (stat.isDirectory) {
				const children = await fileService.resolve(extensionsPath);
				const extensionCount = children.children?.filter(c => c.isDirectory).length || 0;
				if (extensionCount > 0) {
					installations.push({
						source,
						extensionsPath,
						extensionCount
					});
				}
			}
		} catch {
			// 目录不存在，跳过
		}
	}

	return installations;
}

/**
 * 扫描指定 IDE 的扩展
 */
export async function scanExtensionsFromIDE(
	installation: IIDEInstallation,
	fileService: IFileService
): Promise<IImportableExtension[]> {
	const extensions: IImportableExtension[] = [];

	try {
		const resolved = await fileService.resolve(installation.extensionsPath);
		if (!resolved.children) {
			return extensions;
		}

		for (const child of resolved.children) {
			if (!child.isDirectory) {
				continue;
			}

			const manifestPath = URI.joinPath(child.resource, 'package.json');
			try {
				const content = await fileService.readFile(manifestPath);
				const manifest: IExtensionManifest = JSON.parse(content.value.toString());

				if (manifest.name && manifest.version && manifest.publisher) {
					extensions.push({
						id: `${manifest.publisher}.${manifest.name}`.toLowerCase(),
						name: manifest.name,
						displayName: manifest.displayName || manifest.name,
						version: manifest.version,
						publisher: manifest.publisher,
						description: manifest.description || '',
						extensionPath: child.resource,
						source: installation.source
					});
				}
			} catch {
				// manifest 解析失败，跳过
			}
		}
	} catch {
		// 扫描失败
	}

	return extensions;
}

/**
 * 创建导入提示 UI
 */
export function createImportHint(
	container: HTMLElement,
	installations: IIDEInstallation[],
	onImport: (installation: IIDEInstallation) => void
): IDisposable {
	const disposables = new DisposableStore();

	const hintContainer = append(container, $('.extension-import-hint'));
	const textSpan = append(hintContainer, $('span'));
	textSpan.textContent = localize('importHint', "你可以从 ");

	installations.forEach((installation, index) => {
		if (index > 0) {
			const separator = append(hintContainer, $('span'));
			separator.textContent = index === installations.length - 1 ? ' 或 ' : '、';
		}

		const link = append(hintContainer, $('a.import-link'));
		link.textContent = installation.source.name;
		link.title = localize('importFrom', "从 {0} 导入 {1} 个扩展", installation.source.name, installation.extensionCount);
		link.tabIndex = 0;
		link.style.cursor = 'pointer';

		disposables.add({
			dispose: () => {
				link.onclick = null;
				link.onkeydown = null;
			}
		});

		link.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			onImport(installation);
		};

		link.onkeydown = (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				e.stopPropagation();
				onImport(installation);
			}
		};
	});

	const endSpan = append(hintContainer, $('span'));
	endSpan.textContent = localize('importHintEnd', " 导入扩展");

	return disposables;
}

/**
 * 获取导入扩展的标题
 */
export function getImportTitle(): string {
	return localize('importExtensions', "从其他 IDE 导入扩展");
}

/**
 * 获取选择 IDE 的占位符
 */
export function getSelectIDEPlaceholder(): string {
	return localize('selectIDE', "选择要导入扩展的 IDE");
}

/**
 * 获取选择扩展的占位符
 */
export function getSelectExtensionsPlaceholder(): string {
	return localize('selectExtensions', "选择要导入的扩展");
}

/**
 * 获取无可用 IDE 的消息
 */
export function getNoIDEMessage(): string {
	return localize('noIDEFound', "未检测到其他 IDE 的扩展目录");
}

/**
 * 获取导入成功的消息
 */
export function getImportSuccessMessage(count: number): string {
	return localize('importSuccess', "成功导入 {0} 个扩展，请重新加载窗口以激活", count);
}

/**
 * 获取导入失败的消息
 */
export function getImportFailedMessage(failed: number, total: number): string {
	return localize('importFailed', "导入完成，{0}/{1} 个扩展导入失败", failed, total);
}
