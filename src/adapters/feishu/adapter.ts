/**
 * Feishu Adapter
 *
 * 飞书平台适配器 - 实现 PlatformAdapter 接口
 * 复用 @larksuiteoapi/feishu-openclaw-plugin 的核心功能
 */

import {
	sendTextLark,
	sendCardLark,
	sendImageLark,
	updateCardFeishu,
	probeFeishu,
} from "@larksuiteoapi/feishu-openclaw-plugin";
import type {
	PlatformAdapter,
	PlatformConfig,
	UniversalMessage,
	UniversalResponse,
	UserInfo,
	ChannelInfo,
} from "../../core/platform/adapter.js";
import type { PlatformContext } from "../../core/platform/context.js";
import { FeishuPlatformContext } from "./context.js";
import type { FeishuAdapterConfig, MentionInfo } from "./types.js";
import type { Logger } from "../../utils/logger/types.js";

// ============================================================================
// Feishu Adapter
// ============================================================================

/**
 * 飞书平台适配器
 *
 * 实现 PlatformAdapter 接口，将飞书消息转换为 UniversalMessage
 */
export class FeishuAdapter implements PlatformAdapter {
	readonly platform = "feishu" as const;

	private config: FeishuAdapterConfig;
	private logger?: Logger;
	private messageHandlers: Array<(message: UniversalMessage) => void> = [];
	private runningChannels = new Map<string, { abort: () => void }>();
	private defaultModel: string | undefined;
	private botOpenId: string | null = null;

	constructor(config: FeishuAdapterConfig) {
		this.config = config;
		this.logger = config.logger;
		this.defaultModel = config.defaultModel;
	}

	// ========================================================================
	// PlatformAdapter Implementation
	// ========================================================================

	async initialize(config: PlatformConfig): Promise<void> {
		// 合并配置
		this.config = {
			...this.config,
			...config,
		} as FeishuAdapterConfig;

		this.logger?.info("FeishuAdapter initialized", {
			appId: this.config.appId ? "***" : "(not set)",
			brand: this.config.brand || "feishu",
		});
	}

	async start(): Promise<void> {
		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("Feishu appId and appSecret are required");
		}

		this.logger?.info("Starting FeishuAdapter...");

		// 探测连接获取 bot open_id
		const cfg = this.buildPluginConfig();
		const probeResult = await probeFeishu(cfg);
		if (!probeResult.ok) {
			throw new Error(`Feishu connection probe failed: ${probeResult.error}`);
		}

		this.botOpenId = probeResult.botOpenId || null;

		this.logger?.info("FeishuAdapter connected", {
			botName: probeResult.botName,
			botOpenId: this.botOpenId ? "***" : "(not set)",
		});

		// 注意：WebSocket 监听由 feishu-openclaw-plugin 的 monitorFeishuProvider 负责
		// 这里我们只做初始化，实际的消息监听在 UnifiedBot 层处理
	}

	async stop(): Promise<void> {
		this.logger?.info("Stopping FeishuAdapter...");
		// 清理运行中的频道
		for (const [channelId, { abort }] of this.runningChannels) {
			abort();
			this.runningChannels.delete(channelId);
		}
		this.logger?.info("FeishuAdapter stopped");
	}

	async sendMessage(response: UniversalResponse): Promise<void> {
		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("FeishuAdapter not initialized");
		}

		const cfg = this.buildPluginConfig();
		const to = response.messageId || "";

		if (response.type === "text") {
			await sendTextLark({
				cfg,
				to,
				text: response.content as string,
			});
		} else if (response.type === "card") {
			await sendCardLark({
				cfg,
				to,
				card: response.content as unknown as Record<string, unknown>,
			});
		} else if (response.type === "image" && response.imageKey) {
			await sendImageLark({
				cfg,
				to,
				imageKey: response.imageKey,
			});
		} else {
			throw new Error(`Unsupported response type: ${response.type}`);
		}
	}

	/**
	 * 发送消息到指定聊天
	 */
	async sendMessageToChat(chatId: string, response: UniversalResponse): Promise<string> {
		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("FeishuAdapter not initialized");
		}

		const cfg = this.buildPluginConfig();

		if (response.type === "text") {
			const result = await sendTextLark({
				cfg,
				to: chatId,
				text: response.content as string,
			});
			return result.messageId;
		} else if (response.type === "card") {
			const result = await sendCardLark({
				cfg,
				to: chatId,
				card: response.content as unknown as Record<string, unknown>,
			});
			return result.messageId;
		} else if (response.type === "image" && response.imageKey) {
			const result = await sendImageLark({
				cfg,
				to: chatId,
				imageKey: response.imageKey,
			});
			return result.messageId;
		} else {
			throw new Error(`Unsupported response type: ${response.type}`);
		}
	}

	async updateMessage(
		messageId: string,
		response: UniversalResponse
	): Promise<void> {
		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("FeishuAdapter not initialized");
		}

		if (response.type === "card") {
			const cfg = this.buildPluginConfig();
			await updateCardFeishu({
				cfg,
				messageId,
				card: response.content as unknown as Record<string, unknown>,
			});
		} else {
			throw new Error(`Cannot update message of type: ${response.type}`);
		}
	}

	async deleteMessage(messageId: string): Promise<void> {
		// 飞书不支持删除消息，只能撤回
		this.logger?.warn(`Delete message not supported in Feishu: ${messageId}`);
	}

	async uploadFile(filePath: string): Promise<string> {
		// TODO: 实现
		throw new Error("uploadFile not implemented yet");
	}

	async uploadImage(imagePath: string): Promise<string> {
		// TODO: 实现
		throw new Error("uploadImage not implemented yet");
	}

	async getUserInfo(userId: string): Promise<UserInfo | undefined> {
		// TODO: 通过 API 获取用户信息
		return {
			id: userId,
			userName: userId,
			displayName: userId,
		};
	}

	async getAllUsers(): Promise<UserInfo[]> {
		// 飞书不支持批量获取用户
		return [];
	}

	async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
		return {
			id: channelId,
			name: channelId,
		};
	}

	async getAllChannels(): Promise<ChannelInfo[]> {
		// 飞书不支持批量获取频道
		return [];
	}

	onMessage(handler: (message: UniversalMessage) => void): void {
		this.messageHandlers.push(handler);
	}

	/**
	 * 处理飞书消息事件
	 *
	 * 由外部调用者（如 monitorFeishuProvider）调用
	 */
	async handleFeishuMessage(event: unknown, botOpenId: string): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const evt = event as any;
		if (!evt?.message) {
			return;
		}

		// 动态导入 parseMessageEvent 和 mentionedBot
		const { parseMessageEvent, mentionedBot } = await import("@larksuiteoapi/feishu-openclaw-plugin");

		// 解析消息事件
		const messageContext = await parseMessageEvent(evt, botOpenId);

		// 检查是否提及了机器人
		const isMentioned = mentionedBot(messageContext);
		if (!isMentioned && messageContext.chatType !== "p2p") {
			// 群聊中未提及机器人，忽略
			return;
		}

		// 转换为 UniversalMessage
		const universalMessage: UniversalMessage = {
			id: messageContext.messageId,
			platform: "feishu",
			type: this.convertMessageType(messageContext.contentType),
			content: messageContext.content,
			sender: {
				id: messageContext.senderId,
				name: messageContext.senderId,
			},
			chat: {
				id: messageContext.chatId,
				type: this.convertChatType(messageContext.chatType),
			},
			timestamp: messageContext.createTime
				? new Date(messageContext.createTime)
				: new Date(),
			mentions: messageContext.mentions
				.filter((m: MentionInfo) => !m.isBot)
				.map((m: MentionInfo) => m.openId),
		};

		// 触发消息处理器
		for (const handler of this.messageHandlers) {
			try {
				handler(universalMessage);
			} catch (error) {
				this.logger?.error(
					"Message handler error",
					undefined,
					error as Error
				);
			}
		}
	}

	createPlatformContext(chatId: string): PlatformContext {
		return new FeishuPlatformContext(chatId, this);
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
	// Feishu-specific Methods
	// ========================================================================

	/**
	 * 发送卡片消息
	 */
	async sendCard(
		chatId: string,
		card: Record<string, unknown>
	): Promise<{ messageId: string }> {
		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("FeishuAdapter not initialized");
		}

		const cfg = this.buildPluginConfig();
		const result = await sendCardLark({
			cfg,
			to: chatId,
			card,
		});
		return { messageId: result.messageId };
	}

	/**
	 * 更新卡片消息
	 */
	async updateCard(
		messageId: string,
		card: Record<string, unknown>
	): Promise<void> {
		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("FeishuAdapter not initialized");
		}

		const cfg = this.buildPluginConfig();
		await updateCardFeishu({ cfg, messageId, card });
	}

	/**
	 * 发送文本消息
	 */
	async sendText(chatId: string, text: string): Promise<{ messageId: string }> {
		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("FeishuAdapter not initialized");
		}

		const cfg = this.buildPluginConfig();
		const result = await sendTextLark({
			cfg,
			to: chatId,
			text,
		});
		return { messageId: result.messageId };
	}

	/**
	 * 获取配置
	 */
	getConfig(): FeishuAdapterConfig {
		return this.config;
	}

	/**
	 * 获取 Bot Open ID
	 */
	getBotOpenId(): string | null {
		return this.botOpenId;
	}

	/**
	 * 构建插件配置
	 */
	private buildPluginConfig(): Record<string, unknown> {
		return {
			feishu: {
				accounts: {
					default: {
						app_id: this.config.appId,
						app_secret: this.config.appSecret,
						encrypt_key: this.config.encryptKey,
						verification_token: this.config.verificationToken,
						brand: this.config.brand || "feishu",
					},
				},
			},
		};
	}

	/**
	 * 转换消息类型
	 */
	private convertMessageType(contentType: string): UniversalMessage["type"] {
		switch (contentType) {
			case "text":
				return "text";
			case "image":
				return "image";
			case "audio":
				return "audio";
			case "video":
				return "video";
			case "file":
			case "media":
				return "file";
			default:
				return "text";
		}
	}

	/**
	 * 转换聊天类型
	 */
	private convertChatType(
		chatType: string
	): UniversalMessage["chat"]["type"] {
		switch (chatType) {
			case "p2p":
				return "private";
			case "group":
			case "topic_group":
				return "group";
			default:
				return "private";
		}
	}
}
