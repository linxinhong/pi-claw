/**
 * Debug Plugin - 调试插件
 *
 * 提供性能监控和日志记录功能
 */

import { createWriteStream, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { Plugin, PluginInitContext } from "../../core/plugin/types.js";
import type {
	MessageHookContext,
	MessageSentContext,
	ToolCallContext,
	SystemPromptBuildContext,
} from "../../core/hook/types.js";
import { getHookManager, HOOK_NAMES } from "../../core/hook/index.js";

// ============================================================================
// Debug Plugin
// ============================================================================

export const debugPlugin: Plugin = {
	meta: {
		id: "debug",
		name: "Debug",
		version: "1.0.0",
		description: "Debug plugin for performance monitoring",
	},

	async init(context: PluginInitContext): Promise<void> {
		const hookManager = context.hookManager || getHookManager();
		const logDir = join(context.workspaceDir, "logs");
		if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

		const logStream = createWriteStream(join(logDir, "debug.log"), { flags: "a" });
		const log = (msg: string) => {
			const timestamp = new Date().toISOString();
			logStream.write(`[${timestamp}] ${msg}\n`);
		};

		// 监控消息接收
		hookManager.on<MessageHookContext>(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
			log(`[MESSAGE_RECEIVE] channel=${ctx.channelId} text=${ctx.text.slice(0, 50)}`);
			return next();
		});

		// 监控消息发送
		hookManager.on<MessageHookContext>(HOOK_NAMES.MESSAGE_SEND, async (ctx, next) => {
			log(`[MESSAGE_SEND] channel=${ctx.channelId}`);
			return next();
		});

		// 监控消息发送完成
		hookManager.on<MessageSentContext>(HOOK_NAMES.MESSAGE_SENT, async (ctx, next) => {
			log(`[MESSAGE_SENT] channel=${ctx.channelId} success=${ctx.success}`);
			return next();
		});

		// 监控工具调用
		hookManager.on<ToolCallContext>(HOOK_NAMES.TOOL_CALL, async (ctx, next) => {
			const start = Date.now();
			log(`[TOOL_CALL] ${ctx.toolName} args=${JSON.stringify(ctx.args)}`);
			const result = await next();
			log(`[TOOL_CALLED] ${ctx.toolName} duration=${Date.now() - start}ms`);
			return result;
		});

		// 监控系统提示词构建
		hookManager.on<SystemPromptBuildContext>(HOOK_NAMES.SYSTEM_PROMPT_BUILD, async (ctx, next) => {
			const start = Date.now();
			log(`[SYSTEM_PROMPT_BUILD] channel=${ctx.channelId}`);
			const result = await next();
			log(`[SYSTEM_PROMPT_BUILD_DONE] duration=${Date.now() - start}ms`);
			return result;
		});

		context.log("info", "[Debug Plugin] Initialized, logging to logs/debug.log");
	},
};
