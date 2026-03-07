/**
 * Feishu Platform Context
 *
 * 飞书平台上下文 - 提供飞书特定的能力
 */

import type { PlatformContext } from "../../core/platform/context.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 飞书上下文配置
 */
export interface FeishuContextConfig {
	/** 飞书客户端 */
	client: any;
	/** 频道 ID */
	chatId: string;
	/** 发送文本消息的函数 */
	postMessage: (chatId: string, text: string) => Promise<string>;
	/** 更新消息的函数 */
	updateMessage: (messageId: string, text: string) => Promise<void>;
	/** 删除消息的函数 */
	deleteMessage: (messageId: string) => Promise<void>;
	/** 上传文件的函数 */
	uploadFile: (chatId: string, filePath: string, title?: string) => Promise<void>;
	/** 上传图片的函数 */
	uploadImage: (imagePath: string) => Promise<string>;
	/** 发送图片的函数 */
	sendImage: (chatId: string, imageKey: string) => Promise<string>;
	/** 发送语音消息的函数 */
	sendVoiceMessage: (chatId: string, filePath: string) => Promise<string>;
	/** 在线程中回复的函数 */
	postInThread: (chatId: string, parentMessageId: string, text: string) => Promise<string>;
}

// ============================================================================
// Feishu Platform Context
// ============================================================================

/**
 * 飞书平台上下文实现
 */
export class FeishuPlatformContext implements PlatformContext {
	readonly platform = "feishu";
	private config: FeishuContextConfig;
	private statusMessageId: string | null = null; // 状态消息 ID
	private toolHistory: string[] = []; // 工具执行历史

	constructor(config: FeishuContextConfig) {
		this.config = config;
	}

	async sendText(chatId: string, text: string): Promise<string> {
		// 如果是工具状态消息（以 "_ ->" 开头），更新状态卡片
		if (text.startsWith("_ -> ") || text.startsWith("_Error:")) {
			const cleanText = text.replace(/^_/, "").replace(/_$/, "");
			this.toolHistory.push(cleanText);

			const historyText = this.toolHistory.join("\n");
			if (this.statusMessageId) {
				await this.config.updateMessage(this.statusMessageId, `🤔 处理中...\n\n${historyText}`);
				return this.statusMessageId;
			}
		}

		// 如果还没有状态消息，先创建一个
		if (!this.statusMessageId) {
			this.statusMessageId = await this.config.postMessage(chatId, "🤔 处理中...");
		}

		// 更新状态卡片
		if (this.toolHistory.length > 0) {
			const historyText = this.toolHistory.join("\n");
			await this.config.updateMessage(this.statusMessageId, `🤔 处理中...\n\n${historyText}`);
		}

		return this.statusMessageId;
	}

	async updateMessage(messageId: string, content: string): Promise<void> {
		return this.config.updateMessage(messageId, content);
	}

	async deleteMessage(messageId: string): Promise<void> {
		return this.config.deleteMessage(messageId);
	}

	async uploadFile(filePath: string, chatId: string): Promise<void> {
		return this.config.uploadFile(chatId, filePath);
	}

	async uploadImage(imagePath: string): Promise<string> {
		return this.config.uploadImage(imagePath);
	}

	async sendImage(chatId: string, imageKey: string): Promise<string> {
		return this.config.sendImage(chatId, imageKey);
	}

	async sendVoiceMessage(chatId: string, filePath: string): Promise<string> {
		return this.config.sendVoiceMessage(chatId, filePath);
	}

	async postInThread(chatId: string, parentMessageId: string, text: string): Promise<string> {
		return this.config.postInThread(chatId, parentMessageId, text);
	}

	/**
	 * 重置状态（用于新会话）
	 */
	resetStatus(): void {
		this.statusMessageId = null;
		this.toolHistory = [];
	}

	/**
	 * 完成状态（用于处理完成后更新状态）
	 * @param finalMessage 最终消息，如果不提供则删除状态消息
	 */
	async finishStatus(finalMessage?: string): Promise<void> {
		if (this.statusMessageId) {
			if (finalMessage) {
				await this.config.updateMessage(this.statusMessageId, finalMessage);
			} else {
				await this.config.deleteMessage(this.statusMessageId);
			}
			this.statusMessageId = null;
			this.toolHistory = [];
		}
	}

	/**
	 * 获取飞书平台特定功能
	 */
	getPlatformFeature<T = any>(feature: string): T {
		switch (feature) {
			case "buildCard": {
				// 返回飞书卡片构建函数
				const fn = (content: string) => {
					return JSON.stringify({
						schema: "2.0",
						config: { width_mode: "fill", update_multi: true },
						body: {
							elements: [{ tag: "div", text: { tag: "lark_md", content } }],
						},
					});
				};
				return fn as T;
			}
			default:
				throw new Error(`Unknown feature: ${feature}`);
		}
	}
}
