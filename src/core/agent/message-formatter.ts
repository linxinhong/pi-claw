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
 * 智能分层 Compact 配置
 */
export interface CompactConfig {
	/** 完整保留的轮数（每轮 = assistant + tool result） */
	fullRounds: number;
	/** Markdown 简化的轮数 */
	markdownRounds: number;
	/** 最大总轮数（超过后丢弃） */
	maxTotalRounds: number;
	/** 是否跳过 Markdown 转换（对 MiniMax 等严格模型使用） */
	skipMarkdown?: boolean;
}

/** 默认 Compact 配置 */
export const DEFAULT_COMPACT_CONFIG: CompactConfig = {
	fullRounds: 10,      // 完整保留 10 轮
	markdownRounds: 20,  // Markdown 简化 20 轮
	maxTotalRounds: 50,  // 最多 50 轮
	skipMarkdown: false, // 默认启用 Markdown 压缩
};

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
	options: Partial<MarkdownOptions> = {},
): ReturnType<typeof convertToLlm> {
	const opts: MarkdownOptions = {
		keepRecentMessages: 10, // 保留 5 轮对话
		maxMarkdownLength: 10000,
		includeToolResults: false,
		...options,
	};

	// 1. 先使用原始 convertToLlm 过滤
	const filtered = convertToLlm(messages);

	// 2. 如果消息数量少，直接返回
	if (filtered.length <= opts.keepRecentMessages) {
		return filtered;
	}

	// 【修复】收集所有 tool call ID 映射关系
	// 这是为了解决 MiniMax 等模型在多轮对话后的 tool call ID 不匹配问题
	const toolCallIdMap = new Map<string, string>();
	const assistantToolCalls = new Map<string, string>(); // message index -> tool call id

	for (let i = 0; i < filtered.length; i++) {
		const msg = filtered[i] as any;
		if (msg.role === "assistant" && msg.toolCalls) {
			for (const tc of msg.toolCalls) {
				if (tc.id) {
					assistantToolCalls.set(`${i}-${tc.name}`, tc.id);
				}
			}
		}
	}

	// 3. 安全截断：分割历史消息和最近消息
	const recentMessages = safeTruncateMessages(filtered, opts.keepRecentMessages);
	const historyMessages = filtered.slice(0, filtered.length - recentMessages.length);

	// 【修复】检查截断边界，确保没有孤立的 tool result
	// 如果最近消息的第一条是 tool result，需要检查其对应的 assistant 是否被截断
	if (recentMessages.length > 0) {
		const firstRecent = recentMessages[0] as any;
		if (firstRecent.role === "toolResult" && firstRecent.toolCallId) {
			// 查找对应的 assistant 消息
			let foundAssistant = false;
			for (const msg of recentMessages) {
				const m = msg as any;
				if (m.role === "assistant" && m.toolCalls) {
					for (const tc of m.toolCalls) {
						if (tc.id === firstRecent.toolCallId) {
							foundAssistant = true;
							break;
						}
					}
				}
				if (foundAssistant) break;
			}

			// 如果在保留的消息中找不到对应的 assistant，从历史消息中找
			if (!foundAssistant && historyMessages.length > 0) {
				// 从历史消息末尾开始找
				for (let i = historyMessages.length - 1; i >= 0; i--) {
					const msg = historyMessages[i] as any;
					if (msg.role === "assistant" && msg.toolCalls) {
						for (const tc of msg.toolCalls) {
							if (tc.id === firstRecent.toolCallId) {
								// 找到了！把这个 assistant 移到保留的消息中
								const assistantMsg = historyMessages.splice(i, 1)[0];
								recentMessages.unshift(assistantMsg);
								foundAssistant = true;
								break;
							}
						}
					}
					if (foundAssistant) break;
				}
			}
		}
	}

	// 4. 转换历史消息为 Markdown
	const lines: string[] = ["## 近期对话", ""];

	for (const msg of historyMessages) {
		const timestamp = formatTimestamp((msg as any).timestamp || Date.now());

		if (msg.role === "user") {
			const text = extractText(msg.content);
			lines.push(`**${timestamp} [user]:** ${text}`);
			lines.push("");
		} else if (msg.role === "assistant") {
			const text = extractText(msg.content);
			// 截断过长的回复
			const truncated = text.length > 500 ? text.slice(0, 500) + "..." : text;
			lines.push(`**${timestamp} [assistant]:** ${truncated}`);
			lines.push("");
		} else if (msg.role === "toolResult" && opts.includeToolResults) {
			const text = extractText(msg.content);
			const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
			const toolName = (msg as any).toolName || "unknown";
			lines.push(`**${timestamp} [tool:${toolName}]:** ${truncated}`);
			lines.push("");
		}
	}

	let markdownContent = lines.join("\n");

	// 5. 截断过长的 Markdown
	if (markdownContent.length > opts.maxMarkdownLength) {
		markdownContent = markdownContent.slice(0, opts.maxMarkdownLength) + "\n\n... (历史消息已截断)";
	}

	// 6. 创建 Markdown 消息
	const markdownMessage: Message = {
		role: "user",
		content: markdownContent,
		timestamp: Date.now(),
	};

	// 7. 返回合并后的消息列表
	return [markdownMessage, ...recentMessages];
}

/**
 * 智能分层 Compact 消息
 * 
 * 分层策略：
 * 1. 最近 N 轮：完整保留
 * 2. 接下来 M 轮：Markdown 简化
 * 3. 更旧的消息：丢弃
 * 
 * 这样可以支持长任务（50+轮），同时控制 token 消耗
 */
export function compactMessages(
	messages: Parameters<typeof convertToLlm>[0],
	config: Partial<CompactConfig> = {},
): ReturnType<typeof convertToLlm> {
	const opts = { ...DEFAULT_COMPACT_CONFIG, ...config };
	
	// 1. 先过滤消息
	const filtered = convertToLlm(messages);
	
	// 计算各层消息数（每轮 = 2条消息：assistant + tool result/user）
	const fullMessages = opts.fullRounds * 2;
	const markdownMessages = opts.markdownRounds * 2;
	const maxTotalMessages = opts.maxTotalRounds * 2;
	
	// 2. 如果消息数少于完整保留数，直接返回
	if (filtered.length <= fullMessages) {
		return filtered;
	}
	
	// 【修复】如果 skipMarkdown 为 true（MiniMax 等严格模型），直接截断不转换
	if (opts.skipMarkdown) {
		// 只保留最近 maxTotalMessages 条消息，确保不留下孤立的 tool result
		let truncated = safeTruncateMessages(filtered, maxTotalMessages);
		
		// 检查边界：如果第一条是 tool result，需要找对应的 assistant
		if (truncated.length > 0) {
			const firstMsg = truncated[0] as any;
			if (firstMsg.role === "toolResult" && firstMsg.toolCallId) {
				// 在被截断的消息中查找对应的 assistant
				const removedCount = filtered.length - truncated.length;
				for (let i = removedCount - 1; i >= 0; i--) {
					const msg = filtered[i] as any;
					if (msg.role === "assistant" && msg.toolCalls) {
						const hasMatchingToolCall = msg.toolCalls.some((tc: any) => tc.id === firstMsg.toolCallId);
						if (hasMatchingToolCall) {
							// 找到了对应的 assistant，添加到开头
							truncated = [msg, ...truncated];
							break;
						}
					}
				}
			}
		}
		
		return truncated;
	}
	
	// 3. 分割消息为三层
	// 从后往前：完整层 | Markdown层 | 丢弃层
	const fullLayer = filtered.slice(-fullMessages);
	const remainingForMarkdown = filtered.slice(0, filtered.length - fullMessages);
	
	// 4. 处理 Markdown 层
	let markdownLayer: typeof filtered = [];
	if (remainingForMarkdown.length > 0) {
		// 取最近的部分用于 Markdown，其余丢弃
		const markdownSlice = remainingForMarkdown.slice(-markdownMessages);
		
		// 使用 convertToMarkdown 处理 Markdown 层
		// 注意：这里我们需要特殊处理，因为 convertToMarkdown 会再分割
		// 我们直接手动转换
		const lines: string[] = ["## 历史对话摘要", ""];
		
		for (const msg of markdownSlice) {
			const timestamp = formatTimestamp((msg as any).timestamp || Date.now());
			
			if (msg.role === "user") {
				const text = extractText(msg.content);
				lines.push(`**${timestamp} [user]:** ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`);
			} else if (msg.role === "assistant") {
				const text = extractText(msg.content);
				// 截断过长的回复
				const truncated = text.length > 150 ? text.slice(0, 150) + "..." : text;
				lines.push(`**${timestamp} [assistant]:** ${truncated}`);
			}
			// toolResult 不显示，避免混乱
		}
		
		const markdownContent = lines.join("\n");
		
		// 创建 Markdown 消息
		const markdownMessage: Message = {
			role: "user",
			content: markdownContent,
			timestamp: Date.now(),
		};
		
		markdownLayer = [markdownMessage];
	}
	
	// 5. 检查边界：确保完整层的第一条不是孤立的 tool result
	// 如果完整层的开头是 tool result，其 assistant 可能在 Markdown 层
	if (fullLayer.length > 0) {
		const firstFull = fullLayer[0] as any;
		if (firstFull.role === "toolResult" && firstFull.toolCallId) {
			// 在 Markdown 层的原始消息中查找对应的 assistant
			const originalIndex = filtered.findIndex((m: any) => 
				m.role === "assistant" && 
				m.toolCalls?.some((tc: any) => tc.id === firstFull.toolCallId)
			);
			
			if (originalIndex >= 0 && originalIndex < filtered.length - fullMessages) {
				// 找到了，把这个 assistant 移到完整层开头
				const assistantMsg = filtered[originalIndex];
				fullLayer.unshift(assistantMsg);
				
				// 如果 Markdown 层包含这条消息，需要更新
				// 简单处理：重新生成 Markdown 层（去掉这条消息）
				if (markdownLayer.length > 0) {
					const newMarkdownSlice = filtered.slice(
						Math.max(0, filtered.length - fullMessages - markdownMessages - 1),
						originalIndex
					).concat(filtered.slice(originalIndex + 1, filtered.length - fullMessages));
					
					if (newMarkdownSlice.length > 0) {
						const newLines: string[] = ["## 历史对话摘要", ""];
						for (const msg of newMarkdownSlice.slice(-markdownMessages)) {
							const timestamp = formatTimestamp((msg as any).timestamp || Date.now());
							if (msg.role === "user") {
								const text = extractText(msg.content);
								newLines.push(`**${timestamp} [user]:** ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`);
							} else if (msg.role === "assistant") {
								const text = extractText(msg.content);
								const truncated = text.length > 150 ? text.slice(0, 150) + "..." : text;
								newLines.push(`**${timestamp} [assistant]:** ${truncated}`);
							}
						}
						markdownLayer[0].content = newLines.join("\n");
					}
				}
			}
		}
	}
	
	// 6. 合并返回：Markdown 层 + 完整层
	return [...markdownLayer, ...fullLayer];
}
