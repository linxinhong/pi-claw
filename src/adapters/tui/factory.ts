/**
 * TUI Bot Factory
 *
 * 创建配置好的 UnifiedBot 实例用于 TUI 模式
 */

import { join } from "path";
import { UnifiedBot } from "../../core/unified-bot.js";
import { PluginManager } from "../../core/plugin/manager.js";
import { TUIAdapter } from "./adapter.js";
import { TUIStore } from "./store.js";
import type { PiClawTUI } from "./app.js";
import { ConfigManager } from "../../core/config/manager.js";
import { getHookManager } from "../../core/hook/index.js";
import { PiLogger } from "../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

export interface CreateTUIBotConfig {
	/** 工作目录 */
	workspaceDir: string;
	/** TUI 实例 */
	tui: PiClawTUI;
	/** 默认模型 */
	model?: string;
	/** 日志器 */
	logger?: PiLogger;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建 TUI Bot
 *
 * 创建配置好的 UnifiedBot 实例，集成 TUI 适配器和 CoreAgent
 */
export async function createTUIBot(config: CreateTUIBotConfig): Promise<UnifiedBot> {
	const { workspaceDir, tui, model } = config;

	// 1. 创建 Logger（不输出到控制台）
	const logDir = join(workspaceDir, "logs");
	const logger = new PiLogger("tui", {
		dir: logDir,
		enabled: true,
		level: "debug",
		console: false,
	});

	logger.info("Creating TUI bot", { workspaceDir });

	// 2. 创建 TUIAdapter
	const adapter = new TUIAdapter({
		workingDir: workspaceDir,
		tui,
		model,
		logger,
	});

	// 初始化适配器
	await adapter.initialize({
		platform: "tui",
		enabled: true,
	});

	// 3. 创建 TUIStore
	const store = new TUIStore({
		workspaceDir,
	});

	// 4. 初始化 ConfigManager
	let configManager: ConfigManager | undefined;
	try {
		configManager = ConfigManager.getInstance();
	} catch {
		// ConfigManager 未初始化，使用默认配置
	}

	// 5. 创建 PluginManager
	// TUI 模式使用简化的插件配置
	const pluginsConfig = {
		agent: { enabled: true },
		memory: { enabled: true, maxHistoryMessages: 10 },
	};

	const pluginManager = new PluginManager({
		workspaceDir,
		pluginsConfig,
		logger: logger.child("plugin"),
	});

	// 设置平台
	pluginManager.setPlatform("tui");

	// 设置 HookManager
	pluginManager.setHookManager(getHookManager());

	// 初始化插件
	await pluginManager.initialize({
		platform: "tui",
	});

	logger.info("TUI bot created successfully");

	// 6. 创建 UnifiedBot
	const bot = new UnifiedBot({
		adapter,
		workingDir: workspaceDir,
		store,
		pluginManager,
		defaultModel: model,
	});

	return bot;
}
