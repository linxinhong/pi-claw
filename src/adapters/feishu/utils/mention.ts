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
 * 格式化 @提及为文本（用于文本/Post 消息）
 * 格式: <at user_id="ou_xxx">@name</at>
 */
export function formatMentionForText(mention: FeishuMention): string {
	const name = mention.name || mention.open_id || "unknown";
	return `<at user_id="${mention.open_id || mention.user_id}">@${name}</at>`;
}

/**
 * 格式化 @所有人为文本（用于文本/Post 消息）
 * 格式: <at user_id="all">@所有人</at>
 */
export function formatMentionAllForText(): string {
	return `<at user_id="all">@所有人</at>`;
}

/**
 * 格式化 @提及为卡片格式
 * 格式: <at id=ou_xxx></at>
 * 注意：卡片中使用不同的格式
 */
export function formatMentionForCard(mention: FeishuMention): string {
	return `<at id=${mention.open_id || mention.user_id}></at>`;
}

/**
 * 格式化 @所有人为卡片格式
 * 格式: <at id=all></at>
 */
export function formatMentionAllForCard(): string {
	return `<at id=all></at>`;
}

/**
 * 构建带 @提及的消息（文本格式）
 * @param mentions 要 @ 的用户列表
 * @param message 消息内容
 */
export function buildMentionedMessage(mentions: FeishuMention[], message: string): string {
	if (mentions.length === 0) {
		return message;
	}
	const mentionTags = mentions.map(formatMentionForText).join(" ");
	return `${mentionTags}\n${message}`;
}

/**
 * 构建带 @提及的卡片内容
 * @param mentions 要 @ 的用户列表
 * @param content 卡片 Markdown 内容
 */
export function buildMentionedCardContent(mentions: FeishuMention[], content: string): string {
	if (mentions.length === 0) {
		return content;
	}
	const mentionTags = mentions.map(formatMentionForCard).join(" ");
	return `${mentionTags}\n${content}`;
}

/**
 * 从文本中移除 @提及
 */
export function removeMentionFromText(text: string, botIdentity: BotIdentity): string {
	// 移除 @Bot 的文本
	const botNamePattern = new RegExp(`@${botIdentity.name}\\s*`, "g");
	let result = text.replace(botNamePattern, "");

	// 移除飞书格式的 @提及
	result = result.replace(/<at[^>]*>@[^<]+<\/at>\\s*/g, "");

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

/**
 * 规范化 @提及标签
 * 修复 AI 常写的错误格式
 * 例如: <at id=ou_xxx> → <at user_id="ou_xxx">
 */
export function normalizeAtMentions(text: string): string {
	return text.replace(
		/<at\\s+(?:id|open_id|user_id)\\s*=\\s*"?([^">\\s]+)"?\\s*>/gi,
		'<at user_id="$1">'
	);
}
