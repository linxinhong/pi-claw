/**
 * Feishu Adapter Factory
 *
 * 创建配置好的 UnifiedBot 实例用于飞书模式
 */

import { join } from "path";
import { UnifiedBot } from "../../core/unified-bot.js";
import { PluginManager } from "../../core/plugin/manager.js";
import { ConfigManager } from "../../core/config/manager.js";
import { getHookManager } from "../../core/hook/index.js";
import { PiLogger } from "../../utils/logger/index.js";
import { FeishuAdapter } from "./adapter.js";
import { FeishuStore } from "./store.js";
import type { AdapterFactory, BotConfig, Bot } from "../../core/adapter/types.js";
import type { FeishuAdapterConfig } from "./types.js";

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建飞书 Bot
 */
export async function createFeishuBot(config: BotConfig & { feishu: FeishuAdapterConfig }): Promise<Bot> {
	const { workspaceDir, feishu } = config;

	// 1. 创建 Logger
	const logDir = join(workspaceDir, "logs");
	const logger = new PiLogger("feishu", {
		dir: logDir,
		enabled: true,
		level: "debug",
		console: true,
	});

	logger.info("Creating Feishu bot", { workspaceDir, appId: feishu.appId });

	// 2. 创建 FeishuAdapter
	const adapter = new FeishuAdapter(feishu);
	adapter.setWorkspaceDir(workspaceDir);

	// 初始化适配器
	await adapter.initialize({
		platform: "feishu",
		enabled: true,
		...feishu,
	});

	// 3. 获取 Store
	const store = adapter.getStore();
	if (!store) {
		throw new Error("Failed to create FeishuStore");
	}

	// 4. 初始化 ConfigManager
	let configManager: ConfigManager | undefined;
	try {
		configManager = ConfigManager.getInstance();
	} catch {
		// ConfigManager 未初始化，使用默认配置
	}

	// 5. 创建 PluginManager
	const pluginsConfig = config.plugins || {
		agent: { enabled: true },
		memory: { enabled: true, maxHistoryMessages: 50 },
	};

	const pluginManager = new PluginManager({
		workspaceDir,
		pluginsConfig,
		logger: logger.child("plugin"),
	});

	// 设置平台
	pluginManager.setPlatform("feishu");

	// 设置 HookManager
	pluginManager.setHookManager(getHookManager());

	// 初始化插件
	await pluginManager.initialize({
		platform: "feishu",
	});

	logger.info("Feishu bot created successfully");

	// 6. 创建 UnifiedBot
	const bot = new UnifiedBot({
		adapter,
		workingDir: workspaceDir,
		store,
		pluginManager,
		defaultModel: feishu.defaultModel || config.model,
	});

	return bot;
}

// ============================================================================
// Adapter Factory
// ============================================================================

/**
 * 飞书 Adapter 工厂
 */
export const feishuAdapterFactory: AdapterFactory = {
	meta: {
		id: "feishu",
		name: "Feishu (飞书)",
		version: "1.0.0",
		description: "Feishu/Lark platform adapter with full SDK support",
	},

	async createBot(config: BotConfig): Promise<Bot> {
		const feishuConfig = config.feishu;
		if (!feishuConfig) {
			throw new Error("Missing feishu configuration in config");
		}

		return createFeishuBot({
			...config,
			feishu: feishuConfig,
		});
	},

	validateConfig(config: any): boolean {
		const feishu = config.feishu;
		if (!feishu) {
			return false;
		}

		if (!feishu.appId || typeof feishu.appId !== "string") {
			return false;
		}

		if (!feishu.appSecret || typeof feishu.appSecret !== "string") {
			return false;
		}

		return true;
	},

	getDefaultConfig(): Partial<BotConfig> {
		return {
			feishu: {
				appId: "",
				appSecret: "",
				domain: "feishu",
				connectionMode: "websocket",
				dmPolicy: "open",
				groupPolicy: "open",
				requireMention: true,
				replyMode: "streaming",
				historyLimit: 50,
				textChunkLimit: 4000,
				mediaMaxMb: 20,
			},
		};
	},
};
