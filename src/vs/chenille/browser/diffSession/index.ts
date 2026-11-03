/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type {
	IChenilleDiffSession,
	IChenilleHunkInfo,
} from './chenilleDiffSession.js';
export {
	IChenilleDiffSessionService,
	ChenilleHunkState,
	chenilleDiffInsertedColor,
	chenilleDiffInsertedOutlineColor,
	chenilleDiffRemovedColor,
	chenilleDiffRemovedOutlineColor,
	CONTEXT_CHENILLE_DIFF_SESSION_ACTIVE,
} from './chenilleDiffSession.js';

export { ChenilleDiffSessionImpl } from './chenilleDiffSessionImpl.js';
export { ChenilleDiffSessionService } from './chenilleDiffSessionService.js';
export { ChenilleHunkWidgetFactory, createHunkActions } from './chenilleHunkWidget.js';
export type { IHunkAction } from './chenilleHunkWidget.js';

// 导入 actions 以注册它们
import './chenilleDiffActions.js';
