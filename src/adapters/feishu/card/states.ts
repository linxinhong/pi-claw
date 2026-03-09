/**
 * Card States
 *
 * 卡片状态管理
 */

import type { CardStatus, CardContext, ToolCallInfo } from "../types.js";

// ============================================================================
// Card State Manager
// ============================================================================

/**
 * 卡片状态管理器
 */
export class CardStateManager {
	private cards: Map<string, CardContext> = new Map();

	/**
	 * 创建新卡片上下文
	 */
	create(messageId: string, chatId: string): CardContext {
		const context: CardContext = {
			messageId,
			chatId,
			status: "thinking",
			startTime: Date.now(),
			content: "",
			toolCalls: [],
		};

		this.cards.set(messageId, context);
		return context;
	}

	/**
	 * 获取卡片上下文
	 */
	get(messageId: string): CardContext | undefined {
		return this.cards.get(messageId);
	}

	/**
	 * 更新卡片状态
	 */
	updateStatus(messageId: string, status: CardStatus): void {
		const context = this.cards.get(messageId);
		if (context) {
			context.status = status;
		}
	}

	/**
	 * 更新卡片内容
	 */
	updateContent(messageId: string, content: string): void {
		const context = this.cards.get(messageId);
		if (context) {
			context.content = content;
		}
	}

	/**
	 * 追加卡片内容
	 */
	appendContent(messageId: string, content: string): void {
		const context = this.cards.get(messageId);
		if (context) {
			context.content += content;
		}
	}

	/**
	 * 设置思考内容
	 */
	setThinkingContent(messageId: string, content: string): void {
		const context = this.cards.get(messageId);
		if (context) {
			context.thinkingContent = content;
		}
	}

	/**
	 * 添加工具调用
	 */
	addToolCall(messageId: string, toolCall: ToolCallInfo): void {
		const context = this.cards.get(messageId);
		if (context) {
			if (!context.toolCalls) {
				context.toolCalls = [];
			}
			context.toolCalls.push(toolCall);
		}
	}

	/**
	 * 更新工具调用状态
	 */
	updateToolCallStatus(messageId: string, index: number, status: ToolCallInfo["status"], result?: string): void {
		const context = this.cards.get(messageId);
		if (context && context.toolCalls && context.toolCalls[index]) {
			context.toolCalls[index].status = status;
			if (result !== undefined) {
				context.toolCalls[index].result = result;
			}
		}
	}

	/**
	 * 完成卡片
	 */
	complete(messageId: string): CardContext | undefined {
		const context = this.cards.get(messageId);
		if (context) {
			context.status = "complete";
		}
		return context;
	}

	/**
	 * 删除卡片上下文
	 */
	delete(messageId: string): boolean {
		return this.cards.delete(messageId);
	}

	/**
	 * 获取卡片耗时
	 */
	getElapsed(messageId: string): number {
		const context = this.cards.get(messageId);
		if (context) {
			return Date.now() - context.startTime;
		}
		return 0;
	}

	/**
	 * 清空所有卡片
	 */
	clear(): void {
		this.cards.clear();
	}
}
