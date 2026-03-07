/**
 * Feishu Adapter Factory
 *
 * 飞书平台的 Adapter 工厂实现
 */

import type { AdapterFactory, BotConfig, Bot } from "../../core/adapter/index.js";
import { UnifiedBot, type UnifiedBotConfig } from "../../core/unified-bot.js";
import { PluginManager } from "../../core/plugin/manager.js";
import { FeishuStore } from "./store.js";
import { FeishuAdapter, type FeishuAdapterConfig } from "./adapter.js";
import type { SandboxConfig } from "../../core/sandbox/index.js";
import { getFeishuBuiltinPlugins } from "./bot.js";
import { PiLogger } from "../../utils/logger/index.js";
import type { Logger } from "../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 飞书特定的 Bot 配置
 */
export interface FeishuBotConfig extends BotConfig {
	/** 飞书 App ID */
	appId: string;
	/** 飞书 App Secret */
	appSecret: string;
	/** 是否使用 WebSocket */
	useWebSocket?: boolean;
}

// ============================================================================
// Feishu Adapter Factory
// ============================================================================

/**
 * 飞书 Adapter 工厂
 */
export const feishuAdapterFactory: AdapterFactory = {
	meta: {
		id: "feishu",
		name: "Feishu",
		version: "1.0.0",
		description: "飞书机器人适配器",
	},

	/**
	 * 创建飞书 Bot 实例
	 */
	async createBot(config: FeishuBotConfig): Promise<Bot> {
		// 验证必要配置
		if (!config.appId || !config.appSecret) {
			throw new Error("Feishu adapter requires appId and appSecret");
		}

		// 1. 创建 Logger
		const logger = new PiLogger("feishu", {
			enabled: config.logging?.enabled ?? true,
			level: config.logging?.level || "info",
			dir: config.logging?.dir,
			console: config.logging?.console ?? true,
		});

		logger.info("Creating Feishu bot", { workspaceDir: config.workspaceDir });

		// 合并 sandbox 配置
		const sandboxConfig: SandboxConfig = config.sandbox || { type: "host" };

		// 2. 创建飞书适配器（传入 logger）
		const adapter = new FeishuAdapter({
			appId: config.appId,
			appSecret: config.appSecret,
			workingDir: config.workspaceDir,
			platform: "feishu",
			enabled: true,
			useWebSocket: config.useWebSocket,
			port: config.port,
			logger: logger.child("adapter"),
		} as FeishuAdapterConfig);

		// 初始化适配器
		await adapter.initialize({
			platform: "feishu",
			enabled: true,
		});

		// 3. 创建存储
		const store = new FeishuStore({
			workspaceDir: config.workspaceDir,
			appId: config.appId,
			appSecret: config.appSecret,
		});

		// 4. 创建插件管理器（传入 logger）
		const pluginManager = new PluginManager({
			workspaceDir: config.workspaceDir,
			pluginsConfig: config.plugins || {},
			logger: logger.child("plugin"),
		});

		// 设置平台为飞书
		pluginManager.setPlatform("feishu");

		// 注册内置插件
		pluginManager.registerAll(getFeishuBuiltinPlugins());

		// 初始化插件
		await pluginManager.initialize({
			sandboxConfig,
			platform: "feishu",
		});

		logger.info("Feishu bot created successfully");

		// 5. 创建统一机器人
		const bot = new UnifiedBot({
			adapter,
			workingDir: config.workspaceDir,
			store,
			pluginManager,
			port: config.port,
		});

		return bot;
	},

	/**
	 * 验证配置
	 */
	validateConfig(config: any): boolean {
		return !!(config && config.appId && config.appSecret && config.workspaceDir);
	},

	/**
	 * 获取默认配置
	 */
	getDefaultConfig(): Partial<FeishuBotConfig> {
		return {
			useWebSocket: true,
			port: 3000,
			plugins: {
				agent: { enabled: true },
				voice: { enabled: true, defaultVoice: "Cherry" },
				memory: { enabled: true, maxHistoryMessages: 10 },
				card: { enabled: true },
				event: { enabled: false },
			},
			sandbox: { type: "host" },
		};
	},
};
