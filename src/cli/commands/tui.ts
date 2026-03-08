/**
 * TUI 命令 - 启动 TUI 界面
 */

import { Command } from "commander";
import { PiClawTUI } from "../../adapters/tui/index.js";
import { createTUIBot } from "../../adapters/tui/factory.js";
import type { TUIMode } from "../../adapters/tui/types.js";
import type { TUIAdapter } from "../../adapters/tui/adapter.js";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { ConfigManager } from "../../core/config/manager.js";
import { getHookManager } from "../../core/hook/index.js";
import { loadConfig } from "../../utils/config.js";

export function registerTUICommand(program: Command): void {
	program
		.command("tui")
		.description("启动 TUI 界面")
		.option("-m, --mode <mode>", "运行模式: chat, monitor, both", "chat")
		.option("-c, --config <path>", "配置文件路径")
		.option("-w, --workdir <path>", "工作目录")
		.option("--model <model>", "默认模型")
		.action(async (options) => {
			try {
				console.log("[pi-claw] Starting TUI...");

				// 确定工作目录
				const workspaceDir = options.workdir || join(homedir(), ".pi-claw");

				// 初始化 ConfigManager
				const config = loadConfig(workspaceDir);
				const hookManager = getHookManager();
				const configManager = ConfigManager.getInstance({
					configPath: options.config,
					initialConfig: config,
					hookManager,
					enableWatch: false, // TUI 模式不需要热更新
				});

				const tui = new PiClawTUI({
					workingDir: workspaceDir,
					configPath: options.config,
					initialMode: options.mode as TUIMode,
				});

				// 创建 Bot（在 TUI 启动前）
				let adapter: TUIAdapter | null = null;

				// Handle events
				tui.addEventListener((event) => {
					if (event.type === "message-send") {
						// 通过 adapter 处理用户输入
						if (adapter) {
							adapter.handleUserInput(event.content, event.channelId);
						}
					}

					if (event.type === "exit") {
						tui.stop();
						process.exit(0);
					}
				});

				// 添加启动日志
				tui.addLog({
					id: randomUUID(),
					level: "info",
					message: `TUI started in ${options.mode} mode`,
					timestamp: new Date(),
					source: "tui",
				});

				// 初始化 adapter 状态
				tui.updateAdapterStatus({
					name: "TUI",
					type: "local",
					status: "running",
					channels: 1,
					messages: 0,
				});

				// 启动 TUI（等待用户选择模式）
				await tui.start();

				// 如果是 chat 或 both 模式，创建并启动 Bot
				if (tui.getMode() === "chat" || tui.getMode() === "both") {
					tui.addLog({
						id: randomUUID(),
						level: "info",
						message: "Initializing CoreAgent...",
						timestamp: new Date(),
						source: "tui",
					});

					const bot = await createTUIBot({
						workspaceDir,
						tui,
						model: options.model,
					});

					// 获取 adapter 引用
					adapter = (bot as any).adapter as TUIAdapter;

					// 启动 bot
					await bot.start();

					tui.addLog({
						id: randomUUID(),
						level: "info",
						message: "CoreAgent initialized successfully",
						timestamp: new Date(),
						source: "tui",
					});
				}

				// Handle graceful shutdown
				const shutdown = async () => {
					console.log("\n[pi-claw] Shutting down...");
					tui.stop();
					process.exit(0);
				};

				process.on("SIGINT", shutdown);
				process.on("SIGTERM", shutdown);
			} catch (error: any) {
				console.error(`[pi-claw] Error: ${error.message}`);
				process.exit(1);
			}
		});
}
