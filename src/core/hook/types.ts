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
}

// ============================================================================
// Hook Handler
// ============================================================================

/**
 * Hook 处理函数（中间件模式）
 *
 * @param context Hook 上下文
 * @param next 调用下一个 handler 的函数
 * @returns Hook 处理结果
 */
export type HookHandler<TContext = unknown, TResult = void> = (
	context: TContext,
	next: () => Promise<HookResult<TResult>>
) => Promise<HookResult<TResult>>;

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
	SYSTEM_STARTUP: "system:startup",
	SYSTEM_SHUTDOWN: "system:shutdown",

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

	// Events 事件调度
	EVENT_TRIGGER: "event:trigger",
	EVENT_TRIGGERED: "event:triggered",

	// Tools 调用（通用）
	TOOL_CALL: "tool:call",
	TOOL_CALLED: "tool:called",
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

// ============================================================================
// Type Map
// ============================================================================

/**
 * Hook 名称到上下文类型的映射
 */
export interface HookContextMap {
	[HOOK_NAMES.SYSTEM_STARTUP]: SystemHookContext;
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
}
