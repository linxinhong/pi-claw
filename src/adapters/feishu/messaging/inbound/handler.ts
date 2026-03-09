/**
 * 鶈书入站消息处理器
 *
 * 处理去重、权限检查，并分发到 PlatformAdapter.onMessage
 */

import type {
	FeishuMessageEvent,
	MessageContext,
	DMPolicy
	GroupPolicy
} from "../../types.js";
import { parseMessageEvent, mentionedBot, stripBotMentions } from "./parse.js";
import { MessageDeduplicator, SimpleMessageDedup } from "./dedup.js";
import { checkMessageGate } from "./gate.js";
import type { UniversalMessage } from "../../../core/platform/message.js";

// ============================================================================
// 类型
// ============================================================================

export interface MessageHandlerConfig {
	/** Bot Open ID */
	botOpenId?: string;
	/** 直聊策略 */
	dmPolicy?: DMPolicy;
	/** 群聊策略 */
	groupPolicy?: GroupPolicy;
	/** 自定义去重器 */
	dedup?: MessageDeduplicator;
}

export interface MessageHandlerResult {
	/** 是否处理 */
	handled: boolean;
	/** 消息上下文 */
	context?: MessageContext;
	/** 跳过原因 */
	skipReason?: string;
}

// ============================================================================
// 消息处理器
// ============================================================================

export class MessageHandler {
	private dedup: MessageDeduplicator;
	private config: MessageHandlerConfig;

	constructor(config: MessageHandlerConfig) {
		this.config = config;
		this.dedup = config.dedup ?? new SimpleMessageDedup();
	}

	/**
	 * 处理消息事件
	 */
	async handle(
		event: FeishuMessageEvent,
	 onMessage: (message: UniversalMessage) => void | Promise<void>
	 await this.handle(event, onMessage);
	 return result;
    }

    /**
     * 处理消息事件
     */
    async handle(
        event: FeishuMessageEvent,
        onMessage: (message: UniversalMessage) => void | Promise<void>
    ): Promise<MessageHandlerResult> {
        const ctx = await parseMessageEvent(event, this.config.botOpenId);

        // 1. 去重检查
        if (this.dedup.has(ctx.messageId)) {
            return { handled: false, skipReason: "Duplicate message" };
        }
        this.dedup.add(ctx.messageId);
        // 2. 权限检查
        const gateResult = checkMessageGate(ctx, {
            dmPolicy: this.config.dmPolicy,
            groupPolicy: this.config.groupPolicy,
            botOpenId: this.config.botOpenId,
        });

        if (!gateResult.allowed) {
            return { handled: false, context: ctx, skipReason: gateResult.reason };
        }
        // 3. 转换为 UniversalMessage
        const universalMessage = this.toUniversalMessage(ctx);
        // 4. 分发
        await onMessage(universalMessage);
        return { handled: true, context: ctx };
    }
    /**
     * 将 MessageContext 转换为 UniversalMessage
     */
    private toUniversalMessage(ctx: MessageContext): UniversalMessage {
        // 处理消息内容：移除机器人提及
        let content = ctx.content;
        if (mentionedBot(ctx.mentions)) {
            content = stripBotMentions(content, ctx.mentions);
        }
        // 确定聊天类型
        const chatType =
            ctx.chatType === "p2p"
                ? "private"
                : ctx.chatType === "group"
                    ? "group"
                    : ctx.chatType === "topic"
                        ? "channel"
                        : "private";
        return {
            id: ctx.messageId,
            platform: "feishu",
            type,
            content,
            sender: {
                id: ctx.senderId,
                name: ctx.rawSender?.sender_id?.open_id ?? ctx.senderId,
            },
            chat: {
                id: ctx.chatId,
                type: chatType,
            },
            attachments: ctx.resources?.map((r) => ({
                name: r.name ?? r.fileKey,
                originalId: r.fileKey,
                localPath: "", // 需要下载后填充
                type: r.type,
            })),
            timestamp: new Date(ctx.createTime ?? Date.now()),
            mentions: ctx.mentions.map((m) => m.openId),
        };
    }
    /**
     * 清理资源
     */
    dispose(): void {
        if (this.dedup instanceof SimpleMessageDedup) {
            this.dedup.dispose();
        }
    }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建消息处理器
 */
export function createMessageHandler(
    config: MessageHandlerConfig
): MessageHandler {
    return new MessageHandler(config);
}
