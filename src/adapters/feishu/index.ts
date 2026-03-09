/**
 * Feishu Adapter Module Entry
 *
 * 飞书适配器模块入口
 */

// Core exports
export { FeishuAdapter } from "./adapter.js";
export { createFeishuBot, feishuAdapterFactory } from "./factory.js";
export { FeishuPlatformContext } from "./context.js";
export { FeishuStore } from "./store.js";

// Types
export type {
	FeishuConfig,
	FeishuAdapterConfig,
	FeishuPolicyConfig,
	FeishuResponseConfig,
	FeishuDisplayConfig,
	FeishuMessageContext,
	FeishuMessageEvent,
	FeishuReactionEvent,
	FeishuRawMessage,
	FeishuRawSender,
	FeishuMention,
	FeishuSendResult,
	FeishuMediaInfo,
	FeishuUserInfo,
	FeishuChatInfo,
	BotIdentity,
	CardStatus,
	CardContext,
	ToolCallInfo,
} from "./types.js";

// Client
export { LarkClient } from "./client/index.js";
export { MessageDedup } from "./client/index.js";

// Messaging
export { MessageHandler, MessageParser, MessageGate } from "./messaging/index.js";

// Card
export { CardBuilder, CardStateManager } from "./card/index.js";

// Queue
export { ChannelQueue } from "./queue/index.js";

// Utils
export * from "./utils/index.js";

// ============================================================================
// Auto Registration
// ============================================================================

import { adapterRegistry } from "../../core/adapter/index.js";
import { feishuAdapterFactory } from "./factory.js";

// 自注册到 Adapter Registry
adapterRegistry.register(feishuAdapterFactory);

console.log("[FeishuAdapter] Registered to adapterRegistry");
