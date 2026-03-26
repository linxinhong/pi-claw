/**
 * Core Agent
 *
 * 核心 Agent 类 - 平台无关的 AI 对话代理
 */

import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Api, ImageContent, Model } from "@mariozechner/pi-ai";
import {
	AgentSession,
	convertToLlm,
	createExtensionRuntime,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { readFileSync, statSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { getChannelDir } from "../../utils/config.js";
import type { AgentContext } from "./context.js";
import { buildSystemPrompt, generateHistoryMarkdown, loadBootFiles, loadMemoryContent, loadSkills } from "./prompt-builder.js";
import { compactMessages, convertToMarkdown, safeTruncateMessages } from "./message-formatter.js";
import type { ModelManager } from "../model/manager.js";
import type { PlatformContext } from "../platform/context.js";
import type { UniversalMessage } from "../platform/message.js";
import * as log from "../../utils/logger/index.js";
import type { Executor } from "../sandbox/index.js";
import { MemoryStore, getAllMemoryTools } from "../services/memory/index.js";
import { getAllEventTools } from "../services/event/index.js";
import type { EventsWatcher } from "../services/event/watcher.js";
import type { HookManager } from "../hook/manager.js";
import { HOOK_NAMES } from "../hook/index.js";
import type { ConfigManager } from "../config/manager.js";
import type { McpManager } from "../mcp/manager.js";
import type { PluginManager } from "../plugin/manager.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent 配置
 */
export interface AgentConfig {
	/** 模型管理器 */
	modelManager: ModelManager;
	/** 配置管理器 */
	configManager?: ConfigManager;
	/** 沙箱执行器 */
	executor: Executor;
	/** 工作目录 */
	workspaceDir: string;
	/** 事件总线 */
	eventBus?: any;
	/** Hook 管理器 */
	hookManager?: HookManager;
	/** adapter 级别默认模型 */
	adapterDefaultModel?: string;
	/** 事件监控器 */
	eventsWatcher?: EventsWatcher;
	/** MCP 管理器 */
	mcpManager?: McpManager;
	/** 插件管理器 */
	pluginManager?: PluginManager;
}

/**
 * Agent 状态
 */
interface AgentState {
	agent: Agent | null;
	session: AgentSession | null;
	sessionManager: SessionManager | null;
	modelRegistry: ModelRegistry | null;
	memoryStore: MemoryStore | null;
	channelMemoryStore: MemoryStore | null;
	settingsManager: SettingsManager | null;
	tools: AgentTool<any>[];
	processing: boolean;
	updateResourceLoaderPrompt: ((prompt: string) => void) | null;
	/** 上次系统提示更新的文件修改时间 */
	lastPromptUpdate: {
		skillsMtime: number;
		memoryMtime: number;
	} | null;
	/** session 订阅的取消函数 */
	unsubscribe: (() => void) | null;
}

/**
 * Agent 运行状态
 */
interface AgentRunState {
	totalUsage: {
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
	};
	stopReason: string;
	errorMessage?: string;
}

// ============================================================================
// Global State
// ============================================================================

const channelStates = new Map<string, AgentState>();

/** 工具模块预加载状态 */
let toolsPreloaded = false;

/**
 * 预加载工具模块
 * 避免首次消息时的动态 import 延迟
 */
async function preloadTools(): Promise<void> {
	if (toolsPreloaded) return;

	await Promise.all([
		import("../tools/bash.js"),
		import("../tools/read.js"),
		import("../tools/write.js"),
		import("../tools/edit.js"),
		import("../tools/models.js"),
		import("../tools/glob.js"),
		import("../tools/grep.js"),
		import("../tools/spawn/index.js"),
		import("../tools/rtk.js"),
	]);

	toolsPreloaded = true;
}

/**
 * 获取目录的修改时间（取目录内所有文件的最新 mtime）
 */
function getDirMtime(dir: string): number {
	try {
		const stats = statSync(dir);
		return stats.mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * 获取 memory 相关文件的修改时间
 */
function getMemoryMtime(channelDir: string, workspaceDir: string): number {
	const paths = [
		join(workspaceDir, "boot"),
		join(workspaceDir, "memory", "memory.md"),
		join(channelDir, "MEMORY.md"),
	];

	let maxMtime = 0;
	for (const p of paths) {
		try {
			const stats = statSync(p);
			maxMtime = Math.max(maxMtime, stats.mtimeMs);
		} catch {
			// 忽略不存在的文件
		}
	}

	// 检查今日日志文件
	const today = new Date().toISOString().split("T")[0];
	const todayLogPath = join(workspaceDir, "memory", `${today}.md`);
	try {
		const stats = statSync(todayLogPath);
		maxMtime = Math.max(maxMtime, stats.mtimeMs);
	} catch {
		// 忽略
	}

	return maxMtime;
}

/**
 * 获取 skills 目录的修改时间
 */
function getSkillsMtime(channelDir: string, workspaceDir: string): number {
	const paths = [
		join(workspaceDir, "skills"),
		join(channelDir, "skills"),
	];

	let maxMtime = 0;
	for (const p of paths) {
		try {
			const stats = statSync(p);
			maxMtime = Math.max(maxMtime, stats.mtimeMs);
		} catch {
			// 忽略不存在的目录
		}
	}

	return maxMtime;
}

// ============================================================================
// API Key Helper
// ============================================================================

async function getApiKeyForModel(
	model: Model<Api>,
	modelRegistry: ModelRegistry,
): Promise<string> {
	// 尝试从 ModelRegistry 获取
	const key = await modelRegistry.getApiKey(model);
	if (key) return key;

	throw new Error(`No API key found for ${model.provider}. Use /login or set environment variable.`);
}

// ============================================================================
// Core Agent Class
// ============================================================================

/**
 * 核心 Agent 类
 *
 * 平台无关的 AI 对话代理，负责：
 * - 对话状态管理
 * - 模型调用
 * - 工具执行
 * - 模型切换
 */
export class CoreAgent {
	private config: AgentConfig;
	private currentModel: Model<Api> | null = null;

	constructor(config: AgentConfig) {
		this.config = config;
	}

	/**
	 * 预热频道 Agent
	 *
	 * 提前初始化 Agent 状态，减少首次消息响应延迟
	 * @param channelId 频道 ID
	 * @param platformContext 平台上下文
	 * @param additionalContext 附加上下文
	 */
	async warmup(
		channelId: string,
		platformContext: PlatformContext,
		additionalContext: Partial<AgentContext> = {},
	): Promise<void> {
		const channelDir = getChannelDir(channelId);

		// 确保目录存在
		await mkdir(channelDir, { recursive: true });

		// 检查是否已经初始化
		let state = channelStates.get(channelId);
		if (state?.agent) {
			log.logInfo(`[Agent] Channel ${channelId} already warmed up`);
			return;
		}

		log.logInfo(`[Agent] Warming up channel ${channelId}`);

		// 使用 ConfigManager 加载频道配置
		const configManager = this.config.configManager;
		if (configManager) {
			configManager.watchChannelConfig(channelId);
			const channelConfig = configManager.getChannelConfig(channelId);
			if (channelConfig.model) {
				this.config.modelManager.switchChannelModel(channelId, channelConfig.model);
			}
		} else {
			const modelConfigPath = join(channelDir, "channel-config.json");
			this.config.modelManager.loadChannelModels(modelConfigPath);
		}

		// 创建初始状态
		if (!state) {
			state = { agent: null, session: null, sessionManager: null, modelRegistry: null, memoryStore: null, channelMemoryStore: null, settingsManager: null, tools: [], processing: false, updateResourceLoaderPrompt: null, lastPromptUpdate: null, unsubscribe: null };
			channelStates.set(channelId, state);
		}

		// 创建一个空的预热消息
		const warmupMessage: UniversalMessage = {
			id: "warmup",
			platform: platformContext.platform as "feishu" | "wechat" | "weibo",
			type: "text",
			content: "",
			sender: {
				id: "system",
				name: "System",
			},
			chat: {
				id: channelId,
				type: "private",
			},
			timestamp: new Date(),
		};

		// 初始化 Agent（不执行）
		await this.initializeAgent(state, channelId, channelDir, warmupMessage, platformContext, additionalContext);

		log.logInfo(`[Agent] Channel ${channelId} warmed up successfully`);
	}

	/**
	 * 处理消息（轻量平台感知）
	 */
	async processMessage(
		message: UniversalMessage,
		platformContext: PlatformContext,
		additionalContext: Partial<AgentContext>,
	): Promise<string> {
		const chatId = message.chat.id;
		const channelDir = getChannelDir(chatId);

		// 确保目录存在
		await mkdir(channelDir, { recursive: true });

		// 使用 ConfigManager 加载频道配置
		const configManager = this.config.configManager;
		if (configManager) {
			// 加载并监控频道配置
			configManager.watchChannelConfig(chatId);
			const channelConfig = configManager.getChannelConfig(chatId);

			// 应用模型配置
			if (channelConfig.model) {
				this.config.modelManager.switchChannelModel(chatId, channelConfig.model);
			}
		} else {
			// 回退到旧的加载方式
			const modelConfigPath = join(channelDir, "channel-config.json");
			this.config.modelManager.loadChannelModels(modelConfigPath);
		}

		// 获取或创建 Agent 状态
		let state = channelStates.get(chatId);
		if (!state) {
			state = { agent: null, session: null, sessionManager: null, modelRegistry: null, memoryStore: null, channelMemoryStore: null, settingsManager: null, tools: [], processing: false, updateResourceLoaderPrompt: null, lastPromptUpdate: null, unsubscribe: null };
			channelStates.set(chatId, state);
		}

		// 检查是否正在处理消息
		if (state.processing) {
			log.logInfo(`[Agent] Channel ${chatId} is busy, skipping message`);
			return "_正在处理上一条消息，请稍后_";
		}

		// 设置处理锁
		state.processing = true;

		try {
			// 显示"思考中"卡片（飞书平台）
			// 注意：必须在 initializeAgent 之前调用，因为 initializeAgent 会读取 hideThinking 状态
			// 传入 message.id 作为引用消息 ID，让回复卡片能引用原消息
			if ((platformContext as any).startThinking) {
				await (platformContext as any).startThinking(message.id);
			}

			// 初始化 Agent
			if (!state.agent) {
				await this.initializeAgent(state, chatId, channelDir, message, platformContext, additionalContext);
			} else {
				// Agent 已存在，更新 thinkingLevel（因为 hideThinking 可能在 startThinking 中改变了）
				const hideThinking = (platformContext as any).isThinkingHidden?.() ?? false;
				state.agent.setThinkingLevel(hideThinking ? "off" : "medium");
			}

			// 更新系统提示
			await this.updateSystemPrompt(state, chatId, channelDir, platformContext, additionalContext);

			// 准备用户消息
			const userMessage = await this.formatUserMessage(message, additionalContext);

			// 验证用户消息不为空
			if (!userMessage || userMessage.trim().length === 0) {
				log.logWarning("[Agent] Empty user message, skipping");
				return "_No response_";
			}

			// 处理图片附件
			const imageAttachments = this.processImageAttachments(message);

			// 复用已有的 session
			const session = state.session!;
			const sessionId = `${chatId}-${Date.now()}`;

			// 触发 SESSION_CREATE hook
			const hookManager = this.config.hookManager;
			if (hookManager?.hasHooks(HOOK_NAMES.SESSION_CREATE)) {
				await hookManager.emit(HOOK_NAMES.SESSION_CREATE, {
					channelId: chatId,
					sessionId: sessionId,
					timestamp: new Date(),
				});
			}

			// 运行状态
			const runState: AgentRunState = {
				totalUsage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				errorMessage: undefined,
			};

			// 【修复】防止 finishThinking 被重复调用
			let finishThinkingCalled = false;

			// Turn 计数器
			let turnNumber = 0;

			// 订阅事件并响应
			let finalResponse = "";
			const responsePromise = new Promise<string>((resolve, reject) => {
				// 取消之前的订阅（如果存在），防止订阅泄漏
				if (state.unsubscribe) {
					state.unsubscribe();
					state.unsubscribe = null;
				}

				// 订阅事件并保存取消函数
				state.unsubscribe = session.subscribe(async (agentEvent) => {
					try {
						if (agentEvent.type === "tool_execution_start") {
							const args = agentEvent.args as Record<string, unknown>;

							// 使用新的结构化工具调用方法
							if ((platformContext as any).startToolCall) {
								await (platformContext as any).startToolCall(agentEvent.toolName, args);
							} else if ((platformContext as any).updateToolStatus) {
								// 兼容旧接口
								const label = (args.label as string) || agentEvent.toolName;
								await (platformContext as any).updateToolStatus(`-> ${label}`);
							} else {
								await platformContext.sendText(chatId, `_ -> ${agentEvent.toolName}_`);
							}

							// 触发 tool:call hook
							if (hookManager?.hasHooks(HOOK_NAMES.TOOL_CALL)) {
								await hookManager.emit(HOOK_NAMES.TOOL_CALL, {
									toolName: agentEvent.toolName,
									args: args,
									channelId: chatId,
									timestamp: new Date(),
								});
							}
						} else if (agentEvent.type === "tool_execution_end") {
							// 使用新的结构化工具调用方法
							if ((platformContext as any).endToolCall) {
								await (platformContext as any).endToolCall(
									agentEvent.toolName,
									!agentEvent.isError,
									(agentEvent as any).result
								);
							} else if ((platformContext as any).updateToolStatus) {
								// 兼容旧接口
								const statusIcon = agentEvent.isError ? "X" : "OK";
								await (platformContext as any).updateToolStatus(`-> ${statusIcon} ${agentEvent.toolName}`);
							} else {
								const statusIcon = agentEvent.isError ? "X" : "OK";
								await platformContext.sendText(chatId, `_ -> ${statusIcon} ${agentEvent.toolName}_`);
							}

							// 触发 tool:called hook
							if (hookManager?.hasHooks(HOOK_NAMES.TOOL_CALLED)) {
								await hookManager.emit(HOOK_NAMES.TOOL_CALLED, {
									toolName: agentEvent.toolName,
									args: (agentEvent as any).args || {},
									channelId: chatId,
									timestamp: new Date(),
									result: (agentEvent as any).result,
									success: !agentEvent.isError,
									error: agentEvent.isError ? String((agentEvent as any).error) : undefined,
									duration: 0, // duration 需要从 start 事件计算，这里简化处理
								});
							}
						} else if (agentEvent.type === "message_update") {
							// 处理 thinking 事件
							const message = agentEvent.message as any;
							const thinkingContent = message.content?.find((c: any) => c.type === "thinking");
							if (thinkingContent && (platformContext as any).updateThinking) {
								await (platformContext as any).updateThinking(thinkingContent.thinking);

								// 触发 agent:thinking hook
								if (hookManager?.hasHooks(HOOK_NAMES.AGENT_THINKING)) {
									await hookManager.emit(HOOK_NAMES.AGENT_THINKING, {
										channelId: chatId,
										thinking: thinkingContent.thinking,
										timestamp: new Date(),
									});
								}
							}
						} else if (agentEvent.type === "turn_start") {
							// Turn 开始
							turnNumber++;

							// 通知 platformContext 开始新 turn
							if ((platformContext as any).startNewTurn) {
								(platformContext as any).startNewTurn();
							}

							// 触发 agent:turn-start hook
							if (hookManager?.hasHooks(HOOK_NAMES.AGENT_TURN_START)) {
								await hookManager.emit(HOOK_NAMES.AGENT_TURN_START, {
									channelId: chatId,
									turnNumber,
									timestamp: new Date(),
								});
							}
						} else if (agentEvent.type === "turn_end") {
							// Turn 结束
							const stopReason = (agentEvent as any).stopReason || "stop";
							log.logInfo(`[Agent] Received turn_end event, stopReason: ${stopReason}`);

							// 触发 agent:turn-end hook
							if (hookManager?.hasHooks(HOOK_NAMES.AGENT_TURN_END)) {
								await hookManager.emit(HOOK_NAMES.AGENT_TURN_END, {
									channelId: chatId,
									turnNumber,
									stopReason,
									timestamp: new Date(),
								});
							}

							// 如果是最终 turn 且没有 message_end 事件，手动调用 finishThinking
							const isFinalTurn = stopReason === "stop" || stopReason === "end_turn" || stopReason === "error";
							// 【修复】延迟执行 turn_end 的 finishThinking，给 message_end 优先权
							if (isFinalTurn && !finishThinkingCalled && (platformContext as any).finishThinking) {
								// 延迟 100ms，让 message_end 有机会先执行
								setTimeout(async () => {
									// 再次检查，如果 message_end 已经调用了，就不再执行
									if (!finishThinkingCalled) {
										// 从 platformContext 获取缓存的内容
										const lastContent = (platformContext as any).getLastStreamingContent?.() || "";
										if (lastContent) {
											log.logInfo(`[Agent] turn_end with final stopReason, calling finishThinking (fallback)`);
											await (platformContext as any).finishThinking(lastContent, stopReason);
											// 【修复】成功执行后才设置标志
											finishThinkingCalled = true;
										}
									}
								}, 100);
							}
						} else if (agentEvent.type === "message_end" && agentEvent.message.role === "assistant") {
							log.logInfo(`[Agent] Received message_end event, role: ${agentEvent.message.role}, stopReason: ${agentEvent.message.stopReason || "stop"}`);
							const assistantMsg = agentEvent.message as any;
							const stopReason = assistantMsg.stopReason || "stop";
							if (assistantMsg.stopReason) runState.stopReason = assistantMsg.stopReason;
							if (assistantMsg.errorMessage) {
								runState.errorMessage = assistantMsg.errorMessage;
								log.logError(`[Agent] API error: ${assistantMsg.errorMessage}`);
							}

							const content = agentEvent.message.content;
							const textParts = content.filter((c: any) => c.type === "text").map((c: any) => c.text);
							let responseContent = textParts.join("\n");

							// 当 stopReason 为 error 时，如果有错误消息，将其作为响应内容
							if (stopReason === "error" && assistantMsg.errorMessage) {
								responseContent = `❌ **发生错误**\n\n${assistantMsg.errorMessage}`;
								log.logInfo(`[Agent] Error response: ${assistantMsg.errorMessage}`);
							}

							finalResponse = responseContent;

							// 完成思考卡片（传递 stopReason 以区分中间 turn 和最终 turn）
							// 注意：error 也视为最终回复，需要显示给用户
							const isFinalResponse = stopReason === "stop" || stopReason === "end_turn" || stopReason === "error";
							// 【修复】防止 finishThinking 被重复调用，但允许非最终响应（toolUse）后继续处理
							if (!finishThinkingCalled && (platformContext as any).finishThinking) {
								log.logInfo(`[Agent] Calling finishThinking with content: "${finalResponse.slice(0, 50)}...", stopReason: ${stopReason}`);
								await (platformContext as any).finishThinking(finalResponse, isFinalResponse ? "stop" : stopReason);
								// 【修复】只在最终响应后才设置标志，非最终响应（toolUse）不设置，以便后续还能调用
								if (isFinalResponse) {
									finishThinkingCalled = true;
								}
							}

							// 只有最终回复时才取消订阅和 resolve promise
							// toolUse 等中间状态需要继续等待下一个 turn
							if (isFinalResponse) {
								if (state.unsubscribe) {
									log.logInfo(`[Agent] Unsubscribing from session events after final message_end`);
									state.unsubscribe();
									state.unsubscribe = null;
								}
								resolve(finalResponse);
							} else {
								log.logInfo(`[Agent] Intermediate stopReason: ${stopReason}, continuing to wait for next turn...`);
							}
						}
					} catch (error) {
						// 检查是否是权限错误，如果是则 reject Promise 让上层处理
						const errorCode = (error as any)?.code ?? (error as any)?.response?.data?.code;
						const errorMsg = String(error);
						if (errorCode === 99991672 || errorMsg.includes("99991672")) {
							log.logError(`[Agent] Permission error in event handler, rejecting promise: ${error}`);
							reject(error);
							return;
						}
						log.logError(`[Agent] Event handler error: ${error}`);
					}
				});
			});

			// 执行
			await session.prompt(
				userMessage,
				imageAttachments.length > 0 ? { images: imageAttachments } : undefined,
			);

			await responsePromise;

			// 触发 SESSION_DESTROY hook
			if (hookManager?.hasHooks(HOOK_NAMES.SESSION_DESTROY)) {
				await hookManager.emit(HOOK_NAMES.SESSION_DESTROY, {
					channelId: chatId,
					sessionId: sessionId,
					timestamp: new Date(),
				});
			}

			return finalResponse || "_No response_";
		} finally {
			// 释放处理锁
			state.processing = false;
		}
	}

	/**
	 * 初始化 Agent
	 */
	private async initializeAgent(
		state: AgentState,
		chatId: string,
		channelDir: string,
		message: UniversalMessage,
		platformContext: PlatformContext,
		additionalContext: Partial<AgentContext>,
	): Promise<void> {
		const hookManager = this.config.hookManager;

		// 触发 AGENT_INIT_START hook
		if (hookManager?.hasHooks(HOOK_NAMES.AGENT_INIT_START)) {
			await hookManager.emit(HOOK_NAMES.AGENT_INIT_START, {
				channelId: chatId,
				timestamp: new Date(),
			});
		}

		const workspacePath = this.config.executor.getWorkspacePath(
			join(channelDir, "..", ".."),
		);

		// 触发 MODEL_GET_START hook
		if (hookManager?.hasHooks(HOOK_NAMES.MODEL_GET_START)) {
			await hookManager.emit(HOOK_NAMES.MODEL_GET_START, {
				channelId: chatId,
				timestamp: new Date(),
			});
		}

		const model = await this.config.modelManager.getModelInstance(chatId, this.config.adapterDefaultModel);

		// 触发 MODEL_GET_END hook
		if (hookManager?.hasHooks(HOOK_NAMES.MODEL_GET_END)) {
			await hookManager.emit(HOOK_NAMES.MODEL_GET_END, {
				channelId: chatId,
				modelId: model.id,
				timestamp: new Date(),
			});
		}

		// 创建或获取全局 MemoryStore
		if (!state.memoryStore) {
			state.memoryStore = new MemoryStore(workspacePath);
		}

		// 创建频道 MemoryStore
		if (!state.channelMemoryStore) {
			state.channelMemoryStore = new MemoryStore(channelDir, true);
		}

		// 验证工具依赖
		if (!this.config.executor) {
			throw new Error("[Agent] Executor is required to create tools");
		}

		// 预加载工具模块（首次调用时会执行，后续跳过）
		await preloadTools();

		// 创建工具
		const { createBashTool } = await import("../tools/bash.js");
		const { createReadTool } = await import("../tools/read.js");
		const { createWriteTool } = await import("../tools/write.js");
		const { createEditTool } = await import("../tools/edit.js");
		const { createModelsTool } = await import("../tools/models.js");
		const { createGlobTool } = await import("../tools/glob.js");
		const { createGrepTool } = await import("../tools/grep.js");
		const { createSpawnTool } = await import("../tools/spawn/index.js");
		const { createRtkTool } = await import("../tools/rtk.js");
		const { createWebSearchTool } = await import("../tools/web-search.js");
		const { createWebReaderTool } = await import("../tools/web-reader.js");

		// 先创建基础工具（不包括 spawn，因为 spawn 需要知道 parentTools）
		const baseTools: AgentTool<any>[] = [
			createBashTool(this.config.executor),
			createReadTool(this.config.executor),
			createWriteTool(this.config.executor),
			createEditTool(this.config.executor),
			createModelsTool({
				modelManager: this.config.modelManager,
				channelId: chatId,
				channelDir: channelDir,
			}),
			createGlobTool(this.config.executor),
			createGrepTool(this.config.executor),
			createRtkTool(this.config.executor),
			// 添加 web 工具
			createWebSearchTool(),
			createWebReaderTool(),
			// 添加 memory 工具
			...getAllMemoryTools(state.memoryStore, state.channelMemoryStore, workspacePath),
			// 添加 event 工具（如果 eventsWatcher 可用）
			...(this.config.eventsWatcher ? getAllEventTools(this.config.eventsWatcher, chatId) : []),
		].filter(Boolean);

		// 添加平台特定工具到基础工具
		if (platformContext.getTools) {
			try {
				const platformTools = await platformContext.getTools({
					chatId,
					workspaceDir: workspacePath,
					channelDir,
				});
				if (platformTools && platformTools.length > 0) {
					baseTools.push(...platformTools);
					log.logInfo(`[Agent] Added ${platformTools.length} platform tools for ${platformContext.platform}`);
				}
			} catch (error) {
				log.logError(`[Agent] Failed to load platform tools: ${error}`);
			}
		}

		// 添加 MCP 工具
		if (this.config.mcpManager) {
			try {
				const mcpTools = await this.config.mcpManager.getAllTools();
				if (mcpTools && mcpTools.length > 0) {
					baseTools.push(...mcpTools);
					log.logInfo(`[Agent] Added ${mcpTools.length} MCP tools`);
				}
			} catch (error) {
				log.logError(`[Agent] Failed to load MCP tools: ${error}`);
			}
		}

		// 添加插件工具
		if (this.config.pluginManager) {
			try {
				log.logInfo("[Agent] Loading plugin tools...");
				// 构建插件上下文
				const pluginContext = {
					message: {
						id: message.id,
						text: message.content,
						channel: chatId,
						user: message.sender.id,
						platform: platformContext.platform,
						raw: message,
					},
					channel: chatId,
					channelDir,
					workspaceDir: workspacePath,
					capabilities: {
						platform: platformContext.platform,
						chatId,
						// 核心能力
						sendVoiceMessage: (filePath: string) => platformContext.sendVoiceMessage(chatId, filePath),
						// 可选能力（如果平台支持）
						...(platformContext.setTyping && {
							setTyping: () => platformContext.setTyping!(chatId, true),
						}),
						// hasCapability 辅助方法
						hasCapability: (cap: string) => {
							const caps: Record<string, boolean> = {
								sendVoiceMessage: true,
								setTyping: !!platformContext.setTyping,
							};
							return caps[cap] ?? false;
						},
					},
					config: {},
				};
				log.logInfo(`[Agent] Plugin context has sendVoiceMessage: ${!!pluginContext.capabilities.sendVoiceMessage}`);
				const pluginTools = await this.config.pluginManager.getTools(pluginContext as any);
				log.logInfo(`[Agent] Plugin tools count: ${pluginTools.length}`);
				if (pluginTools && pluginTools.length > 0) {
					baseTools.push(...pluginTools);
					log.logInfo(`[Agent] Added ${pluginTools.length} plugin tools`);
				}
			} catch (error) {
				log.logError(`[Agent] Failed to load plugin tools: ${error}`);
			}
		}

		// 创建 spawn 工具，传入所有已创建的工具作为 parentTools
		const spawnTool = createSpawnTool({
			executor: this.config.executor,
			modelManager: this.config.modelManager,
			workspaceDir: workspacePath,
			channelDir: channelDir,
			parentTools: baseTools,
		});

		// 最终工具列表 = 基础工具 + spawn 工具
		const tools = [...baseTools, spawnTool];

		// 验证工具不为空
		if (tools.length === 0) {
			throw new Error("[Agent] No tools available - cannot initialize agent");
		}

		const toolNames = tools.map((t: any) => t.name).join(", ");
		log.logInfo(`[Agent] Created ${tools.length} tools for channel ${chatId}: ${toolNames}`);

		// 保存工具到 state，供 AgentSession 使用
		state.tools = tools;

		// 初始化系统提示
		const skills = loadSkills(channelDir, workspacePath);
		const memoryContent = loadMemoryContent(channelDir, workspacePath);
		const bootContents = loadBootFiles(workspacePath);
		const context: AgentContext = {
			platform: platformContext,
			chatId,
			user: {
				id: message.sender.id,
				userName: message.sender.name,
				displayName: message.sender.displayName || message.sender.name,
			},
			workspaceDir: workspacePath,
			channelDir,
			channels: additionalContext.channels || [],
			users: additionalContext.users || [],
			rawText: message.content,
			text: message.content,
			attachments: [],
			timestamp: message.timestamp.toISOString(),
		};

		// 创建 SessionManager（提前创建，用于生成历史摘要）
		const contextFile = join(channelDir, "context.jsonl");
		state.sessionManager = SessionManager.open(contextFile, channelDir);

        // 生成历史对话摘要
        const sessionForHistory = state.sessionManager.buildSessionContext();
        const historyMarkdown = sessionForHistory.messages.length > 0
            ? generateHistoryMarkdown(sessionForHistory.messages.slice(-20))
            : undefined;

        const systemPrompt = buildSystemPrompt(context, skills, memoryContent, channelDir, bootContents, historyMarkdown);

        // 触发 SYSTEM_PROMPT_BUILD hook
		if (hookManager?.hasHooks(HOOK_NAMES.SYSTEM_PROMPT_BUILD)) {
			await hookManager.emit(HOOK_NAMES.SYSTEM_PROMPT_BUILD, {
				channelId: chatId,
				prompt: systemPrompt,
				timestamp: new Date(),
			});
		}

		// 创建 ModelRegistry（必须在 Agent 之前，因为 getApiKey 需要用到）
		state.modelRegistry = this.config.modelManager.getRegistry();

		// 检查是否隐藏思考过程（默认显示思考）
		const hideThinking = (platformContext as any).isThinkingHidden?.() ?? false;

		// 创建带智能 Compact 的 convertToLlm 函数
		// 策略：分层保留消息，支持长任务（50+轮）
		const convertToLlmWithCompact = (messages: Parameters<typeof convertToLlm>[0]): ReturnType<typeof convertToLlm> => {
			// 使用智能分层 Compact
			// 10轮完整 + 20轮Markdown简化 = 最多50轮上下文
			return compactMessages(messages, {
				fullRounds: 10,
				markdownRounds: 20,
				maxTotalRounds: 50,
			});
		};

		// 创建 Agent
		state.agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: hideThinking ? "off" : "medium",
				tools,
			},
			convertToLlm: convertToLlmWithCompact,
			getApiKey: async () => getApiKeyForModel(model, state.modelRegistry!),
			// 【修复】Minimax 等模型的 tool call ID 不匹配问题
			onPayload: (payload: unknown, _model: typeof model) => {
				const params = payload as {
					messages?: Array<{
						role?: string;
						tool_call_id?: string;
						tool_calls?: Array<{ id?: string }>;
						content?: unknown;
					}>;
				};
				if (!params?.messages || !Array.isArray(params.messages)) {
					return payload;
				}

				// 收集所有 assistant 消息中的 tool call ID
				const assistantToolCallIds = new Set<string>();
				for (const msg of params.messages) {
					if (msg.role === "assistant" && msg.tool_calls) {
						for (const tc of msg.tool_calls) {
							if (tc.id) {
								assistantToolCallIds.add(tc.id);
							}
						}
					}
				}

				// 如果没有 tool calls，直接返回
				if (assistantToolCallIds.size === 0) {
					return payload;
				}

				// 检查并修复 tool 消息中的 tool_call_id
				let hasFix = false;
				const missingToolMsgs: Array<{ msg: typeof params.messages[0]; index: number }> = [];

				for (let i = 0; i < params.messages.length; i++) {
					const msg = params.messages[i];
					if (msg.role === "tool" && msg.tool_call_id) {
						// 如果 tool_call_id 不在 assistant 的 tool_calls 中
						if (!assistantToolCallIds.has(msg.tool_call_id)) {
							missingToolMsgs.push({ msg, index: i });
						}
					}
				}

				// 如果有不匹配的 tool 消息，尝试修复
				if (missingToolMsgs.length > 0) {
					log.logWarning(`[Agent][onPayload] Found ${missingToolMsgs.length} tool msgs with mismatched IDs`);

					for (const { msg, index } of missingToolMsgs) {
						const originalId = msg.tool_call_id!;
						log.logWarning(`[Agent][onPayload] [#${index}] tool_call_id=${originalId} not found in assistant tool_calls`);

						// 【修复策略】找到最近的 assistant 消息，使用其 tool call ID
						// 这对于 MiniMax 等模型特别重要，因为 tool result 必须对应到正确的 assistant tool call
						let fixed = false;

						// 策略 1: 尝试各种 ID 变体
						const possibleIds = [
							originalId,
							originalId.replace(/_/g, "-"),
							originalId.replace(/-/g, "_"),
							originalId.split("_").slice(0, -1).join("_"),
							originalId.split("-").slice(0, -1).join("-"),
							// MiniMax 格式: call_function_xxx_1 -> call_function_xxx
							originalId.replace(/_\d+$/, ""),
							originalId.replace(/-\d+$/, ""),
						];

						for (const id of possibleIds) {
							if (id && id !== originalId && assistantToolCallIds.has(id)) {
								log.logInfo(`[Agent][onPayload] [#${index}] Fixed by variant: ${originalId} -> ${id}`);
								msg.tool_call_id = id;
								hasFix = true;
								fixed = true;
								break;
							}
						}

						// 策略 2: 如果找不到匹配，使用最近 assistant 中的第一个 tool call ID
						if (!fixed) {
							// 从当前位置往前找最近的 assistant 消息
							for (let j = index - 1; j >= 0; j--) {
								const prevMsg = params.messages[j];
								if (prevMsg.role === "assistant" && prevMsg.tool_calls && prevMsg.tool_calls.length > 0) {
									const firstToolCallId = prevMsg.tool_calls[0].id;
									if (firstToolCallId) {
										log.logInfo(`[Agent][onPayload] [#${index}] Fixed to nearest assistant's tool_call: ${originalId} -> ${firstToolCallId}`);
										msg.tool_call_id = firstToolCallId;
										hasFix = true;
										fixed = true;
										break;
									}
								}
							}
						}
					}
				}

				if (hasFix) {
					log.logInfo("[Agent][onPayload] Fixed tool call ID mismatch in payload");
				}

				return payload;
			},
		});

		// 创建 SettingsManager（只创建一次）
		state.settingsManager = SettingsManager.inMemory({
			images: { autoResize: true },
			retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
			theme: "dark",
			shellPath: process.env.SHELL || "/bin/bash",
		});

		// 创建可更新的 resourceLoader
		const { loader: resourceLoader, updateSystemPrompt } = this.createResourceLoader();
		state.updateResourceLoaderPrompt = updateSystemPrompt;
		// 初始化 resourceLoader 的 system prompt
		updateSystemPrompt(systemPrompt);

		// 将工具转换为 Record 格式
		const toolsRecord: Record<string, AgentTool> = {};
		for (const tool of state.tools) {
			toolsRecord[tool.name] = tool;
		}

		// 创建并保存 AgentSession
		state.session = new AgentSession({
			agent: state.agent,
			sessionManager: state.sessionManager!,
			settingsManager: state.settingsManager,
			cwd: process.cwd(),
			modelRegistry: state.modelRegistry!,
			resourceLoader,
			baseToolsOverride: toolsRecord,
		});

		// 加载历史消息
		const loadedSession = state.sessionManager.buildSessionContext();
		if (loadedSession.messages.length > 0) {
			// 【修改】增大最大消息数到 100（约50轮），配合 compact 策略使用
			const maxMessages = 100;
			let messages = loadedSession.messages.slice(-maxMessages);

			// 【修复】检查截断边界，确保没有孤立的 tool result
			// 如果第一条消息是 tool result，其对应的 assistant 可能被截断到了前面
			if (messages.length > 0) {
				const firstMsg = messages[0] as any;
				if (firstMsg.role === "toolResult" && firstMsg.toolCallId) {
					// 在截断前的消息中查找对应的 assistant
					const beforeSlice = loadedSession.messages.slice(0, -maxMessages);
					for (let i = beforeSlice.length - 1; i >= 0; i--) {
						const msg = beforeSlice[i] as any;
						if (msg.role === "assistant" && msg.toolCalls) {
							const hasMatchingToolCall = msg.toolCalls.some((tc: any) => tc.id === firstMsg.toolCallId);
							if (hasMatchingToolCall) {
								// 找到了对应的 assistant，将其添加到消息列表开头
								messages.unshift(msg);
								log.logInfo(`[Agent] Added missing assistant message for tool call ${firstMsg.toolCallId}`);
								break;
							}
						}
					}
				}
			}

			// 验证消息历史：确保 toolResult 消息有对应的 tool_calls
			const validMessages: typeof messages = [];
			const pendingToolCalls = new Set<string>();
			
			for (const msg of messages) {
				const role = (msg as any).role;
				if (role === "assistant") {
					// 记录这个 assistant 消息中的 tool_calls
					const toolCalls = (msg as any).toolCalls || [];
					for (const tc of toolCalls) {
						if (tc.id) pendingToolCalls.add(tc.id);
					}
					validMessages.push(msg);
				} else if (role === "toolResult") {
					// 检查这个 toolResult 消息是否有对应的 tool_call
					const toolCallId = (msg as any).toolCallId;
					if (toolCallId && pendingToolCalls.has(toolCallId)) {
						validMessages.push(msg);
						pendingToolCalls.delete(toolCallId);
					} else {
						log.logWarning(`[Agent] Skipping orphaned toolResult message: ${toolCallId}`);
					}
				} else if (role === "user") {
					validMessages.push(msg);
					// 用户消息会开始新的 turn，清空 pending tool calls
					pendingToolCalls.clear();
				} else {
					validMessages.push(msg);
				}
			}
			
			if (validMessages.length < messages.length) {
				log.logWarning(`[Agent] Filtered out ${messages.length - validMessages.length} invalid messages`);
			}

			// 【修复】处理孤立的 tool_calls（当消息被截断时，tool_calls 可能没有对应的 tool_result）
			if (pendingToolCalls.size > 0) {
				log.logWarning(`[Agent] Found ${pendingToolCalls.size} orphaned tool_calls, removing from last assistant message`);
				// 从后往前找到最后一个 assistant 消息
				for (let i = validMessages.length - 1; i >= 0; i--) {
					const msg = validMessages[i];
					if ((msg as any).role === "assistant") {
						const assistantMsg = msg as any;
						// 过滤掉没有对应 tool_result 的 tool_calls
						if (assistantMsg.content && Array.isArray(assistantMsg.content)) {
							assistantMsg.content = assistantMsg.content.filter(
								(c: any) => c.type !== "toolCall" || !pendingToolCalls.has(c.id)
							);
						}
						// 同时清理 toolCalls 属性
						if (assistantMsg.toolCalls && Array.isArray(assistantMsg.toolCalls)) {
							assistantMsg.toolCalls = assistantMsg.toolCalls.filter(
								(tc: any) => !pendingToolCalls.has(tc.id)
							);
						}
						break;
					}
				}
			}

			// 计算预估总长度
			const systemPromptLength = systemPrompt.length;
			const messagesLength = validMessages.reduce((sum, msg) =>
				sum + JSON.stringify(msg).length, 0);
			const estimatedTotal = systemPromptLength + messagesLength;

			// 如果超限，动态减少消息数量
			let finalMessages = validMessages;
			if (estimatedTotal > 250000) {
				const targetLength = 250000 - systemPromptLength;
				const avgMsgLength = messagesLength / validMessages.length;
				const maxAllowed = Math.max(5, Math.floor(targetLength / avgMsgLength));
				finalMessages = validMessages.slice(-maxAllowed);
				log.logWarning(`[Agent] Reducing messages from ${validMessages.length} to ${finalMessages.length} due to length limit`);
				
				// 【修复】再次检查截断边界
				if (finalMessages.length > 0) {
					const firstMsg = finalMessages[0] as any;
					if (firstMsg.role === "toolResult" && firstMsg.toolCallId) {
						// 在截断前的消息中查找对应的 assistant
						for (let i = validMessages.length - finalMessages.length - 1; i >= 0; i--) {
							const msg = validMessages[i] as any;
							if (msg.role === "assistant" && msg.toolCalls) {
								const hasMatchingToolCall = msg.toolCalls.some((tc: any) => tc.id === firstMsg.toolCallId);
								if (hasMatchingToolCall) {
									finalMessages.unshift(msg);
									log.logInfo(`[Agent] Added missing assistant message for tool call ${firstMsg.toolCallId} (length limit)`);
									break;
								}
							}
						}
					}
				}
			}

			state.agent.replaceMessages(finalMessages);
			log.logInfo(`[Agent] Loaded ${finalMessages.length} messages from context (system prompt: ${systemPromptLength}, messages: ${messagesLength})`);
		}

		log.logInfo(`[Agent] Initialized for channel ${chatId} with model ${model.id}`);

		// 触发 AGENT_INIT_END hook
		if (hookManager?.hasHooks(HOOK_NAMES.AGENT_INIT_END)) {
			await hookManager.emit(HOOK_NAMES.AGENT_INIT_END, {
				channelId: chatId,
				timestamp: new Date(),
			});
		}
	}

	/**
	 * 更新系统提示（条件性：只在文件变更时更新）
	 */
	private async updateSystemPrompt(
		state: AgentState,
		chatId: string,
		channelDir: string,
		platformContext: PlatformContext,
		additionalContext: Partial<AgentContext>,
	): Promise<void> {
		const workspacePath = this.config.executor.getWorkspacePath(
			join(channelDir, "..", ".."),
		);

		// 获取当前的文件 mtime
		const currentSkillsMtime = getSkillsMtime(channelDir, workspacePath);
		const currentMemoryMtime = getMemoryMtime(workspacePath, channelDir);

		// 检查是否需要更新（首次或文件有变更）
		const needsUpdate = !state.lastPromptUpdate ||
			state.lastPromptUpdate.skillsMtime !== currentSkillsMtime ||
			state.lastPromptUpdate.memoryMtime !== currentMemoryMtime;

		if (!needsUpdate) {
			// 文件未变更，跳过更新
			return;
		}

		// 加载 skills 和 memory（已有缓存，不会重复读取文件）
		const skills = loadSkills(channelDir, workspacePath);
		const memoryContent = loadMemoryContent(channelDir, workspacePath);
		const bootContents = loadBootFiles(workspacePath);

		// 更新 mtime 记录
		state.lastPromptUpdate = {
			skillsMtime: currentSkillsMtime,
			memoryMtime: currentMemoryMtime,
		};

		const context: AgentContext = {
			platform: platformContext,
			chatId,
			user: additionalContext.user || { id: "", userName: "", displayName: "" },
			workspaceDir: workspacePath,
			channelDir,
			channels: additionalContext.channels || [],
			users: additionalContext.users || [],
			rawText: "",
			text: "",
			attachments: [],
			timestamp: "",
		};

        // 生成历史对话摘要
        const sessionForPrompt = state.sessionManager!.buildSessionContext();
        const historyMarkdown = sessionForPrompt.messages.length > 0
            ? generateHistoryMarkdown(sessionForPrompt.messages.slice(-20))
            : undefined;

        const systemPrompt = buildSystemPrompt(context, skills, memoryContent, channelDir, bootContents, historyMarkdown);

        // 触发 SYSTEM_PROMPT_BUILD hook
		const hookManager = this.config.hookManager;
		if (hookManager?.hasHooks(HOOK_NAMES.SYSTEM_PROMPT_BUILD)) {
			await hookManager.emit(HOOK_NAMES.SYSTEM_PROMPT_BUILD, {
				channelId: chatId,
				prompt: systemPrompt,
				timestamp: new Date(),
			});
		}

		state.agent!.setSystemPrompt(systemPrompt);

		// 更新 mtime 记录
		state.lastPromptUpdate = {
			skillsMtime: currentSkillsMtime,
			memoryMtime: currentMemoryMtime,
		};
	}

	/**
	 * 格式化用户消息
	 */
	private async formatUserMessage(message: UniversalMessage, additionalContext: Partial<AgentContext>): Promise<string> {
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, "0");
		const offset = -now.getTimezoneOffset();
		const offsetSign = offset >= 0 ? "+" : "-";
		const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
		const offsetMins = pad(Math.abs(offset) % 60);
		const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;

		const userName = additionalContext.user?.displayName || additionalContext.user?.userName || message.sender.name || "unknown";
		let userMessage = `[${timestamp}] [${userName}]: ${message.content}`;

		// 处理非图片附件
		const nonImageAttachments = (message.attachments || []).filter((a) => a.type !== "image");
		if (nonImageAttachments.length > 0) {
			const attachmentInfo = await Promise.all(
				nonImageAttachments.map(async (a, index) => {
					const fileType = this.getFileTypeDescription(a.name);
					const fileSize = await this.getFileSize(a.localPath);
					const isText = this.isTextFile(a.name);
					const sizeStr = fileSize ? `, ${fileSize}` : "";
					const typeStr = isText ? "文本" : "二进制";
					return `${index + 1}. 📎 ${a.name} (${fileType}, ${typeStr}${sizeStr}) - 路径: ${a.localPath}`;
				})
			);
			userMessage += `\n\n<attachments>\n用户上传了以下附件，请使用 read 工具读取需要的内容：\n${attachmentInfo.join("\n")}\n</attachments>`;
		}

		return userMessage;
	}

	/**
	 * 获取文件大小（格式化显示）
	 */
	private async getFileSize(filePath: string): Promise<string | null> {
		try {
			const { stat } = await import("fs/promises");
			const stats = await stat(filePath);
			const bytes = stats.size;

			if (bytes < 1024) return `${bytes}B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
			if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
			return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
		} catch {
			return null;
		}
	}

	/**
	 * 判断是否为文本文件
	 */
	private isTextFile(fileName: string): boolean {
		const textExtensions = new Set([
			// 文档
			"txt", "md", "markdown",
			// 代码文件
			"js", "ts", "jsx", "tsx", "py", "java", "go", "rs", "c", "cpp", "h", "rb", "php",
			"html", "htm", "css", "scss", "less", "sql", "sh", "bash", "zsh", "ps1", "vim",
			// 数据文件
			"json", "jsonl", "yaml", "yml", "xml", "csv",
			// 配置文件
			"conf", "config", "ini", "properties", "env",
			// 日志文件
			"log",
		]);
		const ext = fileName.toLowerCase().split(".").pop() || "";
		return textExtensions.has(ext);
	}

	/**
	 * 获取文件类型描述
	 */
	private getFileTypeDescription(fileName: string): string {
		const ext = fileName.toLowerCase().split(".").pop() || "";
		
		const typeMap: Record<string, string> = {
			// 文档
			"pdf": "PDF 文档",
			"doc": "Word 文档",
			"docx": "Word 文档",
			"xls": "Excel 表格",
			"xlsx": "Excel 表格",
			"ppt": "PPT 演示文稿",
			"pptx": "PPT 演示文稿",
			"txt": "文本文件",
			"md": "Markdown 文档",
			"markdown": "Markdown 文档",
			// 代码文件
			"js": "JavaScript 代码",
			"ts": "TypeScript 代码",
			"jsx": "React JSX",
			"tsx": "React TSX",
			"py": "Python 代码",
			"java": "Java 代码",
			"go": "Go 代码",
			"rs": "Rust 代码",
			"c": "C 代码",
			"cpp": "C++ 代码",
			"h": "头文件",
			"rb": "Ruby 代码",
			"php": "PHP 代码",
			"html": "HTML 文档",
			"css": "CSS 样式",
			"scss": "SCSS 样式",
			"less": "LESS 样式",
			"sql": "SQL 脚本",
			"sh": "Shell 脚本",
			"bash": "Bash 脚本",
			"zsh": "Zsh 脚本",
			"ps1": "PowerShell 脚本",
			// 数据文件
			"json": "JSON 数据",
			"jsonl": "JSON Lines",
			"yaml": "YAML 配置",
			"yml": "YAML 配置",
			"xml": "XML 数据",
			"csv": "CSV 表格",
			// 配置文件
			"conf": "配置文件",
			"config": "配置文件",
			"ini": "INI 配置",
			"properties": "Properties 配置",
			"env": "环境变量配置",
			// 日志文件
			"log": "日志文件",
			// 压缩文件
			"zip": "ZIP 压缩包",
			"tar": "TAR 归档",
			"gz": "Gzip 压缩",
			"rar": "RAR 压缩包",
			"7z": "7z 压缩包",
			// 音视频
			"mp3": "音频文件",
			"mp4": "视频文件",
			"wav": "WAV 音频",
			"avi": "AVI 视频",
			"mov": "QuickTime 视频",
			"mkv": "Matroska 视频",
			// 图片（虽然通常单独处理）
			"png": "PNG 图片",
			"jpg": "JPEG 图片",
			"jpeg": "JPEG 图片",
			"gif": "GIF 图片",
			"webp": "WebP 图片",
			"svg": "SVG 矢量图",
			// 其他
			"exe": "可执行文件",
			"dll": "动态链接库",
			"so": "共享库",
			"dylib": "动态库",
		};

		return typeMap[ext] || `${ext.toUpperCase()} 文件`;
	}

	/**
	 * 处理图片附件
	 */
	private processImageAttachments(message: UniversalMessage): ImageContent[] {
		const IMAGE_MIME_TYPES: Record<string, string> = {
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			png: "image/png",
			gif: "image/gif",
			webp: "image/webp",
		};

		const imageAttachments: ImageContent[] = [];

		for (const attachment of message.attachments || []) {
			if (attachment.type !== "image") continue;

			const ext = attachment.name.toLowerCase().split(".").pop() || "";
			const mimeType = IMAGE_MIME_TYPES[ext];

			if (mimeType) {
				try {
					const data = readFileSync(attachment.localPath).toString("base64");
					imageAttachments.push({
						type: "image",
						mimeType,
						data,
					});
				} catch (error) {
					log.logWarning(`[Agent] Failed to read image: ${attachment.localPath}`);
				}
			}
		}

		return imageAttachments;
	}

	/**
	 * 创建可更新的资源加载器
	 */
	private createResourceLoader(): { loader: ResourceLoader; updateSystemPrompt: (prompt: string) => void } {
		let currentSystemPrompt = "";
		return {
			loader: {
				getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
				getSkills: () => ({ skills: [], diagnostics: [] }),
				getPrompts: () => ({ prompts: [], diagnostics: [] }),
				getThemes: () => ({ themes: [], diagnostics: [] }),
				getAgentsFiles: () => ({ agentsFiles: [] }),
				getSystemPrompt: () => currentSystemPrompt,
				getAppendSystemPrompt: () => [],
				extendResources: () => {},
				reload: async () => {},
			},
			updateSystemPrompt: (prompt: string) => {
				currentSystemPrompt = prompt;
			},
		};
	}

	/**
	 * 切换模型
	 */
	switchModel(modelId: string): boolean {
		return this.config.modelManager.switchModel(modelId);
	}

	/**
	 * 切换频道模型
	 */
	switchChannelModel(channelId: string, modelId: string): boolean {
		return this.config.modelManager.switchChannelModel(channelId, modelId);
	}

	/**
	 * 获取当前模型
	 */
	async getCurrentModel(channelId?: string): Promise<Model<Api>> {
		return this.config.modelManager.getModelInstance(channelId, this.config.adapterDefaultModel);
	}

	/**
	 * 销毁频道 Agent 状态
	 * 当模型切换时调用，下次消息处理时会重新初始化并使用新模型
	 */
	destroyChannelState(channelId: string): void {
		channelStates.delete(channelId);
		log.logInfo(`[Agent] Destroyed state for channel ${channelId}`);
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建 CoreAgent 实例
 */
export function createCoreAgent(config: AgentConfig): CoreAgent {
	return new CoreAgent(config);
}
