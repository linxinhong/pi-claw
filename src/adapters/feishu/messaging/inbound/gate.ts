/**
 * Message Gate
 *
 * 策略门控，检查消息是否应该被处理
 */

import type { FeishuMessageContext, FeishuAdapterConfig } from "../../types.js";
import type { PiLogger } from "../../../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

export interface GateResult {
	allowed: boolean;
	reason?: string;
}

// ============================================================================
// Message Gate
// ============================================================================

/**
 * 消息策略门控
 */
export class MessageGate {
	private config: FeishuAdapterConfig;
	private logger?: PiLogger;

	constructor(options: { config: FeishuAdapterConfig; logger?: PiLogger }) {
		this.config = options.config;
		this.logger = options.logger;
	}

	/**
	 * 检查消息是否应该被处理
	 */
	check(context: FeishuMessageContext): GateResult {
		// 检查私聊策略
		if (context.chatType === "p2p") {
			return this.checkDMPolicy(context);
		}

		// 检查群聊策略
		if (context.chatType === "group") {
			return this.checkGroupPolicy(context);
		}

		// 未知类型，检查是否需要 @提及
		if (context.chatType === "unknown") {
			// 如果有 root_id，说明是话题消息，可能是群聊
			if (context.rootId) {
				return this.checkGroupPolicy(context);
			}
			// 否则假设是私聊
			return this.checkDMPolicy(context);
		}

		return { allowed: false, reason: "Unknown chat type" };
	}

	/**
	 * 检查私聊策略
	 */
	private checkDMPolicy(context: FeishuMessageContext): GateResult {
		const dmPolicy = this.config.dmPolicy || "open";

		switch (dmPolicy) {
			case "open":
				return { allowed: true };

			case "disabled":
				return { allowed: false, reason: "DM disabled" };

			case "allowlist":
				const dmAllowlist = this.config.dmAllowlist || [];
				if (!dmAllowlist.includes(context.sender.openId)) {
					return { allowed: false, reason: "User not in DM allowlist" };
				}
				return { allowed: true };

			case "pairing":
				// 配对模式需要额外实现，暂时返回 true
				return { allowed: true };

			default:
				return { allowed: true };
		}
	}

	/**
	 * 检查群聊策略
	 */
	private checkGroupPolicy(context: FeishuMessageContext): GateResult {
		const groupPolicy = this.config.groupPolicy || "open";

		switch (groupPolicy) {
			case "open":
				// 检查是否需要 @提及
				if (this.config.requireMention !== false) {
					// 检查群组级配置
					const groupConfig = this.getGroupConfig(context.chatId);
					if (groupConfig?.requireMention === false) {
						return { allowed: true };
					}

					if (!context.mentionedBot) {
						return { allowed: false, reason: "Bot not mentioned in group" };
					}
				}
				return { allowed: true };

			case "disabled":
				return { allowed: false, reason: "Group disabled" };

			case "allowlist":
				const groupAllowlist = this.config.groupAllowlist || [];
				if (!groupAllowlist.includes(context.chatId)) {
					return { allowed: false, reason: "Group not in allowlist" };
				}

				// 检查是否需要 @提及
				if (this.config.requireMention !== false && !context.mentionedBot) {
					return { allowed: false, reason: "Bot not mentioned in group" };
				}
				return { allowed: true };

			default:
				return { allowed: true };
		}
	}

	/**
	 * 获取群组级配置
	 */
	private getGroupConfig(chatId: string): Partial<FeishuAdapterConfig> | undefined {
		const groups = this.config.groups;
		if (!groups) {
			return undefined;
		}

		// 先检查特定群组配置
		if (groups[chatId]) {
			return groups[chatId];
		}

		// 检查通配符配置
		if (groups["*"]) {
			return groups["*"];
		}

		return undefined;
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 检查消息是否过期（超过 5 分钟）
 */
export function isMessageExpired(context: FeishuMessageContext, maxAgeMs: number = 5 * 60 * 1000): boolean {
	const now = Date.now();
	const messageTime = context.timestamp.getTime();
	return now - messageTime > maxAgeMs;
}
