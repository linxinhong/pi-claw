/**
 * Unified Bot - 统一机器人入口
 *
 * 基于新架构的机器人实现，使用 PlatformAdapter 和 CoreAgent
 * 不再硬编码平台选择，通过 Adapter Factory 创建
 */

import type { PlatformAdapter } from "./platform/adapter.js";
import type { PluginManager } from "./plugin/manager.js";
import type { PlatformStore } from "./store/types.js";
import type { LogContext } from "../utils/logger/console.js";
import { CoreAgent, createCoreAgent } from "./agent/index.js";
import { ModelManager } from "./model/index.js";
import { createExecutor } from "./sandbox/index.js";
import { EventsWatcher } from "./services/event/index.js";
import { getHookManager, HOOK_NAMES } from "./hook/index.js";
import { ConfigManager } from "./config/manager.js";
import { logMessageReceive, logMessageReply } from "../utils/logger/console.js";
import { createMcpManager, McpManager } from "./mcp/index.js";
import type { McpConfig } from "../utils/config.js";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export interface UnifiedBotConfig {
	/** 平台适配器（由 Adapter Factory 创建） */
	adapter: PlatformAdapter;
	/** 工作目录 */
	workingDir: string;
	/** 存储实例 */
	store: PlatformStore;
	/** 插件管理器 */
	pluginManager: PluginManager;
	/** 端口号 */
	port?: number;
	/** 全局默认模型 ID（来自 config.json 的 model 字段） */
	defaultModel?: string;
	/** 预热频道列表（启动时提前初始化这些频道的 Agent） */
	warmupChannels?: string[];
}

// ============================================================================
// Unified Bot
// ============================================================================

/**
 * 统一机器人类
 *
 * 使用新架构的机器人实现，支持多平台
 * 接收已创建的 PlatformAdapter，不再内部创建
 */
export class UnifiedBot {
	private adapter: PlatformAdapter;
	private store: PlatformStore;
	private pluginManager: PluginManager;
	private modelManager: ModelManager;
	private coreAgent: CoreAgent;
	private workingDir: string;
	private eventsWatcher: EventsWatcher | null = null;
	private warmupChannels: string[];
	private mcpManager: McpManager | null = null;

	constructor(config: UnifiedBotConfig) {
		this.workingDir = config.workingDir;
		this.store = config.store;
		this.pluginManager = config.pluginManager;
		this.adapter = config.adapter;
		this.warmupChannels = config.warmupChannels || [];

		// 获取 ConfigManager 单例
		let configManager: ConfigManager | undefined;
		try {
			configManager = ConfigManager.getInstance();
		} catch {
			// ConfigManager 未初始化，使用旧模式
		}

		// 初始化 MCP 管理器
		this.mcpManager = this.initMcpManager(configManager);

		// 创建模型管理器（使用配置中的默认模型）
		this.modelManager = new ModelManager(undefined, config.defaultModel);

		// 如果 ConfigManager 可用，设置到 ModelManager
		if (configManager) {
			this.modelManager.setConfigManager(configManager);
		}

		// 获取 adapter 默认模型
		const adapterDefaultModel = this.adapter.getDefaultModel?.();

		// 创建 EventsWatcher（需要在 CoreAgent 之前创建）
		const eventsDir = join(this.workingDir, "events");
		this.eventsWatcher = new EventsWatcher({
			eventsDir,
			onEvent: async (platform, channelId, text) => {
				await this.handleScheduledEvent(platform, channelId, text);
			},
		});

		// 设置 hookManager，使事件能够触发 hooks
		this.eventsWatcher.setHookManager(getHookManager());

		// 创建核心 Agent
		this.coreAgent = createCoreAgent({
			modelManager: this.modelManager,
			configManager,
			executor: createExecutor({ type: "host" }),
			workspaceDir: config.workingDir,
			eventBus: null, // 可以传入 EventBus
			adapterDefaultModel,
			hookManager: getHookManager(),
			eventsWatcher: this.eventsWatcher,
			mcpManager: this.mcpManager || undefined,
		});

		// 设置模型变更回调：当模型切换时销毁 Agent 状态
		this.modelManager.setOnModelChange((channelId) => {
			this.coreAgent.destroyChannelState(channelId);
		});

		// 订阅适配器消息
		this.adapter.onMessage(async (message) => {
			await this.handleMessage(message);
		});
	}

	async start(port?: number): Promise<void> {
		await this.adapter.start();

		// 启动 MCP 管理器
		if (this.mcpManager) {
			try {
				await this.mcpManager.initialize();
			} catch (error) {
				console.error("[UnifiedBot] Failed to initialize MCP manager:", error);
			}
		}

		// 启动事件监控（已在构造函数中创建）
		if (this.eventsWatcher) {
			this.eventsWatcher.start();
		}

		// 预热频道
		if (this.warmupChannels.length > 0 && this.adapter && 'warmupChannelsAsync' in this.adapter) {
			console.log(`[UnifiedBot] Warming up ${this.warmupChannels.length} channels...`);
			await (this.adapter as any).warmupChannelsAsync(this.coreAgent, this.warmupChannels);
		}

		console.log(`[UnifiedBot] Started on ${this.adapter.platform} platform`);
	}

	async stop(): Promise<void> {
		// 停止事件监控
		if (this.eventsWatcher) {
			this.eventsWatcher.stop();
			this.eventsWatcher = null;
		}

		// 关闭 MCP 管理器
		if (this.mcpManager) {
			try {
				await this.mcpManager.shutdown();
			} catch (error) {
				console.error("[UnifiedBot] Error shutting down MCP manager:", error);
			}
			this.mcpManager = null;
		}

		await this.adapter.stop();
		console.log("[UnifiedBot] Stopped");
	}

	private async handleMessage(message: any): Promise<void> {
		const startTime = Date.now();
		const chatId = message.chat.id;

		// 获取上下文信息
		const channelInfo = await this.adapter.getChannelInfo(chatId);
		const ctx: LogContext = {
			channelId: chatId,
			channelName: channelInfo?.name,
			userName: message.sender?.name,
			platform: this.adapter.platform,
		};

		// 记录消息接收
		logMessageReceive(ctx, message.content, message.id);

		// 触发 MESSAGE_RECEIVE hook
		const hookManager = getHookManager();
		if (hookManager.hasHooks(HOOK_NAMES.MESSAGE_RECEIVE)) {
			await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
				channelId: message.chat.id,
				messageId: message.id,
				text: message.content,
				userId: message.sender?.id,
				userName: message.sender?.name,
				timestamp: message.timestamp || new Date(),
			});
		}

		// 创建平台上下文
		const platformContext = this.adapter.createPlatformContext(message.chat.id);

		// 处理消息
		const response = await this.coreAgent.processMessage(message, platformContext, {
			user: message.sender,
			channels: await this.adapter.getAllChannels(),
			users: await this.adapter.getAllUsers(),
		});

		// 发送响应
		if (response) {
			// 检查是否已经通过其他方式发送过响应
			const alreadySent = platformContext.isResponseSent?.();

			if (!alreadySent && platformContext.finalizeResponse) {
				await platformContext.finalizeResponse(response);
			} else if (!alreadySent) {
				await platformContext.sendText(message.chat.id, response);
			}

			// 记录回复
			const duration = Date.now() - startTime;
			logMessageReply(ctx, response.length, duration);
		}
	}

	/**
	 * 处理调度事件
	 */
	private async handleScheduledEvent(platform: string, channelId: string, text: string): Promise<void> {
		// 检查 platform 是否匹配当前 adapter
		if (platform !== this.adapter.platform) {
			console.log(`[UnifiedBot] Event platform mismatch: event=${platform}, adapter=${this.adapter.platform}, ignoring`);
			return; // 不是当前 platform 的事件，忽略
		}

		console.log(`[UnifiedBot] Handling scheduled event: platform=${platform}, channelId=${channelId}`);

		// 创建合成消息
		const syntheticMessage: any = {
			id: `event-${Date.now()}`,
			chat: { id: channelId },
			content: text,
			sender: { id: "EVENT", name: "Event" },
			timestamp: new Date(),
		};

		// 创建平台上下文
		const platformContext = this.adapter.createPlatformContext(channelId);

		// 让 Agent 处理
		const response = await this.coreAgent.processMessage(syntheticMessage, platformContext, {
			user: { id: "EVENT", userName: "Event", displayName: "Event" },
			channels: await this.adapter.getAllChannels(),
			users: await this.adapter.getAllUsers(),
		});

		// 发送响应
		if (response) {
			if (platformContext.finalizeResponse) {
				await platformContext.finalizeResponse(response);
			} else {
				await platformContext.sendText(channelId, response);
			}
		}
	}

	/**
	 * 初始化 MCP 管理器
	 */
	private initMcpManager(configManager?: ConfigManager): McpManager | null {
		try {
			// 从配置中获取 MCP 配置
			let mcpConfig: McpConfig | undefined;
			
			if (configManager) {
				const globalConfig = configManager.getGlobalConfig();
				mcpConfig = globalConfig.mcp;
			}

			// 如果没有配置或禁用了 MCP，返回 null
			if (!mcpConfig || mcpConfig.enabled === false) {
				console.log("[UnifiedBot] MCP is disabled or not configured");
				return null;
			}

			// 如果没有配置服务器，返回 null
			if (!mcpConfig.servers || mcpConfig.servers.length === 0) {
				console.log("[UnifiedBot] MCP servers not configured");
				return null;
			}

			console.log(`[UnifiedBot] Initializing MCP manager with ${mcpConfig.servers.length} servers`);

			// 创建 MCP 管理器
			return createMcpManager({
				servers: mcpConfig.servers,
				clientInfo: {
					name: "pi-claw",
					version: "1.0.0",
				},
			});
		} catch (error) {
			console.error("[UnifiedBot] Failed to initialize MCP manager:", error);
			return null;
		}
	}
}

/**
 * 创建统一机器人（兼容旧 API）
 */
export async function createUnifiedBot(config: UnifiedBotConfig): Promise<UnifiedBot> {
	return new UnifiedBot(config);
}
