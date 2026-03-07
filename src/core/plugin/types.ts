/**
 * Core Plugin Types
 *
 * 通用插件系统核心类型定义，平台无关
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Logger, LogContext } from "../../utils/logger/index.js";

// ============================================================================
// Plugin Metadata
// ============================================================================

/**
 * 插件元数据
 */
export interface PluginMeta {
	/** 插件唯一标识 */
	id: string;
	/** 插件名称 */
	name: string;
	/** 插件版本 */
	version: string;
	/** 插件描述 */
	description?: string;
	/** 依赖的其他插件 */
	dependencies?: string[];
	/** 支持的平台列表（留空表示支持所有平台） */
	supportedPlatforms?: string[];
	/** 所需的平台能力（Feature Detection） */
	requiredCapabilities?: string[];
}

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * 插件配置
 */
export interface PluginConfig {
	/** 是否启用 */
	enabled: boolean;
	/** 插件特定配置 */
	[key: string]: unknown;
}

/**
 * 插件配置集合
 */
export interface PluginsConfig {
	[key: string]: PluginConfig;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * 附件信息
 */
export interface Attachment {
	original: string;
	local: string;
}

/**
 * 消息事件
 */
export interface MessageEvent {
	type: "message";
	channel: string;
	ts: string;
	user: string;
	userName?: string;
	text: string;
	rawText: string;
	attachments: Attachment[];
}

/**
 * 调度事件
 */
export interface ScheduledEvent {
	type: "scheduled";
	channel: string;
	eventId: string;
	eventType: "immediate" | "one-shot" | "periodic";
	scheduleInfo: string;
	text: string;
}

/**
 * 系统事件
 */
export interface SystemEvent {
	type: "system";
	action: "startup" | "shutdown" | "error";
	error?: Error;
}

/**
 * 插件事件联合类型
 */
export type PluginEvent = MessageEvent | ScheduledEvent | SystemEvent;

// ============================================================================
// Context Types
// ============================================================================

/**
 * 频道信息
 */
export interface ChannelInfo {
	id: string;
	name: string;
}

/**
 * 用户信息
 */
export interface UserInfo {
	id: string;
	userName: string;
	displayName: string;
}

/**
 * 平台能力接口（Feature Detection 模式）
 *
 * 通过这个接口，插件可以检测平台是否支持特定功能
 */
export interface PlatformCapabilities {
	/**
	 * 平台标识
	 */
	readonly platform: string;

	/**
	 * 检查平台是否支持某项能力
	 * @param capability 能力名称
	 */
	hasCapability(capability: string): boolean;

	/**
	 * 获取平台特定功能
	 * @param feature 功能名称
	 */
	getFeature?<T = unknown>(feature: string): T;

	// ========== 核心能力（可选实现） ==========

	/** 更新消息 */
	replaceMessage?(text: string): Promise<void>;

	/** 在线程中回复 */
	respondInThread?(text: string): Promise<void>;

	/** 设置打字状态 */
	setTyping?(isTyping: boolean): Promise<void>;

	/** 设置工作状态 */
	setWorking?(working: boolean): Promise<void>;

	/** 上传文件 */
	uploadFile?(filePath: string, title?: string): Promise<void>;

	/** 上传图片 */
	uploadImage?(imagePath: string): Promise<string>;

	/** 发送图片 */
	sendImage?(imageKey: string): Promise<string>;

	/** 发送语音消息 */
	sendVoiceMessage?(filePath: string): Promise<string>;

	/** 删除消息 */
	deleteMessage?(): Promise<void>;

	/** 发送错误卡片 */
	sendErrorCard?(message: string): Promise<void>;
}

/**
 * 消息上下文
 */
export interface MessageContext {
	/** 消息文本 */
	text: string;
	/** 原始消息文本 */
	rawText: string;
	/** 用户 ID */
	user: string;
	/** 用户名 */
	userName?: string;
	/** 频道 ID */
	channel: string;
	/** 时间戳 */
	ts: string;
	/** 附件列表 */
	attachments: Attachment[];
}

/**
 * 通用插件上下文
 *
 * 提供给插件使用的 API 和状态，包含通用能力和平台扩展能力
 */
export interface PluginContext {
	// ========== 消息信息 ==========
	message: MessageContext;

	// ========== 频道信息 ==========
	channelName?: string;
	channels: ChannelInfo[];
	users: UserInfo[];

	// ========== 核心响应方法 ==========
	/** 发送文本回复（所有平台都必须实现） */
	respond: (text: string, shouldLog?: boolean) => Promise<void>;

	// ========== 工作目录 ==========
	workspaceDir: string;
	channelDir: string;

	// ========== 平台能力扩展 ==========
	capabilities: PlatformCapabilities;

	// ========== 日志器 ==========
	/** 日志器 */
	logger?: Logger;
}

/**
 * 插件初始化上下文
 */
export interface PluginInitContext {
	/** 工作目录 */
	workspaceDir: string;
	/** 插件配置 */
	config: PluginConfig;
	/** 日志函数（兼容旧版本） */
	log: (level: "info" | "warning" | "error", message: string, ...args: unknown[]) => void;
	/** 日志器（推荐使用） */
	logger?: Logger;
	/** Sandbox 配置 */
	sandboxConfig?: { type: "host" } | { type: "docker"; container: string };
	/** Hook 管理器 */
	hookManager?: import("../hook/manager.js").HookManager;
}

// ============================================================================
// Plugin Interface
// ============================================================================

/**
 * 通用插件接口
 *
 * 每个插件实现此接口，核心系统通过此接口与插件交互
 * 这是平台无关的接口，可以在飞书、微信、微博等任何平台上使用
 */
export interface Plugin {
	/** 插件元数据 */
	meta: PluginMeta;

	/**
	 * 初始化插件
	 * 在插件加载时调用一次
	 */
	init?(context: PluginInitContext): Promise<void>;

	/**
	 * 销毁插件
	 * 在系统关闭时调用
	 */
	destroy?(): Promise<void>;

	/**
	 * 提供工具
	 * 返回此插件提供给 Agent 使用的工具列表
	 * 插件应通过 context.capabilities.hasCapability() 检查平台能力
	 */
	getTools?(context: PluginContext): AgentTool<any>[] | Promise<AgentTool<any>[]>;

	/**
	 * 处理事件
	 * 当有消息或调度事件时调用
	 */
	onEvent?(event: PluginEvent, context: PluginContext): Promise<void>;

	/**
	 * 预处理消息
	 * 在消息被 Agent 处理前调用
	 * 返回 null 表示跳过此消息
	 */
	preprocessMessage?(event: MessageEvent, context: PluginContext): Promise<MessageEvent | null>;
}

// ============================================================================
// Plugin Manager Types
// ============================================================================

/**
 * 插件管理器配置
 */
export interface PluginManagerConfig {
	workspaceDir: string;
	pluginsConfig: PluginsConfig;
	/** 日志器 */
	logger?: Logger;
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * 工具上下文
 */
export interface ToolContext {
	/** 执行器 */
	executor: {
		execute: (command: string, args?: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
		getWorkspacePath: (subPath?: string) => string;
	};
	/** 工作目录 */
	workspaceDir: string;
	/** 频道目录 */
	channelDir: string;
}

// ============================================================================
// Platform Capability Names (Constants)
// ============================================================================

/**
 * 平台能力名称常量
 */
export const CAPABILITIES = {
	/** 更新消息 */
	REPLACE_MESSAGE: "replaceMessage",
	/** 在线程中回复 */
	RESPOND_IN_THREAD: "respondInThread",
	/** 设置打字状态 */
	SET_TYPING: "setTyping",
	/** 设置工作状态 */
	SET_WORKING: "setWorking",
	/** 上传文件 */
	UPLOAD_FILE: "uploadFile",
	/** 上传图片 */
	UPLOAD_IMAGE: "uploadImage",
	/** 发送图片 */
	SEND_IMAGE: "sendImage",
	/** 发送语音消息 */
	SEND_VOICE_MESSAGE: "sendVoiceMessage",
	/** 删除消息 */
	DELETE_MESSAGE: "deleteMessage",
	/** 发送错误卡片 */
	SEND_ERROR_CARD: "sendErrorCard",
} as const;

export type CapabilityName = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];
