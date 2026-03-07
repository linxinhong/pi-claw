/**
 * Feishu Bot Factory
 *
 * 创建飞书机器人的工厂函数
 */

import { UnifiedBot, type UnifiedBotConfig } from "../../core/unified-bot.js";
import { PluginManager } from "../../core/plugin/manager.js";
import { FeishuStore } from "./store.js";
import { FeishuAdapter, type FeishuAdapterConfig } from "./adapter.js";
import { loadConfig, type FeishuPlatformConfig } from "../../utils/config.js";
import type { SandboxConfig } from "../../core/sandbox/index.js";

// 内置插件
import { voicePlugin } from "../../plugins/voice/index.js";
import { cardPlugin } from "./card/index.js";
import { debugPlugin } from "../../plugins/debug/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 飞书机器人配置
 */
export interface FeishuBotOptions {
	/** 配置文件路径 */
	configPath?: string;
	/** Sandbox 配置 */
	sandboxConfig?: SandboxConfig;
}

// ============================================================================
// Built-in Plugins
// ============================================================================

/**
 * 获取飞书平台内置插件
 */
export function getFeishuBuiltinPlugins() {
	return [voicePlugin, cardPlugin, debugPlugin];
}

// ============================================================================
// Bot Factory
// ============================================================================

/**
 * 创建飞书机器人
 */
export async function createFeishuBot(options?: FeishuBotOptions): Promise<UnifiedBot> {
	const { configPath, sandboxConfig } = options || {};

	// 加载配置
	const config = loadConfig(configPath);

	// 获取飞书平台配置
	const feishuConfig = config.feishu as FeishuPlatformConfig | undefined;
	if (!feishuConfig) {
		throw new Error("Feishu configuration not found. Please add 'feishu' section to config.json");
	}

	// 合并 sandbox 配置（CLI 参数优先）
	const finalSandboxConfig: SandboxConfig = sandboxConfig || config.sandbox || { type: "host" };

	// 创建飞书适配器
	const adapter = new FeishuAdapter({
		appId: feishuConfig.appId,
		appSecret: feishuConfig.appSecret,
		workingDir: config.workspaceDir!,
		platform: "feishu",
		enabled: true,
		useWebSocket: feishuConfig.useWebSocket,
		port: config.port,
	} as FeishuAdapterConfig);

	// 初始化适配器
	await adapter.initialize({
		platform: "feishu",
		enabled: true,
	});

	// 创建存储
	const store = new FeishuStore({
		workspaceDir: config.workspaceDir!,
		appId: feishuConfig.appId,
		appSecret: feishuConfig.appSecret,
	});

	// 创建插件管理器
	const pluginManager = new PluginManager({
		workspaceDir: config.workspaceDir!,
		pluginsConfig: config.plugins || {},
	});

	// 设置平台为飞书
	pluginManager.setPlatform("feishu");

	// 注册内置插件
	pluginManager.registerAll(getFeishuBuiltinPlugins());

	// 初始化插件
	await pluginManager.initialize({
		sandboxConfig: finalSandboxConfig,
		platform: "feishu",
	});

	// 创建统一机器人
	const bot = new UnifiedBot({
		adapter,
		workingDir: config.workspaceDir!,
		store,
		pluginManager,
		port: config.port,
		defaultModel: config.model,
	});

	return bot;
}
