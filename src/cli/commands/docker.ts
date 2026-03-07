/**
 * docker 命令 - Docker 容器管理
 */

import { Command } from "commander";
import { join } from "path";
import { spawn } from "child_process";
import { WORKSPACE_DIR } from "../../utils/config.js";

export function registerDockerCommand(program: Command): void {
	program
		.command("docker")
		.description("Docker 容器管理")
		.argument("<action>", "create|start|stop|remove|status|shell")
		.option("--data-dir <path>", "数据目录")
		.option("--container <name>", "容器名称 (默认: pi-claw-sandbox)")
		.action(async (action, options) => {
			const containerName = options.container || "pi-claw-sandbox";
			const dataDir = options.dataDir || WORKSPACE_DIR;

			const validActions = ["create", "start", "stop", "remove", "status", "shell"];
			if (!validActions.includes(action)) {
				console.error(`Error: Invalid action '${action}'. Valid actions: ${validActions.join(", ")}`);
				process.exit(1);
			}

			// 执行 docker.sh 脚本
			const scriptPath = join(import.meta.dirname, "..", "..", "..", "scripts", "docker.sh");
			const args = [action, "--container", containerName];

			if (action === "create") {
				args.push("--data-dir", dataDir);
			}

			try {
				const child = spawn("bash", [scriptPath, ...args], {
					stdio: "inherit",
				});

				child.on("close", (code) => {
					process.exit(code || 0);
				});
			} catch (error: any) {
				console.error(`Error executing docker.sh: ${error.message}`);
				process.exit(1);
			}
		});
}
