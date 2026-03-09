/**
 * Mention Utilities
 *
 * @提及处理工具
 */

import type { FeishuMention, BotIdentity } from "../types.js";

/**
 * 检查是否 @了 Bot
 */
export function mentionedBot(mentions: FeishuMention[] | undefined, botIdentity: BotIdentity): boolean {
	if (!mentions) {
		return false;
	}

	return mentions.some(
		(m) => m.open_id === botIdentity.openId || m.user_id === botIdentity.userId
	);
}

/**
 * 获取非 Bot 的提及列表
 */
export function nonBotMentions(mentions: FeishuMention[] | undefined, botIdentity: BotIdentity): FeishuMention[] {
	if (!mentions) {
		return [];
	}

	return mentions.filter((m) => {
		// 排除 Bot 自己
		if (m.open_id === botIdentity.openId || m.user_id === botIdentity.userId) {
			return false;
		}
		// 排除其他 Bot（通常以 cli_ 开头）
		if (m.open_id?.startsWith("cli_")) {
			return false;
		}
		return true;
	});
}

/**
 * 格式化 @提及为文本
 */
export function formatMentionForText(mention: FeishuMention): string {
	const name = mention.name || mention.open_id || "unknown";
	return `<at user_id="${mention.open_id || mention.user_id}">@${name}</at>`;
}

/**
 * 从文本中移除 @提及
 */
export function removeMentionFromText(text: string, botIdentity: BotIdentity): string {
	// 移除 @Bot 的文本
	const botNamePattern = new RegExp(`@${botIdentity.name}\\s*`, "g");
	let result = text.replace(botNamePattern, "");

	// 移除飞书格式的 @提及
	result = result.replace(/<at[^>]*>@[^<]+<\/at>\s*/g, "");

	return result.trim();
}

/**
 * 提取 @提及的用户 ID
 */
export function extractMentionedUserIds(mentions: FeishuMention[] | undefined): string[] {
	if (!mentions) {
		return [];
	}

	return mentions
		.map((m) => m.open_id || m.user_id)
		.filter((id): id is string => Boolean(id));
}
