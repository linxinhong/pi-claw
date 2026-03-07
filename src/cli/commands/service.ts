/**
 * service 命令 - 服务管理
 */

import { Command } from "commander";
import { processManager } from "../../utils/service/index.js";
import { printSuccess, printError, printInfo, printKeyValue, printTable, COLORS } from "../utils/output.js";

export function registerServiceCommand(program: Command): void {
	const service = program.command("service").description("服务管理");

	// service start
	service
		.command("start")
		.description("启动服务（后台进程）")
		.option("--config <path>", "配置文件路径")
		.option("--sandbox <type>", "Sandbox 类型")
		.action(async (options) => {
			const result = await processManager.start({
				configPath: options.config,
				sandbox: options.sandbox,
			});

			if (result.success) {
				printSuccess(`Service started (PID: ${result.pid})`);
				printInfo(`Log file: ${processManager.getLogFile()}`);
			} else {
				printError(result.error || "Failed to start service");
				process.exit(1);
			}
		});

	// service stop
	service
		.command("stop")
		.description("停止服务")
		.option("--timeout <ms>", "超时时间（毫秒）", "10000")
		.action(async (options) => {
			const timeout = parseInt(options.timeout, 10);
			printInfo("Stopping service...");

			const result = await processManager.stop(timeout);

			if (result.success) {
				printSuccess("Service stopped");
			} else {
				printError(result.error || "Failed to stop service");
				process.exit(1);
			}
		});

	// service status
	service
		.command("status")
		.description("查看服务状态")
		.action(() => {
			const status = processManager.getStatus();

			if (status.running) {
				console.log(`\n${COLORS.green}●${COLORS.reset} ${COLORS.bright}pi-claw is running${COLORS.reset}\n`);
				printKeyValue("PID", status.pid!);
				printKeyValue("Started", status.startTime!.toISOString());
				printKeyValue("Uptime", status.uptime!);
				printKeyValue("PID File", processManager.getPidFile());
				printKeyValue("Log File", processManager.getLogFile());
				console.log();
			} else {
				console.log(`\n${COLORS.red}○${COLORS.reset} ${COLORS.bright}pi-claw is not running${COLORS.reset}\n`);
				printKeyValue("PID File", processManager.getPidFile());
				console.log();
			}
		});

	// service restart
	service
		.command("restart")
		.description("重启服务")
		.option("--config <path>", "配置文件路径")
		.option("--sandbox <type>", "Sandbox 类型")
		.option("--timeout <ms>", "停止超时时间（毫秒）", "10000")
		.action(async (options) => {
			// 先停止
			const status = processManager.getStatus();
			if (status.running) {
				printInfo("Stopping service...");
				const stopResult = await processManager.stop(parseInt(options.timeout, 10));
				if (!stopResult.success) {
					printError(stopResult.error || "Failed to stop service");
					process.exit(1);
				}
				printSuccess("Service stopped");
			}

			// 再启动
			printInfo("Starting service...");
			const startResult = await processManager.start({
				configPath: options.config,
				sandbox: options.sandbox,
			});

			if (startResult.success) {
				printSuccess(`Service started (PID: ${startResult.pid})`);
			} else {
				printError(startResult.error || "Failed to start service");
				process.exit(1);
			}
		});
}
