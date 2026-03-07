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

	constructor(config: UnifiedBotConfig) {
		this.workingDir = config.workingDir;
		this.store = config.store;
		this.pluginManager = config.pluginManager;
		this.adapter = config.adapter;

		// 获取 ConfigManager 单例
		let configManager: ConfigManager | undefined;
		try {
			configManager = ConfigManager.getInstance();
		} catch {
			// ConfigManager 未初始化，使用旧模式
		}

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
			onEvent: async (channelId, text) => {
				await this.handleScheduledEvent(channelId, text);
			},
		});

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

		// 启动事件监控（已在构造函数中创建）
		if (this.eventsWatcher) {
			this.eventsWatcher.start();
		}

		console.log(`[UnifiedBot] Started on ${this.adapter.platform} platform`);
	}

	async stop(): Promise<void> {
		// 停止事件监控
		if (this.eventsWatcher) {
			this.eventsWatcher.stop();
			this.eventsWatcher = null;
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
			// 使用 finishStatus 更新状态卡片为最终响应
			const feishuContext = platformContext as any;
			if (feishuContext.finishStatus) {
				await feishuContext.finishStatus(response);
			} else {
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
	private async handleScheduledEvent(channelId: string, text: string): Promise<void> {
		// 创建平台上下文
		const platformContext = this.adapter.createPlatformContext(channelId);

		// 发送事件消息
		await platformContext.sendText(channelId, text);
	}
}

/**
 * 创建统一机器人（兼容旧 API）
 */
export async function createUnifiedBot(config: UnifiedBotConfig): Promise<UnifiedBot> {
	return new UnifiedBot(config);
}
