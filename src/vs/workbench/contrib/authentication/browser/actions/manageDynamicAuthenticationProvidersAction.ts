/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IDynamicAuthenticationProviderStorageService, DynamicAuthenticationProviderInfo } from '../../../../services/authentication/common/dynamicAuthenticationProviderStorage.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';

interface IDynamicProviderQuickPickItem extends IQuickPickItem {
	provider: DynamicAuthenticationProviderInfo;
}

export class RemoveDynamicAuthenticationProvidersAction extends Action2 {

	static readonly ID = 'workbench.action.removeDynamicAuthenticationProviders';

	constructor() {
		super({
			id: RemoveDynamicAuthenticationProvidersAction.ID,
			title: localize2('removeDynamicAuthProviders', '移除动态身份验证提供程序'),
			category: localize2('authenticationCategory', '身份验证'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const dynamicAuthStorageService = accessor.get(IDynamicAuthenticationProviderStorageService);
		const authenticationService = accessor.get(IAuthenticationService);
		const dialogService = accessor.get(IDialogService);

		const interactedProviders = dynamicAuthStorageService.getInteractedProviders();

		if (interactedProviders.length === 0) {
			await dialogService.info(
				localize('noDynamicProviders', '没有动态身份验证提供程序'),
				localize('noDynamicProvidersDetail', '尚未使用任何动态身份验证提供程序。')
			);
			return;
		}

		const items: IDynamicProviderQuickPickItem[] = interactedProviders.map(provider => ({
			label: provider.label,
			description: localize('clientId', '客户端 ID: {0}', provider.clientId),
			provider
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('selectProviderToRemove', '选择要移除的动态身份验证提供程序'),
			canPickMany: true
		});

		if (!selected || selected.length === 0) {
			return;
		}

		// Confirm deletion
		const providerNames = selected.map(item => item.provider.label).join(', ');
		const message = selected.length === 1
			? localize('confirmDeleteSingleProvider', '确定要移除动态身份验证提供程序 "{0}" 吗?', providerNames)
			: localize('confirmDeleteMultipleProviders', '确定要移除 {0} 个动态身份验证提供程序: {1} 吗?', selected.length, providerNames);

		const result = await dialogService.confirm({
			message,
			detail: localize('confirmDeleteDetail', '这将移除所选提供程序的所有已存储身份验证数据。如果再次使用这些提供程序，您需要重新进行身份验证。'),
			primaryButton: localize('remove', '移除'),
			type: 'warning'
		});

		if (!result.confirmed) {
			return;
		}

		// Remove the selected providers
		for (const item of selected) {
			const providerId = item.provider.providerId;

			// Unregister from authentication service if still registered
			if (authenticationService.isAuthenticationProviderRegistered(providerId)) {
				authenticationService.unregisterAuthenticationProvider(providerId);
			}

			// Remove from dynamic storage service
			await dynamicAuthStorageService.removeDynamicProvider(providerId);
		}
	}
}
