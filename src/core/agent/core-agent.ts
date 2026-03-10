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
import { buildSystemPrompt, loadBootFiles, loadMemoryContent, loadSkills } from "./prompt-builder.js";
import { convertToMarkdown } from "./message-formatter.js";
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
		import("../tools/spawn.js"),
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
			if ((platformContext as any).startThinking) {
				await (platformContext as any).startThinking();
			}

			// 初始化 Agent
			if (!state.agent) {
				await this.initializeAgent(state, chatId, channelDir, message, platformContext, additionalContext);
			} else {
				// Agent 已存在，更新 thinkingLevel（因为 hideThinking 可能在 startThinking 中改变了）
				const hideThinking = (platformContext as any).isThinkingHidden?.() ?? true;
				state.agent.setThinkingLevel(hideThinking ? "off" : "medium");
			}

			// 更新系统提示
			await this.updateSystemPrompt(state, chatId, channelDir, platformContext, additionalContext);

			// 准备用户消息
			const userMessage = this.formatUserMessage(message, additionalContext);

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

			// 订阅事件并响应
			let finalResponse = "";
			const responsePromise = new Promise<string>((resolve) => {
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
							}
						} else if (agentEvent.type === "message_end" && agentEvent.message.role === "assistant") {
							const assistantMsg = agentEvent.message as any;
							if (assistantMsg.stopReason) runState.stopReason = assistantMsg.stopReason;
							if (assistantMsg.errorMessage) {
								runState.errorMessage = assistantMsg.errorMessage;
								log.logError(`[Agent] API error: ${assistantMsg.errorMessage}`);
							}

							const content = agentEvent.message.content;
							const textParts = content.filter((c: any) => c.type === "text").map((c: any) => c.text);
							finalResponse = textParts.join("\n");

							// 完成思考卡片
							if ((platformContext as any).finishThinking) {
								await (platformContext as any).finishThinking(finalResponse);
							}

							resolve(finalResponse);
						}
					} catch (error) {
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
		const { createSpawnTool } = await import("../tools/spawn.js");
		const { createRtkTool } = await import("../tools/rtk.js");

		const tools = [
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
			createSpawnTool({
				executor: this.config.executor,
				modelManager: this.config.modelManager,
				workspaceDir: workspacePath,
			}),
			createRtkTool(this.config.executor),
			// 添加 memory 工具
			...getAllMemoryTools(state.memoryStore, state.channelMemoryStore, workspacePath),
			// 添加 event 工具（如果 eventsWatcher 可用）
			...(this.config.eventsWatcher ? getAllEventTools(this.config.eventsWatcher, chatId) : []),
		].filter(Boolean);

		// 添加平台特定工具
		if (platformContext.getTools) {
			try {
				const platformTools = await platformContext.getTools({
					chatId,
					workspaceDir: workspacePath,
					channelDir,
				});
				if (platformTools && platformTools.length > 0) {
					tools.push(...platformTools);
					log.logInfo(`[Agent] Added ${platformTools.length} platform tools for ${platformContext.platform}`);
				}
			} catch (error) {
				log.logError(`[Agent] Failed to load platform tools: ${error}`);
			}
		}

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
		const systemPrompt = buildSystemPrompt(context, skills, memoryContent, channelDir, bootContents);

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

		// 创建 SessionManager
		const contextFile = join(channelDir, "context.jsonl");
		state.sessionManager = SessionManager.open(contextFile, channelDir);

		// 检查是否隐藏思考过程
		const hideThinking = (platformContext as any).isThinkingHidden?.() ?? true;

		// 创建带 Markdown 转换和截断的 convertToLlm 函数
		// 策略：将历史消息转换为 Markdown 格式，保留最近消息为原始格式
		const maxMessages = 40;
		const convertToLlmWithTruncation = (messages: Parameters<typeof convertToLlm>[0]): ReturnType<typeof convertToLlm> => {
			// 使用 Markdown 转换（内部会调用 convertToLlm）
			const converted = convertToMarkdown(messages, {
				keepRecentMessages: 10, // 保留 5 轮对话
				maxMarkdownLength: 10000,
				includeToolResults: false,
			});

			// 最终截断到 maxMessages 条
			if (converted.length > maxMessages) {
				log.logInfo(`[Agent] Truncating messages from ${converted.length} to ${maxMessages}`);
				return converted.slice(-maxMessages);
			}
			return converted;
		};

		// 创建 Agent
		state.agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: hideThinking ? "off" : "medium",
				tools,
			},
			convertToLlm: convertToLlmWithTruncation,
			getApiKey: async () => getApiKeyForModel(model, state.modelRegistry!),
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
			// 截断到最后 40 条消息，避免输入超过 API 限制
			const maxMessages = 40;
			const messages = loadedSession.messages.slice(-maxMessages);
			state.agent.replaceMessages(messages);
			log.logInfo(`[Agent] Loaded ${messages.length} messages from context (total: ${loadedSession.messages.length})`);
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

		const systemPrompt = buildSystemPrompt(context, skills, memoryContent, channelDir, bootContents);

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
	private formatUserMessage(message: UniversalMessage, additionalContext: Partial<AgentContext>): string {
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
			const paths = nonImageAttachments.map((a) => a.localPath).join("\n");
			userMessage += `\n\n<attachments>\n${paths}\n</attachments>`;
		}

		return userMessage;
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
				getPathMetadata: () => new Map(),
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
