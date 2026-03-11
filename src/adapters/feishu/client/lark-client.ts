/**
 * Lark Client - 飞书 SDK 封装
 *
 * 封装 @larksuiteoapi/node-sdk，提供统一的客户端管理
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig, BotIdentity, FeishuUserInfo, FeishuChatInfo, FeishuSendResult } from "../types.js";
import { MessageDedup } from "./message-dedup.js";
import { PiLogger } from "../../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

export interface LarkClientConfig extends FeishuConfig {
	/** 日志器 */
	logger?: PiLogger;
}

export interface WebSocketOptions {
	/** 事件处理器 */
	onMessage?: (event: any) => void;
	/** 连接状态变更 */
	onConnect?: () => void;
	/** 断开连接 */
	onDisconnect?: () => void;
	/** 错误处理 */
	onError?: (error: Error) => void;
}

// ============================================================================
// Lark Client
// ============================================================================

/**
 * 飞书 SDK 客户端封装
 */
export class LarkClient {
	private client: Lark.Client;
	private wsClient?: Lark.WSClient;
	private config: LarkClientConfig;
	private logger?: PiLogger;
	private botIdentity: BotIdentity | null = null;
	private messageDedup: MessageDedup;
	private wsConnected = false;
	private wsListeners: Map<string, Set<Function>> = new Map();
	private domain: Lark.Domain;

	constructor(config: LarkClientConfig) {
		this.config = config;
		this.logger = config.logger;

		// 确定域名
		const domainStr = config.domain || "feishu";
		this.domain = domainStr === "feishu" ? Lark.Domain.Feishu : domainStr === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;

		// 创建 SDK 客户端
		this.client = new Lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
			appType: Lark.AppType.SelfBuild,
			domain: this.domain,
		});

		// 创建消息去重器
		this.messageDedup = new MessageDedup({
			maxSize: 10000,
			ttl: 60000, // 1 分钟
		});

		this.logger?.debug("LarkClient created", { appId: config.appId, domain: domainStr });
	}

	// ========================================================================
	// Lifecycle
	// ========================================================================

	/**
	 * 启动 WebSocket 连接
	 */
	async startWS(options: WebSocketOptions = {}): Promise<void> {
		this.logger?.info("Starting WebSocket connection...");

		// 注册事件处理器
		if (options.onMessage) {
			this.on("message", options.onMessage);
		}
		if (options.onConnect) {
			this.on("connect", options.onConnect);
		}
		if (options.onDisconnect) {
			this.on("disconnect", options.onDisconnect);
		}
		if (options.onError) {
			this.on("error", options.onError);
		}

		try {
			// 创建 EventDispatcher 并注册事件处理器
			const eventDispatcher = new Lark.EventDispatcher({}).register({
				"im.message.receive_v1": async (data) => {
					this.logger?.debug("Received message event", data);
					await this.handleReceivedEvent(data);
				},
			});

			// 创建 WSClient 实例
			this.wsClient = new Lark.WSClient({
				appId: this.config.appId,
				appSecret: this.config.appSecret,
				domain: this.domain,
				loggerLevel: Lark.LoggerLevel.info,
			});

			// 启动真正的 WebSocket 连接
			await this.wsClient.start({
				eventDispatcher: eventDispatcher,
			});

			this.wsConnected = true;
			this.emit("connect");
			this.logger?.info("WebSocket connected");
		} catch (error) {
			this.logger?.error("Failed to start WebSocket", undefined, error as Error);
			this.emit("error", error as Error);
			throw error;
		}
	}

	/**
	 * 断开 WebSocket 连接（保留缓存）
	 */
	disconnect(): void {
		if (this.wsConnected) {
			this.wsClient?.close();
			this.wsConnected = false;
			this.emit("disconnect");
			this.logger?.info("WebSocket disconnected");
		}
	}

	/**
	 * 销毁客户端（断开并清理缓存）
	 */
	dispose(): void {
		this.disconnect();
		this.messageDedup.clear();
		this.wsListeners.clear();
		this.logger?.debug("LarkClient disposed");
	}

	// ========================================================================
	// Event Handling
	// ========================================================================

	private on(event: string, handler: Function): void {
		if (!this.wsListeners.has(event)) {
			this.wsListeners.set(event, new Set());
		}
		this.wsListeners.get(event)!.add(handler);
	}

	private emit(event: string, ...args: any[]): void {
		const handlers = this.wsListeners.get(event);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(...args);
				} catch (error) {
					this.logger?.error(`Event handler error for ${event}`, undefined, error as Error);
				}
			}
		}
	}

	/**
	 * 处理接收到的消息事件
	 */
	async handleReceivedEvent(event: any): Promise<void> {
		try {
			// 检查消息去重
			const messageId = event?.event?.message?.message_id || event?.message?.message_id;
			if (messageId && this.messageDedup.has(messageId)) {
				this.logger?.debug("Duplicate message ignored", { messageId });
				return;
			}

			// 标记已处理
			if (messageId) {
				this.messageDedup.add(messageId);
			}

			// 发送事件
			this.emit("message", event);
		} catch (error) {
			this.logger?.error("Error handling WebSocket event", undefined, error as Error);
		}
	}

	// ========================================================================
	// Bot Identity
	// ========================================================================

	/**
	 * 获取 Bot 身份信息
	 *
	 * 注意：SDK 没有直接的 botInfo API，这里使用 appId 作为标识
	 */
	async getBotIdentity(): Promise<BotIdentity> {
		if (this.botIdentity) {
			return this.botIdentity;
		}

		// 使用 appId 作为 Bot 标识
		// 实际的 Bot Open ID 需要通过其他方式获取
		this.botIdentity = {
			openId: `bot_${this.config.appId}`,
			userId: this.config.appId,
			name: "Bot",
		};

		this.logger?.info("Bot identity set", { openId: this.botIdentity.openId });
		return this.botIdentity;
	}

	// ========================================================================
	// Message Operations
	// ========================================================================

	/**
	 * 发送文本消息
	 * @param receiveId 接收者 ID
	 * @param text 文本内容
	 * @param quoteMessageId 可选的引用消息 ID，用于引用回复原消息
	 */
	async sendText(receiveId: string, text: string, quoteMessageId?: string): Promise<FeishuSendResult> {
		this.logger?.debug("Sending text message", { receiveId, textLength: text.length, quoteMessageId });

		// 如果有引用消息 ID，使用 reply API 实现引用功能
		if (quoteMessageId) {
			return this.replyText(quoteMessageId, text);
		}

		const response = await this.client.im.v1.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: receiveId,
				msg_type: "text",
				content: JSON.stringify({ text }),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to send message: [${response.code}] ${response.msg}`);
		}

		const messageId = response.data?.message_id;
		if (!messageId) {
			throw new Error("sendText succeeded but no message_id returned");
		}

		return { message_id: messageId };
	}

	/**
	 * 回复文本消息（实现引用功能）
	 * @param messageId 要回复的消息 ID
	 * @param text 文本内容
	 * @param replyInThread 是否在话题中回复
	 */
	async replyText(messageId: string, text: string, replyInThread?: boolean): Promise<FeishuSendResult> {
		this.logger?.debug("Replying text message", { messageId, textLength: text.length, replyInThread });

		const response = await this.client.im.v1.message.reply({
			path: {
				message_id: messageId,
			},
			data: {
				content: JSON.stringify({ text }),
				msg_type: "text",
				reply_in_thread: replyInThread ?? false,
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to reply message: [${response.code}] ${response.msg}`);
		}

		const replyMessageId = response.data?.message_id;
		if (!replyMessageId) {
			throw new Error("replyText succeeded but no message_id returned");
		}

		return { message_id: replyMessageId };
	}

	/**
	 * 发送卡片消息
	 * @param receiveId 接收者 ID
	 * @param card 卡片内容
	 * @param quoteMessageId 可选的引用消息 ID，用于引用回复原消息
	 */
	async sendCard(receiveId: string, card: any, quoteMessageId?: string): Promise<FeishuSendResult> {
		this.logger?.debug("Sending card message", { receiveId, quoteMessageId });

		// 如果有引用消息 ID，使用 reply API 实现引用功能
		if (quoteMessageId) {
			return this.replyCard(quoteMessageId, card);
		}

		const response = await this.client.im.v1.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: receiveId,
				msg_type: "interactive",
				content: JSON.stringify(card),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to send card: [${response.code}] ${response.msg}`);
		}

		const messageId = response.data?.message_id;
		if (!messageId) {
			throw new Error("sendCard succeeded but no message_id returned");
		}

		return { message_id: messageId };
	}

	/**
	 * 回复卡片消息（实现引用功能）
	 * @param messageId 要回复的消息 ID
	 * @param card 卡片内容
	 * @param replyInThread 是否在话题中回复
	 */
	async replyCard(messageId: string, card: any, replyInThread?: boolean): Promise<FeishuSendResult> {
		this.logger?.debug("Replying card message", { messageId, replyInThread });

		const response = await this.client.im.v1.message.reply({
			path: {
				message_id: messageId,
			},
			data: {
				content: JSON.stringify(card),
				msg_type: "interactive",
				reply_in_thread: replyInThread ?? false,
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to reply card: [${response.code}] ${response.msg}`);
		}

		const replyMessageId = response.data?.message_id;
		if (!replyMessageId) {
			throw new Error("replyCard succeeded but no message_id returned");
		}

		return { message_id: replyMessageId };
	}

	/**
	 * 更新卡片消息
	 */
	async updateCard(messageId: string, card: any): Promise<void> {
		this.logger?.debug("Updating card message", { messageId });

		const response = await this.client.im.v1.message.patch({
			path: {
				message_id: messageId,
			},
			data: {
				content: JSON.stringify(card),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to update card: [${response.code}] ${response.msg}`);
		}
	}

	/**
	 * 更新文本消息
	 */
	async updateMessage(messageId: string, content: string): Promise<void> {
		this.logger?.debug("Updating message", { messageId });

		const response = await this.client.im.v1.message.patch({
			path: {
				message_id: messageId,
			},
			data: {
				content: JSON.stringify({ text: content }),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to update message: [${response.code}] ${response.msg}`);
		}
	}

	/**
	 * 删除消息
	 */
	async deleteMessage(messageId: string): Promise<void> {
		this.logger?.debug("Deleting message", { messageId });

		const response = await this.client.im.v1.message.delete({
			path: {
				message_id: messageId,
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to delete message: [${response.code}] ${response.msg}`);
		}
	}

	/**
	 * 获取消息内容
	 */
	async getMessage(messageId: string): Promise<any> {
		const response = await this.client.im.v1.message.get({
			path: {
				message_id: messageId,
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to get message: [${response.code}] ${response.msg}`);
		}

		return response.data;
	}

	/**
	 * 发送图片
	 */
	async sendImage(receiveId: string, imageKey: string): Promise<FeishuSendResult> {
		this.logger?.debug("Sending image", { receiveId, imageKey });

		const response = await this.client.im.v1.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: receiveId,
				msg_type: "image",
				content: JSON.stringify({ image_key: imageKey }),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to send image: [${response.code}] ${response.msg}`);
		}

		const messageId = response.data?.message_id;
		if (!messageId) {
			throw new Error("sendImage succeeded but no message_id returned");
		}

		return { message_id: messageId };
	}

	/**
	 * 发送文件
	 */
	async sendFile(receiveId: string, fileKey: string): Promise<FeishuSendResult> {
		this.logger?.debug("Sending file", { receiveId, fileKey });

		const response = await this.client.im.v1.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: receiveId,
				msg_type: "file",
				content: JSON.stringify({ file_key: fileKey }),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to send file: [${response.code}] ${response.msg}`);
		}

		const messageId = response.data?.message_id;
		if (!messageId) {
			throw new Error("sendFile succeeded but no message_id returned");
		}

		return { message_id: messageId };
	}

	/**
	 * 在话题中回复
	 */
	async replyInThread(chatId: string, rootId: string, text: string): Promise<FeishuSendResult> {
		this.logger?.debug("Replying in thread", { chatId, rootId });

		// 飞书的话题回复需要通过不同的方式
		// 暂时使用普通消息发送
		const response = await this.client.im.v1.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: chatId,
				msg_type: "text",
				content: JSON.stringify({ text }),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to reply in thread: [${response.code}] ${response.msg}`);
		}

		const messageId = response.data?.message_id;
		if (!messageId) {
			throw new Error("replyInThread succeeded but no message_id returned");
		}

		return { message_id: messageId };
	}

	// ========================================================================
	// File Operations
	// ========================================================================

	/**
	 * 上传图片
	 */
	async uploadImage(imagePath: string): Promise<string> {
		this.logger?.debug("Uploading image", { imagePath });

		const { default: fs } = await import("fs");
		const fileStream = fs.createReadStream(imagePath);

		const response = await this.client.im.v1.image.create({
			data: {
				image_type: "message",
				image: fileStream,
			},
		});

		if (!response || !response.image_key) {
			throw new Error("Failed to upload image: no image_key returned");
		}

		return response.image_key;
	}

	/**
	 * 上传文件
	 */
	async uploadFile(filePath: string): Promise<string> {
		this.logger?.debug("Uploading file", { filePath });

		const { default: fs } = await import("fs");
		const { basename } = await import("path");
		const fileStream = fs.createReadStream(filePath);

		const response = await this.client.im.v1.file.create({
			data: {
				file_type: "stream",
				file_name: basename(filePath),
				file: fileStream,
			},
		});

		if (!response || !response.file_key) {
			throw new Error("Failed to upload file: no file_key returned");
		}

		return response.file_key;
	}

	/**
	 * 下载文件
	 */
	async downloadFile(fileKey: string, localPath: string): Promise<void> {
		this.logger?.debug("Downloading file", { fileKey, localPath });

		const response = await this.client.im.v1.file.get({
			path: {
				file_key: fileKey,
			},
		});

		if (!response) {
			throw new Error("Failed to download file: no response");
		}

		// 写入文件
		const writeResult = response.writeFile?.(localPath);
		if (writeResult) {
			await writeResult;
		}
	}

	/**
	 * 下载图片
	 */
	async downloadImage(imageKey: string, localPath: string): Promise<void> {
		this.logger?.debug("Downloading image", { imageKey, localPath });

		const response = await this.client.im.v1.image.get({
			path: {
				image_key: imageKey,
			},
		});

		if (!response) {
			throw new Error("Failed to download image: no response");
		}

		// 写入文件
		const writeResult = response.writeFile?.(localPath);
		if (writeResult) {
			await writeResult;
		}
	}

	// ========================================================================
	// User Operations
	// ========================================================================

	/**
	 * 获取用户信息
	 */
	async getUserInfo(openId: string): Promise<FeishuUserInfo | undefined> {
		try {
			const response = await this.client.contact.v3.user.get({
				path: {
					user_id: openId,
				},
				params: {
					user_id_type: "open_id",
					department_id_type: "open_department_id",
				},
			});

			if (response.code !== 0) {
				this.logger?.warn("Failed to get user info", { openId, code: response.code, msg: response.msg });
				return undefined;
			}

			return {
				open_id: response.data?.user?.open_id || openId,
				name: response.data?.user?.name,
				nickname: response.data?.user?.nickname,
				avatar_url: response.data?.user?.avatar?.avatar_origin,
				email: response.data?.user?.email,
				mobile: response.data?.user?.mobile,
			};
		} catch (error) {
			this.logger?.error("Error getting user info", undefined, error as Error);
			return undefined;
		}
	}

	// ========================================================================
	// Chat Operations
	// ========================================================================

	/**
	 * 获取群聊信息
	 */
	async getChatInfo(chatId: string): Promise<FeishuChatInfo | undefined> {
		try {
			const response = await this.client.im.v1.chat.get({
				path: {
					chat_id: chatId,
				},
			});

			if (response.code !== 0) {
				this.logger?.warn("Failed to get chat info", { chatId, code: response.code, msg: response.msg });
				return undefined;
			}

			const chatMode = response.data?.chat_mode;
			const chatType = response.data?.chat_type;

			return {
				chat_id: chatId,
				name: response.data?.name,
				description: response.data?.description,
				chat_mode: chatMode === "group" ? "group" : chatMode === "p2p" ? "p2p" : "topic",
				chat_type: chatType === "group" ? "group" : "p2p",
				owner_id: response.data?.owner_id,
				user_count: response.data?.user_count ? parseInt(response.data.user_count) : undefined,
			};
		} catch (error) {
			this.logger?.error("Error getting chat info", undefined, error as Error);
			return undefined;
		}
	}

	// ========================================================================
	// Reaction Operations
	// ========================================================================

	/**
	 * 添加表情反应
	 */
	async addReaction(messageId: string, reactionType: string): Promise<void> {
		this.logger?.debug("Adding reaction", { messageId, reactionType });

		const response = await this.client.im.v1.messageReaction.create({
			path: {
				message_id: messageId,
			},
			data: {
				reaction_type: {
					emoji_type: reactionType,
				},
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to add reaction: [${response.code}] ${response.msg}`);
		}
	}

	/**
	 * 删除表情反应
	 */
	async removeReaction(messageId: string, reactionType: string, reactionId: string): Promise<void> {
		this.logger?.debug("Removing reaction", { messageId, reactionType });

		const response = await this.client.im.v1.messageReaction.delete({
			path: {
				message_id: messageId,
				reaction_id: reactionId,
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to remove reaction: [${response.code}] ${response.msg}`);
		}
	}

	// ========================================================================
	// Getters
	// ========================================================================

	/** 获取 SDK 客户端 */
	get sdk(): Lark.Client {
		return this.client;
	}

	/** 获取消息去重器 */
	get dedup(): MessageDedup {
		return this.messageDedup;
	}

	/** 是否已连接 */
	get isConnected(): boolean {
		return this.wsConnected;
	}

	// ========================================================================
	// User Cache for @mentions
	// ========================================================================

	/** 群成员缓存 (name -> openId) */
	private chatMembersCache = new Map<string, Map<string, string>>();
	private chatMembersCacheTime = new Map<string, number>();
	private readonly CHAT_MEMBERS_CACHE_TTL = 5 * 60 * 1000; // 5分钟

	/** 用户真实姓名缓存 (openId -> realName) */
	private userNameCache = new Map<string, string>();
	private userNameCacheTime = new Map<string, number>();
	private readonly USER_NAME_CACHE_TTL = 30 * 60 * 1000; // 30分钟

	/**
	 * 获取用户真实姓名
	 * @param openId 用户 open_id
	 */
	async getUserName(openId: string): Promise<string | undefined> {
		// 检查缓存
		const cached = this.userNameCache.get(openId);
		const cachedTime = this.userNameCacheTime.get(openId) ?? 0;
		if (cached && Date.now() - cachedTime < this.USER_NAME_CACHE_TTL) {
			return cached;
		}

		try {
			const response = await this.client.contact.v3.user.get({
				path: { user_id: openId },
				params: { user_id_type: "open_id" },
			});

			if (response.code === 0 && response.data?.user?.name) {
				const name = response.data.user.name;
				this.userNameCache.set(openId, name);
				this.userNameCacheTime.set(openId, Date.now());
				return name;
			}
		} catch (error) {
			this.logger?.warn("Failed to get user name", { openId, error: String(error) });
		}

		return undefined;
	}

	/**
	 * 获取群成员列表（用于 @ 功能）
	 * @param chatId 群聊 ID
	 */
	async getChatMembers(chatId: string): Promise<Map<string, string>> {
		// 检查缓存
		const cached = this.chatMembersCache.get(chatId);
		const cachedTime = this.chatMembersCacheTime.get(chatId) ?? 0;
		if (cached && Date.now() - cachedTime < this.CHAT_MEMBERS_CACHE_TTL) {
			this.logger?.debug("Using cached chat members", { chatId, count: cached.size });
			return cached;
		}

		this.logger?.debug("Fetching chat members", { chatId });

		// 获取群成员
		const members = new Map<string, string>();
		try {
			// 使用 contact/v3/users/batch 或 im/v1/chat-members
			const response = await this.client.contact.v3.user.batchGetId({
				params: {
					user_id_type: "open_id",
				},
				data: {
					// 这里需要具体的用户列表，飞书 API 不支持直接获取群成员列表
					// 改用 im/chat-members API
				},
			});

			// 由于 batchGetId 需要具体的用户 ID，我们使用另一种方式
			// 通过消息中已有的 mention 信息来建立映射
			this.logger?.debug("Chat members fetch not fully implemented, using message mentions");
		} catch (error) {
			this.logger?.warn("Failed to fetch chat members", { chatId, error: String(error) });
		}

		// 缓存结果（即使是空的）
		this.chatMembersCache.set(chatId, members);
		this.chatMembersCacheTime.set(chatId, Date.now());

		return members;
	}

	/**
	 * 添加用户到缓存
	 * @param chatId 群聊 ID
	 * @param name 用户名
	 * @param openId open_id
	 */
	addUserToCache(chatId: string, name: string, openId: string): void {
		let chatCache = this.chatMembersCache.get(chatId);
		if (!chatCache) {
			chatCache = new Map();
			this.chatMembersCache.set(chatId, chatCache);
		}
		chatCache.set(name, openId);
		this.chatMembersCacheTime.set(chatId, Date.now());
	}

	/**
	 * 根据用户名查找 open_id
	 * @param chatId 群聊 ID
	 * @param name 用户名
	 */
	async findUserOpenId(chatId: string, name: string): Promise<string | undefined> {
		const members = await this.getChatMembers(chatId);
		return members.get(name);
	}

	/**
	 * 将 @用户名 转换为飞书 @ 格式
	 * @param chatId 群聊 ID
	 * @param text 原始文本
	 */
	async convertAtMentions(chatId: string, text: string): Promise<string> {
		this.logger?.debug("Converting @ mentions", { chatId, text, cacheSize: this.chatMembersCache.get(chatId)?.size });
		const members = await this.getChatMembers(chatId);
		this.logger?.debug("Chat members for conversion", { members: Array.from(members.entries()) });

		// 替换 @用户名 为飞书格式
		let result = text;
		for (const [name, openId] of members.entries()) {
			// 匹配 @用户名（前后有空格或字符串边界）
			const regex = new RegExp(`@\\s*${this.escapeRegExp(name)}\\b`, "g");
			const before = result;
			result = result.replace(regex, `<at user_id="${openId}">@${name}</at>`);
			if (result !== before) {
				this.logger?.debug("Replaced mention", { name, openId, before, after: result });
			}
		}

		this.logger?.debug("Converted result", { result });
		return result;
	}

	/**
	 * 转义正则特殊字符
	 */
	private escapeRegExp(string: string): string {
		return string.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
	}
}
