/**
 * Feishu Adapter
 *
 * 飞书平台适配器 - 实现 PlatformAdapter 接口
 */

import type {
	PlatformAdapter,
	PlatformConfig,
	UniversalMessage,
	UniversalResponse,
	UserInfo,
	ChannelInfo,
} from "../../core/platform/adapter.js";
import type { PlatformContext } from "../../core/platform/context.js";
import { LarkClient } from "./client/index.js";
import { FeishuPlatformContext } from "./context.js";
import { FeishuStore } from "./store.js";
import { MessageHandler } from "./messaging/inbound/handler.js";
import { MessageSender } from "./messaging/outbound/sender.js";
import { ChannelQueue } from "./queue/channel-queue.js";
import type { FeishuAdapterConfig, FeishuMessageContext, BotIdentity } from "./types.js";
import { PiLogger } from "../../utils/logger/index.js";

// ============================================================================
// Feishu Adapter
// ============================================================================

/**
 * 飞书平台适配器
 *
 * 实现 PlatformAdapter 接口，将飞书事件转换为 UniversalMessage
 */
export class FeishuAdapter implements PlatformAdapter {
	readonly platform = "feishu" as const;

	private config: FeishuAdapterConfig;
	private logger: PiLogger;
	private larkClient: LarkClient | null = null;
	private store: FeishuStore | null = null;
	private messageHandler: MessageHandler | null = null;
	private messageSender: MessageSender | null = null;
	private channelQueue: ChannelQueue | null = null;
	private botIdentity: BotIdentity | null = null;

	private messageHandlers: Array<(message: UniversalMessage) => void> = [];
	private runningChannels = new Map<string, { abort: () => void }>();
	private defaultModel: string | undefined;
	private workspaceDir: string = "";

	/** 预热频道列表 */
	private warmupChannels: string[] = [];

	/** PlatformContext 缓存，用于复用卡片状态 */
	private contextCache: Map<string, FeishuPlatformContext> = new Map();

	constructor(config: FeishuAdapterConfig) {
		this.config = config;
		this.logger = new PiLogger("feishu", {
			enabled: true,
			level: "debug",
			console: true,
		});
		this.defaultModel = config.defaultModel;
	}

	// ========================================================================
	// PlatformAdapter Implementation
	// ========================================================================

	async initialize(config: PlatformConfig): Promise<void> {
		this.logger.info("Initializing FeishuAdapter", { appId: this.config.appId });

		// 创建 LarkClient
		this.larkClient = new LarkClient({
			appId: this.config.appId,
			appSecret: this.config.appSecret,
			domain: this.config.domain || "feishu",
			connectionMode: this.config.connectionMode || "websocket",
			logger: this.logger,
		});

		// 获取 Bot 身份
		this.botIdentity = await this.larkClient.getBotIdentity();
		this.logger.info("Bot identity retrieved", {
			openId: this.botIdentity.openId,
			name: this.botIdentity.name,
		});

		// 创建 Store
		this.store = new FeishuStore({
			larkClient: this.larkClient,
			workspaceDir: this.workspaceDir,
		});

		// 创建消息发送器
		this.messageSender = new MessageSender({
			larkClient: this.larkClient,
			logger: this.logger,
		});

		// 创建消息处理器
		this.messageHandler = new MessageHandler({
			larkClient: this.larkClient,
			store: this.store,
			config: this.config,
			logger: this.logger,
		});

		// 创建频道队列
		this.channelQueue = new ChannelQueue({
			logger: this.logger,
		});

		this.logger.info("FeishuAdapter initialized");
	}

	async start(): Promise<void> {
		if (!this.larkClient) {
			throw new Error("FeishuAdapter not initialized");
		}

		this.logger.info("Starting FeishuAdapter...");

		// 启动 WebSocket
		await this.larkClient.startWS({
			onMessage: async (event) => {
				await this.handleWSEvent(event);
			},
			onConnect: () => {
				this.logger.info("WebSocket connected");
			},
			onDisconnect: () => {
				this.logger.warn("WebSocket disconnected");
			},
			onError: (error) => {
				this.logger.error("WebSocket error", undefined, error);
			},
		});

		this.logger.info("FeishuAdapter started");
	}

	/**
	 * 设置预热频道列表
	 * @param channels 频道 ID 列表
	 */
	setWarmupChannels(channels: string[]): void {
		this.warmupChannels = channels;
	}

	/**
	 * 获取活跃频道列表
	 * 用于预热，子类可以覆盖此方法
	 */
	getActiveChannels(): string[] {
		return this.warmupChannels;
	}

	/**
	 * 预热指定频道
	 * @param coreAgent CoreAgent 实例
	 * @param channels 频道列表（可选，默认使用 warmupChannels）
	 */
	async warmupChannelsAsync(coreAgent: any, channels?: string[]): Promise<void> {
		const targetChannels = channels || this.warmupChannels;
		if (targetChannels.length === 0) {
			this.logger.debug("No channels to warmup");
			return;
		}

		this.logger.info(`Warming up ${targetChannels.length} channels...`);

		for (const channelId of targetChannels) {
			try {
				const platformContext = this.createPlatformContext(channelId);
				await coreAgent.warmup(channelId, platformContext);
				this.logger.debug(`Warmed up channel: ${channelId}`);
			} catch (error) {
				this.logger.error(`Failed to warmup channel ${channelId}`, undefined, error as Error);
			}
		}

		this.logger.info("Channel warmup completed");
	}

	async stop(): Promise<void> {
		this.logger.info("Stopping FeishuAdapter...");

		if (this.larkClient) {
			this.larkClient.disconnect();
		}

		if (this.channelQueue) {
			this.channelQueue.clear();
		}

		this.runningChannels.clear();
		this.contextCache.clear();
		this.logger.info("FeishuAdapter stopped");
	}

	async sendMessage(response: UniversalResponse): Promise<void> {
		if (!this.messageSender) {
			throw new Error("FeishuAdapter not initialized");
		}

		await this.messageSender.send(response);
	}

	async updateMessage(messageId: string, response: UniversalResponse): Promise<void> {
		if (!this.messageSender) {
			throw new Error("FeishuAdapter not initialized");
		}

		await this.messageSender.update(messageId, response);
	}

	async deleteMessage(messageId: string): Promise<void> {
		if (!this.larkClient) {
			throw new Error("FeishuAdapter not initialized");
		}

		await this.larkClient.deleteMessage(messageId);
	}

	async uploadFile(filePath: string): Promise<string> {
		if (!this.larkClient) {
			throw new Error("FeishuAdapter not initialized");
		}

		return await this.larkClient.uploadFile(filePath);
	}

	async uploadImage(imagePath: string): Promise<string> {
		if (!this.larkClient) {
			throw new Error("FeishuAdapter not initialized");
		}

		return await this.larkClient.uploadImage(imagePath);
	}

	async getUserInfo(userId: string): Promise<UserInfo | undefined> {
		if (!this.larkClient) {
			throw new Error("FeishuAdapter not initialized");
		}

		const userInfo = await this.larkClient.getUserInfo(userId);
		if (!userInfo) {
			return undefined;
		}

		return {
			id: userInfo.open_id,
			userName: userInfo.name || userInfo.nickname || userInfo.open_id,
			displayName: userInfo.nickname || userInfo.name || userInfo.open_id,
			avatar: userInfo.avatar_url,
		};
	}

	async getAllUsers(): Promise<UserInfo[]> {
		// 飞书不支持获取所有用户，返回空列表
		return [];
	}

	async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
		if (!this.larkClient) {
			throw new Error("FeishuAdapter not initialized");
		}

		const chatInfo = await this.larkClient.getChatInfo(channelId);
		if (!chatInfo) {
			return undefined;
		}

		return {
			id: chatInfo.chat_id,
			name: chatInfo.name || channelId,
		};
	}

	async getAllChannels(): Promise<ChannelInfo[]> {
		// 飞书不支持获取所有频道，返回空列表
		return [];
	}

	onMessage(handler: (message: UniversalMessage) => void): void {
		this.messageHandlers.push(handler);
	}

	createPlatformContext(chatId: string): PlatformContext {
		if (!this.larkClient || !this.messageSender) {
			throw new Error("FeishuAdapter not initialized");
		}

		// 尝试从缓存获取
		let context = this.contextCache.get(chatId);

		if (!context) {
			// 创建新实例并缓存
			context = new FeishuPlatformContext({
				chatId,
				larkClient: this.larkClient,
				messageSender: this.messageSender,
				store: this.store!,
				logger: this.logger,
			});
			this.contextCache.set(chatId, context);
		}

		return context;
	}

	/**
	 * 清理 context 缓存
	 * @param chatId 可选，指定清理的 chatId，不传则清理全部
	 */
	clearContextCache(chatId?: string): void {
		if (chatId) {
			this.contextCache.delete(chatId);
		} else {
			this.contextCache.clear();
		}
	}

	isRunning(channelId: string): boolean {
		return this.runningChannels.has(channelId);
	}

	setRunning(channelId: string, abort: () => void): void {
		this.runningChannels.set(channelId, { abort });
	}

	clearRunning(channelId: string): void {
		this.runningChannels.delete(channelId);
	}

	abortChannel(channelId: string): void {
		const running = this.runningChannels.get(channelId);
		if (running) {
			running.abort();
			this.runningChannels.delete(channelId);
		}
	}

	getDefaultModel(): string | undefined {
		return this.defaultModel;
	}

	// ========================================================================
	// Internal Methods
	// ========================================================================

	/**
	 * 设置工作目录
	 */
	setWorkspaceDir(dir: string): void {
		this.workspaceDir = dir;
	}

	/**
	 * 获取 Store
	 */
	getStore(): FeishuStore | null {
		return this.store;
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	private async handleWSEvent(event: any): Promise<void> {
		if (!this.messageHandler || !this.channelQueue) {
			return;
		}

		try {
			// 解析事件
			const context = await this.messageHandler.parse(event);
			if (!context) {
				return;
			}

			// 检查策略门控
			const gateResult = await this.messageHandler.checkGate(context);
			if (!gateResult.allowed) {
				this.logger.debug("Message blocked by gate", {
					messageId: context.messageId,
					reason: gateResult.reason,
				});
				return;
			}

			// 转换为 UniversalMessage
			const universalMessage = await this.messageHandler.toUniversalMessage(context);

			// 入队处理
			const queueKey = `${context.chatId}:${context.rootId || ""}`;
			await this.channelQueue.enqueue(queueKey, async () => {
				// 触发消息处理器
				for (const handler of this.messageHandlers) {
					try {
						await handler(universalMessage);
					} catch (error) {
						this.logger.error("Message handler error", undefined, error as Error);
					}
				}
			});
		} catch (error) {
			this.logger.error("Error handling WebSocket event", undefined, error as Error);
		}
	}
}
