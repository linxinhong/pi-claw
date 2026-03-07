/**
 * Process Manager - 进程管理
 *
 * 使用 PID 文件管理后台进程
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawn } from "child_process";

// ============================================================================
// 常量
// ============================================================================

/** PI-CLAW 数据目录 */
const PI_CLAW_DIR = join(homedir(), ".pi-claw");

/** PID 文件路径 */
export const PID_FILE = join(PI_CLAW_DIR, ".pi-claw.pid");

/** 日志目录 */
export const LOGS_DIR = join(PI_CLAW_DIR, "logs");

/** 主日志文件 */
export const LOG_FILE = join(LOGS_DIR, "pi-claw.log");

/** 错误日志文件 */
export const ERROR_LOG_FILE = join(LOGS_DIR, "pi-claw.error.log");

// ============================================================================
// 类型
// ============================================================================

export interface ProcessStatus {
	running: boolean;
	pid?: number;
	startTime?: Date;
	uptime?: string;
}

export interface StartOptions {
	configPath?: string;
	sandbox?: string;
	port?: number;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * 检查进程是否存在
 */
function isProcessRunning(pid: number): boolean {
	try {
		// 发送信号 0 检查进程是否存在
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

	return parts.join(" ");
}

// ============================================================================
// Process Manager
// ============================================================================

/**
 * 进程管理器
 */
export class ProcessManager {
	private pidFile: string;
	private logFile: string;
	private errorLogFile: string;

	constructor(pidFile: string = PID_FILE, logFile: string = LOG_FILE, errorLogFile: string = ERROR_LOG_FILE) {
		this.pidFile = pidFile;
		this.logFile = logFile;
		this.errorLogFile = errorLogFile;
	}

	/**
	 * 获取进程状态
	 */
	getStatus(): ProcessStatus {
		if (!existsSync(this.pidFile)) {
			return { running: false };
		}

		try {
			const content = readFileSync(this.pidFile, "utf-8");
			const data = JSON.parse(content);
			const pid = data.pid;

			if (!pid || !isProcessRunning(pid)) {
				// 进程不存在，清理 PID 文件
				this.cleanup();
				return { running: false };
			}

			const startTime = new Date(data.startTime);
			const uptimeSeconds = (Date.now() - startTime.getTime()) / 1000;

			return {
				running: true,
				pid,
				startTime,
				uptime: formatUptime(uptimeSeconds),
			};
		} catch {
			this.cleanup();
			return { running: false };
		}
	}

	/**
	 * 启动后台进程
	 */
	async start(options: StartOptions = {}): Promise<{ success: boolean; pid?: number; error?: string }> {
		const status = this.getStatus();

		if (status.running) {
			return { success: false, error: `Service is already running (PID: ${status.pid})` };
		}

		// 确保日志目录存在
		ensureDir(LOGS_DIR);
		ensureDir(PI_CLAW_DIR);

		// 构建启动参数
		const args = [process.execPath, join(import.meta.dirname, "..", "..", "..", "dist", "main.js")];

		if (options.configPath) {
			args.push("--config", options.configPath);
		}
		if (options.sandbox) {
			args.push("--sandbox", options.sandbox);
		}
		if (options.port) {
			args.push("--port", String(options.port));
		}

		try {
			// 使用 spawn 启动后台进程
			const child = spawn(args[0], args.slice(1), {
				detached: true,
				stdio: ["ignore", "ignore", "ignore"],
			});

			// 让子进程独立运行
			child.unref();

			const pid = child.pid;
			const startTime = new Date();

			// 写入 PID 文件
			writeFileSync(this.pidFile, JSON.stringify({ pid, startTime }), "utf-8");

			return { success: true, pid };
		} catch (error: any) {
			return { success: false, error: error.message };
		}
	}

	/**
	 * 停止进程
	 */
	async stop(timeout: number = 10000): Promise<{ success: boolean; error?: string }> {
		const status = this.getStatus();

		if (!status.running || !status.pid) {
			return { success: false, error: "Service is not running" };
		}

		const pid = status.pid;

		try {
			// 先发送 SIGTERM
			process.kill(pid, "SIGTERM");

			// 等待进程退出
			const startTime = Date.now();
			while (Date.now() - startTime < timeout) {
				if (!isProcessRunning(pid)) {
					this.cleanup();
					return { success: true };
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// 超时后发送 SIGKILL
			if (isProcessRunning(pid)) {
				process.kill(pid, "SIGKILL");
				await new Promise((resolve) => setTimeout(resolve, 500));

				if (!isProcessRunning(pid)) {
					this.cleanup();
					return { success: true };
				}

				return { success: false, error: "Failed to kill process" };
			}

			this.cleanup();
			return { success: true };
		} catch (error: any) {
			// 进程可能已经不存在
			this.cleanup();
			return { success: false, error: error.message };
		}
	}

	/**
	 * 清理 PID 文件
	 */
	cleanup(): void {
		if (existsSync(this.pidFile)) {
			try {
				unlinkSync(this.pidFile);
			} catch {
				// 忽略错误
			}
		}
	}

	/**
	 * 获取 PID 文件路径
	 */
	getPidFile(): string {
		return this.pidFile;
	}

	/**
	 * 获取日志文件路径
	 */
	getLogFile(): string {
		return this.logFile;
	}

	/**
	 * 获取错误日志文件路径
	 */
	getErrorLogFile(): string {
		return this.errorLogFile;
	}
}

// ============================================================================
// 全局实例
// ============================================================================

export const processManager = new ProcessManager();
