/**
 * pi-claw - 多平台机器人网关
 *
 * 通过 Adapter Registry 加载配置指定的平台
 * 添加新平台只需创建 adapter 目录，无需修改此文件
 */

import {
	adapterRegistry,
	loadAdapters,
	getConfiguredPlatforms,
} from "./core/adapter/index.js";
import type { BotConfig, Bot } from "./core/adapter/index.js";
import { loadConfig } from "./utils/config.js";
import type { SandboxConfig } from "./core/sandbox/index.js";
import { parseSandboxArg } from "./core/sandbox/index.js";
import * as log from "./utils/logger/index.js";
import { createGlobalLogger, PiLogger } from "./utils/logger/index.js";
import type { LogConfig } from "./utils/logger/index.js";
import { getHookManager, HOOK_NAMES } from "./core/hook/index.js";
import { ConfigManager } from "./core/config/manager.js";

// 重新导出主要入口函数和类型（供外部使用）
export type { SandboxConfig } from "./core/sandbox/index.js";
export { adapterRegistry } from "./core/adapter/index.js";

/**
 * 主入口选项
 */
export interface MainOptions {
	configPath?: string;
	sandbox?: string;
	port?: number;
}

/**
 * 解析命令行参数
 */
function parseArgs(): MainOptions {
	const args = process.argv.slice(2);
	const options: MainOptions = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--config" && args[i + 1]) {
			options.configPath = args[++i];
		} else if (arg === "--sandbox" && args[i + 1]) {
			options.sandbox = args[++i];
		} else if (arg === "--port" && args[i + 1]) {
			options.port = parseInt(args[++i], 10);
		}
	}

	return options;
}

/**
 * 主入口 - 启动机器人
 */
export async function main(options: MainOptions = {}): Promise<void> {
	// 如果没有提供选项，尝试从命令行解析
	if (Object.keys(options).length === 0) {
		options = parseArgs();
	}

	const config = loadConfig(options.configPath);

	// 初始化全局 Logger
	const logConfig: LogConfig = {
		enabled: true,
		level: "info",
		console: true,
	};
	const globalLogger = createGlobalLogger(logConfig);

	// 同时设置到 log.ts 的全局引用
	log.setGlobalLogger(globalLogger);

	// 初始化全局 HookManager
	const hookManager = getHookManager();

	// 初始化 ConfigManager（单例模式，传入已加载的配置避免重复加载）
	const configManager = ConfigManager.getInstance({
		configPath: options.configPath,
		initialConfig: config,
		hookManager,
		enableWatch: true, // 启用热更新
	});

	// 处理 sandbox 配置（CLI 参数优先）
	let sandboxConfig: SandboxConfig | undefined;
	if (options.sandbox) {
		sandboxConfig = parseSandboxArg(options.sandbox);
	} else if (config.sandbox) {
		sandboxConfig = config.sandbox as SandboxConfig;
	}

	// 处理 port（CLI 参数优先）
	const port = options.port || config.port;

	// 1. 自动发现并加载所有 adapter
	await loadAdapters();

	// 2. 确定要启动的平台（有配置的平台）
	const platforms = getConfiguredPlatforms(config);

	log.logInfo("Starting pi-claw...");
	log.logInfo(`Available adapters: ${adapterRegistry.listIds().join(", ")}`);
	log.logInfo(`Configured platforms: ${platforms.join(", ")}`);
	log.logInfo(`Working directory: ${config.workspaceDir}`);
	log.logInfo(`Port: ${port}`);
	if (sandboxConfig) {
		log.logInfo(`Sandbox mode: ${sandboxConfig.type}${sandboxConfig.type === "docker" ? `:${sandboxConfig.container}` : ""}`);
	}

	if (platforms.length === 0) {
		log.logWarning("No platform configured. Running in standalone mode (events and plugins only).");
	}

	// 3. 触发 system:before-start hook（bot 创建前）
	if (hookManager.hasHooks(HOOK_NAMES.SYSTEM_BEFORE_START)) {
		await hookManager.emit(HOOK_NAMES.SYSTEM_BEFORE_START, {
			timestamp: new Date(),
			version: "1.0.0",
			config: { workspaceDir: config.workspaceDir, port, platforms },
		});
	}

	// 4. 为每个平台创建并启动 bot
	const bots: Bot[] = [];

	for (const platform of platforms) {
		const factory = adapterRegistry.get(platform);
		if (!factory) {
			log.logWarning(`No adapter registered for platform: ${platform}`);
			continue;
		}

		// 构建平台特定的 Bot 配置
		const platformConfig = config[platform as keyof typeof config] as Record<string, any>;
		const botConfig: BotConfig = {
			workspaceDir: config.workspaceDir!,
			plugins: config.plugins,
			sandbox: sandboxConfig,
			port: port,
			logging: logConfig, // 传递日志配置给工厂
			model: config.model, // 全局默认模型（可被平台特定配置覆盖）
			...platformConfig, // 合并平台特定配置
		};

		const bot = await factory.createBot(botConfig);
		bots.push(bot);

		log.logInfo(`Created bot for platform: ${platform}`);
	}

	// 5. 启动所有 bot（并行）
	await Promise.all(bots.map((bot) => bot.start(port)));

	log.logConnected();

	// 6. 触发 system:ready hook（所有 bot 启动后）
	if (hookManager.hasHooks(HOOK_NAMES.SYSTEM_READY)) {
		await hookManager.emit(HOOK_NAMES.SYSTEM_READY, {
			timestamp: new Date(),
			version: "1.0.0",
			config: { workspaceDir: config.workspaceDir, port, platforms },
		});
	}

	// 7. 注册优雅关闭处理
	const shutdown = async () => {
		log.logInfo("Shutting down...");

		// 触发 system:shutdown hook
		if (hookManager.hasHooks(HOOK_NAMES.SYSTEM_SHUTDOWN)) {
			await hookManager.emit(HOOK_NAMES.SYSTEM_SHUTDOWN, {
				timestamp: new Date(),
				reason: "SIGINT",
			});
		}

		// 清理所有 hook
		hookManager.clearAll();

		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

// 如果直接运行
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		log.logError("Failed to start:", error);
		process.exit(1);
	});
}
