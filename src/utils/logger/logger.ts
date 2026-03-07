/**
 * PiLogger - 日志实现
 *
 * 支持分类文件 + 主汇总文件的混合日志模式
 */

import { appendFileSync, existsSync, mkdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Logger, LogConfig, LogContext, LogLevel, LogEntry, FileLoggerConfig } from "./types.js";
import { LOG_LEVEL_PRIORITY } from "./types.js";

// ============================================================================
// 常量
// ============================================================================

/** 默认日志目录 */
export const DEFAULT_LOG_DIR = join(homedir(), ".pi-claw", "logs");

/** 主日志文件名 */
export const MAIN_LOG_FILE = "pi-claw.log";

/** 错误日志文件名 */
export const ERROR_LOG_FILE = "pi-claw.error.log";

/** 最大日志文件大小 (10MB) */
const MAX_LOG_SIZE = 10 * 1024 * 1024;

/** 最大日志文件数量 */
const MAX_LOG_FILES = 5;

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
 * 获取时间戳
 */
function getTimestamp(): string {
	return new Date().toISOString().replace("T", " ").substring(0, 19);
}

/**
 * 格式化日志条目为字符串
 */
function formatEntry(entry: LogEntry, includeCategory: boolean = true): string {
	const categoryStr = includeCategory ? ` [${entry.category}]` : "";
	const contextStr = entry.context && Object.keys(entry.context).length > 0
		? ` ${JSON.stringify(entry.context)}`
		: "";
	const errorStr = entry.error
		? ` Error: ${entry.error.message}${entry.error.stack ? `\n${entry.error.stack}` : ""}`
		: "";

	return `[${entry.timestamp}]${categoryStr} [${entry.level.toUpperCase().padEnd(5)}] ${entry.message}${contextStr}${errorStr}\n`;
}

/**
 * 检查并轮转日志文件
 */
function rotateLogIfNeeded(logFile: string): void {
	if (!existsSync(logFile)) return;

	try {
		const stats = statSync(logFile);
		if (stats.size >= MAX_LOG_SIZE) {
			// 轮转日志文件
			for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
				const oldFile = `${logFile}.${i}`;
				const newFile = `${logFile}.${i + 1}`;
				if (existsSync(oldFile)) {
					const { renameSync, unlinkSync } = require("fs");
					if (existsSync(newFile)) {
						unlinkSync(newFile);
					}
					renameSync(oldFile, newFile);
				}
			}
			const { renameSync } = require("fs");
			renameSync(logFile, `${logFile}.1`);
		}
	} catch {
		// 忽略错误
	}
}

/**
 * 获取分类日志文件名
 * 分类规则：
 * - 主 adapter: `{platform}.log` (如 `feishu.log`)
 * - 插件: `plugin-{pluginId}.log`
 * - 核心模块: `{module}.log` (如 `agent.log`)
 */
function getCategoryFileName(category: string): string {
	// 处理 plugin:xxx 格式
	if (category.startsWith("plugin:")) {
		const pluginId = category.substring(7);
		return `plugin-${pluginId}.log`;
	}

	// 处理 feishu:adapter 格式（取第一部分）
	const colonIndex = category.indexOf(":");
	if (colonIndex > 0) {
		const mainCategory = category.substring(0, colonIndex);
		return `${mainCategory}.log`;
	}

	// 默认：直接使用分类名
	return `${category}.log`;
}

// ============================================================================
// 控制台颜色
// ============================================================================

const COLORS = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: COLORS.magenta,
	info: COLORS.green,
	warn: COLORS.yellow,
	error: COLORS.red,
};

// ============================================================================
// PiLogger
// ============================================================================

/**
 * PiLogger 实现类
 *
 * 支持混合日志模式：
 * - 写入分类文件（如 feishu.log）
 * - 同时写入主汇总文件（pi-claw.log）
 * - 错误日志额外写入错误汇总文件（pi-claw.error.log）
 */
export class PiLogger implements Logger {
	readonly category: string;
	private logDir: string;
	private categoryFile: string;
	private mainLogFile: string;
	private errorLogFile: string;
	private enabled: boolean;
	private minLevel: LogLevel;
	private consoleOutput: boolean;
	private writeToMain: boolean;

	constructor(category: string, config?: LogConfig) {
		this.category = category;
		this.logDir = config?.dir || DEFAULT_LOG_DIR;
		this.enabled = config?.enabled ?? true;
		this.minLevel = config?.level || "info";
		this.consoleOutput = config?.console ?? true;
		this.writeToMain = true; // 总是写入主汇总文件

		// 确保日志目录存在
		ensureDir(this.logDir);

		// 设置文件路径
		this.categoryFile = join(this.logDir, getCategoryFileName(category));
		this.mainLogFile = join(this.logDir, MAIN_LOG_FILE);
		this.errorLogFile = join(this.logDir, ERROR_LOG_FILE);
	}

	/**
	 * 设置是否启用
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * 设置最小日志级别
	 */
	setMinLevel(level: LogLevel): void {
		this.minLevel = level;
	}

	/**
	 * 设置是否输出到控制台
	 */
	setConsoleOutput(enabled: boolean): void {
		this.consoleOutput = enabled;
	}

	/**
	 * 检查日志级别是否满足要求
	 */
	private shouldLog(level: LogLevel): boolean {
		if (!this.enabled) return false;
		return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
	}

	/**
	 * 写入日志到文件
	 */
	private writeToFile(entry: LogEntry): void {
		try {
			// 1. 写入分类文件
			rotateLogIfNeeded(this.categoryFile);
			appendFileSync(this.categoryFile, formatEntry(entry, false), "utf-8");

			// 2. 写入主汇总文件
			if (this.writeToMain) {
				rotateLogIfNeeded(this.mainLogFile);
				appendFileSync(this.mainLogFile, formatEntry(entry, true), "utf-8");
			}

			// 3. 错误日志额外写入错误汇总文件
			if (entry.level === "error") {
				rotateLogIfNeeded(this.errorLogFile);
				appendFileSync(this.errorLogFile, formatEntry(entry, true), "utf-8");
			}
		} catch {
			// 忽略写入错误
		}
	}

	/**
	 * 输出到控制台
	 */
	private writeToConsole(entry: LogEntry): void {
		const timestamp = `${COLORS.dim}${entry.timestamp}${COLORS.reset}`;
		const levelColor = LEVEL_COLORS[entry.level];
		const levelStr = `${levelColor}${entry.level.toUpperCase().padEnd(5)}${COLORS.reset}`;
		const categoryStr = `${COLORS.cyan}[${entry.category}]${COLORS.reset}`;

		let output = `${timestamp} ${categoryStr} ${levelStr} ${entry.message}`;

		if (entry.context && Object.keys(entry.context).length > 0) {
			output += ` ${JSON.stringify(entry.context)}`;
		}

		if (entry.error) {
			output += `\n  Error: ${entry.error.message}`;
			if (entry.error.stack) {
				output += `\n  ${entry.error.stack.split("\n").slice(1, 4).join("\n  ")}`;
			}
		}

		if (entry.level === "error") {
			console.error(output);
		} else if (entry.level === "warn") {
			console.warn(output);
		} else {
			console.log(output);
		}
	}

	/**
	 * 记录日志
	 */
	private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
		if (!this.shouldLog(level)) return;

		const entry: LogEntry = {
			timestamp: getTimestamp(),
			level,
			category: this.category,
			message,
			context,
			error: error
				? {
						name: error.name,
						message: error.message,
						stack: error.stack,
					}
				: undefined,
		};

		// 写入文件
		this.writeToFile(entry);

		// 输出到控制台
		if (this.consoleOutput) {
			this.writeToConsole(entry);
		}
	}

	debug(message: string, context?: LogContext): void {
		this.log("debug", message, context);
	}

	info(message: string, context?: LogContext): void {
		this.log("info", message, context);
	}

	warn(message: string, context?: LogContext): void {
		this.log("warn", message, context);
	}

	error(message: string, context?: LogContext, error?: Error): void {
		this.log("error", message, context, error);
	}

	/**
	 * 创建子 Logger
	 */
	child(subCategory: string): Logger {
		const childCategory = `${this.category}:${subCategory}`;
		return new PiLogger(childCategory, {
			enabled: this.enabled,
			level: this.minLevel,
			dir: this.logDir,
			console: this.consoleOutput,
		});
	}

	/**
	 * 获取分类日志文件路径
	 */
	getCategoryLogFile(): string {
		return this.categoryFile;
	}

	/**
	 * 获取主日志文件路径
	 */
	getMainLogFile(): string {
		return this.mainLogFile;
	}

	/**
	 * 获取错误日志文件路径
	 */
	getErrorLogFile(): string {
		return this.errorLogFile;
	}
}

// ============================================================================
// 全局 Logger 管理
// ============================================================================

let globalLogger: Logger | null = null;

/**
 * 设置全局 Logger
 */
export function setGlobalLogger(logger: Logger): void {
	globalLogger = logger;
}

/**
 * 获取全局 Logger
 */
export function getGlobalLogger(): Logger | null {
	return globalLogger;
}

/**
 * 创建全局 Logger
 */
export function createGlobalLogger(config?: LogConfig): Logger {
	const logger = new PiLogger("main", config);
	setGlobalLogger(logger);
	return logger;
}
