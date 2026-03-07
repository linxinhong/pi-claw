/**
 * Unified Bot - 统一机器人入口
 *
 * 基于新架构的机器人实现，使用 PlatformAdapter 和 CoreAgent
 * 不再硬编码平台选择，通过 Adapter Factory 创建
 */

import type { PlatformAdapter } from "./platform/adapter.js";
import type { PluginManager } from "./plugin/manager.js";
import type { PlatformStore } from "./store/types.js";
import { CoreAgent, createCoreAgent } from "./agent/index.js";
import { ModelManager } from "./model/index.js";
import { createExecutor } from "./sandbox/index.js";
import { EventsWatcher } from "./services/event/index.js";
import { getHookManager, HOOK_NAMES } from "./hook/index.js";
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

		// 创建模型管理器
		this.modelManager = new ModelManager();

		// 创建核心 Agent
		this.coreAgent = createCoreAgent({
			modelManager: this.modelManager,
			executor: createExecutor({ type: "host" }),
			workspaceDir: config.workingDir,
			eventBus: null, // 可以传入 EventBus
		});

		// 订阅适配器消息
		this.adapter.onMessage(async (message) => {
			await this.handleMessage(message);
		});
	}

	async start(port?: number): Promise<void> {
		await this.adapter.start();

		// 启动事件监控
		const eventsDir = join(this.workingDir, "events");
		this.eventsWatcher = new EventsWatcher({
			eventsDir,
			onEvent: async (channelId, text) => {
				await this.handleScheduledEvent(channelId, text);
			},
		});
		this.eventsWatcher.start();

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
			await platformContext.sendText(message.chat.id, response);
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
