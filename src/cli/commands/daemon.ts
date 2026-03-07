/**
 * daemon 命令 - 守护进程管理
 */

import { Command } from "commander";
import { homedir, platform } from "os";
import { join } from "path";
import { getLauncher, isDaemonSupported } from "../../utils/daemon/index.js";
import { printSuccess, printError, printInfo, printWarning, printKeyValue, COLORS } from "../utils/output.js";

// ============================================================================
// 常量
// ============================================================================

const SERVICE_NAME = "com.pi-claw.service";
const DISPLAY_NAME = "pi-claw";

// ============================================================================
// 命令实现
// ============================================================================

export function registerDaemonCommand(program: Command): void {
	const daemon = program.command("daemon").description("守护进程管理");

	// daemon install
	daemon
		.command("install")
		.description("安装为守护进程")
		.option("--config <path>", "配置文件路径")
		.option("--sandbox <type>", "Sandbox 类型")
		.action(async (options) => {
			if (!isDaemonSupported()) {
				printError(`Daemon is not supported on ${platform()}`);
				printInfo("Supported platforms: macOS (launchd), Linux (systemd)");
				process.exit(1);
			}

			const launcher = getLauncher()!;

			if (launcher.isInstalled(SERVICE_NAME)) {
				printError("Daemon is already installed");
				printInfo("Use 'pi-claw daemon uninstall' to remove it first");
				process.exit(1);
			}

			// 构建配置
			const execPath = process.execPath;
			const mainPath = join(import.meta.dirname, "..", "..", "..", "dist", "main.js");
			const args = [mainPath];

			if (options.config) {
				args.push("--config", options.config);
			}
			if (options.sandbox) {
				args.push("--sandbox", options.sandbox);
			}

			const config = {
				name: SERVICE_NAME,
				displayName: DISPLAY_NAME,
				description: "Pi Claw Multi-platform Bot Service",
				execPath,
				args,
				workingDir: join(homedir(), ".pi-claw"),
				autoStart: true,
				restart: true,
			};

			printInfo(`Installing daemon for ${launcher.platform}...`);

			const result = await launcher.install(config);

			if (result.success) {
				printSuccess("Daemon installed successfully");

				// 询问是否启动
				printInfo("Starting daemon...");
				const startResult = await launcher.start(SERVICE_NAME);

				if (startResult.success) {
					printSuccess("Daemon started successfully");
				} else {
					printWarning(`Daemon installed but failed to start: ${startResult.error}`);
					printInfo("Try starting manually: pi-claw daemon start");
				}
			} else {
				printError(result.error || "Failed to install daemon");
				process.exit(1);
			}
		});

	// daemon uninstall
	daemon
		.command("uninstall")
		.description("卸载守护进程")
		.action(async () => {
			if (!isDaemonSupported()) {
				printError(`Daemon is not supported on ${platform()}`);
				process.exit(1);
			}

			const launcher = getLauncher()!;

			if (!launcher.isInstalled(SERVICE_NAME)) {
				printError("Daemon is not installed");
				process.exit(1);
			}

			printInfo(`Uninstalling daemon from ${launcher.platform}...`);

			const result = await launcher.uninstall(SERVICE_NAME);

			if (result.success) {
				printSuccess("Daemon uninstalled successfully");
			} else {
				printError(result.error || "Failed to uninstall daemon");
				process.exit(1);
			}
		});

	// daemon start
	daemon
		.command("start")
		.description("启动守护进程")
		.action(async () => {
			if (!isDaemonSupported()) {
				printError(`Daemon is not supported on ${platform()}`);
				process.exit(1);
			}

			const launcher = getLauncher()!;

			if (!launcher.isInstalled(SERVICE_NAME)) {
				printError("Daemon is not installed");
				printInfo("Use 'pi-claw daemon install' to install it first");
				process.exit(1);
			}

			printInfo("Starting daemon...");

			const result = await launcher.start(SERVICE_NAME);

			if (result.success) {
				printSuccess("Daemon started successfully");
			} else {
				printError(result.error || "Failed to start daemon");
				process.exit(1);
			}
		});

	// daemon stop
	daemon
		.command("stop")
		.description("停止守护进程")
		.action(async () => {
			if (!isDaemonSupported()) {
				printError(`Daemon is not supported on ${platform()}`);
				process.exit(1);
			}

			const launcher = getLauncher()!;

			if (!launcher.isInstalled(SERVICE_NAME)) {
				printError("Daemon is not installed");
				process.exit(1);
			}

			printInfo("Stopping daemon...");

			const result = await launcher.stop(SERVICE_NAME);

			if (result.success) {
				printSuccess("Daemon stopped successfully");
			} else {
				printError(result.error || "Failed to stop daemon");
				process.exit(1);
			}
		});

	// daemon status
	daemon
		.command("status")
		.description("查看守护进程状态")
		.action(async () => {
			if (!isDaemonSupported()) {
				printError(`Daemon is not supported on ${platform()}`);
				process.exit(1);
			}

			const launcher = getLauncher()!;
			const status = await launcher.status(SERVICE_NAME);

			console.log(`\n${COLORS.bright}Daemon Status (${launcher.platform})${COLORS.reset}\n`);

			printKeyValue("Installed", status.installed ? `${COLORS.green}Yes${COLORS.reset}` : `${COLORS.red}No${COLORS.reset}`);

			if (status.installed) {
				printKeyValue("Running", status.running ? `${COLORS.green}Yes${COLORS.reset}` : `${COLORS.red}No${COLORS.reset}`);
				if (status.pid) {
					printKeyValue("PID", status.pid);
				}
				printKeyValue("Auto-start", status.enabled ? `${COLORS.green}Enabled${COLORS.reset}` : `${COLORS.yellow}Disabled${COLORS.reset}`);
			}

			console.log();
		});
}
