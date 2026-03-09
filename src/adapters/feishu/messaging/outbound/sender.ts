/**
 * Message Sender
 *
 * 出站消息发送器
 */

import type { UniversalResponse, CardContent } from "../../../../core/platform/message.js";
import type { LarkClient } from "../../client/index.js";
import type { PiLogger } from "../../../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

export interface MessageSenderOptions {
	larkClient: LarkClient;
	logger?: PiLogger;
}

// ============================================================================
// Message Sender
// ============================================================================

/**
 * 出站消息发送器
 */
export class MessageSender {
	private larkClient: LarkClient;
	private logger?: PiLogger;

	constructor(options: MessageSenderOptions) {
		this.larkClient = options.larkClient;
		this.logger = options.logger;
	}

	/**
	 * 发送消息
	 */
	async send(response: UniversalResponse, chatId?: string): Promise<string> {
		const targetChatId = chatId || response.messageId || "";

		switch (response.type) {
			case "text":
				return await this.sendText(targetChatId, response.content as string);

			case "image":
				return await this.sendImage(targetChatId, response.imageKey || "");

			case "card":
				return await this.sendCard(targetChatId, response.content as CardContent);

			default:
				throw new Error(`Unsupported response type: ${response.type}`);
		}
	}

	/**
	 * 更新消息
	 */
	async update(messageId: string, response: UniversalResponse): Promise<void> {
		switch (response.type) {
			case "text":
				await this.larkClient.updateMessage(messageId, response.content as string);
				break;

			case "card":
				await this.larkClient.updateCard(messageId, response.content);
				break;

			default:
				throw new Error(`Unsupported update type: ${response.type}`);
		}
	}

	/**
	 * 发送文本消息
	 */
	async sendText(chatId: string, text: string): Promise<string> {
		this.logger?.debug("Sending text message", { chatId, length: text.length });
		const result = await this.larkClient.sendText(chatId, text);
		return result.message_id;
	}

	/**
	 * 发送图片消息
	 */
	async sendImage(chatId: string, imageKey: string): Promise<string> {
		this.logger?.debug("Sending image message", { chatId, imageKey });
		const result = await this.larkClient.sendImage(chatId, imageKey);
		return result.message_id;
	}

	/**
	 * 发送卡片消息
	 */
	async sendCard(chatId: string, card: CardContent | any): Promise<string> {
		this.logger?.debug("Sending card message", { chatId });
		const result = await this.larkClient.sendCard(chatId, card);
		return result.message_id;
	}

	/**
	 * 更新卡片消息
	 */
	async updateCard(messageId: string, card: CardContent | any): Promise<void> {
		this.logger?.debug("Updating card message", { messageId });
		await this.larkClient.updateCard(messageId, card);
	}

	/**
	 * 发送文件消息
	 */
	async sendFile(chatId: string, fileKey: string): Promise<string> {
		this.logger?.debug("Sending file message", { chatId, fileKey });
		const result = await this.larkClient.sendFile(chatId, fileKey);
		return result.message_id;
	}

	/**
	 * 在话题中回复
	 */
	async replyInThread(chatId: string, rootId: string, text: string): Promise<string> {
		this.logger?.debug("Replying in thread", { chatId, rootId });
		const result = await this.larkClient.replyInThread(chatId, rootId, text);
		return result.message_id;
	}
}
