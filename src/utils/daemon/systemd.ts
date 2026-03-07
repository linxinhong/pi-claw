/**
 * systemd - Linux 守护进程实现
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { spawn } from "child_process";
import type { DaemonConfig, DaemonLauncher, DaemonStatus } from "./launcher.js";

// ============================================================================
// 常量
// ============================================================================

const SERVICE_NAME = "pi-claw";
const SYSTEMD_DIR = "/etc/systemd/system";
const SERVICE_PATH = join(SYSTEMD_DIR, `${SERVICE_NAME}.service`);

// ============================================================================
// systemd Launcher
// ============================================================================

export class SystemdLauncher implements DaemonLauncher {
	readonly platform = "Linux";

	isSupported(): boolean {
		return platform() === "linux";
	}

	private getServicePath(name: string): string {
		return join(SYSTEMD_DIR, `${name}.service`);
	}

	private generateService(config: DaemonConfig): string {
		const envLines = config.env
			? Object.entries(config.env)
					.map(([key, value]) => `Environment="${key}=${value}"`)
					.join("\n")
			: "";

		return `[Unit]
Description=${config.description}
After=network.target

[Service]
Type=simple
ExecStart=${config.execPath} ${config.args.join(" ")}
WorkingDirectory=${config.workingDir}
${envLines}
Restart=${config.restart ?? "on-failure"}
RestartSec=5
StandardOutput=append:${join(config.workingDir, "logs", "pi-claw.log")}
StandardError=append:${join(config.workingDir, "logs", "pi-claw.error.log")}

[Install]
WantedBy=multi-user.target
`;
	}

	async install(config: DaemonConfig): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "systemd is only supported on Linux" };
		}

		try {
			// 生成 service 文件
			const serviceContent = this.generateService(config);
			const servicePath = this.getServicePath(config.name);

			// 需要 sudo 权限写入 /etc/systemd/system
			writeFileSync(servicePath, serviceContent, "utf-8");

			// 重新加载 systemd
			await this.runSystemctl("daemon-reload");

			// 启用服务
			if (config.autoStart !== false) {
				await this.runSystemctl("enable", config.name);
			}

			return { success: true };
		} catch (error: any) {
			return { success: false, error: error.message };
		}
	}

	async uninstall(name: string): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "systemd is only supported on Linux" };
		}

		try {
			const servicePath = this.getServicePath(name);

			// 先停止
			await this.stop(name);

			// 禁用服务
			await this.runSystemctl("disable", name);

			// 删除 service 文件
			if (existsSync(servicePath)) {
				unlinkSync(servicePath);
			}

			// 重新加载 systemd
			await this.runSystemctl("daemon-reload");

			return { success: true };
		} catch (error: any) {
			return { success: false, error: error.message };
		}
	}

	async start(name: string): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "systemd is only supported on Linux" };
		}

		return this.runSystemctl("start", name);
	}

	async stop(name: string): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "systemd is only supported on Linux" };
		}

		return this.runSystemctl("stop", name);
	}

	async status(name: string): Promise<DaemonStatus> {
		if (!this.isSupported()) {
			return { installed: false };
		}

		const servicePath = this.getServicePath(name);
		const installed = existsSync(servicePath);

		if (!installed) {
			return { installed: false };
		}

		try {
			const result = await this.runSystemctlWithOutput("is-active", name);
			const running = result.trim() === "active";

			let pid: number | undefined;
			if (running) {
				const pidResult = await this.runSystemctlWithOutput("show", "--property=MainPID", name);
				const pidMatch = pidResult.match(/MainPID=(\d+)/);
				pid = pidMatch ? parseInt(pidMatch[1], 10) : undefined;
			}

			const enabledResult = await this.runSystemctlWithOutput("is-enabled", name);
			const enabled = enabledResult.trim() === "enabled";

			return {
				installed: true,
				running,
				enabled,
				pid: pid && pid > 0 ? pid : undefined,
			};
		} catch {
			return {
				installed: true,
				running: false,
				enabled: false,
			};
		}
	}

	isInstalled(name: string): boolean {
		return existsSync(this.getServicePath(name));
	}

	private runSystemctl(...args: string[]): Promise<{ success: boolean; error?: string }> {
		return new Promise((resolve) => {
			const child = spawn("systemctl", args, {
				stdio: "pipe",
			});

			child.on("close", (code) => {
				if (code === 0) {
					resolve({ success: true });
				} else {
					resolve({ success: false, error: `systemctl ${args[0]} failed with code ${code}` });
				}
			});

			child.on("error", (err) => {
				resolve({ success: false, error: err.message });
			});
		});
	}

	private runSystemctlWithOutput(...args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn("systemctl", args, {
				stdio: "pipe",
			});

			let output = "";
			child.stdout?.on("data", (data) => {
				output += data.toString();
			});

			child.on("close", (code) => {
				if (code === 0) {
					resolve(output);
				} else {
					reject(new Error(`systemctl failed with code ${code}`));
				}
			});

			child.on("error", (err) => {
				reject(err);
			});
		});
	}
}

// ============================================================================
// 全局实例
// ============================================================================

export const systemdLauncher = new SystemdLauncher();
