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

	// 当前状态卡片
	private currentCardMessageId: string | null = null;
	private currentCardStatus: "thinking" | "streaming" | "complete" | null = null;

	// 思考中卡片状态
	private thinkingStartTime: number | null = null;
	private hideThinking: boolean = true;

	// 累积的工具状态
	private toolStatusLines: string[] = [];

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

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildStreamingCard(content);
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
			const card = this.cardBuilder.buildStreamingCard(content);
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
		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildStreamingCard(content);
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
			const card = this.cardBuilder.buildStreamingCard(content);
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

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildCompleteCard(content, { elapsed });
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.currentCardStatus = "complete";
				this.currentCardMessageId = null;
				this.thinkingStartTime = null;
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
		this.pendingContent = ""; // 清空累积内容
	}

	// ========================================================================
	// 思考中卡片（CoreAgent 兼容接口）
	// ========================================================================

	/**
	 * 开始思考（发送思考中卡片）
	 */
	async startThinking(): Promise<void> {
		this.thinkingStartTime = Date.now();
		await this.showThinking();
	}

	/**
	 * 更新思考内容
	 * @param content 思考内容
	 */
	async updateThinking(content: string): Promise<void> {
		// 如果隐藏思考过程，不更新卡片内容
		if (this.hideThinking) {
			return;
		}

		if (!this.currentCardMessageId) {
			// 如果没有卡片，创建一个
			this.thinkingStartTime = Date.now();
			await this.showThinking();
		}

		// 累积内容并使用节流更新
		this.pendingContent = `💭 思考中...\n\n${content}`;
		await this.throttledCardUpdate();
	}

	/**
	 * 完成思考，显示最终回复
	 * @param content 最终回复内容
	 */
	async finishThinking(content: string): Promise<void> {
		// 清理节流定时器
		this.cleanupThrottle();

		// 计算耗时
		const elapsed = this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined;

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildCompleteCard(content, { elapsed });
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.currentCardStatus = "complete";
				this.currentCardMessageId = null;
				this.thinkingStartTime = null;
				this.toolStatusLines = []; // 清空工具状态
				this.pendingContent = ""; // 清空累积内容
				this._responseSent = true;
				return;
			} catch (error) {
				this.logger?.error("Failed to update final thinking card", undefined, error as Error);
				// 更新失败，继续发送文本
			}
		}

		// 没有卡片或更新失败，发送文本
		await this.messageSender.sendText(this.chatId, content);
		this.currentCardMessageId = null;
		this.thinkingStartTime = null;
		this.toolStatusLines = [];
		this.pendingContent = ""; // 清空累积内容
		this._responseSent = true;
	}

	/**
	 * 更新工具执行状态（在卡片上显示）
	 * @param statusText 状态文本，如 "-> 工具名" 或 "-> OK 工具名"
	 */
	async updateToolStatus(statusText: string): Promise<void> {
		// 累积工具状态
		this.toolStatusLines.push(statusText);

		// 累积内容并使用节流更新
		this.pendingContent = `⚡ 执行中...\n\n${this.toolStatusLines.join("\n")}`;
		await this.throttledCardUpdate();
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
