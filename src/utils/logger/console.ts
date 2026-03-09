/**
 * Console Log - 控制台日志工具
 *
 * 提供控制台日志输出，同时支持集成全局 Logger 写入文件
 */

import type { Logger } from "./index.js";

export interface LogContext {
	channelId: string;
	userName?: string;
	channelName?: string;
	platform?: string; // adapter 名称，如 "feishu"
}

interface UsageSummary {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

const COLORS = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	red: "\x1b[31m",
};

// 检测是否支持颜色（TTY 环境且未禁用颜色）
const supportsColor = process.stdout.isTTY && process.env.NO_COLOR !== "1" && process.env.TERM !== "dumb";

// 条件性应用颜色
const color = {
	reset: supportsColor ? COLORS.reset : "",
	dim: supportsColor ? COLORS.dim : "",
	green: supportsColor ? COLORS.green : "",
	yellow: supportsColor ? COLORS.yellow : "",
	blue: supportsColor ? COLORS.blue : "",
	magenta: supportsColor ? COLORS.magenta : "",
	cyan: supportsColor ? COLORS.cyan : "",
	red: supportsColor ? COLORS.red : "",
};

function timestamp(): string {
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 全局 Logger 引用
let globalLogger: Logger | null = null;

// 静默模式开关（TUI 模式下禁用控制台输出）
let silentMode = false;

/**
 * 设置全局 Logger
 * 设置后，log 函数会同时写入文件
 */
export function setGlobalLogger(logger: Logger): void {
	globalLogger = logger;
}

/**
 * 设置静默模式
 * 启用后，所有控制台输出将被禁用（用于 TUI 模式）
 */
export function setSilentMode(silent: boolean): void {
	silentMode = silent;
}

/**
 * 获取全局 Logger
 */
export function getGlobalLogger(): Logger | null {
	return globalLogger;
}

export function logInfo(message: string, ...args: unknown[]): void {
	if (silentMode) return;
	console.log(`${color.dim}${timestamp()}${color.reset} ${color.green}INFO${color.reset} ${message}`, ...args);

	// 同时写入文件
	if (globalLogger) {
		globalLogger.info(message, args.length > 0 ? { args } : undefined);
	}
}

export function logWarning(message: string, ...args: unknown[]): void {
	if (silentMode) return;
	console.warn(`${color.dim}${timestamp()}${color.reset} ${color.yellow}WARN${color.reset} ${message}`, ...args);

	// 同时写入文件
	if (globalLogger) {
		globalLogger.warn(message, args.length > 0 ? { args } : undefined);
	}
}

export function logError(message: string, ...args: unknown[]): void {
	if (silentMode) return;
	console.error(`${color.dim}${timestamp()}${color.reset} ${color.red}ERROR${color.reset} ${message}`, ...args);

	// 同时写入文件
	if (globalLogger) {
		const error = args.length > 0 && args[0] instanceof Error ? args[0] : undefined;
		globalLogger.error(message, args.length > 0 ? { args: args.filter(a => !(a instanceof Error)) } : undefined, error);
	}
}

export function logToolStart(ctx: LogContext, toolName: string, label: string, args: Record<string, unknown>): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	console.log(
		`${color.dim}${timestamp()}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.magenta}TOOL${color.reset} ${toolName}: ${label}`,
	);
}

export function logToolSuccess(ctx: LogContext, toolName: string, durationMs: number, result: string): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	const duration = (durationMs / 1000).toFixed(1);
	const truncated = result.length > 200 ? result.substring(0, 200) + "..." : result;
	console.log(
		`${color.dim}${timestamp()}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.green}OK${color.reset} ${toolName} (${duration}s): ${truncated}`,
	);
}

export function logToolError(ctx: LogContext, toolName: string, durationMs: number, error: string): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	const duration = (durationMs / 1000).toFixed(1);
	console.error(
		`${color.dim}${timestamp()}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.red}ERR${color.reset} ${toolName} (${duration}s): ${error}`,
	);
}

export function logResponseStart(ctx: LogContext): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	console.log(`${color.dim}${timestamp()}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.blue}RESP${color.reset} Starting response...`);
}

export function logResponse(ctx: LogContext, text: string): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	const truncated = text.length > 100 ? text.substring(0, 100) + "..." : text;
	console.log(`${color.dim}${timestamp()}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.blue}RESP${color.reset} ${truncated}`);
}

export function logThinking(ctx: LogContext, thinking: string): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	const truncated = thinking.length > 100 ? thinking.substring(0, 100) + "..." : thinking;
	console.log(`${color.dim}${timestamp()}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.magenta}THINK${color.reset} ${truncated}`);
}

export function logUsageSummary(ctx: LogContext, usage: UsageSummary, contextTokens: number, contextWindow: number): string {
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	const contextPercent = ((contextTokens / contextWindow) * 100).toFixed(1);
	const costStr = usage.cost.total > 0 ? ` $${usage.cost.total.toFixed(4)}` : "";

	const summary = `📊 Tokens: ${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out${costStr} | Context: ${contextPercent}%`;

	if (!silentMode) {
		console.log(
			`${color.dim}${timestamp()}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.green}USAGE${color.reset} ${summary}`,
		);
	}

	return summary;
}

export function logConnected(): void {
	if (silentMode) return;
	console.log(`${color.dim}${timestamp()}${color.reset} ${color.green}✓${color.reset} Connected to Feishu`);
}

export function logMessageReceive(ctx: LogContext, content: string, messageId: string): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	const platformTag = ctx.platform ? `[${ctx.platform}]` : "";
	const userInfo = ctx.userName || "unknown";
	const truncated = content.length > 100 ? content.substring(0, 100) + "..." : content;
	console.log(
		`${color.dim}${timestamp()}${color.reset} ${color.magenta}${platformTag}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.green}RECV${color.reset} [${userInfo}]: ${truncated}`,
	);
}

export function logMessageReply(ctx: LogContext, contentLength: number, durationMs: number): void {
	if (silentMode) return;
	const channelInfo = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId;
	const platformTag = ctx.platform ? `[${ctx.platform}]` : "";
	const duration = (durationMs / 1000).toFixed(1);
	console.log(
		`${color.dim}${timestamp()}${color.reset} ${color.magenta}${platformTag}${color.reset} ${color.cyan}${channelInfo}${color.reset} ${color.blue}REPLY${color.reset} ${contentLength} chars (${duration}s)`,
	);
}
