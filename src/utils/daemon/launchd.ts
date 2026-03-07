/**
 * launchd - macOS 守护进程实现
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { spawn } from "child_process";
import type { DaemonConfig, DaemonLauncher, DaemonStatus } from "./launcher.js";

// ============================================================================
// 常量
// ============================================================================

const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const SERVICE_NAME = "com.pi-claw.service";
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${SERVICE_NAME}.plist`);

// ============================================================================
// launchd Launcher
// ============================================================================

export class LaunchdLauncher implements DaemonLauncher {
	readonly platform = "macOS";

	isSupported(): boolean {
		return platform() === "darwin";
	}

	private getPlistPath(name: string): string {
		return join(LAUNCH_AGENTS_DIR, `${name}.plist`);
	}

	private generatePlist(config: DaemonConfig): string {
		const envDict = config.env
			? Object.entries(config.env)
					.map(([key, value]) => `\t\t\t<key>${key}</key>\n\t\t\t<string>${value}</string>`)
					.join("\n")
			: "";

		return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${config.name}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${config.execPath}</string>
${config.args.map((arg) => `\t\t<string>${arg}</string>`).join("\n")}
	</array>
	<key>WorkingDirectory</key>
	<string>${config.workingDir}</string>
	<key>RunAtLoad</key>
	<${config.autoStart ?? true}/>
	<key>KeepAlive</key>
	<${config.restart ?? true}/>
	<key>StandardOutPath</key>
	<string>${join(config.workingDir, "logs", "pi-claw.log")}</string>
	<key>StandardErrorPath</key>
	<string>${join(config.workingDir, "logs", "pi-claw.error.log")}</string>
	<key>EnvironmentVariables</key>
	<dict>
${envDict}
	</dict>
</dict>
</plist>
`;
	}

	async install(config: DaemonConfig): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "launchd is only supported on macOS" };
		}

		try {
			// 确保 LaunchAgents 目录存在
			if (!existsSync(LAUNCH_AGENTS_DIR)) {
				mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
			}

			// 生成 plist 文件
			const plistContent = this.generatePlist(config);
			const plistPath = this.getPlistPath(config.name);
			writeFileSync(plistPath, plistContent, "utf-8");

			return { success: true };
		} catch (error: any) {
			return { success: false, error: error.message };
		}
	}

	async uninstall(name: string): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "launchd is only supported on macOS" };
		}

		try {
			const plistPath = this.getPlistPath(name);

			// 先停止
			await this.stop(name);

			// 删除 plist 文件
			if (existsSync(plistPath)) {
				unlinkSync(plistPath);
			}

			return { success: true };
		} catch (error: any) {
			return { success: false, error: error.message };
		}
	}

	async start(name: string): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "launchd is only supported on macOS" };
		}

		return new Promise((resolve) => {
			const plistPath = this.getPlistPath(name);

			if (!existsSync(plistPath)) {
				resolve({ success: false, error: "Service not installed" });
				return;
			}

			const child = spawn("launchctl", ["load", plistPath], {
				stdio: "pipe",
			});

			child.on("close", (code) => {
				if (code === 0) {
					resolve({ success: true });
				} else {
					resolve({ success: false, error: `launchctl load failed with code ${code}` });
				}
			});

			child.on("error", (err) => {
				resolve({ success: false, error: err.message });
			});
		});
	}

	async stop(name: string): Promise<{ success: boolean; error?: string }> {
		if (!this.isSupported()) {
			return { success: false, error: "launchd is only supported on macOS" };
		}

		return new Promise((resolve) => {
			const plistPath = this.getPlistPath(name);

			if (!existsSync(plistPath)) {
				resolve({ success: true }); // 未安装视为成功
				return;
			}

			const child = spawn("launchctl", ["unload", plistPath], {
				stdio: "pipe",
			});

			child.on("close", (code) => {
				// unload 即使服务未运行也会返回成功
				resolve({ success: true });
			});

			child.on("error", (err) => {
				resolve({ success: false, error: err.message });
			});
		});
	}

	async status(name: string): Promise<DaemonStatus> {
		if (!this.isSupported()) {
			return { installed: false };
		}

		const plistPath = this.getPlistPath(name);
		const installed = existsSync(plistPath);

		if (!installed) {
			return { installed: false };
		}

		// 使用 launchctl list 检查运行状态
		return new Promise((resolve) => {
			const child = spawn("launchctl", ["list", name], {
				stdio: "pipe",
			});

			let output = "";
			child.stdout?.on("data", (data) => {
				output += data.toString();
			});

			child.on("close", (code) => {
				if (code === 0) {
					// 解析 PID
					const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
					const pid = pidMatch ? parseInt(pidMatch[1], 10) : undefined;

					resolve({
						installed: true,
						running: pid !== undefined,
						enabled: true,
						pid,
					});
				} else {
					resolve({
						installed: true,
						running: false,
						enabled: true,
					});
				}
			});

			child.on("error", () => {
				resolve({ installed: true, running: false, enabled: true });
			});
		});
	}

	isInstalled(name: string): boolean {
		return existsSync(this.getPlistPath(name));
	}
}

// ============================================================================
// 全局实例
// ============================================================================

export const launchdLauncher = new LaunchdLauncher();
