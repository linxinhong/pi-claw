/**
 * Core Logger Module
 *
 * 日志系统入口
 */

// 类型导出
export type { Logger, LogConfig, LogContext, LogLevel, LogEntry, FileLoggerConfig } from "./types.js";
export { LOG_LEVEL_PRIORITY } from "./types.js";

// 实现导出
export { PiLogger, setGlobalLogger, getGlobalLogger, createGlobalLogger, DEFAULT_LOG_DIR, MAIN_LOG_FILE, ERROR_LOG_FILE } from "./logger.js";

// 控制台日志功能
export * from "./console.js";
