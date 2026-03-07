#!/usr/bin/env node
/**
 * pi-claw CLI
 *
 * pi-claw - Pi Claw 多平台机器人命令行工具
 */

import { Command } from "commander";

// 导入命令注册函数
import { registerStartCommand } from "./cli/commands/start.js";
import { registerDockerCommand } from "./cli/commands/docker.js";
import { registerServiceCommand } from "./cli/commands/service.js";
import { registerInitCommand } from "./cli/commands/init.js";
import { registerLogsCommand } from "./cli/commands/logs.js";
import { registerDaemonCommand } from "./cli/commands/daemon.js";
import { registerPluginCommand } from "./cli/commands/plugin.js";
import { registerAdapterCommand } from "./cli/commands/adapter.js";

// ============================================================================
// CLI 程序
// ============================================================================

const program = new Command();

program
	.name("pi-claw")
	.description("Pi Claw - 多平台机器人 CLI")
	.version("1.0.0");

// 注册命令
registerStartCommand(program);
registerDockerCommand(program);
registerServiceCommand(program);
registerInitCommand(program);
registerLogsCommand(program);
registerDaemonCommand(program);
registerPluginCommand(program);
registerAdapterCommand(program);

// 解析命令行参数
program.parse();
