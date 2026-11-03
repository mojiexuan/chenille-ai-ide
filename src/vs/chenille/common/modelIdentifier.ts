/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Chenille 在官方语言模型服务中使用的 vendor */
export const CHENILLE_MODEL_VENDOR = 'chenille';

/** Chenille 注册到官方 Chat 系统的 agent id */
export const CHENILLE_AGENT_ID = 'chenille.agent';

const PREFIX = `${CHENILLE_MODEL_VENDOR}/`;

export function toChenilleModelIdentifier(modelName: string): string {
	return `${PREFIX}${modelName}`;
}

export function fromChenilleModelIdentifier(identifier: string | undefined): string | undefined {
	return identifier?.startsWith(PREFIX) ? identifier.slice(PREFIX.length) : undefined;
}
