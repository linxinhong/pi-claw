/**
 * CardKit Client
 *
 * 飞书 CardKit API 封装，用于实现打字机效果
 *
 * 关键 API 流程：
 * 1. createCardEntity()  → 创建卡片实体，返回 card_id
 * 2. sendCardByCardId()  → 通过 card_id 发送卡片消息
 * 3. streamCardContent() → 使用 cardElement.content API 流式更新内容（打字机效果）
 * 4. setStreamingMode()  → 完成后关闭流式模式
 * 5. updateCard()        → 完成后更新整个卡片
 */

import type { PiLogger } from "../../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

export interface CardKitClientOptions {
	/** 飞书 SDK 客户端 */
	client: any;
	/** 日志器 */
	logger?: PiLogger;
}

export interface StreamingCardConfig {
	/** 流式内容的 element_id */
	elementId?: string;
	/** 卡片摘要（显示在通知中） */
	summary?: string;
}

// ============================================================================
// CardKit Client
// ============================================================================

/**
 * CardKit 客户端
 *
 * 封装飞书 CardKit API，提供卡片实体创建、流式更新等功能
 */
export class CardKitClient {
	private client: any;
	private logger?: PiLogger;

	/** 当前流式卡片 ID */
	private currentCardId: string | null = null;

	/** 当前流式序列号 */
	private streamSequence: number = 0;

	constructor(options: CardKitClientOptions) {
		this.client = options.client;
		this.logger = options.logger;
	}

	// ========================================================================
	// Card Entity Operations
	// ========================================================================

	/**
	 * 创建卡片实体
	 * @param card 卡片内容
	 * @returns card_id
	 */
	async createCardEntity(card: any): Promise<string> {
		this.logger?.debug("[CardKit] Creating card entity");

		const response = await this.client.cardkit.v1.card.create({
			data: {
				type: "card_json",
				data: JSON.stringify(card),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to create card entity: [${response.code}] ${response.msg}`);
		}

		const cardId = response.data?.card?.card_id;
		if (!cardId) {
			throw new Error("createCardEntity succeeded but no card_id returned");
		}

		this.currentCardId = cardId;
		this.streamSequence = 0;

		this.logger?.debug("[CardKit] Card entity created", { cardId });
		return cardId;
	}

	/**
	 * 通过 card_id 发送卡片消息
	 * @param chatId 聊天 ID
	 * @param cardId 卡片实体 ID
	 * @param quoteMessageId 可选的引用消息 ID
	 * @returns message_id
	 */
	async sendCardByCardId(
		chatId: string,
		cardId: string,
		quoteMessageId?: string
	): Promise<string> {
		this.logger?.debug("[CardKit] Sending card by card_id", { chatId, cardId, quoteMessageId });

		// 如果有引用消息 ID，使用 reply API
		if (quoteMessageId) {
			const response = await this.client.im.v1.message.reply({
				path: {
					message_id: quoteMessageId,
				},
				data: {
					msg_type: "interactive",
					content: JSON.stringify({
						type: "card",
						data: { card_id: cardId },
					}),
					reply_in_thread: false,
				},
			});

			if (response.code !== 0) {
				throw new Error(`Failed to reply card by card_id: [${response.code}] ${response.msg}`);
			}

			const messageId = response.data?.message_id;
			if (!messageId) {
				throw new Error("sendCardByCardId (reply) succeeded but no message_id returned");
			}

			return messageId;
		}

		// 普通发送
		const response = await this.client.im.v1.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: chatId,
				msg_type: "interactive",
				content: JSON.stringify({
					type: "card",
					data: { card_id: cardId },
				}),
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to send card by card_id: [${response.code}] ${response.msg}`);
		}

		const messageId = response.data?.message_id;
		if (!messageId) {
			throw new Error("sendCardByCardId succeeded but no message_id returned");
		}

		return messageId;
	}

	// ========================================================================
	// Streaming Operations
	// ========================================================================

	/**
	 * 流式更新卡片内容（打字机效果）
	 * @param cardId 卡片实体 ID
	 * @param elementId 要更新的元素 ID
	 * @param content 新内容
	 * @param sequence 序列号（递增）
	 */
	async streamCardContent(
		cardId: string,
		elementId: string,
		content: string
	): Promise<void> {
		const sequence = ++this.streamSequence;

		this.logger?.debug("[CardKit] Streaming card content", {
			cardId,
			elementId,
			contentLength: content.length,
			sequence,
		});

		const response = await this.client.cardkit.v1.cardElement.content({
			path: {
				card_id: cardId,
				element_id: elementId,
			},
			data: {
				content,
				sequence,
			},
		});

		if (response.code !== 0) {
			// 速率限制错误，静默跳过
			if (response.code === 230020) {
				this.logger?.debug("[CardKit] Card content stream rate limited, skipping");
				return;
			}
			throw new Error(`Failed to stream card content: [${response.code}] ${response.msg}`);
		}
	}

	/**
	 * 设置卡片流式模式
	 * @param cardId 卡片实体 ID
	 * @param streamingMode 是否启用流式模式
	 * @param sequence 序列号
	 */
	async setStreamingMode(
		cardId: string,
		streamingMode: boolean
	): Promise<void> {
		const sequence = ++this.streamSequence;

		this.logger?.debug("[CardKit] Setting streaming mode", {
			cardId,
			streamingMode,
			sequence,
		});

		const response = await this.client.cardkit.v1.card.settings({
			path: {
				card_id: cardId,
			},
			data: {
				settings: JSON.stringify({ streaming_mode: streamingMode }),
				sequence,
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to set streaming mode: [${response.code}] ${response.msg}`);
		}
	}

	/**
	 * 更新整个卡片
	 * @param cardId 卡片实体 ID
	 * @param card 新的卡片内容
	 */
	async updateCard(cardId: string, card: any): Promise<void> {
		const sequence = ++this.streamSequence;

		this.logger?.debug("[CardKit] Updating card", { cardId, sequence });

		const response = await this.client.cardkit.v1.card.update({
			path: {
				card_id: cardId,
			},
			data: {
				type: "card_json",
				data: JSON.stringify(card),
				sequence,
			},
		});

		if (response.code !== 0) {
			throw new Error(`Failed to update card: [${response.code}] ${response.msg}`);
		}
	}

	// ========================================================================
	// High-Level API
	// ========================================================================

	/**
	 * 获取当前流式卡片 ID
	 */
	getCurrentCardId(): string | null {
		return this.currentCardId;
	}

	/**
	 * 重置流式状态
	 */
	resetStreaming(): void {
		this.currentCardId = null;
		this.streamSequence = 0;
	}

	/**
	 * 获取当前序列号
	 */
	getCurrentSequence(): number {
		return this.streamSequence;
	}
}
