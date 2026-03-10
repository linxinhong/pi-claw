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
		if (!this.currentCardMessageId) {
			// 如果没有卡片，创建一个新的
			const card = this.cardBuilder.buildStreamingCard(content);
			const messageId = await this.messageSender.sendCard(this.chatId, card);
			this.currentCardMessageId = messageId;
			this.currentCardStatus = "streaming";
			return;
		}

		// 更新现有卡片
		const card = this.cardBuilder.buildStreamingCard(content);
		await this.messageSender.updateCard(this.currentCardMessageId, card);
		this.currentCardStatus = "streaming";
	}

	/**
	 * 完成状态，显示最终结果
	 */
	async finishStatus(content: string): Promise<void> {
		if (!this.currentCardMessageId) {
			// 如果没有卡片，直接发送文本
			await this.messageSender.sendText(this.chatId, content);
			return;
		}

		// 计算耗时
		const elapsed = this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined;

		// 更新为完成状态
		const card = this.cardBuilder.buildCompleteCard(content, { elapsed });
		await this.messageSender.updateCard(this.currentCardMessageId, card);
		this.currentCardStatus = "complete";
		this.currentCardMessageId = null;
		this.thinkingStartTime = null;
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

		// 更新卡片显示思考内容
		const card = this.cardBuilder.buildStreamingCard(`💭 思考中...\n\n${content}`);
		await this.messageSender.updateCard(this.currentCardMessageId!, card);
	}

	/**
	 * 完成思考，显示最终回复
	 * @param content 最终回复内容
	 */
	async finishThinking(content: string): Promise<void> {
		if (!this.currentCardMessageId) {
			// 如果没有卡片，直接发送文本
			await this.messageSender.sendText(this.chatId, content);
			return;
		}

		// 计算耗时
		const elapsed = this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined;

		// 更新为完成状态
		const card = this.cardBuilder.buildCompleteCard(content, { elapsed });
		await this.messageSender.updateCard(this.currentCardMessageId, card);
		this.currentCardStatus = "complete";
		this.currentCardMessageId = null;
		this.thinkingStartTime = null;
		this.toolStatusLines = []; // 清空工具状态
	}

	/**
	 * 更新工具执行状态（在卡片上显示）
	 * @param statusText 状态文本，如 "-> 工具名" 或 "-> OK 工具名"
	 */
	async updateToolStatus(statusText: string): Promise<void> {
		// 累积工具状态
		this.toolStatusLines.push(statusText);

		if (!this.currentCardMessageId) {
			// 如果没有卡片，创建一个
			this.thinkingStartTime = Date.now();
			await this.showThinking();
		}

		// 更新卡片显示工具状态
		const content = `⚡ 执行中...\n\n${this.toolStatusLines.join("\n")}`;
		const card = this.cardBuilder.buildStreamingCard(content);
		await this.messageSender.updateCard(this.currentCardMessageId!, card);
	}

	/**
	 * 检查响应是否已经发送（卡片已完成）
	 */
	isResponseSent(): boolean {
		return this.currentCardStatus === "complete";
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
}
