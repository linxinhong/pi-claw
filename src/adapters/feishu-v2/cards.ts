/**
 * Feishu V2 Cards Module
 *
 * 飞书卡片系统 - 构建和发送卡片消息
 */

import type * as lark from "@larksuiteoapi/node-sdk";
import type { CardContent, CardElement } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 卡片配置
 */
export interface FeishuCardConfig {
	schema?: string;
	config?: {
		wide_mode?: boolean;
		update_multi?: boolean;
	};
	header?: {
		title?: { tag: string; content: string };
		template?: string;
	};
	elements: CardElement[];
}

// ============================================================================
// 卡片构建函数
// ============================================================================

/**
 * 构建文本卡片
 */
export function buildTextCard(text: string): CardContent {
	return {
		type: "template",
		data: {
			config: {
				wide_screen_mode: true,
			},
			elements: [
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content: text,
					},
				},
			],
		},
	};
}

/**
 * 构建代码卡片
 */
export function buildCodeCard(code: string, language?: string): CardContent {
	return {
		type: "template",
		data: {
			config: {
				wide_screen_mode: true,
			},
			elements: [
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content: `\`\`\`${language || ""}\n${code}\n\`\`\``,
					},
				},
			],
		},
	};
}

/**
 * 构建错误卡片
 */
export function buildErrorCard(message: string, details?: string): CardContent {
	const content = details ? `${message}\n\n详细信息：${details}` : message;
	return {
		type: "template",
		data: {
			config: {
				wide_screen_mode: true,
			},
			header: {
				title: {
					tag: "plain_text",
					content: "❌ 错误",
				},
				template: "red",
			},
			elements: [
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content,
					},
				},
			],
		},
	};
}

/**
 * 构建成功卡片
 */
export function buildSuccessCard(message: string): CardContent {
	return {
		type: "template",
		data: {
			config: {
				wide_screen_mode: true,
			},
			header: {
				title: {
					tag: "plain_text",
					content: "✅ 成功",
				},
				template: "green",
			},
			elements: [
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content: message,
					},
				},
			],
		},
	};
}

/**
 * 构建状态卡片
 */
export function buildStatusCard(options: {
	status: string;
	toolHistory?: string[];
}): CardContent {
	const elements: CardElement[] = [
		{
			tag: "div",
			text: {
				tag: "lark_md",
				content: `**${options.status}**`,
			},
		},
	];

	if (options.toolHistory && options.toolHistory.length > 0) {
		elements.push({
			tag: "hr",
		});

		for (const tool of options.toolHistory) {
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: tool,
				},
			});
		}
	}

	return {
		type: "template",
		data: {
			config: {
				wide_screen_mode: true,
			},
			elements,
		},
	};
}

/**
 * 构建进度卡片
 */
export function buildProgressCard(
	status: string,
	toolHistory: string[],
): CardContent {
	const elements: CardElement[] = [
		{
			tag: "div",
			text: {
				tag: "lark_md",
				content: `**${status}**`,
			},
		},
	];

	if (toolHistory.length > 0) {
		elements.push({
			tag: "hr",
		});

		for (const tool of toolHistory) {
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: tool,
				},
			});
		}
	}

	return {
		type: "template",
		data: {
			config: {
				wide_screen_mode: true,
			},
			elements,
		},
	};
}

/**
 * 智能构建卡片（根据内容自动选择样式）
 */
export function autoBuildCard(text: string): CardContent {
	// 检测是否包含代码块
	if (text.includes("```")) {
		return buildCodeCard(text);
	}

	// 检测是否是错误消息
	if (text.toLowerCase().includes("error") || text.includes("错误") || text.includes("失败")) {
		return buildErrorCard(text);
	}

	// 检测是否是成功消息
	if (text.includes("成功") || text.includes("完成") || text.includes("✅")) {
		return buildSuccessCard(text);
	}

	// 默认使用文本卡片
	return buildTextCard(text);
}

// ============================================================================
// 卡片发送类
// ============================================================================

/**
 * 飞书卡片发送器
 */
export class FeishuCards {
	private client: lark.Client;

	constructor(client: lark.Client) {
		this.client = client;
	}

	/**
	 * 发送卡片消息
	 */
	async sendCard(
		receiveId: string,
		card: CardContent,
		options?: {
			receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
			rootId?: string;
		},
	): Promise<string> {
		const result = await this.client.im.message.create({
			params: {
				receive_id_type: options?.receiveIdType || "chat_id",
			},
			data: {
				receive_id: receiveId,
				msg_type: "interactive",
				content: JSON.stringify(card),
				...(options?.rootId && { root_id: options.rootId }),
			} as any,
		});

		if (result.code !== 0) {
			throw new Error(`Failed to send card: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	/**
	 * 更新卡片消息
	 */
	async updateCard(messageId: string, card: CardContent): Promise<void> {
		const result = await this.client.im.message.patch({
			path: {
				message_id: messageId,
			},
			data: {
				content: JSON.stringify(card),
			},
		});

		if (result.code !== 0) {
			throw new Error(`Failed to update card: ${result.msg}`);
		}
	}

	/**
	 * 发送文本卡片
	 */
	async sendTextCard(receiveId: string, text: string): Promise<string> {
		const card = buildTextCard(text);
		return this.sendCard(receiveId, card);
	}

	/**
	 * 发送错误卡片
	 */
	async sendErrorCard(receiveId: string, message: string, details?: string): Promise<string> {
		const card = buildErrorCard(message, details);
		return this.sendCard(receiveId, card);
	}

	/**
	 * 发送成功卡片
	 */
	async sendSuccessCard(receiveId: string, message: string): Promise<string> {
		const card = buildSuccessCard(message);
		return this.sendCard(receiveId, card);
	}
}
