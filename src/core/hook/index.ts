/**
 * Hook System
 *
 * 统一的 Hook 管理系统，支持中间件模式、优先级控制、短路拦截
 */

// 导出类型
export type {
	HookResult,
	HookHandler,
	SerialHookHandler,
	ParallelHookHandler,
	HookMeta,
	HookOptions,
	HookName,
	SystemHookContext,
	PluginHookContext,
	AdapterHookContext,
	MessageHookContext,
	MessageSentContext,
	SessionHookContext,
	EventTriggerContext,
	EventTriggeredContext,
	ToolCallContext,
	ToolCalledContext,
	HookContextMap,
} from "./types.js";

// 导出常量
export { HOOK_NAMES } from "./types.js";

// 导出管理器
export {
	HookManager,
	getHookManager,
	resetHookManager,
	withCleanHookManager,
} from "./manager.js";
