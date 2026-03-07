/**
 * Core Logger Types
 *
 * 日志系统核心类型定义
 */

// ============================================================================
// 日志级别
// ============================================================================

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志级别优先级映射
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

// ============================================================================
// 日志上下文
// ============================================================================

/**
 * 日志上下文信息
 */
export interface LogContext {
	/** 频道 ID */
	channelId?: string;
	/** 频道名称 */
	channelName?: string;
	/** 用户名 */
	userName?: string;
	/** 用户 ID */
	userId?: string;
	/** 其他上下文信息 */
	[key: string]: unknown;
}

// ============================================================================
// 日志配置
// ============================================================================

/**
 * 日志配置
 */
export interface LogConfig {
	/** 是否启用文件日志 */
	enabled?: boolean;
	/** 最小日志级别 */
	level?: LogLevel;
	/** 日志目录，默认 ~/.pi-claw/logs */
	dir?: string;
	/** 是否同时输出到控制台 */
	console?: boolean;
}

// ============================================================================
// Logger 接口
// ============================================================================

/**
 * Logger 接口
 *
 * 所有日志器都需要实现此接口
 */
export interface Logger {
	/** 日志分类 (如 "feishu", "agent", "plugin:voice") */
	readonly category: string;

	/**
	 * 记录 debug 日志
	 */
	debug(message: string, context?: LogContext): void;

	/**
	 * 记录 info 日志
	 */
	info(message: string, context?: LogContext): void;

	/**
	 * 记录 warn 日志
	 */
	warn(message: string, context?: LogContext): void;

	/**
	 * 记录 error 日志
	 */
	error(message: string, context?: LogContext, error?: Error): void;

	/**
	 * 创建子 Logger
	 * @param subCategory 子分类名称
	 */
	child(subCategory: string): Logger;
}

// ============================================================================
// 日志条目
// ============================================================================

/**
 * 日志条目
 */
export interface LogEntry {
	/** 时间戳 */
	timestamp: string;
	/** 日志级别 */
	level: LogLevel;
	/** 分类 */
	category: string;
	/** 消息 */
	message: string;
	/** 上下文 */
	context?: LogContext;
	/** 错误信息 */
	error?: {
		name: string;
		message: string;
		stack?: string;
	};
}

// ============================================================================
// 文件日志器配置
// ============================================================================

/**
 * 文件日志器配置
 */
export interface FileLoggerConfig {
	/** 日志目录 */
	logDir: string;
	/** 分类名称（用于生成文件名） */
	category: string;
	/** 最小日志级别 */
	level?: LogLevel;
	/** 是否同时输出到控制台 */
	console?: boolean;
	/** 是否写入主汇总文件 */
	writeToMain?: boolean;
	/** 是否写入错误汇总文件 */
	writeToError?: boolean;
}
