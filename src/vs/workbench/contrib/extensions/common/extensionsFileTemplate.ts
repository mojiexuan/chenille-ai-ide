/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { EXTENSION_IDENTIFIER_PATTERN } from '../../../../platform/extensionManagement/common/extensionManagement.js';

export const ExtensionsConfigurationSchemaId = 'vscode://schemas/extensions';
export const ExtensionsConfigurationSchema: IJSONSchema = {
	id: ExtensionsConfigurationSchemaId,
	allowComments: true,
	allowTrailingCommas: true,
	type: 'object',
	title: localize('app.extensions.json.title', "扩展"),
	additionalProperties: false,
	properties: {
		recommendations: {
			type: 'array',
			description: localize('app.extensions.json.recommendations', "应向此工作区用户推荐的扩展列表。扩展的标识符始终为「${publisher}.${name}」。例如: 'vscode.csharp'。"),
			items: {
				type: 'string',
				pattern: EXTENSION_IDENTIFIER_PATTERN,
				errorMessage: localize('app.extension.identifier.errorMessage', "预期格式为「${publisher}.${name}」。例如: 'vscode.csharp'。")
			},
		},
		unwantedRecommendations: {
			type: 'array',
			description: localize('app.extensions.json.unwantedRecommendations', "Chenille 推荐但不应向此工作区用户推荐的扩展列表。扩展的标识符始终为「${publisher}.${name}」。例如: 'vscode.csharp'。"),
			items: {
				type: 'string',
				pattern: EXTENSION_IDENTIFIER_PATTERN,
				errorMessage: localize('app.extension.identifier.errorMessage', "预期格式为「${publisher}.${name}」。例如: 'vscode.csharp'。")
			},
		},
	}
};

export const ExtensionsConfigurationInitialContent: string = [
	'{',
	'\t// 请参阅 https://go.microsoft.com/fwlink/?LinkId=827846 了解工作区推荐。',
	'\t// 扩展标识符格式: ${publisher}.${name}。例如: vscode.csharp',
	'',
	'\t// 应向此工作区用户推荐的扩展列表。',
	'\t"recommendations": [',
	'\t\t',
	'\t],',
	'\t// Chenille 推荐但不应向此工作区用户推荐的扩展列表。',
	'\t"unwantedRecommendations": [',
	'\t\t',
	'\t]',
	'}'
].join('\n');
