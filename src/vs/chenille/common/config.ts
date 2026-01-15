/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ConfigAppVersion {
	name: string;
	code: number;
}

export interface ConfigApp {
	name: string;
	version: ConfigAppVersion;
}

export interface Config {
	app: ConfigApp;
}

export const config: Config = {
	app: {
		name: 'Chenille AI IDE',
		version: {
			name: '0.0.3',
			code: 3
		}
	}
};
