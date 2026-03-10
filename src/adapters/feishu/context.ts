/**
 * Feishu Platform Context
 *
 * 飞书平台上下文实现
 */

import type { PlatformContext } from "../../core/platform/context.js";
import type { PlatformTool } from "../../core/platform/tools/types.js";
import type { LarkClient } from "./client/index.js";
import type { FeishuStore } from "./store.js";
import type { MessageSender } from "./messaging/outbound/sender.js";
import type { PiLogger } from "../../utils/logger/index.js";
import { CardBuilder } from "./card/builder.js";

// ============================================================================
// Types
// ============================================================================

export interface FeishuPlatformContextOptions {
	chatId: string;
	larkClient: LarkClient;
	messageSender: MessageSender;
	store: FeishuStore;
	logger?: PiLogger;
}

// ============================================================================
// Feishu Platform Context
// ============================================================================

/**
 * 飞书平台上下文
 *
 * 实现 PlatformContext 接口，提供飞书特定的能力
 */
export class FeishuPlatformContext implements PlatformContext {
	readonly platform = "feishu" as const;

	private chatId: string;
	private larkClient: LarkClient;
	private messageSender: MessageSender;
	private store: FeishuStore;
	private logger?: PiLogger;
	private cardBuilder: CardBuilder;

	// 当前状态卡片
	private currentCardMessageId: string | null = null;
	private currentCardStatus: "thinking" | "streaming" | "complete" | null = null;

	// 思考中卡片状态
	private thinkingStartTime: number | null = null;
	private hideThinking: boolean = true;

	// 累积的工具状态
	private toolStatusLines: string[] = [];

	// 响应是否已发送标志
	private _responseSent: boolean = false;

	constructor(options: FeishuPlatformContextOptions) {
		this.chatId = options.chatId;
        this.larkClient = options.larkClient;
        this.messageSender = options.messageSender;
        this.store = options.store;
        this.logger = options.logger;
        this.cardBuilder = new CardBuilder();
    }

