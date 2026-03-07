/**
 * Adapter Types - Adapter 类型定义
 *
 * 定义 Adapter 工厂接口和相关类型
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import type { PlatformStore } from "../store/types.js";
import type { PluginManager } from "../plugin/manager.js";
import type { SandboxConfig } from "../sandbox/index.js";
import type { LogConfig, Logger } from "../../utils/logger/index.js";

// ============================================================================
// Adapter Metadata
// ============================================================================

/**
 * Adapter 元数据
 */
export interface AdapterMeta {
	/** 唯一标识符（如 "feishu", "wechat"） */
	id: string;
	/** 显示名称 */
	name: string;
	/** 版本号 */
	version: string;
	/** 描述 */
	description?: string;
}

// ============================================================================
// Bot Configuration
// ============================================================================

/**
 * 通用 Bot 配置
 */
export interface BotConfig {
	/** 工作目录 */
	workspaceDir: string;
	/** 插件配置 */
	plugins?: Record<string, any>;
	/** Sandbox 配置 */
	sandbox?: SandboxConfig;
	/** 端口号 */
	port?: number;
	/** 日志配置 */
	logging?: LogConfig;
	/** 其他平台特定配置 */
	[key: string]: any;
}

// ============================================================================
// Bot Interface
// ============================================================================

/**
 * Bot 接口
 *
 * 所有平台 Bot 都需要实现此接口
 */
export interface Bot {
	/**
	 * 启动机器人
	 * @param port 可选端口号
	 */
	start(port?: number): Promise<void>;

	/**
	 * 停止机器人
	 */
	stop(): Promise<void>;
}

// ============================================================================
// Adapter Factory
// ============================================================================

/**
 * Adapter 工厂接口
 *
 * 用于创建特定平台的 Bot 实例
 */
export interface AdapterFactory {
	/** Adapter 元数据 */
	readonly meta: AdapterMeta;

	/**
	 * 创建 Bot 实例
	 * @param config Bot 配置
	 */
	createBot(config: BotConfig): Promise<Bot>;

	/**
	 * 可选：验证配置是否有效
	 * @param config 配置对象
	 */
	validateConfig?(config: any): boolean;

	/**
	 * 可选：获取默认配置
	 */
	getDefaultConfig?(): Partial<BotConfig>;
}

// ============================================================================
// Adapter Context (Internal)
// ============================================================================

/**
 * Adapter 上下文
 *
 * 创建 Bot 时提供的内部上下文
 */
export interface AdapterContext {
	/** 平台适配器 */
	adapter: PlatformAdapter;
	/** 存储实例 */
	store: PlatformStore;
	/** 插件管理器 */
	pluginManager: PluginManager;
	/** 日志器 */
	logger?: Logger;
}
