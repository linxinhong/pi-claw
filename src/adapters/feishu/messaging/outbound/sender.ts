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
 * 构建思考中卡片
 */
function buildThinkingCard(content?: string): object {
	return {
		config: { wide_screen_mode: true },
		elements: [
			{
				tag: "markdown",
				content: content ? `🤔 思考中...\n\n${content}` : "🤔 思考中...",
			},
		],
	};
}

/**
 * 构建最终回复卡片
 */
function buildFinalCard(content: string): object {
	return {
		config: { wide_screen_mode: true },
		elements: [
			{
				tag: "markdown",
				content: content,
			},
		],
	};
}

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
	 * @param chatId 聊天 ID
	 * @param text 文本内容
	 * @param quoteMessageId 可选的引用消息 ID，用于引用回复原消息
	 */
	async sendText(chatId: string, text: string, quoteMessageId?: string): Promise<string> {
		this.logger?.debug("Sending text message", { chatId, length: text.length, quoteMessageId });
		const result = await this.larkClient.sendText(chatId, text, quoteMessageId);
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
	 * @param chatId 聊天 ID
	 * @param card 卡片内容
	 * @param quoteMessageId 可选的引用消息 ID，用于引用回复原消息
	 */
	async sendCard(chatId: string, card: CardContent | any, quoteMessageId?: string): Promise<string> {
		this.logger?.debug("Sending card message", { chatId, quoteMessageId });
		const result = await this.larkClient.sendCard(chatId, card, quoteMessageId);
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

	// ========================================================================
	// 思考中卡片（流式响应支持）
	// ========================================================================

	/**
	 * 发送思考中卡片
	 * @param chatId 聊天 ID
	 * @returns 卡片消息 ID
	 */
	async sendThinkingCard(chatId: string): Promise<string> {
		this.logger?.debug("Sending thinking card", { chatId });
		const card = buildThinkingCard();
		const result = await this.larkClient.sendCard(chatId, card);
		return result.message_id;
	}

	/**
	 * 更新思考中卡片内容
	 * @param messageId 卡片消息 ID
	 * @param content 思考内容
	 */
	async updateThinkingCard(messageId: string, content: string): Promise<void> {
		this.logger?.debug("Updating thinking card", { messageId, contentLength: content.length });
		const card = buildThinkingCard(content);
		await this.larkClient.updateCard(messageId, card);
	}

	/**
	 * 完成思考，替换为最终回复
	 * @param messageId 卡片消息 ID
	 * @param content 最终回复内容
	 */
	async finalizeThinkingCard(messageId: string, content: string): Promise<void> {
		this.logger?.debug("Finalizing thinking card", { messageId, contentLength: content.length });
		const card = buildFinalCard(content);
		await this.larkClient.updateCard(messageId, card);
	}
}
