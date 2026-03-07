/**
 * Core Hook Types
 *
 * Hook 系统的核心类型定义
 */

// ============================================================================
// Hook Result
// ============================================================================

/**
 * Hook 处理结果
 */
export interface HookResult<T = unknown> {
	/** 是否继续执行后续 handler */
	continue: boolean;
	/** 修改后的数据（可选） */
	data?: T;
	/** 错误信息（可选） */
	error?: Error;
	/**
	 * 是否为主动拦截
	 * - true: handler 主动拦截请求（如权限检查失败）
	 * - undefined: 正常完成或异常
	 */
	blocked?: boolean;
}

// ============================================================================
// Hook Handler
// ============================================================================

/**
 * 串行模式 Hook 处理函数（中间件模式）
 *
 * 支持 next() 控制执行链，可以拦截或修改上下文
 *
 * @param context Hook 上下文
 * @param next 调用下一个 handler 的函数
 * @returns Hook 处理结果
 */
export type SerialHookHandler<TContext = unknown, TResult = void> = (
	context: TContext,
	next: () => Promise<HookResult<TResult>>
) => Promise<HookResult<TResult>>;

/**
 * 并行模式 Hook 处理函数（事件通知模式）
 *
 * 不支持 next()，仅用于通知，不能拦截
 *
 * @param context Hook 上下文
 */
export type ParallelHookHandler<TContext = unknown> = (
	context: TContext
) => Promise<void>;

/**
 * Hook 处理函数（兼容旧代码，等同于 SerialHookHandler）
 *
 * @deprecated 请使用 SerialHookHandler 或 ParallelHookHandler
 */
export type HookHandler<TContext = unknown, TResult = void> =
	SerialHookHandler<TContext, TResult>;

// ============================================================================
// Hook Meta
// ============================================================================

/**
 * Hook 元数据
 */
export interface HookMeta {
	/** Hook 唯一标识 */
	id: string;
	/** 优先级（数字越小越先执行） */
	priority: number;
	/** 是否只执行一次 */
	once: boolean;
	/** 来源（如插件 ID） */
	source?: string;
}

/**
 * Hook 注册选项
 */
export interface HookOptions {
	/** 优先级（数字越小越先执行，默认 10） */
	priority?: number;
	/** 是否只执行一次 */
	once?: boolean;
	/** 来源标识（如插件 ID，用于批量清理） */
	source?: string;
}

// ============================================================================
// Hook Names
// ============================================================================

/**
 * Hook 名称常量
 */
export const HOOK_NAMES = {
	// 系统生命周期
	SYSTEM_BEFORE_START: "system:before-start", // 启动前（bot 创建前）
	SYSTEM_READY: "system:ready", // 启动完成（所有 bot 启动后）
	SYSTEM_SHUTDOWN: "system:shutdown",

	// 兼容旧代码：SYSTEM_STARTUP 现在等同于 SYSTEM_BEFORE_START
	/** @deprecated 请使用 SYSTEM_BEFORE_START */
	SYSTEM_STARTUP: "system:before-start" as const,

	// 插件生命周期
	PLUGIN_LOAD: "plugin:load",
	PLUGIN_UNLOAD: "plugin:unload",

	// 适配器生命周期
	ADAPTER_CONNECT: "adapter:connect",
	ADAPTER_DISCONNECT: "adapter:disconnect",

	// 消息生命周期
	MESSAGE_RECEIVE: "message:receive",
	MESSAGE_SEND: "message:send",
	MESSAGE_SENT: "message:sent",

	// Agent 生命周期
	SESSION_CREATE: "session:create",
	SESSION_DESTROY: "session:destroy",

	// Agent 内部诊断
	AGENT_INIT_START: "agent:init-start",
	AGENT_INIT_END: "agent:init-end",
	MODEL_GET_START: "model:get-start",
	MODEL_GET_END: "model:get-end",

	// Events 事件调度
	EVENT_TRIGGER: "event:trigger",
	EVENT_TRIGGERED: "event:triggered",

	// Tools 调用（通用）
	TOOL_CALL: "tool:call",
	TOOL_CALLED: "tool:called",

	// 系统提示词
	SYSTEM_PROMPT_BUILD: "system-prompt:build",

	// 配置管理
	CONFIG_LOAD: "config:load",
	CONFIG_CHANGE: "config:change",
	CONFIG_RELOAD: "config:reload",
	CONFIG_SAVE: "config:save",
} as const;

export type HookName = (typeof HOOK_NAMES)[keyof typeof HOOK_NAMES];

// ============================================================================
// Hook Context Types
// ============================================================================

/**
 * 系统 Hook 上下文
 */
export interface SystemHookContext {
	timestamp: Date;
	version?: string;
	config?: Record<string, unknown>;
}

/**
 * 插件 Hook 上下文
 */
export interface PluginHookContext {
	pluginId: string;
	pluginName: string;
	pluginVersion: string;
	timestamp: Date;
}

/**
 * 适配器 Hook 上下文
 */
export interface AdapterHookContext {
	platform: string;
	timestamp: Date;
}

/**
 * 消息 Hook 上下文
 */
export interface MessageHookContext {
	channelId: string;
	messageId?: string;
	text: string;
	userId?: string;
	userName?: string;
	timestamp: Date;
}

/**
 * 消息发送后上下文（包含发送结果）
 */
export interface MessageSentContext extends MessageHookContext {
	messageId: string;
	success: boolean;
	error?: string;
}

/**
 * 会话 Hook 上下文
 */
export interface SessionHookContext {
	channelId: string;
	sessionId: string;
	timestamp: Date;
}

/**
 * Events 事件触发上下文
 */
export interface EventTriggerContext {
	eventType: "immediate" | "one-shot" | "periodic";
	channelId: string;
	text: string;
	eventId?: string;
	timestamp: Date;
}

/**
 * Events 事件触发后上下文
 */
export interface EventTriggeredContext extends EventTriggerContext {
	success: boolean;
	error?: string;
	duration: number;
}

/**
 * Tools 调用上下文
 */
export interface ToolCallContext {
	toolName: string;
	args: Record<string, unknown>;
	channelId: string;
	timestamp: Date;
}

/**
 * Tools 调用后上下文
 */
export interface ToolCalledContext extends ToolCallContext {
	result: unknown;
	success: boolean;
	error?: string;
	duration: number;
}

/**
 * 系统提示词生成上下文
 */
export interface SystemPromptBuildContext {
	channelId: string;
	prompt: string;
	timestamp: Date;
}

/**
 * Agent 初始化开始上下文
 */
export interface AgentInitStartContext {
	channelId: string;
	timestamp: Date;
}

/**
 * Agent 初始化完成上下文
 */
export interface AgentInitEndContext {
	channelId: string;
	timestamp: Date;
}

/**
 * 模型获取开始上下文
 */
export interface ModelGetStartContext {
	channelId: string;
	timestamp: Date;
}

/**
 * 模型获取完成上下文
 */
export interface ModelGetEndContext {
	channelId: string;
	modelId: string;
	timestamp: Date;
}

/**
 * 配置 Hook 上下文
 */
export interface ConfigHookContext {
	/** 配置类型 */
	configType: "global" | "model" | "channel";
	/** 配置键名 */
	configKey?: string;
	/** 频道 ID（仅 channel 类型） */
	channelId?: string;
	/** 旧值 */
	oldValue?: unknown;
	/** 新值 */
	newValue?: unknown;
	/** 时间戳 */
	timestamp: Date;
	/** 变更来源 */
	source: "file" | "api" | "command";
}

// ============================================================================
// Type Map
// ============================================================================

/**
 * Hook 名称到上下文类型的映射
 */
export interface HookContextMap {
	[HOOK_NAMES.SYSTEM_BEFORE_START]: SystemHookContext;
	[HOOK_NAMES.SYSTEM_READY]: SystemHookContext;
	[HOOK_NAMES.SYSTEM_SHUTDOWN]: SystemHookContext;
	[HOOK_NAMES.PLUGIN_LOAD]: PluginHookContext;
	[HOOK_NAMES.PLUGIN_UNLOAD]: PluginHookContext;
	[HOOK_NAMES.ADAPTER_CONNECT]: AdapterHookContext;
	[HOOK_NAMES.ADAPTER_DISCONNECT]: AdapterHookContext;
	[HOOK_NAMES.MESSAGE_RECEIVE]: MessageHookContext;
	[HOOK_NAMES.MESSAGE_SEND]: MessageHookContext;
	[HOOK_NAMES.MESSAGE_SENT]: MessageSentContext;
	[HOOK_NAMES.SESSION_CREATE]: SessionHookContext;
	[HOOK_NAMES.SESSION_DESTROY]: SessionHookContext;
	[HOOK_NAMES.EVENT_TRIGGER]: EventTriggerContext;
	[HOOK_NAMES.EVENT_TRIGGERED]: EventTriggeredContext;
	[HOOK_NAMES.TOOL_CALL]: ToolCallContext;
	[HOOK_NAMES.TOOL_CALLED]: ToolCalledContext;
	[HOOK_NAMES.SYSTEM_PROMPT_BUILD]: SystemPromptBuildContext;
	[HOOK_NAMES.AGENT_INIT_START]: AgentInitStartContext;
	[HOOK_NAMES.AGENT_INIT_END]: AgentInitEndContext;
	[HOOK_NAMES.MODEL_GET_START]: ModelGetStartContext;
	[HOOK_NAMES.MODEL_GET_END]: ModelGetEndContext;
	[HOOK_NAMES.CONFIG_LOAD]: ConfigHookContext;
	[HOOK_NAMES.CONFIG_CHANGE]: ConfigHookContext;
	[HOOK_NAMES.CONFIG_RELOAD]: ConfigHookContext;
	[HOOK_NAMES.CONFIG_SAVE]: ConfigHookContext;
}
