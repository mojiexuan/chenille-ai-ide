/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../nls.js';
import * as objects from '../../../base/common/objects.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IJSONSchema } from '../../../base/common/jsonSchema.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../services/extensions/common/extensionsRegistry.js';
import { IConfigurationNode, IConfigurationRegistry, Extensions, validateProperty, ConfigurationScope, OVERRIDE_PROPERTY_REGEX, IConfigurationDefaults, configurationDefaultsSchemaId, IConfigurationDelta, getDefaultValue, getAllConfigurationProperties, parseScope, EXTENSION_UNIFICATION_EXTENSION_IDS } from '../../../platform/configuration/common/configurationRegistry.js';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from '../../../platform/jsonschemas/common/jsonContributionRegistry.js';
import { workspaceSettingsSchemaId, launchSchemaId, tasksSchemaId, mcpSchemaId } from '../../services/configuration/common/configuration.js';
import { isObject, isUndefined } from '../../../base/common/types.js';
import { ExtensionIdentifierMap, IExtensionManifest } from '../../../platform/extensions/common/extensions.js';
import { IStringDictionary } from '../../../base/common/collections.js';
import { Extensions as ExtensionFeaturesExtensions, IExtensionFeatureTableRenderer, IExtensionFeaturesRegistry, IRenderedData, IRowData, ITableData } from '../../services/extensionManagement/common/extensionFeatures.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { MarkdownString } from '../../../base/common/htmlContent.js';
import product from '../../../platform/product/common/product.js';

const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);

const configurationEntrySchema: IJSONSchema = {
	type: 'object',
	defaultSnippets: [{ body: { title: '', properties: {} } }],
	properties: {
		title: {
			description: nls.localize('vscode.extension.contributes.configuration.title', '当前设置类别的标题。此标签将在设置编辑器中作为子标题呈现。如果标题与扩展显示名称相同，则该类别将分组在主扩展标题下。'),
			type: 'string'
		},
		order: {
			description: nls.localize('vscode.extension.contributes.configuration.order', '指定时，给出此设置类别相对于其他类别的顺序。'),
			type: 'integer'
		},
		properties: {
			description: nls.localize('vscode.extension.contributes.configuration.properties', '配置属性的描述。'),
			type: 'object',
			propertyNames: {
				pattern: '\\S+',
				patternErrorMessage: nls.localize('vscode.extension.contributes.configuration.property.empty', '属性不应为空。'),
			},
			additionalProperties: {
				anyOf: [
					{
						title: nls.localize('vscode.extension.contributes.configuration.properties.schema', '配置属性的架构。'),
						$ref: 'http://json-schema.org/draft-07/schema#'
					},
					{
						type: 'object',
						properties: {
							scope: {
								type: 'string',
								enum: ['application', 'machine', 'window', 'resource', 'language-overridable', 'machine-overridable'],
								default: 'window',
								enumDescriptions: [
									nls.localize('scope.application.description', "只能在用户设置中配置的配置。"),
									nls.localize('scope.machine.description', "只能在用户设置或远程设置中配置的配置。"),
									nls.localize('scope.window.description', "可以在用户、远程或工作区设置中配置的配置。"),
									nls.localize('scope.resource.description', "可以在用户、远程、工作区或文件夹设置中配置的配置。"),
									nls.localize('scope.language-overridable.description', "可以在语言特定设置中配置的资源配置。"),
									nls.localize('scope.machine-overridable.description', "也可以在工作区或文件夹设置中配置的计算机配置。")
								],
								markdownDescription: nls.localize('scope.description', "配置适用的作用域。可用的作用域有 `application`、`machine`、`window`、`resource` 和 `machine-overridable`。")
							},
							enumDescriptions: {
								type: 'array',
								items: {
									type: 'string',
								},
								description: nls.localize('scope.enumDescriptions', '枚举值的描述')
							},
							markdownEnumDescriptions: {
								type: 'array',
								items: {
									type: 'string',
								},
								description: nls.localize('scope.markdownEnumDescriptions', 'Markdown 格式的枚举值描述。')
							},
							enumItemLabels: {
								type: 'array',
								items: {
									type: 'string'
								},
								markdownDescription: nls.localize('scope.enumItemLabels', '要在设置编辑器中显示的枚举值标签。指定后，{0} 值仍会显示在标签之后，但不太突出。', '`enum`')
							},
							markdownDescription: {
								type: 'string',
								description: nls.localize('scope.markdownDescription', 'Markdown 格式的描述。')
							},
							deprecationMessage: {
								type: 'string',
								description: nls.localize('scope.deprecationMessage', '如果设置，该属性将被标记为已弃用，并显示给定的消息作为说明。')
							},
							markdownDeprecationMessage: {
								type: 'string',
								description: nls.localize('scope.markdownDeprecationMessage', '如果设置，该属性将被标记为已弃用，并以 Markdown 格式显示给定的消息作为说明。')
							},
							editPresentation: {
								type: 'string',
								enum: ['singlelineText', 'multilineText'],
								enumDescriptions: [
									nls.localize('scope.singlelineText.description', '值将显示在输入框中。'),
									nls.localize('scope.multilineText.description', '值将显示在文本区域中。')
								],
								default: 'singlelineText',
								description: nls.localize('scope.editPresentation', '指定时，控制字符串设置的呈现格式。')
							},
							order: {
								type: 'integer',
								description: nls.localize('scope.order', '指定时，给出此设置相对于同一类别中其他设置的顺序。具有 order 属性的设置将放在没有设置此属性的设置之前。')
							},
							ignoreSync: {
								type: 'boolean',
								description: nls.localize('scope.ignoreSync', '启用后，设置同步默认不会同步此配置的用户值。')
							},
							tags: {
								type: 'array',
								items: {
									type: 'string',
									enum: [
										'accessibility',
										'advanced',
										'experimental',
										'telemetry',
										'usesOnlineServices',
									],
									enumDescriptions: [
										nls.localize('accessibility', '辅助功能设置'),
										nls.localize('advanced', '高级设置默认在设置编辑器中隐藏，除非用户选择显示高级设置。'),
										nls.localize('experimental', '实验性设置可能会更改，并可能在将来的版本中删除。'),
										nls.localize('preview', '预览设置可用于在功能最终确定之前试用新功能。'),
										nls.localize('telemetry', '遥测设置'),
										nls.localize('usesOnlineServices', '使用在线服务的设置')
									],
								},
								additionalItems: true,
								markdownDescription: nls.localize('scope.tags', '放置设置的标签列表。然后可以在设置编辑器中搜索该标签。例如，指定 `experimental` 标签允许通过搜索 `@tag:experimental` 来查找设置。'),
							}
						}
					}
				]
			}
		}
	}
};

// build up a delta across two ext points and only apply it once
let _configDelta: IConfigurationDelta | undefined;


// BEGIN VSCode extension point `configurationDefaults`
const defaultConfigurationExtPoint = ExtensionsRegistry.registerExtensionPoint<IStringDictionary<IStringDictionary<unknown>>>({
	extensionPoint: 'configurationDefaults',
	jsonSchema: {
		$ref: configurationDefaultsSchemaId,
	},
	canHandleResolver: true
});
defaultConfigurationExtPoint.setHandler((extensions, { added, removed }) => {

	if (_configDelta) {
		// HIGHLY unlikely, but just in case
		configurationRegistry.deltaConfiguration(_configDelta);
	}

	const configNow = _configDelta = {};
	// schedule a HIGHLY unlikely task in case only the default configurations EXT point changes
	queueMicrotask(() => {
		if (_configDelta === configNow) {
			configurationRegistry.deltaConfiguration(_configDelta);
			_configDelta = undefined;
		}
	});

	if (removed.length) {
		const removedDefaultConfigurations = removed.map<IConfigurationDefaults>(extension => ({ overrides: objects.deepClone(extension.value), source: { id: extension.description.identifier.value, displayName: extension.description.displayName } }));
		_configDelta.removedDefaults = removedDefaultConfigurations;
	}
	if (added.length) {
		const registeredProperties = configurationRegistry.getConfigurationProperties();
		const allowedScopes = [ConfigurationScope.MACHINE_OVERRIDABLE, ConfigurationScope.WINDOW, ConfigurationScope.RESOURCE, ConfigurationScope.LANGUAGE_OVERRIDABLE];
		const addedDefaultConfigurations = added.map<IConfigurationDefaults>(extension => {
			const overrides = objects.deepClone(extension.value);
			for (const key of Object.keys(overrides)) {
				const registeredPropertyScheme = registeredProperties[key];
				if (registeredPropertyScheme?.disallowConfigurationDefault) {
					extension.collector.warn(nls.localize('config.property.preventDefaultConfiguration.warning', "无法为 '{0}' 注册配置默认值。此设置不允许贡献配置默认值。", key));
					delete overrides[key];
					continue;
				}
				if (!OVERRIDE_PROPERTY_REGEX.test(key)) {
					if (registeredPropertyScheme?.scope && !allowedScopes.includes(registeredPropertyScheme.scope)) {
						extension.collector.warn(nls.localize('config.property.defaultConfiguration.warning', "无法为 '{0}' 注册配置默认值。仅支持 machine-overridable、window、resource 和 language overridable 作用域设置的默认值。", key));
						delete overrides[key];
						continue;
					}
				}
			}
			return { overrides, source: { id: extension.description.identifier.value, displayName: extension.description.displayName } };
		});
		_configDelta.addedDefaults = addedDefaultConfigurations;
	}
});
// END VSCode extension point `configurationDefaults`


// BEGIN VSCode extension point `configuration`
const configurationExtPoint = ExtensionsRegistry.registerExtensionPoint<IConfigurationNode>({
	extensionPoint: 'configuration',
	deps: [defaultConfigurationExtPoint],
	jsonSchema: {
		description: nls.localize('vscode.extension.contributes.configuration', '贡献配置设置。'),
		oneOf: [
			configurationEntrySchema,
			{
				type: 'array',
				items: configurationEntrySchema
			}
		]
	},
	canHandleResolver: true
});

const extensionConfigurations: ExtensionIdentifierMap<IConfigurationNode[]> = new ExtensionIdentifierMap<IConfigurationNode[]>();

configurationExtPoint.setHandler((extensions, { added, removed }) => {

	// HIGHLY unlikely (only configuration but not defaultConfiguration EXT point changes)
	_configDelta ??= {};

	if (removed.length) {
		const removedConfigurations: IConfigurationNode[] = [];
		for (const extension of removed) {
			removedConfigurations.push(...(extensionConfigurations.get(extension.description.identifier) || []));
			extensionConfigurations.delete(extension.description.identifier);
		}
		_configDelta.removedConfigurations = removedConfigurations;
	}

	const seenProperties = new Set<string>();

	function handleConfiguration(node: IConfigurationNode, extension: IExtensionPointUser<unknown>): IConfigurationNode {
		const configuration = objects.deepClone(node);

		if (configuration.title && (typeof configuration.title !== 'string')) {
			extension.collector.error(nls.localize('invalid.title', "'configuration.title' 必须是字符串"));
		}

		validateProperties(configuration, extension);

		configuration.id = node.id || extension.description.identifier.value;
		configuration.extensionInfo = { id: extension.description.identifier.value, displayName: extension.description.displayName };
		configuration.restrictedProperties = extension.description.capabilities?.untrustedWorkspaces?.supported === 'limited' ? extension.description.capabilities?.untrustedWorkspaces.restrictedConfigurations : undefined;
		configuration.title = configuration.title || extension.description.displayName || extension.description.identifier.value;
		return configuration;
	}

	function validateProperties(configuration: IConfigurationNode, extension: IExtensionPointUser<unknown>): void {
		const properties = configuration.properties;
		const extensionConfigurationPolicy = product.extensionConfigurationPolicy;
		if (properties) {
			if (typeof properties !== 'object') {
				extension.collector.error(nls.localize('invalid.properties', "'configuration.properties' 必须是对象"));
				configuration.properties = {};
			}
			for (const key in properties) {
				const propertyConfiguration = properties[key];
				const message = validateProperty(key, propertyConfiguration, extension.description.identifier.value);
				if (message) {
					delete properties[key];
					extension.collector.warn(message);
					continue;
				}
				if (seenProperties.has(key) && !EXTENSION_UNIFICATION_EXTENSION_IDS.has(extension.description.identifier.value.toLowerCase())) {
					delete properties[key];
					extension.collector.warn(nls.localize('config.property.duplicate', "无法注册 '{0}'。此属性已被注册。", key));
					continue;
				}
				if (!isObject(propertyConfiguration)) {
					delete properties[key];
					extension.collector.error(nls.localize('invalid.property', "configuration.properties 属性 '{0}' 必须是对象", key));
					continue;
				}
				if (extensionConfigurationPolicy?.[key]) {
					propertyConfiguration.policy = extensionConfigurationPolicy?.[key];
				}
				if (propertyConfiguration.tags?.some(tag => tag.toLowerCase() === 'onexp')) {
					propertyConfiguration.experiment = {
						mode: 'startup'
					};
				}
				seenProperties.add(key);
				propertyConfiguration.scope = propertyConfiguration.scope ? parseScope(propertyConfiguration.scope.toString()) : ConfigurationScope.WINDOW;
			}
		}
		const subNodes = configuration.allOf;
		if (subNodes) {
			extension.collector.error(nls.localize('invalid.allOf', "'configuration.allOf' 已弃用，不应再使用。请改为将多个配置部分作为数组传递给 'configuration' 贡献点。"));
			for (const node of subNodes) {
				validateProperties(node, extension);
			}
		}
	}

	if (added.length) {
		const addedConfigurations: IConfigurationNode[] = [];
		for (const extension of added) {
			const configurations: IConfigurationNode[] = [];
			const value = <IConfigurationNode | IConfigurationNode[]>extension.value;
			if (Array.isArray(value)) {
				value.forEach(v => configurations.push(handleConfiguration(v, extension)));
			} else {
				configurations.push(handleConfiguration(value, extension));
			}
			extensionConfigurations.set(extension.description.identifier, configurations);
			addedConfigurations.push(...configurations);
		}

		_configDelta.addedConfigurations = addedConfigurations;
	}

	configurationRegistry.deltaConfiguration(_configDelta);
	_configDelta = undefined;
});
// END VSCode extension point `configuration`

jsonRegistry.registerSchema('vscode://schemas/workspaceConfig', {
	allowComments: true,
	allowTrailingCommas: true,
	default: {
		folders: [
			{
				path: ''
			}
		],
		settings: {
		}
	},
	required: ['folders'],
	properties: {
		'folders': {
			minItems: 0,
			uniqueItems: true,
			description: nls.localize('workspaceConfig.folders.description', "要在工作区中加载的文件夹列表。"),
			items: {
				type: 'object',
				defaultSnippets: [{ body: { path: '$1' } }],
				oneOf: [{
					properties: {
						path: {
							type: 'string',
							description: nls.localize('workspaceConfig.path.description', "文件路径。例如 `/root/folderA` 或 `./folderA`（相对路径将相对于工作区文件的位置解析）。")
						},
						name: {
							type: 'string',
							description: nls.localize('workspaceConfig.name.description', "文件夹的可选名称。")
						}
					},
					required: ['path']
				}, {
					properties: {
						uri: {
							type: 'string',
							description: nls.localize('workspaceConfig.uri.description', "文件夹的 URI")
						},
						name: {
							type: 'string',
							description: nls.localize('workspaceConfig.name.description', "文件夹的可选名称。")
						}
					},
					required: ['uri']
				}]
			}
		},
		'settings': {
			type: 'object',
			default: {},
			description: nls.localize('workspaceConfig.settings.description', "工作区设置"),
			$ref: workspaceSettingsSchemaId
		},
		'launch': {
			type: 'object',
			default: { configurations: [], compounds: [] },
			description: nls.localize('workspaceConfig.launch.description', "工作区启动配置"),
			$ref: launchSchemaId
		},
		'tasks': {
			type: 'object',
			default: { version: '2.0.0', tasks: [] },
			description: nls.localize('workspaceConfig.tasks.description', "工作区任务配置"),
			$ref: tasksSchemaId
		},
		'mcp': {
			type: 'object',
			default: {
				inputs: [],
				servers: {
					'mcp-server-time': {
						command: 'uvx',
						args: ['mcp_server_time', '--local-timezone=America/Los_Angeles']
					}
				}
			},
			description: nls.localize('workspaceConfig.mcp.description', "模型上下文协议服务器配置"),
			$ref: mcpSchemaId
		},
		'extensions': {
			type: 'object',
			default: {},
			description: nls.localize('workspaceConfig.extensions.description', "工作区扩展"),
			$ref: 'vscode://schemas/extensions'
		},
		'remoteAuthority': {
			type: 'string',
			doNotSuggest: true,
			description: nls.localize('workspaceConfig.remoteAuthority', "工作区所在的远程服务器。"),
		},
		'transient': {
			type: 'boolean',
			doNotSuggest: true,
			description: nls.localize('workspaceConfig.transient', "临时工作区将在重新启动或重新加载时消失。"),
		}
	},
	errorMessage: nls.localize('unknownWorkspaceProperty', "未知的工作区配置属性")
});


class SettingsTableRenderer extends Disposable implements IExtensionFeatureTableRenderer {

	readonly type = 'table';

	shouldRender(manifest: IExtensionManifest): boolean {
		return !!manifest.contributes?.configuration;
	}

	render(manifest: IExtensionManifest): IRenderedData<ITableData> {
		const configuration: IConfigurationNode[] = manifest.contributes?.configuration
			? Array.isArray(manifest.contributes.configuration) ? manifest.contributes.configuration : [manifest.contributes.configuration]
			: [];

		const properties = getAllConfigurationProperties(configuration);

		const contrib = properties ? Object.keys(properties) : [];
		const headers = [nls.localize('setting name', "ID"), nls.localize('description', "描述"), nls.localize('default', "默认值")];
		const rows: IRowData[][] = contrib.sort((a, b) => a.localeCompare(b))
			.map(key => {
				return [
					new MarkdownString().appendMarkdown(`\`${key}\``),
					properties[key].markdownDescription ? new MarkdownString(properties[key].markdownDescription, false) : properties[key].description ?? '',
					new MarkdownString().appendCodeblock('json', JSON.stringify(isUndefined(properties[key].default) ? getDefaultValue(properties[key].type) : properties[key].default, null, 2)),
				];
			});

		return {
			data: {
				headers,
				rows
			},
			dispose: () => { }
		};
	}
}

Registry.as<IExtensionFeaturesRegistry>(ExtensionFeaturesExtensions.ExtensionFeaturesRegistry).registerExtensionFeature({
	id: 'configuration',
	label: nls.localize('settings', "设置"),
	access: {
		canToggle: false
	},
	renderer: new SyncDescriptor(SettingsTableRenderer),
});
