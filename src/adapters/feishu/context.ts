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
import type { ToolCallInfo, MultiCardIds, TimerState, TimelineEvent } from "./types.js";
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

	// 多卡片 ID 管理
	private cardIds: MultiCardIds = {
		statusCardId: null,
		thinkingCardId: null,
		toolCardId: null,
	};

	// 计时器状态
	private timerState: TimerState = {
		startTime: null,
		intervalId: null,
	};

	// 当前状态卡片（兼容旧接口）
	private currentCardMessageId: string | null = null;
	private currentCardStatus: "thinking" | "streaming" | "complete" | null = null;

	// 思考中卡片状态
	private thinkingStartTime: number | null = null;
	private hideThinking: boolean = true;

	// 思考内容（流式累积）
	private thinkingContent: string = "";

	// 累积的工具调用信息
	private toolCalls: ToolCallInfo[] = [];

	// 处理流程时间线
	private timeline: TimelineEvent[] = [];

	// 当前 turn 轮次
	private currentTurn: number = 0;

	// 工具卡片创建锁（防止并发创建多张卡片）
	private toolCardCreating: boolean = false;

	// 响应是否已发送标志
	private _responseSent: boolean = false;

	// 节流相关
	private lastCardUpdateTime: number = 0;
	private pendingFlushTimer: NodeJS.Timeout | null = null;
	private pendingContent: string = ""; // 累积的内容
	private readonly THROTTLE_MS = 1000; // 节流时间
	private readonly BATCH_AFTER_GAP_MS = 300; // 长时间空闲后的批量延迟
	private readonly LONG_GAP_THRESHOLD_MS = 2000; // 长时间空闲阈值

	constructor(options: FeishuPlatformContextOptions) {
		this.chatId = options.chatId;
		this.larkClient = options.larkClient;
		this.messageSender = options.messageSender;
		this.store = options.store;
		this.logger = options.logger;
		this.cardBuilder = new CardBuilder();
	}

	/**
	 * 设置是否隐藏思考过程
	 */
	setHideThinking(hide: boolean): void {
		this.hideThinking = hide;
	}

	/**
	 * 检查是否隐藏思考过程
	 */
	isThinkingHidden(): boolean {
		return this.hideThinking;
	}

	// ========================================================================
	// PlatformContext Implementation
	// ========================================================================

	async sendText(chatId: string, text: string): Promise<string> {
		return await this.messageSender.sendText(chatId, text);
	}

	async updateMessage(messageId: string, content: string): Promise<void> {
		await this.messageSender.update(messageId, {
			type: "text",
			content,
		});
	}

	async deleteMessage(messageId: string): Promise<void> {
		await this.larkClient.deleteMessage(messageId);
	}

	async uploadFile(filePath: string, chatId: string): Promise<void> {
		const fileKey = await this.larkClient.uploadFile(filePath);
		await this.messageSender.sendFile(chatId, fileKey);
	}

	async uploadImage(imagePath: string): Promise<string> {
		return await this.larkClient.uploadImage(imagePath);
	}

	async sendImage(chatId: string, imageKey: string): Promise<string> {
		return await this.messageSender.sendImage(chatId, imageKey);
	}

	async sendVoiceMessage(chatId: string, filePath: string): Promise<string> {
		// 飞书需要先上传音频文件，然后发送
		const fileKey = await this.larkClient.uploadFile(filePath);
		return await this.messageSender.sendFile(chatId, fileKey);
	}

	async postInThread(chatId: string, parentMessageId: string, text: string): Promise<string> {
		return await this.messageSender.replyInThread(chatId, parentMessageId, text);
	}

	// ========================================================================
	// Feishu Specific Methods
	// ========================================================================

	/**
	 * 发送卡片消息
	 */
	async sendCard(chatId: string, card: any): Promise<string> {
		return await this.messageSender.sendCard(chatId, card);
	}

	/**
	 * 更新卡片消息
	 */
	async updateCard(messageId: string, card: any): Promise<void> {
		await this.messageSender.updateCard(messageId, card);
	}

	/**
	 * 节流卡片更新
	 * - 如果距离上次更新超过 THROTTLE_MS，立即更新
	 * - 如果在节流窗口内，安排延迟更新
	 * - 如果长时间空闲后（>2秒），先延迟 300ms 批量更新
	 * - 捕获 230020 速率限制错误并静默跳过
	 */
	private async throttledCardUpdate(): Promise<void> {
		const now = Date.now();
		const timeSinceLastUpdate = now - this.lastCardUpdateTime;

		// 清除之前的待处理定时器
		if (this.pendingFlushTimer) {
			clearTimeout(this.pendingFlushTimer);
			this.pendingFlushTimer = null;
		}

		// 检查是否是长时间空闲后的更新（可能是批量事件的开始）
		if (timeSinceLastUpdate > this.LONG_GAP_THRESHOLD_MS) {
			// 延迟一小段时间，让批量事件累积
			this.pendingFlushTimer = setTimeout(async () => {
				this.pendingFlushTimer = null;
				await this.doFlushCardUpdate();
			}, this.BATCH_AFTER_GAP_MS);
			return;
		}

		// 如果距离上次更新超过节流时间，立即更新
		if (timeSinceLastUpdate >= this.THROTTLE_MS) {
			await this.doFlushCardUpdate();
			return;
		}

		// 在节流窗口内，安排延迟更新
		const delay = this.THROTTLE_MS - timeSinceLastUpdate;
		this.pendingFlushTimer = setTimeout(async () => {
			this.pendingFlushTimer = null;
			await this.doFlushCardUpdate();
		}, delay);
	}

	/**
	 * 执行实际的卡片更新
	 */
	private async doFlushCardUpdate(): Promise<void> {
		if (!this.pendingContent) return;

		const content = this.pendingContent;
		const timeline = this.getTimeline();

		// 调试日志
		console.log("[DEBUG] doFlushCardUpdate:", {
			contentLength: content?.length || 0,
			timelineCount: timeline?.length || 0,
			timeline: timeline,
		});

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildStreamingCard(content, { timeline });
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.lastCardUpdateTime = Date.now();
				this.currentCardStatus = "streaming";
				return;
			} catch (error: any) {
				// 检查是否是速率限制错误 (230020)
				if (error?.code === 230020) {
					// 静默跳过，等待下次更新
					this.logger?.debug("Card update rate limited, skipping");
					return;
				}
				this.logger?.error("Failed to update card", undefined, error as Error);
				// 不清除 currentCardMessageId，保留以便下次重试
			}
		}

		// 没有卡片，创建新卡片
		try {
			if (!this.thinkingStartTime) {
				this.thinkingStartTime = Date.now();
			}
			const card = this.cardBuilder.buildStreamingCard(content, { timeline });
			const messageId = await this.messageSender.sendCard(this.chatId, card);
			this.currentCardMessageId = messageId;
			this.lastCardUpdateTime = Date.now();
			this.currentCardStatus = "streaming";
		} catch (error: any) {
			// 检查是否是速率限制错误
			if (error?.code === 230020) {
				this.logger?.debug("Card send rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to send card", undefined, error as Error);
		}
	}

	/**
	 * 清理节流相关的定时器和状态
	 */
	cleanupThrottle(): void {
		if (this.pendingFlushTimer) {
			clearTimeout(this.pendingFlushTimer);
			this.pendingFlushTimer = null;
		}
	}

	/**
	 * 显示思考中状态
	 */
	async showThinking(): Promise<string> {
		const card = this.cardBuilder.buildThinkingCard();
		const messageId = await this.messageSender.sendCard(this.chatId, card);
		this.currentCardMessageId = messageId;
		this.currentCardStatus = "thinking";
		return messageId;
	}

	/**
	 * 更新流式输出内容
	 */
	async updateStreaming(content: string): Promise<void> {
		const timeline = this.getTimeline();

		// 调试日志
		console.log("[DEBUG] updateStreaming:", {
			contentLength: content?.length || 0,
			timelineCount: timeline?.length || 0,
			timeline: timeline,
		});

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildStreamingCard(content, { timeline });
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.currentCardStatus = "streaming";
				return;
			} catch (error: any) {
				// 检查是否是速率限制错误 (230020)
				if (error?.code === 230020) {
					// 静默跳过，等待下次更新
					this.logger?.debug("Streaming card update rate limited, skipping");
					return;
				}
				// 更新失败，记录错误，但不清除 currentCardMessageId
				this.logger?.error("Failed to update card", undefined, error as Error);
				// 继续尝试创建新卡片
			}
		}

		// 创建新卡片
		try {
			const card = this.cardBuilder.buildStreamingCard(content, { timeline });
			const messageId = await this.messageSender.sendCard(this.chatId, card);
			this.currentCardMessageId = messageId;
			this.currentCardStatus = "streaming";
		} catch (error: any) {
			// 检查是否是速率限制错误
			if (error?.code === 230020) {
				this.logger?.debug("Streaming card send rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to send card", undefined, error as Error);
			// 发送失败，降级为文本消息
			await this.messageSender.sendText(this.chatId, content);
		}
	}

	/**
	 * 完成状态，显示最终结果
	 */
	async finishStatus(content: string): Promise<void> {
		// 清理节流定时器
		this.cleanupThrottle();

		// 计算耗时
		const elapsed = this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined;

		// 获取时间线
		const timeline = this.getTimeline();

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildCompleteCard(content, {
					elapsed,
					toolCalls: this.toolCalls,
					timeline,
				});
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.currentCardStatus = "complete";
				this.currentCardMessageId = null;
				this.thinkingStartTime = null;
				this.toolCalls = []; // 清空工具调用
				this.timeline = []; // 清空时间线
				this.pendingContent = ""; // 清空累积内容
				return;
			} catch (error) {
				this.logger?.error("Failed to update final card", undefined, error as Error);
				// 更新失败，继续发送文本
			}
		}

		// 没有卡片或更新失败，发送文本
		await this.messageSender.sendText(this.chatId, content);
		this.currentCardMessageId = null;
		this.thinkingStartTime = null;
		this.toolCalls = [];
		this.timeline = []; // 清空时间线
		this.pendingContent = ""; // 清空累积内容
	}

	// ========================================================================
	// 思考中卡片（CoreAgent 兼容接口）
	// ========================================================================

	/**
	 * 开始思考（发送思考中卡片）
	 * 创建状态卡片 + 思考卡片 + 启动计时器
	 */
	async startThinking(): Promise<void> {
		const now = Date.now();
		this.thinkingStartTime = now;
		this.timerState.startTime = now;

		// 重置状态
		this.hideThinking = false; // 允许显示思考内容
		this.thinkingContent = "";
		this.toolCalls = [];
		this.timeline = []; // 清空时间线
		this.currentTurn = 0; // 重置 turn 轮次
		this.toolCardCreating = false; // 重置工具卡片创建锁
		this.cardIds = {
			statusCardId: null,
			thinkingCardId: null,
			toolCardId: null,
		};

		// 创建状态卡片
		const statusCard = this.cardBuilder.buildStatusCard(undefined, "processing");
		const statusMessageId = await this.messageSender.sendCard(this.chatId, statusCard);
		this.cardIds.statusCardId = statusMessageId;

		// 创建思考卡片
		const thinkingCard = this.cardBuilder.buildThinkingContentCard("💭 思考中...");
		const thinkingMessageId = await this.messageSender.sendCard(this.chatId, thinkingCard);
		this.cardIds.thinkingCardId = thinkingMessageId;

		// 更新状态
		this.currentCardStatus = "thinking";

		// 启动计时器
		this.startTimer();
	}

	/**
	 * 更新思考内容
	 * @param content 思考内容
	 */
	async updateThinking(content: string): Promise<void> {
		// 添加到时间线（只在内容第一次更新时添加）
		if (!this.thinkingContent && content) {
			this.addThinkingToTimeline(content);
		}

		// 如果隐藏思考过程，不更新卡片内容
		if (this.hideThinking) {
			return;
		}

		// 如果没有思考卡片，创建一个
		if (!this.cardIds.thinkingCardId) {
			const thinkingCard = this.cardBuilder.buildThinkingContentCard("💭 思考中...");
			const messageId = await this.messageSender.sendCard(this.chatId, thinkingCard);
			this.cardIds.thinkingCardId = messageId;
		}

		// 累积思考内容
		this.thinkingContent = content;

		// 节流更新思考卡片
		this.pendingContent = content;
		await this.throttledThinkingCardUpdate();
	}

	/**
	 * 完成思考，显示最终回复
	 * @param content 最终回复内容
	 */
	async finishThinking(content: string): Promise<void> {
		// 停止计时器
		this.stopTimer();

		// 清理节流定时器
		this.cleanupThrottle();

		// 计算耗时
		const elapsed = this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined;

		// 1. 更新状态卡片为完成状态
		if (this.cardIds.statusCardId) {
			try {
				const statusCard = this.cardBuilder.buildStatusCard(elapsed, "complete");
				await this.messageSender.updateCard(this.cardIds.statusCardId, statusCard);
			} catch (error) {
				this.logger?.error("Failed to update status card", undefined, error as Error);
			}
		}

		// 2. 更新思考卡片为最终结果
		if (this.cardIds.thinkingCardId) {
			try {
				const resultCard = this.cardBuilder.buildThinkingContentCard(content);
				await this.messageSender.updateCard(this.cardIds.thinkingCardId, resultCard);
			} catch (error) {
				this.logger?.error("Failed to update thinking card", undefined, error as Error);
			}
		}

		// 3. 如果没有工具卡片，但有工具调用，创建工具卡片
		// 如果有工具卡片，保持不变（工具调用已经在处理中更新）
		// 注意：根据计划，完成后工具卡片保持（或删除如果没有工具调用）

		// 清理状态
		this.currentCardStatus = "complete";
		this.thinkingStartTime = null;
		this.toolCalls = [];
		this.timeline = []; // 清空时间线
		this.currentTurn = 0; // 重置 turn 轮次
		this.thinkingContent = "";
		this.pendingContent = "";
		this._responseSent = true;

		// 重置卡片 ID（保留清理逻辑）
		// 注意：这里不重置 cardIds，因为卡片已经发送完成
		// 下次 startThinking 会重新创建卡片
		this.cardIds = {
			statusCardId: null,
			thinkingCardId: null,
			toolCardId: null,
		};
	}

	/**
	 * 更新工具执行状态（在卡片上显示）
	 * @param statusText 状态文本，如 "-> 工具名" 或 "-> OK 工具名"
	 */
	async updateToolStatus(statusText: string): Promise<void> {
		// 兼容旧接口：解析状态文本
		// 格式可能是 "-> 工具名" 或 "-> OK 工具名" 或 "-> X 工具名"
		const match = statusText.match(/^->\s*(OK|X)?\s*(.+)$/);
		if (match) {
			const [, status, toolName] = match;
			if (status === "OK") {
				// 工具成功完成
				await this.endToolCall(toolName, true);
			} else if (status === "X") {
				// 工具失败
				await this.endToolCall(toolName, false);
			} else {
				// 工具开始
				await this.startToolCall(toolName);
			}
		}
	}

	/**
	 * 开始工具调用（创建/更新工具卡片）
	 */
	async startToolCall(toolName: string, args?: Record<string, any>): Promise<void> {
		this.toolCalls.push({
			name: toolName,
			args: args,
			status: "running",
		});

		// 添加到时间线
		this.addToolCallToTimeline(toolName, args, "running");

		// 更新或创建工具卡片
		await this.updateOrCreateToolCard();
	}

	/**
	 * 更新或创建工具卡片
	 * 使用锁机制防止并发创建多张卡片
	 */
	private async updateOrCreateToolCard(): Promise<void> {
		if (this.toolCalls.length === 0) return;

		try {
			const toolCard = this.cardBuilder.buildToolCallsCard(this.toolCalls);

			if (this.cardIds.toolCardId) {
				// 更新现有卡片
				await this.messageSender.updateCard(this.cardIds.toolCardId, toolCard);
			} else if (!this.toolCardCreating) {
				// 创建新卡片（加锁防止并发）
				this.toolCardCreating = true;
				try {
					const messageId = await this.messageSender.sendCard(this.chatId, toolCard);
					this.cardIds.toolCardId = messageId;
				} finally {
					this.toolCardCreating = false;
				}
			}
			// 如果正在创建中，跳过本次更新（下一次调用会更新）
		} catch (error: any) {
			// 检查是否是速率限制错误 (230020)
			if (error?.code === 230020) {
				this.logger?.debug("Tool card update rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to update tool card", undefined, error as Error);
		}
	}

	/**
	 * 结束工具调用（更新工具卡片）
	 */
	async endToolCall(toolName: string, success: boolean, result?: string): Promise<void> {
		// 找到最近一个同名的 running 状态工具
		const toolCall = [...this.toolCalls].reverse().find(tc => tc.name === toolName && tc.status === "running");
		if (toolCall) {
			toolCall.status = success ? "success" : "error";
			toolCall.result = result;
		}

		// 更新时间线中对应的工具状态
		this.updateToolCallInTimeline(toolName, success ? "success" : "error");

		// 更新工具卡片
		await this.updateOrCreateToolCard();
	}

	/**
	 * 构建工具调用内容
	 */
	private buildToolCallsContent(): string {
		if (this.toolCalls.length === 0) {
			return "";
		}

		const lines = this.toolCalls.map(tc => {
			const statusIcon = tc.status === "success" ? "✅" :
			                   tc.status === "error" ? "❌" :
			                   tc.status === "running" ? "🔄" : "⏳";

			// 格式化参数
			const argsStr = tc.args ? this.formatToolArgs(tc.args) : "";
			const argsDisplay = argsStr ? `: ${argsStr}` : "";

			return `${statusIcon} \`${tc.name}\`${argsDisplay}`;
		});

		return `⚡ **工具调用**\n${lines.join("\n")}`;
	}

	// ========================================================================
	// Timeline Methods
	// ========================================================================

	/**
	 * 开始新的 turn 轮次
	 */
	startNewTurn(): void {
		this.currentTurn++;
	}

	/**
	 * 获取当前 turn 轮次
	 */
	getCurrentTurn(): number {
		return this.currentTurn;
	}

	/**
	 * 添加思考内容到时间线
	 * @param content 思考内容
	 */
	addThinkingToTimeline(content: string): void {
		// 截断思考内容（最多显示 50 个字符）
		const truncated = content.length > 50 ? content.slice(0, 50) + "..." : content;

		this.timeline.push({
			type: "thinking",
			turn: this.currentTurn || 1,
			content: truncated,
		});
	}

	/**
	 * 添加工具调用到时间线
	 */
	private addToolCallToTimeline(toolName: string, args?: Record<string, any>, status?: "pending" | "running" | "success" | "error"): void {
		const argsStr = args ? this.formatToolArgs(args) : "";

		this.timeline.push({
			type: "toolcall",
			turn: this.currentTurn || 1,
			content: toolName,
			args: argsStr || undefined,
			status: status || "running",
		});
	}

	/**
	 * 更新时间线中工具调用的状态
	 */
	private updateToolCallInTimeline(toolName: string, status: "success" | "error"): void {
		// 从后往前找到最近的同名工具
		for (let i = this.timeline.length - 1; i >= 0; i--) {
			const event = this.timeline[i];
			if (event.type === "toolcall" && event.content === toolName && event.status === "running") {
				event.status = status;
				break;
			}
		}
	}

	/**
	 * 获取时间线
	 */
	getTimeline(): TimelineEvent[] {
		return [...this.timeline];
	}

	/**
	 * 清空时间线
	 */
	clearTimeline(): void {
		this.timeline = [];
	}

	// ========================================================================
	// Multi-Card Timer Methods
	// ========================================================================

	/**
	 * 启动计时器
	 */
	private startTimer(): void {
		this.timerState.startTime = Date.now();
		this.timerState.intervalId = setInterval(async () => {
			if (!this.timerState.startTime || !this.cardIds.statusCardId) return;
			const elapsed = Date.now() - this.timerState.startTime;
			await this.updateStatusCard(elapsed);
		}, 1000);
	}

	/**
	 * 停止计时器
	 */
	private stopTimer(): void {
		if (this.timerState.intervalId) {
			clearInterval(this.timerState.intervalId);
			this.timerState.intervalId = null;
		}
		this.timerState.startTime = null;
	}

	/**
	 * 更新状态卡片
	 */
	private async updateStatusCard(elapsed: number): Promise<void> {
		if (!this.cardIds.statusCardId) return;

		try {
			const statusCard = this.cardBuilder.buildStatusCard(elapsed, "processing");
			await this.messageSender.updateCard(this.cardIds.statusCardId, statusCard);
		} catch (error: any) {
			// 检查是否是速率限制错误 (230020)
			if (error?.code === 230020) {
				this.logger?.debug("Status card update rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to update status card", undefined, error as Error);
		}
	}

	/**
	 * 更新工具卡片
	 */
	private async updateToolCard(): Promise<void> {
		if (!this.cardIds.toolCardId || this.toolCalls.length === 0) return;

		try {
			const toolCard = this.cardBuilder.buildToolCallsCard(this.toolCalls);
			await this.messageSender.updateCard(this.cardIds.toolCardId, toolCard);
		} catch (error: any) {
			// 检查是否是速率限制错误 (230020)
			if (error?.code === 230020) {
				this.logger?.debug("Tool card update rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to update tool card", undefined, error as Error);
		}
	}

	/**
	 * 节流更新思考卡片
	 */
	private async throttledThinkingCardUpdate(): Promise<void> {
		const now = Date.now();
		const timeSinceLastUpdate = now - this.lastCardUpdateTime;

		// 清除之前的待处理定时器
		if (this.pendingFlushTimer) {
			clearTimeout(this.pendingFlushTimer);
			this.pendingFlushTimer = null;
		}

		// 如果距离上次更新超过节流时间，立即更新
		if (timeSinceLastUpdate >= this.THROTTLE_MS) {
			await this.doFlushThinkingCardUpdate();
			return;
		}

		// 在节流窗口内，安排延迟更新
		const delay = this.THROTTLE_MS - timeSinceLastUpdate;
		this.pendingFlushTimer = setTimeout(async () => {
			this.pendingFlushTimer = null;
			await this.doFlushThinkingCardUpdate();
		}, delay);
	}

	/**
	 * 执行实际的思考卡片更新
	 */
	private async doFlushThinkingCardUpdate(): Promise<void> {
		if (!this.pendingContent || !this.cardIds.thinkingCardId) return;

		try {
			const thinkingCard = this.cardBuilder.buildThinkingContentCard(this.pendingContent);
			await this.messageSender.updateCard(this.cardIds.thinkingCardId, thinkingCard);
			this.lastCardUpdateTime = Date.now();
		} catch (error: any) {
			// 检查是否是速率限制错误 (230020)
			if (error?.code === 230020) {
				this.logger?.debug("Thinking card update rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to update thinking card", undefined, error as Error);
		}
	}

	/**
	 * 格式化工具参数（简化显示）
	 */
	private formatToolArgs(args: Record<string, any>): string {
		const keys = Object.keys(args).filter(k => !k.startsWith("_"));
		if (keys.length === 0) return "";

		// 对于 bash 工具，显示命令
		if (args.command) {
			const cmd = String(args.command);
			return cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd;
		}

		// 对于 read 工具，显示文件路径
		if (args.file_path) {
			const path = String(args.file_path);
			return path.split("/").pop() || path;
		}

		// 其他工具，显示第一个参数的值
		const firstKey = keys[0];
		const value = String(args[firstKey]);
		return value.length > 50 ? value.substring(0, 50) + "..." : value;
	}

	/**
	 * 添加表情反应
	 */
	async addReaction(messageId: string, emoji: string): Promise<void> {
		await this.larkClient.addReaction(messageId, emoji);
	}

	/**
	 * 删除表情反应
	 */
	async removeReaction(messageId: string, emoji: string, reactionId: string): Promise<void> {
		await this.larkClient.removeReaction(messageId, emoji, reactionId);
	}

	/**
	 * 获取平台特定功能
	 */
	getPlatformFeature?<T = any>(feature: string): T {
		switch (feature) {
			case "sendCard":
				return this.sendCard.bind(this) as T;

			case "updateCard":
				return this.updateCard.bind(this) as T;

			case "showThinking":
				return this.showThinking.bind(this) as T;

			case "updateStreaming":
				return this.updateStreaming.bind(this) as T;

			case "finishStatus":
				return this.finishStatus.bind(this) as T;

			case "startThinking":
				return this.startThinking.bind(this) as T;

			case "updateThinking":
				return this.updateThinking.bind(this) as T;

			case "finishThinking":
				return this.finishThinking.bind(this) as T;

			case "isThinkingHidden":
				return this.isThinkingHidden.bind(this) as T;

			case "addReaction":
				return this.addReaction.bind(this) as T;

			case "cardBuilder":
				return this.cardBuilder as T;

			default:
				throw new Error(`Unknown platform feature: ${feature}`);
		}
	}

	/**
	 * 获取平台工具
	 */
	async getTools(context: {
		chatId: string;
		workspaceDir: string;
		channelDir: string;
	}): Promise<PlatformTool[]> {
		// 暂时返回空数组，工具将在 tools/ 模块中实现
		return [];
	}

	// ========================================================================
	// PlatformContext Optional Methods
	// ========================================================================

	/**
	 * 检查响应是否已发送
	 */
	isResponseSent(): boolean {
		return this._responseSent;
	}

	/**
	 * 完成响应（更新状态卡片为最终状态）
	 */
	async finalizeResponse(content: string): Promise<void> {
		await this.finishStatus(content);
		this._responseSent = true;
	}
}
