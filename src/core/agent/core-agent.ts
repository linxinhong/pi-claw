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
import { readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { getChannelDir } from "../../utils/config.js";
import type { AgentContext } from "./context.js";
import { buildSystemPrompt, loadMemoryContent, loadSkills } from "./prompt-builder.js";
import type { ModelManager } from "../model/manager.js";
import type { PlatformContext } from "../platform/context.js";
import type { UniversalMessage } from "../platform/message.js";
import * as log from "../../utils/logger/index.js";
import type { Executor } from "../sandbox/index.js";
import { MemoryStore, getAllMemoryTools } from "../services/memory/index.js";
import type { HookManager } from "../hook/manager.js";
import { HOOK_NAMES } from "../hook/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent 配置
 */
export interface AgentConfig {
	/** 模型管理器 */
	modelManager: ModelManager;
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
	tools: AgentTool<any>[];
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

		// 检查模型切换命令
		const { handleModelSwitchCommand } = await import("./model-switcher.js");
		const switchResult = handleModelSwitchCommand(
			message.content,
			this.config.modelManager,
			chatId,
			channelDir,
		);
		if (switchResult.response) {
			return switchResult.response;
		}

		// 加载频道模型配置
		const modelConfigPath = join(channelDir, "model-config.json");
		this.config.modelManager.loadChannelModels(modelConfigPath);

		// 获取或创建 Agent 状态
		let state = channelStates.get(chatId);
		if (!state) {
			state = { agent: null, session: null, sessionManager: null, modelRegistry: null, memoryStore: null, tools: [] };
			channelStates.set(chatId, state);
		}

		// 初始化 Agent
		if (!state.agent) {
			await this.initializeAgent(state, chatId, channelDir, message, platformContext, additionalContext);
		}

		// 更新系统提示
		await this.updateSystemPrompt(state, chatId, channelDir, platformContext, additionalContext);

		// 准备用户消息
		const userMessage = this.formatUserMessage(message, additionalContext);

		// 处理图片附件
		const imageAttachments = this.processImageAttachments(message);

		// 创建 session
		const systemPrompt = buildSystemPrompt(
			{
				platform: platformContext,
				chatId,
				user: {
					id: message.sender.id,
					userName: message.sender.name,
					displayName: message.sender.displayName || message.sender.name,
				},
				workspaceDir: this.config.workspaceDir,
				channelDir,
				channels: additionalContext.channels || [],
				users: additionalContext.users || [],
				rawText: message.content,
				text: message.content,
				attachments: [],
				timestamp: message.timestamp.toISOString(),
			},
			[],
			"",
		);
		const resourceLoader = this.createResourceLoader(state.agent!, systemPrompt);
		const sessionId = `${chatId}-${Date.now()}`;
		const hookManager = this.config.hookManager;

		// 触发 SESSION_CREATE hook
		if (hookManager?.hasHooks(HOOK_NAMES.SESSION_CREATE)) {
			await hookManager.emit(HOOK_NAMES.SESSION_CREATE, {
				channelId: chatId,
				sessionId: sessionId,
				timestamp: new Date(),
			});
		}

		const settingsManager = SettingsManager.inMemory({
			images: { autoResize: true },
			retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
			theme: "dark",
			shellPath: process.env.SHELL || "/bin/bash",
		});

		// 将工具数组转换为 Record 格式
		const toolsRecord: Record<string, AgentTool> = {};
		for (const tool of state.tools) {
			toolsRecord[tool.name] = tool;
		}

		const session = new AgentSession({
			agent: state.agent!,
			sessionManager: state.sessionManager!,
			settingsManager,
			cwd: process.cwd(),
			modelRegistry: state.modelRegistry!,
			resourceLoader,
			baseToolsOverride: toolsRecord,
		});

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
			session.subscribe(async (agentEvent) => {
				if (agentEvent.type === "tool_execution_start") {
					const args = agentEvent.args as Record<string, unknown>;
					const label = (args.label as string) || agentEvent.toolName;
					await platformContext.sendText(chatId, `_ -> ${label}_`);

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
					const statusIcon = agentEvent.isError ? "X" : "OK";
					await platformContext.sendText(chatId, `_ -> ${statusIcon} ${agentEvent.toolName}_`);

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
					resolve(finalResponse);
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
		const workspacePath = this.config.executor.getWorkspacePath(
			join(channelDir, "..", ".."),
		);
		const model = await this.config.modelManager.getModelInstance(chatId, this.config.adapterDefaultModel);

		// 创建或获取 MemoryStore
		if (!state.memoryStore) {
			state.memoryStore = new MemoryStore(workspacePath);
		}

		// 验证工具依赖
		if (!this.config.executor) {
			throw new Error("[Agent] Executor is required to create tools");
		}

		// 创建工具
		const { createBashTool } = await import("../tools/bash.js");
		const { createReadTool } = await import("../tools/read.js");
		const { createWriteTool } = await import("../tools/write.js");
		const { createEditTool } = await import("../tools/edit.js");
		const { createModelsTool } = await import("../tools/models.js");
		const { createGlobTool } = await import("../tools/glob.js");
		const { createGrepTool } = await import("../tools/grep.js");
		const { createSpawnTool } = await import("../tools/spawn.js");

		const tools = [
			createBashTool(this.config.executor),
			createReadTool(this.config.executor),
			createWriteTool(this.config.executor),
			createEditTool(this.config.executor),
			createModelsTool(this.config.modelManager),
			createGlobTool(this.config.executor),
			createGrepTool(this.config.executor),
			createSpawnTool({
				executor: this.config.executor,
				modelManager: this.config.modelManager,
				workspaceDir: workspacePath,
			}),
			// 添加 memory 工具
			...getAllMemoryTools(state.memoryStore, workspacePath),
		].filter(Boolean);

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
		const systemPrompt = buildSystemPrompt(context, skills, memoryContent);

		// 创建 ModelRegistry（必须在 Agent 之前，因为 getApiKey 需要用到）
		state.modelRegistry = this.config.modelManager.getRegistry();

		// 创建 SessionManager
		const contextFile = join(channelDir, "context.jsonl");
		state.sessionManager = SessionManager.open(contextFile, channelDir);

		// 创建 Agent
		state.agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: "off",
				tools,
			},
			convertToLlm,
			getApiKey: async () => getApiKeyForModel(model, state.modelRegistry!),
		});

		// 加载历史消息
		const loadedSession = state.sessionManager.buildSessionContext();
		if (loadedSession.messages.length > 0) {
			state.agent.replaceMessages(loadedSession.messages);
			log.logInfo(`[Agent] Loaded ${loadedSession.messages.length} messages from context`);
		}

		log.logInfo(`[Agent] Initialized for channel ${chatId} with model ${model.id}`);
	}

	/**
	 * 更新系统提示
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
		const skills = loadSkills(channelDir, workspacePath);
		const memoryContent = loadMemoryContent(channelDir, workspacePath);

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

		const systemPrompt = buildSystemPrompt(context, skills, memoryContent);
		state.agent!.setSystemPrompt(systemPrompt);
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
	 * 创建资源加载器
	 */
	private createResourceLoader(agent: Agent, systemPrompt: string): ResourceLoader {
		return {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => systemPrompt,
			getAppendSystemPrompt: () => [],
			getPathMetadata: () => new Map(),
			extendResources: () => {},
			reload: async () => {},
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
