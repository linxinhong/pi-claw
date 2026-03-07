/**
 * Plugin Manager - 通用插件管理器
 *
 * 负责插件的加载、初始化、生命周期管理和工具聚合
 * 使用通用类型，支持多平台
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type {
	Plugin,
	PluginContext,
	PluginEvent,
	PluginInitContext,
	PluginManagerConfig,
	PluginConfig,
	PluginsConfig,
	MessageEvent,
} from "./types.js";
import type { Logger } from "../../utils/logger/index.js";
import type { HookManager } from "../hook/manager.js";
import { PiLogger } from "../../utils/logger/index.js";
import { HOOK_NAMES } from "../hook/index.js";

// ============================================================================
// Event Bus (Internal)
// ============================================================================

type EventHandler<T = unknown> = (event: T) => Promise<void> | void;

interface EventSubscription {
	id: string;
	handler: EventHandler;
	once: boolean;
}

class EventBus {
	private subscriptions = new Map<string, EventSubscription[]>();
	private idCounter = 0;

	on<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
		const id = `sub_${++this.idCounter}`;
		const subs = this.subscriptions.get(eventType) || [];
		subs.push({ id, handler: handler as EventHandler, once: false });
		this.subscriptions.set(eventType, subs);

		return () => this.off(eventType, id);
	}

	once<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
		const id = `sub_${++this.idCounter}`;
		const subs = this.subscriptions.get(eventType) || [];
		subs.push({ id, handler: handler as EventHandler, once: true });
		this.subscriptions.set(eventType, subs);

		return () => this.off(eventType, id);
	}

	private off(eventType: string, id: string): void {
		const subs = this.subscriptions.get(eventType);
		if (!subs) return;

		const index = subs.findIndex((s) => s.id === id);
		if (index !== -1) {
			subs.splice(index, 1);
		}

		if (subs.length === 0) {
			this.subscriptions.delete(eventType);
		}
	}

	async emit<T = unknown>(eventType: string, event: T): Promise<void> {
		const subs = this.subscriptions.get(eventType);
		if (!subs || subs.length === 0) return;

		const toRemove: string[] = [];

		for (const sub of subs) {
			try {
				await sub.handler(event);
				if (sub.once) {
					toRemove.push(sub.id);
				}
			} catch (error) {
				console.error(`[EventBus] Handler error for ${eventType}:`, error);
			}
		}

		for (const id of toRemove) {
			this.off(eventType, id);
		}
	}

	clear(): void {
		this.subscriptions.clear();
	}

	subscriberCount(eventType: string): number {
		return this.subscriptions.get(eventType)?.length || 0;
	}
}

let globalEventBus: EventBus | null = null;

function getEventBus(): EventBus {
	if (!globalEventBus) {
		globalEventBus = new EventBus();
	}
	return globalEventBus;
}

function resetEventBus(): void {
	if (globalEventBus) {
		globalEventBus.clear();
		globalEventBus = null;
	}
}

// ============================================================================
// Plugin Manager
// ============================================================================

/**
 * 通用插件管理器
 *
 * 管理插件的生命周期，支持平台兼容性检查和能力检查
 */
export class PluginManager {
	private plugins = new Map<string, Plugin>();
	private pluginConfigs: PluginsConfig;
	private workspaceDir: string;
	private eventBus: EventBus;
	private initialized = false;
	private currentPlatform: string = "unknown";
	private logger: Logger;
	private hookManager: HookManager | null = null;

	constructor(config: PluginManagerConfig) {
		this.workspaceDir = config.workspaceDir;
		this.pluginConfigs = config.pluginsConfig;
		this.eventBus = getEventBus();
		this.logger = config.logger || new PiLogger("plugin");
	}

	/**
	 * 设置 HookManager
	 */
	setHookManager(hookManager: HookManager): void {
		this.hookManager = hookManager;
	}

	/**
	 * 设置当前平台
	 * 在初始化前调用，用于检查插件的平台兼容性
	 */
	setPlatform(platform: string): void {
		this.currentPlatform = platform;
	}

	/**
	 * 注册插件
	 */
	register(plugin: Plugin): void {
		if (this.plugins.has(plugin.meta.id)) {
			this.logger.warn(`Plugin ${plugin.meta.id} already registered, replacing`);
		}
		this.plugins.set(plugin.meta.id, plugin);
		this.logger.info(`Registered plugin: ${plugin.meta.name} v${plugin.meta.version}`);
	}

	/**
	 * 批量注册插件
	 */
	registerAll(plugins: Plugin[]): void {
		for (const plugin of plugins) {
			this.register(plugin);
		}
	}

	/**
	 * 初始化所有已启用的插件
	 */
	async initialize(initOptions?: {
		sandboxConfig?: PluginInitContext["sandboxConfig"];
		platform?: string;
	}): Promise<void> {
		if (this.initialized) {
			this.logger.warn("PluginManager already initialized");
			return;
		}

		// 设置平台
		if (initOptions?.platform) {
			this.currentPlatform = initOptions.platform;
		}

		const initContext: Omit<PluginInitContext, "config"> = {
			workspaceDir: this.workspaceDir,
			log: (level, message, ...args) => {
				if (level === "error") {
					this.logger.error(message, undefined, args.length > 0 ? new Error(String(args[0])) : undefined);
				} else if (level === "warning") {
					this.logger.warn(message, { args });
				} else {
					this.logger.info(message, { args });
				}
			},
			logger: this.logger,
			sandboxConfig: initOptions?.sandboxConfig,
			hookManager: this.hookManager || undefined,
		};

		// 检查依赖和平台兼容性
		for (const [id, plugin] of this.plugins) {
			const config = this.getPluginConfig(id);
			if (!config.enabled) continue;

			// 检查平台兼容性
			if (plugin.meta.supportedPlatforms && plugin.meta.supportedPlatforms.length > 0) {
				if (!plugin.meta.supportedPlatforms.includes(this.currentPlatform)) {
					this.logger.warn(
						`Plugin ${id} does not support platform ${this.currentPlatform}, skipping`
					);
					continue;
				}
			}

			// 检查依赖
			if (plugin.meta.dependencies) {
				for (const depId of plugin.meta.dependencies) {
					const depConfig = this.getPluginConfig(depId);
					if (!depConfig.enabled) {
						throw new Error(`Plugin ${id} depends on ${depId}, but ${depId} is not enabled`);
					}
					if (!this.plugins.has(depId)) {
						throw new Error(`Plugin ${id} depends on ${depId}, but ${depId} is not registered`);
					}
				}
			}
		}

		// 按依赖顺序初始化
		const initialized = new Set<string>();
		const initPlugin = async (id: string): Promise<void> => {
			if (initialized.has(id)) return;

			const plugin = this.plugins.get(id);
			if (!plugin) return;

			const config = this.getPluginConfig(id);
			if (!config.enabled) return;

			// 检查平台兼容性
			if (plugin.meta.supportedPlatforms && plugin.meta.supportedPlatforms.length > 0) {
				if (!plugin.meta.supportedPlatforms.includes(this.currentPlatform)) {
					return;
				}
			}

			// 先初始化依赖
			if (plugin.meta.dependencies) {
				for (const depId of plugin.meta.dependencies) {
					await initPlugin(depId);
				}
			}

			// 初始化插件
			if (plugin.init) {
				try {
					// 触发 plugin:load hook（如果 hookManager 存在）
					if (this.hookManager?.hasHooks(HOOK_NAMES.PLUGIN_LOAD)) {
						await this.hookManager.emit(HOOK_NAMES.PLUGIN_LOAD, {
							pluginId: id,
							pluginName: plugin.meta.name,
							pluginVersion: plugin.meta.version,
							timestamp: new Date(),
						});
					}

					// 为每个插件创建子 Logger
					const pluginLogger = this.logger.child(`plugin:${id}`);
					await plugin.init({
						...initContext,
						config,
						logger: pluginLogger,
					});
					this.logger.info(`Initialized: ${plugin.meta.name}`);
				} catch (error) {
					this.logger.error(
						`Failed to initialize ${plugin.meta.name}`,
						undefined,
						error instanceof Error ? error : new Error(String(error))
					);
					throw error;
				}
			}

			initialized.add(id);
		};

		for (const id of this.plugins.keys()) {
			await initPlugin(id);
		}

		this.initialized = true;
		this.logger.info(`All plugins initialized (${initialized.size} plugins)`);
	}

	/**
	 * 销毁所有插件
	 */
	async destroy(): Promise<void> {
		for (const [id, plugin] of this.plugins) {
			// 触发 plugin:unload hook（如果 hookManager 存在）
			if (this.hookManager?.hasHooks(HOOK_NAMES.PLUGIN_UNLOAD)) {
				await this.hookManager.emit(HOOK_NAMES.PLUGIN_UNLOAD, {
					pluginId: id,
					pluginName: plugin.meta.name,
					pluginVersion: plugin.meta.version,
					timestamp: new Date(),
				});
			}

			if (plugin.destroy) {
				try {
					await plugin.destroy();
					this.logger.info(`Destroyed: ${plugin.meta.name}`);
				} catch (error) {
					this.logger.error(
						`Failed to destroy ${plugin.meta.name}`,
						undefined,
						error instanceof Error ? error : new Error(String(error))
					);
				}
			}
		}

		// 清理该插件管理器注册的所有 hook
		if (this.hookManager) {
			this.hookManager.clearBySource("plugin-manager");
		}

		this.plugins.clear();
		this.initialized = false;
	}

	/**
	 * 获取插件配置
	 */
	getPluginConfig(pluginId: string): PluginConfig {
		const config = this.pluginConfigs[pluginId];
		if (!config) {
			// 默认配置：新插件默认禁用
			return { enabled: false };
		}
		return config;
	}

	/**
	 * 获取所有启用的插件提供的工具
	 * 会检查平台能力是否满足插件需求
	 */
	async getTools(context: PluginContext): Promise<AgentTool<any>[]> {
		const tools: AgentTool<any>[] = [];

		for (const [id, plugin] of this.plugins) {
			const config = this.getPluginConfig(id);
			if (!config.enabled) continue;

			// 检查平台兼容性
			if (plugin.meta.supportedPlatforms && plugin.meta.supportedPlatforms.length > 0) {
				if (!plugin.meta.supportedPlatforms.includes(this.currentPlatform)) {
					continue;
				}
			}

			// 检查所需能力
			if (plugin.meta.requiredCapabilities) {
				const missingCapabilities = plugin.meta.requiredCapabilities.filter(
					(cap) => !context.capabilities.hasCapability(cap)
				);
				if (missingCapabilities.length > 0) {
					this.logger.warn(
						`Plugin ${id} requires capabilities not available on ${this.currentPlatform}: ${missingCapabilities.join(", ")}`
					);
					continue;
				}
			}

			if (plugin.getTools) {
				try {
					const pluginTools = await plugin.getTools(context);
					tools.push(...pluginTools);
				} catch (error) {
					this.logger.error(
						`Failed to get tools from ${plugin.meta.name}`,
						undefined,
						error instanceof Error ? error : new Error(String(error))
					);
				}
			}
		}

		return tools;
	}

	/**
	 * 预处理消息
	 * 按插件注册顺序依次调用，任一插件返回 null 则终止处理
	 */
	async preprocessMessage(event: MessageEvent, context: PluginContext): Promise<MessageEvent | null> {
		let currentEvent: MessageEvent | null = event;

		for (const [id, plugin] of this.plugins) {
			const config = this.getPluginConfig(id);
			if (!config.enabled) continue;

			// 检查平台兼容性
			if (plugin.meta.supportedPlatforms && plugin.meta.supportedPlatforms.length > 0) {
				if (!plugin.meta.supportedPlatforms.includes(this.currentPlatform)) {
					continue;
				}
			}

			if (plugin.preprocessMessage && currentEvent) {
				try {
					currentEvent = await plugin.preprocessMessage(currentEvent, context);
					if (currentEvent === null) {
						this.logger.info(`Message filtered by ${plugin.meta.name}`);
						return null;
					}
				} catch (error) {
					this.logger.error(
						`Preprocess error in ${plugin.meta.name}`,
						undefined,
						error instanceof Error ? error : new Error(String(error))
					);
				}
			}
		}

		return currentEvent;
	}

	/**
	 * 分发事件给所有插件
	 */
	async dispatchEvent(event: PluginEvent, context: PluginContext): Promise<void> {
		// 先发布到事件总线
		await this.eventBus.emit(event.type, event);

		// 然后分发给插件
		for (const [id, plugin] of this.plugins) {
			const config = this.getPluginConfig(id);
			if (!config.enabled) continue;

			// 检查平台兼容性
			if (plugin.meta.supportedPlatforms && plugin.meta.supportedPlatforms.length > 0) {
				if (!plugin.meta.supportedPlatforms.includes(this.currentPlatform)) {
					continue;
				}
			}

			if (plugin.onEvent) {
				try {
					await plugin.onEvent(event, context);
				} catch (error) {
					this.logger.error(
						`Event handler error in ${plugin.meta.name}`,
						undefined,
						error instanceof Error ? error : new Error(String(error))
					);
				}
			}
		}
	}

	/**
	 * 获取插件
	 */
	getPlugin<T extends Plugin>(id: string): T | undefined {
		return this.plugins.get(id) as T | undefined;
	}

	/**
	 * 获取所有插件
	 */
	getAllPlugins(): Plugin[] {
		return Array.from(this.plugins.values());
	}

	/**
	 * 获取启用的插件
	 */
	getEnabledPlugins(): Plugin[] {
		return Array.from(this.plugins.values()).filter((p) => {
			if (!this.getPluginConfig(p.meta.id).enabled) return false;
			// 检查平台兼容性
			if (p.meta.supportedPlatforms && p.meta.supportedPlatforms.length > 0) {
				return p.meta.supportedPlatforms.includes(this.currentPlatform);
			}
			return true;
		});
	}

	/**
	 * 检查是否已初始化
	 */
	isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * 获取当前平台
	 */
	getPlatform(): string {
		return this.currentPlatform;
	}
}
