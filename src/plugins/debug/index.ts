/**
 * Debug Plugin - 调试插件
 *
 * 提供完整的 hook 监控和日志记录功能
 */

import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "fs";
import { join } from "path";
import type { Plugin, PluginInitContext } from "../../core/plugin/types.js";
import type {
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
	SystemPromptBuildContext,
	AgentInitStartContext,
	AgentInitEndContext,
	ModelGetStartContext,
	ModelGetEndContext,
} from "../../core/hook/types.js";
import { getHookManager, HOOK_NAMES } from "../../core/hook/index.js";

// ============================================================================
// Debug Plugin
// ============================================================================

/**
 * Debug 插件类
 *
 * 使用类封装以便管理 logStream 生命周期
 */
class DebugPluginImpl implements Plugin {
	meta = {
		id: "debug",
		name: "Debug",
		version: "2.0.0",
		description: "Debug plugin for comprehensive hook monitoring",
	};

	private logStream: WriteStream | null = null;

	/**
	 * 日志函数
	 */
	private log(msg: string): void {
		if (!this.logStream) return;
		const timestamp = new Date().toISOString();
		try {
			this.logStream.write(`[${timestamp}] ${msg}\n`);
		} catch (err) {
			console.error("[Debug Plugin] Failed to write log:", err);
		}
	}

	/**
	 * 安全截断文本
	 */
	private truncate(text: string, maxLen = 100): string {
		if (text.length <= maxLen) return text;
		return text.slice(0, maxLen) + "...";
	}

	/**
	 * 安全序列化 JSON
	 */
	private safeJson(obj: unknown): string {
		try {
			return JSON.stringify(obj);
		} catch {
			return "[unable to serialize]";
		}
	}

	async init(context: PluginInitContext): Promise<void> {
		const hookManager = context.hookManager || getHookManager();
		const logDir = join(context.workspaceDir, "logs");
		if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

		// 创建日志流
		this.logStream = createWriteStream(join(logDir, "debug.log"), { flags: "a" });

		// 错误处理
		this.logStream.on("error", (err) => {
			console.error("[Debug Plugin] Log stream error:", err);
		});

		// ========== 系统生命周期 Hook ==========

		// system:before-start
		hookManager.on<SystemHookContext>(HOOK_NAMES.SYSTEM_BEFORE_START, async (ctx, next) => {
			this.log(`[SYSTEM_BEFORE_START] version=${ctx.version ?? "unknown"}`);
			return next();
		});

		// system:ready
		hookManager.on<SystemHookContext>(HOOK_NAMES.SYSTEM_READY, async (ctx, next) => {
			this.log(`[SYSTEM_READY] version=${ctx.version ?? "unknown"}`);
			return next();
		});

		// system:shutdown
		hookManager.on<SystemHookContext>(HOOK_NAMES.SYSTEM_SHUTDOWN, async (ctx, next) => {
			this.log(`[SYSTEM_SHUTDOWN]`);
			return next();
		});

		// ========== 插件生命周期 Hook ==========

		// plugin:load
		hookManager.on<PluginHookContext>(HOOK_NAMES.PLUGIN_LOAD, async (ctx, next) => {
			this.log(`[PLUGIN_LOAD] pluginId=${ctx.pluginId} pluginName=${ctx.pluginName} version=${ctx.pluginVersion}`);
			return next();
		});

		// plugin:unload
		hookManager.on<PluginHookContext>(HOOK_NAMES.PLUGIN_UNLOAD, async (ctx, next) => {
			this.log(`[PLUGIN_UNLOAD] pluginId=${ctx.pluginId} pluginName=${ctx.pluginName}`);
			return next();
		});

		// ========== 适配器生命周期 Hook ==========

		// adapter:connect
		hookManager.on<AdapterHookContext>(HOOK_NAMES.ADAPTER_CONNECT, async (ctx, next) => {
			this.log(`[ADAPTER_CONNECT] platform=${ctx.platform}`);
			return next();
		});

		// adapter:disconnect
		hookManager.on<AdapterHookContext>(HOOK_NAMES.ADAPTER_DISCONNECT, async (ctx, next) => {
			this.log(`[ADAPTER_DISCONNECT] platform=${ctx.platform}`);
			return next();
		});

		// ========== 消息生命周期 Hook ==========

		// message:receive
		hookManager.on<MessageHookContext>(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
			this.log(
				`[MESSAGE_RECEIVE] channelId=${ctx.channelId} userId=${ctx.userId ?? "unknown"} text="${this.truncate(ctx.text)}"`
			);
			return next();
		});

		// message:send
		hookManager.on<MessageHookContext>(HOOK_NAMES.MESSAGE_SEND, async (ctx, next) => {
			this.log(`[MESSAGE_SEND] channelId=${ctx.channelId} text="${this.truncate(ctx.text)}"`);
			return next();
		});

		// message:sent
		hookManager.on<MessageSentContext>(HOOK_NAMES.MESSAGE_SENT, async (ctx, next) => {
			this.log(
				`[MESSAGE_SENT] channelId=${ctx.channelId} messageId=${ctx.messageId} success=${ctx.success}${ctx.error ? ` error="${ctx.error}"` : ""}`
			);
			return next();
		});

		// ========== Session 生命周期 Hook ==========

		// session:create
		hookManager.on<SessionHookContext>(HOOK_NAMES.SESSION_CREATE, async (ctx, next) => {
			this.log(`[SESSION_CREATE] channelId=${ctx.channelId} sessionId=${ctx.sessionId}`);
			return next();
		});

		// session:destroy
		hookManager.on<SessionHookContext>(HOOK_NAMES.SESSION_DESTROY, async (ctx, next) => {
			this.log(`[SESSION_DESTROY] channelId=${ctx.channelId} sessionId=${ctx.sessionId}`);
			return next();
		});

		// ========== Events 事件调度 Hook ==========

		// event:trigger
		hookManager.on<EventTriggerContext>(HOOK_NAMES.EVENT_TRIGGER, async (ctx, next) => {
			this.log(
				`[EVENT_TRIGGER] eventType=${ctx.eventType} channelId=${ctx.channelId} eventId=${ctx.eventId ?? "unknown"} text="${this.truncate(ctx.text)}"`
			);
			return next();
		});

		// event:triggered
		hookManager.on<EventTriggeredContext>(HOOK_NAMES.EVENT_TRIGGERED, async (ctx, next) => {
			this.log(
				`[EVENT_TRIGGERED] eventType=${ctx.eventType} channelId=${ctx.channelId} success=${ctx.success} duration=${ctx.duration}ms${ctx.error ? ` error="${ctx.error}"` : ""}`
			);
			return next();
		});

		// ========== Tools 调用 Hook ==========

		// tool:call
		hookManager.on<ToolCallContext>(HOOK_NAMES.TOOL_CALL, async (ctx, next) => {
			const start = Date.now();
			this.log(
				`[TOOL_CALL] toolName=${ctx.toolName} args=${this.safeJson(ctx.args)} channelId=${ctx.channelId}`
			);
			const result = await next();
			return result;
		});

		// tool:called
		hookManager.on<ToolCalledContext>(HOOK_NAMES.TOOL_CALLED, async (ctx, next) => {
			this.log(
				`[TOOL_CALLED] toolName=${ctx.toolName} success=${ctx.success} duration=${ctx.duration}ms${ctx.error ? ` error="${ctx.error}"` : ""}`
			);
			return next();
		});

		// ========== 系统提示词 Hook ==========

		// system-prompt:build
		hookManager.on<SystemPromptBuildContext>(HOOK_NAMES.SYSTEM_PROMPT_BUILD, async (ctx, next) => {
			const start = Date.now();
			this.log(`[SYSTEM_PROMPT_BUILD] channelId=${ctx.channelId} promptLength=${ctx.prompt.length}`);
			const result = await next();
			this.log(`[SYSTEM_PROMPT_BUILD_DONE] channelId=${ctx.channelId} duration=${Date.now() - start}ms`);
			return result;
		});

		// ========== Agent 内部诊断 Hook ==========

		// agent:init-start
		hookManager.on<AgentInitStartContext>(HOOK_NAMES.AGENT_INIT_START, async (ctx, next) => {
			this.log(`[AGENT_INIT_START] channelId=${ctx.channelId}`);
			return next();
		});

		// agent:init-end
		hookManager.on<AgentInitEndContext>(HOOK_NAMES.AGENT_INIT_END, async (ctx, next) => {
			this.log(`[AGENT_INIT_END] channelId=${ctx.channelId}`);
			return next();
		});

		// model:get-start
		hookManager.on<ModelGetStartContext>(HOOK_NAMES.MODEL_GET_START, async (ctx, next) => {
			this.log(`[MODEL_GET_START] channelId=${ctx.channelId}`);
			return next();
		});

		// model:get-end
		hookManager.on<ModelGetEndContext>(HOOK_NAMES.MODEL_GET_END, async (ctx, next) => {
			this.log(`[MODEL_GET_END] channelId=${ctx.channelId} modelId=${ctx.modelId}`);
			return next();
		});

		context.log("info", "[Debug Plugin] Initialized, logging to logs/debug.log");
	}

	/**
	 * 销毁插件，关闭日志流
	 */
	async destroy(): Promise<void> {
		if (this.logStream) {
			this.log("[DEBUG_PLUGIN] Shutting down");
			this.logStream.end();
			this.logStream = null;
		}
	}
}

export const debugPlugin: Plugin = new DebugPluginImpl();
