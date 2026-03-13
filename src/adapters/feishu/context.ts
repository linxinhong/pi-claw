/**
 * Feishu Platform Context
 *
 * 飞书平台上下文 - 提供飞书特定的能力
 */

import type { PlatformContext } from "../../core/platform/context.js";
import type { Logger } from "../../utils/logger/index.js";
import {
	handlePermissionErrorWithAutoAuth,
	type AuthContext,
	type SendCardFunction,
	type UpdateCardFunction,
	type SendSyntheticMessageFunction,
} from "./oauth/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 飞书上下文配置
 */
export interface FeishuContextConfig {
	/** 飞书客户端 */
	client: any;
	/** 频道 ID */
	chatId: string;
	/** App ID */
	appId?: string;
	/** App Secret */
	appSecret?: string;
	/** 品牌 */
	brand?: string;
	/** 发送者 Open ID */
	senderOpenId?: string;
	/** 消息 ID */
	messageId?: string;
	/** 线程 ID */
	threadId?: string;
	/** 日志器 */
	logger?: Logger;
	/** 发送文本消息的函数 */
	postMessage: (chatId: string, text: string) => Promise<string>;
	/** 发送卡片的函数 */
	sendCard?: (card: any, chatId: string, replyToMessageId?: string) => Promise<string>;
	/** 更新卡片的函数 */
	updateCard?: (cardId: string, card: any) => Promise<void>;
	/** 发送合成消息的函数 */
	sendSyntheticMessage?: (chatId: string, text: string, replyToMessageId?: string) => Promise<void>;
	/** 更新消息的函数 */
	updateMessage: (messageId: string, text: string) => Promise<void>;
	/** 删除消息的函数 */
	deleteMessage: (messageId: string) => Promise<void>;
	/** 上传文件的函数 */
	uploadFile: (chatId: string, filePath: string, title?: string) => Promise<void>;
	/** 上传图片的函数 */
	uploadImage: (imagePath: string) => Promise<string>;
	/** 发送图片的函数 */
	sendImage: (chatId: string, imageKey: string) => Promise<string>;
	/** 发送语音消息的函数 */
	sendVoiceMessage: (chatId: string, filePath: string) => Promise<string>;
	/** 在线程中回复的函数 */
	postInThread: (chatId: string, parentMessageId: string, text: string) => Promise<string>;
}

// ============================================================================
// Feishu Platform Context
// ============================================================================

/**
 * 飞书平台上下文实现
 */
export class FeishuPlatformContext implements PlatformContext {
	readonly platform = "feishu";
	private config: FeishuContextConfig;

	constructor(config: FeishuContextConfig) {
		this.config = config;
	}

	async sendText(chatId: string, text: string): Promise<string> {
		return this.config.postMessage(chatId, text);
	}

	async updateMessage(messageId: string, content: string): Promise<void> {
		return this.config.updateMessage(messageId, content);
	}

	async deleteMessage(messageId: string): Promise<void> {
		return this.config.deleteMessage(messageId);
	}

	async uploadFile(filePath: string, chatId: string): Promise<void> {
		return this.config.uploadFile(chatId, filePath);
	}

	async uploadImage(imagePath: string): Promise<string> {
		return this.config.uploadImage(imagePath);
	}

	async sendImage(chatId: string, imageKey: string): Promise<string> {
		return this.config.sendImage(chatId, imageKey);
	}

	async sendVoiceMessage(chatId: string, filePath: string): Promise<string> {
		return this.config.sendVoiceMessage(chatId, filePath);
	}

	async postInThread(chatId: string, parentMessageId: string, text: string): Promise<string> {
		return this.config.postInThread(chatId, parentMessageId, text);
	}

	/**
	 * 处理错误（支持自动授权）
	 *
	 * @param error - 错误对象
	 * @returns 是否已处理错误
	 */
	async handleError(error: unknown): Promise<boolean> {
		if (!this.config.appId || !this.config.appSecret || !this.config.senderOpenId) {
			return false;
		}

		const sendCard: SendCardFunction = async (card: any, context: AuthContext) => {
			if (!this.config.sendCard) {
				throw new Error("sendCard function not configured");
			}
			return this.config.sendCard(card, context.chatId, context.messageId);
		};

		const updateCard: UpdateCardFunction = async (cardId: string, card: any) => {
			if (!this.config.updateCard) {
				throw new Error("updateCard function not configured");
			}
			return this.config.updateCard(cardId, card);
		};

		const sendSyntheticMessage: SendSyntheticMessageFunction = async (
			context: AuthContext,
			text: string
		) => {
			if (!this.config.sendSyntheticMessage) {
				return;
			}
			return this.config.sendSyntheticMessage(context.chatId, text, context.messageId);
		};

		return handlePermissionErrorWithAutoAuth(
			error,
			{
				appId: this.config.appId,
				appSecret: this.config.appSecret,
				brand: this.config.brand as any,
				senderOpenId: this.config.senderOpenId,
				chatId: this.config.chatId,
				messageId: this.config.messageId ?? "",
				threadId: this.config.threadId,
				logger: this.config.logger,
			},
			sendCard,
			updateCard,
			sendSyntheticMessage
		);
	}

	/**
	 * 获取飞书平台特定功能
	 */
	getPlatformFeature<T = any>(feature: string): T {
		switch (feature) {
			case "buildCard": {
				// 返回飞书卡片构建函数
				const fn = (content: string) => {
					return JSON.stringify({
						schema: "2.0",
						config: { width_mode: "fill", update_multi: true },
						body: {
							elements: [{ tag: "div", text: { tag: "lark_md", content } }],
						},
					});
				};
				return fn as T;
			}
			default:
				throw new Error(`Unknown feature: ${feature}`);
		}
	}
}
