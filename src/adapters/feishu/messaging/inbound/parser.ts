/**
 * Message Event Parser
 *
 * 解析飞书事件为 FeishuMessageContext
 */

import type { FeishuMessageEvent, FeishuMessageContext, FeishuMention, BotIdentity } from "../../types.js";
import type { PiLogger } from "../../../../utils/logger/index.js";

// ============================================================================
// Parser
// ============================================================================

/**
 * 消息事件解析器
 */
export class MessageParser {
	private logger?: PiLogger;
	private botIdentity: BotIdentity | null = null;

	constructor(options?: { logger?: PiLogger; botIdentity?: BotIdentity | null }) {
		this.logger = options?.logger;
		this.botIdentity = options?.botIdentity || null;
	}

	/**
	 * 设置 Bot 身份
	 */
	setBotIdentity(identity: BotIdentity): void {
		this.botIdentity = identity;
	}

	/**
	 * 解析飞书事件
	 */
	parse(event: FeishuMessageEvent): FeishuMessageContext | null {
		try {
			const message = event.message;
			if (!message) {
				this.logger?.warn("Event missing message field");
				return null;
			}

			// 跳过 Bot 自己发送的消息
			const sender = event.sender;
			if (sender?.sender_type === "app") {
				this.logger?.debug("Skipping bot message", { messageId: message.message_id });
				return null;
			}

			// 解析聊天类型
			const chatType = this.parseChatType(message.chat_id);

			// 解析发送者信息
			const senderInfo = {
				openId: sender?.open_id || message.sender?.open_id || "",
				unionId: sender?.union_id,
				userId: sender?.user_id || message.sender?.user_id,
				name: undefined as string | undefined,
			};

			// 解析提及信息
			const mentions = message.mentions || [];
			const { mentionedBot, nonBotMentions } = this.parseMentions(mentions);

			// 解析时间戳
			const timestamp = new Date(parseInt(message.create_time) * 1000);

			const context: FeishuMessageContext = {
				rawEvent: event,
				messageId: message.message_id,
				chatId: message.chat_id,
				chatType,
				rootId: message.root_id,
				parentId: message.parent_id,
				messageType: message.msg_type,
				content: message.content,
				sender: senderInfo,
				mentions,
				timestamp,
				mentionedBot,
				nonBotMentions,
			};

			this.logger?.debug("Parsed message event", {
				messageId: context.messageId,
				chatId: context.chatId,
				chatType: context.chatType,
				messageType: context.messageType,
			});

			return context;
		} catch (error) {
			this.logger?.error("Error parsing message event", undefined, error as Error);
			return null;
		}
	}

	/**
	 * 解析聊天类型
	 */
	private parseChatType(chatId: string): "p2p" | "group" | "unknown" {
		// 飞书私聊 ID 以 "oc_" 开头，群聊也以 "oc_" 开头
		// 需要通过 chat_id 的前缀来判断
		if (chatId.startsWith("oc_")) {
			// 这里需要额外调用 API 来确定是私聊还是群聊
			// 暂时返回 unknown，让 handler 来处理
			return "unknown";
		}
		return "unknown";
	}

	/**
	 * 解析提及信息
	 */
	private parseMentions(mentions: FeishuMention[]): {
		mentionedBot: boolean;
		nonBotMentions: FeishuMention[];
	} {
		let mentionedBot = false;
		const nonBotMentions: FeishuMention[] = [];

		for (const mention of mentions) {
			if (this.botIdentity && mention.open_id === this.botIdentity.openId) {
				mentionedBot = true;
			} else if (mention.open_id && !mention.open_id.startsWith("cli_")) {
				// 排除其他 Bot
				nonBotMentions.push(mention);
			}
		}

		return { mentionedBot, nonBotMentions };
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 提取消息体内容
 */
export function extractMessageBody(content: string): any {
	try {
		return JSON.parse(content);
	} catch {
		return { text: content };
	}
}

/**
 * 解析文本消息内容
 */
export function parseTextContent(content: string): string {
	const body = extractMessageBody(content);
	return body.text || content;
}

/**
 * 解析富文本消息内容
 */
export function parsePostContent(content: string): string {
	const body = extractMessageBody(content);
	if (!body.content) {
		return "";
	}

	// 提取富文本中的纯文本
	const textParts: string[] = [];
	try {
		const postContent = JSON.parse(body.content);
		for (const paragraph of postContent || []) {
			for (const element of paragraph || []) {
				if (element.text) {
					textParts.push(element.text);
				}
			}
		}
	} catch {
		return body.content;
	}

	return textParts.join("\n");
}
