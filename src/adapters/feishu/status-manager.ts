/**
 * Feishu Status Manager
 *
 * 管理飞书卡片状态更新，实现防抖更新机制
 */

// 注意：sendCardLark 和 updateCardFeishu 已通过 FeishuAdapter 调用，无需直接导入
import type { FeishuAdapter } from "./adapter.js";
import type { ToolCallInfo } from "./types.js";
import {
	buildFeishuCard,
	parseToolStatusText,
	splitReasoningText,
} from "./card-builder.js";

/**
 * 防抖函数
 */
function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			fn(...args);
			timer = null;
		}, delay);
	};
}

/**
 * 状态管理器
 *
 * 管理单次对话中的卡片状态：
 * - 思考过程显示
 * - 工具调用进度
 * - 最终响应
 */
export class StatusManager {
	private statusMessageId: string | null = null;
	private toolHistory: ToolCallInfo[] = [];
	private thinkingContent: string | null = null;
	private startTime: number = Date.now();
	private thinkingStartTime: number | null = null;

	/** 防抖更新卡片 */
	private updateCardDebounced: ReturnType<typeof debounce>;

	constructor(
		private chatId: string,
		private adapter: FeishuAdapter
	) {
		// 防抖更新卡片（500ms）
		this.updateCardDebounced = debounce(() => this.doUpdateCard(), 500);
	}

	/**
	 * 更新工具状态
	 *
	 * 解析工具状态文本并更新卡片
	 */
	async updateToolStatus(text: string): Promise<string> {
		const toolInfo = parseToolStatusText(text);
		if (toolInfo) {
			// 检查是否已存在同名工具调用，如果存在则更新状态
			const existingIndex = this.toolHistory.findIndex(
				(t) => t.name === toolInfo.name
			);
			if (existingIndex >= 0) {
				this.toolHistory[existingIndex] = toolInfo;
			} else {
				this.toolHistory.push(toolInfo);
			}
		}

		// 防抖更新卡片
		this.updateCardDebounced();

		return this.statusMessageId || "";
	}

	/**
	 * 显示思考过程
	 */
	async showThinking(content: string): Promise<void> {
		if (!this.thinkingStartTime) {
			this.thinkingStartTime = Date.now();
		}
		this.thinkingContent = content;
		await this.doUpdateCard();
	}

	/**
	 * 追加思考内容
	 */
	appendThinking(content: string): void {
		if (!this.thinkingStartTime) {
			this.thinkingStartTime = Date.now();
		}
		this.thinkingContent = this.thinkingContent
			? `${this.thinkingContent}\n${content}`
			: content;
		this.updateCardDebounced();
	}

	/**
	 * 完成响应
	 *
	 * 构建最终卡片并重置状态
	 */
	async finish(finalContent: string): Promise<string> {
		// 计算耗时
		const elapsedMs = Date.now() - this.startTime;
		const reasoningElapsedMs = this.thinkingStartTime
			? Date.now() - this.thinkingStartTime
			: undefined;

		// 分离思考内容和回答内容
		const { reasoningText, answerText } = finalContent
			? splitReasoningText(finalContent)
			: {};

		// 使用解析出的思考内容，如果没有则使用累积的思考内容
		const effectiveReasoningText = reasoningText || this.thinkingContent || undefined;
		const effectiveAnswerText = answerText || finalContent;

		// 构建最终卡片
		const card = buildFeishuCard("complete", {
			text: effectiveAnswerText || "",
			reasoningText: effectiveReasoningText,
			reasoningElapsedMs,
			toolCalls: this.toolHistory,
			elapsedMs: elapsedMs,
			footer: {
				status: true,
				elapsed: true,
			},
		});

		// 发送或更新卡片
		if (this.statusMessageId) {
			try {
				await this.adapter.updateCard(this.statusMessageId, card);
			} catch {
				// 更新失败，尝试发送新卡片
				const result = await this.sendNewCard(card);
				this.statusMessageId = result;
			}
		} else {
			const result = await this.sendNewCard(card);
			this.statusMessageId = result;
		}

		const messageId = this.statusMessageId;
		this.reset();
		return messageId;
	}

	/**
	 * 错误响应
	 */
	async error(errorText: string): Promise<string> {
		const elapsedMs = Date.now() - this.startTime;

		const card = buildFeishuCard("complete", {
			text: errorText,
			toolCalls: this.toolHistory,
			elapsedMs,
			isError: true,
			footer: {
				status: true,
				elapsed: true,
			},
		});

		if (this.statusMessageId) {
			try {
				await this.adapter.updateCard(this.statusMessageId, card);
			} catch {
				const result = await this.sendNewCard(card);
				this.statusMessageId = result;
			}
		} else {
			const result = await this.sendNewCard(card);
			this.statusMessageId = result;
		}

		const messageId = this.statusMessageId;
		this.reset();
		return messageId;
	}

	/**
	 * 执行卡片更新
	 */
	private async doUpdateCard(): Promise<void> {
		const card = buildFeishuCard("streaming", {
			text: "",
			toolCalls: this.toolHistory,
			reasoningText: this.thinkingContent ?? undefined,
		});

		if (!this.statusMessageId) {
			const result = await this.sendNewCard(card);
			this.statusMessageId = result;
		} else {
			try {
				await this.adapter.updateCard(this.statusMessageId, card);
			} catch {
				// 更新失败可能是因为消息已删除，发送新卡片
				const result = await this.sendNewCard(card);
				this.statusMessageId = result;
			}
		}
	}

	/**
	 * 发送新卡片
	 */
	private async sendNewCard(card: Record<string, unknown>): Promise<string> {
		const result = await this.adapter.sendCard(this.chatId, card);
		return result.messageId;
	}

	/**
	 * 重置状态
	 */
	private reset(): void {
		this.statusMessageId = null;
		this.toolHistory = [];
		this.thinkingContent = null;
		this.startTime = Date.now();
		this.thinkingStartTime = null;
	}

	/**
	 * 取消防抖定时器
	 */
	cancelPendingUpdate(): void {
		// 通过重新创建防抖函数来取消 pending 的更新
		this.updateCardDebounced = debounce(() => this.doUpdateCard(), 500);
	}
}
