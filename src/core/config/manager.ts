/**
 * Config Manager
 *
 * 统一配置管理器 - 管理全局配置和频道配置
 */

import { existsSync, readFileSync, writeFileSync, watch } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import type { AppConfig } from "../../utils/config.js";
import { loadConfig, PROJECT_ROOT, getChannelDir } from "../../utils/config.js";
import type { HookManager } from "../hook/manager.js";
import { HOOK_NAMES } from "../hook/index.js";
import * as log from "../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 频道配置
 */
export interface ChannelConfig {
	/** 频道默认模型 */
	model?: string;
	/** 历史消息数限制 */
	maxHistoryMessages?: number;
	/** 插件配置覆盖 */
	plugins?: {
		agent?: { enabled?: boolean; maxHistoryMessages?: number };
		memory?: { enabled?: boolean; maxHistoryMessages?: number };
		[key: string]: unknown;
	};
	/** 支持扩展 */
	[key: string]: unknown;
}

/**
 * ConfigManager 配置
 */
export interface ConfigManagerConfig {
	/** 配置文件路径 */
	configPath?: string;
	/** Hook 管理器 */
	hookManager?: HookManager;
	/** 是否启用文件监控 */
	enableWatch?: boolean;
}

/**
 * 配置变更监听器
 */
export type ConfigChangeListener = (
	configType: "global" | "channel",
	key: string,
	newValue: unknown,
	oldValue: unknown,
	channelId?: string,
) => void | Promise<void>;

// ============================================================================
// Config Manager
// ============================================================================

/**
 * 统一配置管理器
 *
 * 管理全局配置和频道配置，支持：
 * - 配置读取和写入
 * - 热更新（文件监控）
 * - 变更通知（通过 Hook 和监听器）
 */
export class ConfigManager {
	private static instance: ConfigManager | null = null;

	private globalConfig: AppConfig;
	private channelConfigs: Map<string, ChannelConfig> = new Map();
	private configPath: string;
	private hookManager?: HookManager;
	private listeners: ConfigChangeListener[] = [];
	private watchers: Map<string, ReturnType<typeof watch>> = new Map();
	private enableWatch: boolean;

	private constructor(config: ConfigManagerConfig) {
		this.configPath = config.configPath || join(PROJECT_ROOT, "config.json");
		this.hookManager = config.hookManager;
		this.enableWatch = config.enableWatch ?? false;
		this.globalConfig = loadConfig(this.configPath);

		if (this.enableWatch) {
			this.startWatching();
		}
	}

	/**
	 * 获取单例实例
	 */
	static getInstance(config?: ConfigManagerConfig): ConfigManager {
		if (!ConfigManager.instance) {
			if (!config) {
				throw new Error("ConfigManager not initialized. Call getInstance with config first.");
			}
			ConfigManager.instance = new ConfigManager(config);
		}
		return ConfigManager.instance;
	}

	/**
	 * 重置单例（用于测试）
	 */
	static resetInstance(): void {
		if (ConfigManager.instance) {
			ConfigManager.instance.stopWatching();
			ConfigManager.instance = null;
		}
	}

	// ============================================================================
	// Global Config
	// ============================================================================

	/**
	 * 获取全局配置
	 */
	getGlobalConfig(): AppConfig {
		return { ...this.globalConfig };
	}

	/**
	 * 获取全局配置项
	 */
	get<K extends keyof AppConfig>(key: K): AppConfig[K] {
		return this.globalConfig[key];
	}

	/**
	 * 设置全局配置项
	 */
	async set<K extends keyof AppConfig>(
		key: K,
		value: AppConfig[K],
		options?: { source?: "api" | "command" | "file"; save?: boolean },
	): Promise<boolean> {
		const oldValue = this.globalConfig[key];
		const source = options?.source ?? "api";
		const shouldSave = options?.save ?? true;

		this.globalConfig[key] = value;

		// 触发变更通知
		await this.notifyChange("global", key as string, value, oldValue, undefined, source);

		// 保存到文件
		if (shouldSave) {
			await this.saveGlobalConfig(source);
		}

		return true;
	}

	/**
	 * 保存全局配置到文件
	 */
	private async saveGlobalConfig(source: "api" | "command" | "file"): Promise<void> {
		try {
			writeFileSync(this.configPath, JSON.stringify(this.globalConfig, null, 2));
			log.logInfo(`[ConfigManager] Saved global config (source: ${source})`);

			// 触发 CONFIG_SAVE hook
			if (this.hookManager?.hasHooks(HOOK_NAMES.CONFIG_SAVE)) {
				await this.hookManager.emit(HOOK_NAMES.CONFIG_SAVE, {
					configType: "global",
					source,
					timestamp: new Date(),
				});
			}
		} catch (error) {
			log.logError(`[ConfigManager] Failed to save global config:`, error);
			throw error;
		}
	}

	// ============================================================================
	// Channel Config
	// ============================================================================

	/**
	 * 获取频道配置
	 */
	getChannelConfig(channelId: string): ChannelConfig {
		// 先检查内存缓存
		if (this.channelConfigs.has(channelId)) {
			return { ...this.channelConfigs.get(channelId)! };
		}

		// 从文件加载
		const config = this.loadChannelConfigFromFile(channelId);
		this.channelConfigs.set(channelId, config);
		return { ...config };
	}

	/**
	 * 获取频道配置项
	 */
	getChannelValue<K extends keyof ChannelConfig>(
		channelId: string,
		key: K,
	): ChannelConfig[K] | undefined {
		const config = this.getChannelConfig(channelId);
		return config[key];
	}

	/**
	 * 设置频道配置项
	 */
	async setChannelValue<K extends keyof ChannelConfig>(
		channelId: string,
		key: K,
		value: ChannelConfig[K],
		options?: { source?: "api" | "command" | "file"; save?: boolean },
	): Promise<boolean> {
		const config = this.getChannelConfig(channelId);
		const oldValue = config[key];
		const source = options?.source ?? "api";
		const shouldSave = options?.save ?? true;

		config[key] = value;
		this.channelConfigs.set(channelId, config);

		// 触发变更通知
		await this.notifyChange("channel", key as string, value, oldValue, channelId, source);

		// 保存到文件
		if (shouldSave) {
			await this.saveChannelConfig(channelId, source);
		}

		return true;
	}

	/**
	 * 从文件加载频道配置
	 */
	private loadChannelConfigFromFile(channelId: string): ChannelConfig {
		const channelDir = getChannelDir(channelId);
		const configPath = join(channelDir, "channel-config.json");

		try {
			if (existsSync(configPath)) {
				const content = readFileSync(configPath, "utf-8");
				const config = JSON.parse(content) as ChannelConfig;

				// 触发 CONFIG_LOAD hook
				this.hookManager?.emit(HOOK_NAMES.CONFIG_LOAD, {
					configType: "channel",
					channelId,
					source: "file",
					timestamp: new Date(),
				}).catch(() => {});

				return config;
			}
		} catch (error) {
			log.logWarning(`[ConfigManager] Failed to load channel config for ${channelId}:`, error);
		}

		return {};
	}

	/**
	 * 保存频道配置到文件
	 */
	private async saveChannelConfig(
		channelId: string,
		source: "api" | "command" | "file",
	): Promise<void> {
		const channelDir = getChannelDir(channelId);
		const configPath = join(channelDir, "channel-config.json");
		const config = this.channelConfigs.get(channelId) || {};

		try {
			// 确保目录存在
			await mkdir(channelDir, { recursive: true });

			writeFileSync(configPath, JSON.stringify(config, null, 2));
			log.logInfo(`[ConfigManager] Saved channel config for ${channelId} (source: ${source})`);

			// 触发 CONFIG_SAVE hook
			if (this.hookManager?.hasHooks(HOOK_NAMES.CONFIG_SAVE)) {
				await this.hookManager.emit(HOOK_NAMES.CONFIG_SAVE, {
					configType: "channel",
					channelId,
					source,
					timestamp: new Date(),
				});
			}
		} catch (error) {
			log.logError(`[ConfigManager] Failed to save channel config for ${channelId}:`, error);
			throw error;
		}
	}

	/**
	 * 重新加载频道配置
	 */
	async reloadChannelConfig(channelId: string): Promise<ChannelConfig> {
		const oldConfig = this.channelConfigs.get(channelId);
		const config = this.loadChannelConfigFromFile(channelId);
		this.channelConfigs.set(channelId, config);

		// 检测变更并通知
		if (oldConfig) {
			const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(config)]);
			for (const key of allKeys) {
				const oldValue = (oldConfig as Record<string, unknown>)[key];
				const newValue = (config as Record<string, unknown>)[key];
				if (oldValue !== newValue) {
	                await this.notifyChange("channel", key as string, newValue, oldValue, channelId, "file");
				}
			}
		}

		// 触发 CONFIG_RELOAD hook
		if (this.hookManager?.hasHooks(HOOK_NAMES.CONFIG_RELOAD)) {
			await this.hookManager.emit(HOOK_NAMES.CONFIG_RELOAD, {
				configType: "channel",
				channelId,
				source: "file",
				timestamp: new Date(),
			});
		}

		return { ...config };
	}

	// ============================================================================
	// Listeners
	// ============================================================================

	/**
	 * 添加配置变更监听器
	 */
	addChangeListener(listener: ConfigChangeListener): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	/**
	 * 通知配置变更
	 */
	private async notifyChange(
		configType: "global" | "channel",
		key: string,
		newValue: unknown,
		oldValue: unknown,
		channelId?: string,
		source?: "api" | "command" | "file",
	): Promise<void> {
		// 触发监听器
		for (const listener of this.listeners) {
			try {
				await listener(configType, key, newValue, oldValue, channelId);
			} catch (error) {
				log.logError(`[ConfigManager] Listener error:`, error);
			}
		}

		// 触发 CONFIG_CHANGE hook
		if (this.hookManager?.hasHooks(HOOK_NAMES.CONFIG_CHANGE)) {
			await this.hookManager.emit(HOOK_NAMES.CONFIG_CHANGE, {
				configType,
				configKey: key,
				channelId,
				oldValue,
				newValue,
				timestamp: new Date(),
				source: source || "api",
			});
		}
	}

	// ============================================================================
	// File Watching
	// ============================================================================

	/**
	 * 启动文件监控
	 */
	startWatching(): void {
		if (!this.enableWatch) return;

		// 监控全局配置
		this.watchGlobalConfig();

		log.logInfo("[ConfigManager] Started file watching");
	}

	/**
	 * 停止文件监控
	 */
	stopWatching(): void {
		for (const [path, watcher] of this.watchers) {
			watcher.close();
			log.logInfo(`[ConfigManager] Stopped watching ${path}`);
		}
		this.watchers.clear();
	}

	/**
	 * 监控全局配置文件
	 */
	private watchGlobalConfig(): void {
		if (this.watchers.has(this.configPath)) return;

		try {
			const watcher = watch(this.configPath, async (eventType) => {
				if (eventType === "change") {
					log.logInfo(`[ConfigManager] Global config file changed, reloading...`);
					try {
						this.globalConfig = loadConfig(this.configPath);

						// 触发 CONFIG_RELOAD hook
						if (this.hookManager?.hasHooks(HOOK_NAMES.CONFIG_RELOAD)) {
							await this.hookManager.emit(HOOK_NAMES.CONFIG_RELOAD, {
								configType: "global",
								source: "file",
								timestamp: new Date(),
							});
						}
					} catch (error) {
						log.logError(`[ConfigManager] Failed to reload global config:`, error);
					}
				}
			});

			this.watchers.set(this.configPath, watcher);
		} catch (error) {
			log.logWarning(`[ConfigManager] Failed to watch global config:`, error);
		}
	}

	/**
	 * 监控频道配置文件
	 */
	watchChannelConfig(channelId: string): void {
		if (!this.enableWatch) return;

		const channelDir = getChannelDir(channelId);
		const configPath = join(channelDir, "channel-config.json");

		if (this.watchers.has(configPath)) return;

		try {
			// 确保目录存在
			if (!existsSync(channelDir)) {
				return;
			}

			const watcher = watch(configPath, async (eventType) => {
				if (eventType === "change") {
					log.logInfo(`[ConfigManager] Channel ${channelId} config file changed, reloading...`);
					try {
						await this.reloadChannelConfig(channelId);
					} catch (error) {
						log.logError(`[ConfigManager] Failed to reload channel config:`, error);
					}
				}
			});

			this.watchers.set(configPath, watcher);
		} catch (error) {
			log.logWarning(`[ConfigManager] Failed to watch channel config for ${channelId}:`, error);
		}
	}
}
