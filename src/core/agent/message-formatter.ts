/**
 * 消息格式化工具
 *
 * 将历史消息转换为 Markdown 格式，便于人类阅读和调试
 */

import { convertToLlm } from "@mariozechner/pi-coding-agent";
import type { Message, TextContent } from "@mariozechner/pi-ai";

/**
 * 格式化时间戳为人类可读格式
 */
export function formatTimestamp(timestamp: number | string | Date): string {
	const date = new Date(timestamp);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 提取消息中的文本内容
 */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c): c is TextContent => c.type === "text")
			.map(c => c.text)
			.join("\n");
	}
	return "";
}

/**
 * Markdown 转换选项
 */
export interface MarkdownOptions {
	/** 保留最近消息数量（不转换为 Markdown） */
	keepRecentMessages: number;
	/** Markdown 内容最大长度 */
	maxMarkdownLength: number;
	/** 是否包含工具结果 */
	includeToolResults: boolean;
}

/**
 * 安全截断消息，确保不会留下孤立的 toolResult 消息
 * 规则：如果最后一条消息是 toolResult，则必须保留对应的 assistant 消息
 */
export function safeTruncateMessages<T extends { role: string; toolCallId?: string }>(
	messages: T[],
	maxMessages: number,
): T[] {
	if (messages.length <= maxMessages) return messages;

	// 计算需要保留的消息数
	let keepCount = maxMessages;

	// 获取最后一条消息的角色
	const lastMsg = messages[messages.length - 1];
	const secondLastMsg = messages[messages.length - 2];

	// 如果最后一条是 toolResult，前一条必须是 assistant（带 tool_calls）
	// 如果截断后只剩 toolResult 而没有 assistant，需要多保留一条
	if (lastMsg?.role === "toolResult" && keepCount > 0) {
		const keptMessages = messages.slice(-keepCount);
		const hasAssistantWithToolCalls = keptMessages.some(
			(m) => m.role === "assistant" && (m as any).toolCalls?.length > 0,
		);
		if (!hasAssistantWithToolCalls && messages.length > keepCount) {
			keepCount++;
		}
	}

	// 再次检查截断后的最后一条消息
	// 如果截断后最后一条是 toolResult 且前一条不是 assistant，需要继续调整
	const truncated = messages.slice(-keepCount);
	const lastTruncated = truncated[truncated.length - 1];
	const secondLastTruncated = truncated[truncated.length - 2];

	if (
		lastTruncated?.role === "toolResult" &&
		secondLastTruncated?.role !== "assistant" &&
		keepCount < messages.length
	) {
		// 移除这个孤立的 toolResult
		return truncated.slice(0, -1);
	}

	return truncated;
}

/**
 * 将历史消息转换为 Markdown 格式
 *
 * 策略：
 * 1. 保留最近 N 条消息为原始格式
 * 2. 将较旧的消息合并为一个 Markdown 格式的 user 消息
 * 3. 每条消息显示人类可读的时间戳
 * 4. 可选：不包含工具结果（节约 token）
 */
export function convertToMarkdown(
	messages: Parameters<typeof convertToLlm>[0],
	_options: Partial<MarkdownOptions> = {},
): ReturnType<typeof convertToLlm> {
	// 【调试】临时禁用消息截断，验证问题是否由此引起
	// 直接返回原始消息，不进行任何转换或截断
	return convertToLlm(messages);
}
