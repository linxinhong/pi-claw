/**
 * Message Handler
 *
 * 入站消息处理入口
 */

import type { UniversalMessage, Attachment } from "../../../../core/platform/message.js";
import type { FeishuMessageContext, FeishuAdapterConfig, FeishuMessageEvent, FeishuRawMessage, FeishuUserInfo } from "../../types.js";
import type { LarkClient } from "../../client/index.js";
import type { FeishuStore } from "../../store.js";
import type { PiLogger } from "../../../../utils/logger/index.js";
import { MessageParser } from "./parser.js";
import { MessageGate, GateResult } from "./gate.js";
import { convertTextMessage } from "./converters/text.js";
import { convertImageMessage } from "./converters/image.js";
import { convertFileMessage } from "./converters/file.js";
import { convertPostMessage } from "./converters/post.js";

// ============================================================================
// Types
// ============================================================================

export interface MessageHandlerOptions {
	larkClient: LarkClient;
	store: FeishuStore;
	config: FeishuAdapterConfig;
	logger?: PiLogger;
}

/**
 * 用户信息缓存条目
 */
interface UserInfoCacheEntry {
	info: Partial<FeishuUserInfo>;
	expiresAt: number;
}

// 用户信息缓存 TTL（10 分钟）
const USER_INFO_CACHE_TTL = 10 * 60 * 1000;

// ============================================================================
// Message Handler
// ============================================================================

/**
 * 入站消息处理器
 */
export class MessageHandler {
	private larkClient: LarkClient;
	private store: FeishuStore;
	private config: FeishuAdapterConfig;
	private logger?: PiLogger;
	private parser: MessageParser;
	private gate: MessageGate;

	/** 用户信息缓存 */
	private userInfoCache = new Map<string, UserInfoCacheEntry>();

	constructor(options: MessageHandlerOptions) {
		this.larkClient = options.larkClient;
		this.store = options.store;
		this.config = options.config;
		this.logger = options.logger;

		this.parser = new MessageParser({
			logger: this.logger,
		});

		this.gate = new MessageGate({
			config: this.config,
			logger: this.logger,
		});
	}

	/**
	 * 设置 Bot 身份
	 */
	setBotIdentity(openId: string, name: string): void {
		this.parser.setBotIdentity({ openId, name });
	}

	/**
	 * 解析事件
	 */
	async parse(event: FeishuMessageEvent): Promise<FeishuMessageContext | null> {
		return this.parser.parse(event);
	}

	/**
	 * 检查策略门控
	 */
	async checkGate(context: FeishuMessageContext): Promise<GateResult> {
		return this.gate.check(context);
	}

	/**
	 * 转换为 UniversalMessage
	 */
	async toUniversalMessage(context: FeishuMessageContext): Promise<UniversalMessage> {
		// 获取发送者信息
		const senderInfo = await this.getSenderInfo(context);

		// 解析消息内容
		const { content, attachments } = await this.parseContent(context);

		// 缓存 mention 信息（用于 @ 功能）
		if (context.mentions) {
			for (const mention of context.mentions) {
				if (mention.open_id) {
					// 获取真实用户名（替换 _user_5 这样的占位符）
					let realName = mention.name;
					if (!realName || realName.startsWith("_user_")) {
						const userName = await this.larkClient.getUserName(mention.open_id);
						if (userName) {
							realName = userName;
							mention.name = userName; // 更新 mention 的 name
						}
					}
					if (realName) {
						this.larkClient.addUserToCache(context.chatId, realName, mention.open_id);
					}
				}
			}
		}

		// 提取提及的用户 ID
		const mentions = context.mentions?.map((m) => m.open_id || m.user_id || "").filter(Boolean);

		const message: UniversalMessage = {
			id: context.messageId,
			platform: "feishu",
			type: this.getMessageType(context.messageType),
			content,
			sender: {
				id: context.sender.openId,
				name: senderInfo.name || context.sender.openId,
				displayName: senderInfo.nickname || senderInfo.name,
				avatar: senderInfo.avatar_url,
			},
			chat: {
				id: context.chatId,
				type: context.chatType === "p2p" ? "private" : "group",
				name: undefined,
			},
			attachments,
			timestamp: context.timestamp,
			mentions,
		};

		return message;
	}

	/**
	 * 获取发送者信息（带缓存）
	 */
	private async getSenderInfo(context: FeishuMessageContext): Promise<{ name?: string; nickname?: string; avatar_url?: string }> {
		const cacheKey = context.sender.openId;
		const now = Date.now();

		// 检查缓存
		const cached = this.userInfoCache.get(cacheKey);
		if (cached && cached.expiresAt > now) {
			this.logger?.debug("User info cache hit", { openId: cacheKey });
			return cached.info;
		}

		try {
			const userInfo = await this.larkClient.getUserInfo(context.sender.openId);
			if (userInfo) {
				// 存入缓存
				this.userInfoCache.set(cacheKey, {
					info: userInfo,
					expiresAt: now + USER_INFO_CACHE_TTL,
				});
			}
			return userInfo || {};
		} catch {
			return {};
		}
	}

	/**
	 * 解析消息内容
	 */
	private async parseContent(context: FeishuMessageContext): Promise<{ content: string; attachments?: Attachment[] }> {
		const messageType = context.messageType;

		switch (messageType) {
			case "text":
				return convertTextMessage(context.content);

			case "post":
				return convertPostMessage(context.content);

			case "image":
				return await convertImageMessage(context.content, context, this.store);

			case "file":
			case "media":
				return await convertFileMessage(context.content, context, this.store);

			default:
				// 尝试作为文本处理
				return convertTextMessage(context.content);
		}
	}

	/**
	 * 获取消息类型
	 */
	private getMessageType(msgType: string): "text" | "image" | "file" | "audio" | "video" {
		switch (msgType) {
			case "text":
				return "text";
			case "image":
				return "image";
			case "file":
			case "media":
				return "file";
			case "audio":
				return "audio";
			case "video":
				return "video";
			default:
				return "text";
		}
	}
}
