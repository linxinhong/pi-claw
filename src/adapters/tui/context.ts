/**
 * TUI Platform Context
 *
 * TUI 模式下的平台上下文实现
 */

import type { PlatformContext, UserInfo, ChannelInfo } from "../../core/platform/context.js";
import type { UniversalMessage, UniversalResponse } from "../../core/platform/message.js";

/**
 * TUI 平台上下文配置
 */
export interface TUIPlatformContextOptions {
	/** 发送文本回调 */
	onSendText?: (channelId: string, text: string) => void;
	/** 日志回调（用于工具状态显示） */
	onLog?: (message: string) => void;
}

/**
 * TUI 平台上下文
 *
 * 为 TUI 模式提供与 CoreAgent 兼容的平台上下文
 */
export class TUIPlatformContext implements PlatformContext {
	readonly platform = "tui" as const;
	private channelId: string;
	private options: TUIPlatformContextOptions;

	constructor(channelId: string, options?: TUIPlatformContextOptions) {
		this.channelId = channelId;
		this.options = options || {};
	}

	/**
	 * 发送文本消息
	 *
	 * 检测工具状态消息并路由到日志面板
	 */
	async sendText(chatId: string, text: string): Promise<string> {
		// 检测工具状态消息（以 _ -> 或 _Error: 开头）
		if (text.startsWith("_ -> ") || text.startsWith("_Error:")) {
			// 工具状态 → 日志面板
			// 移除前缀和后缀的下划线
			const cleanText = text.replace(/^_/, "").replace(/_$/, "");
			this.options.onLog?.(cleanText);
		} else {
			// 普通消息 → 聊天面板
			this.options.onSendText?.(chatId, text);
		}
		return `msg-${Date.now()}`;
	}

	/**
	 * 发送图片（TUI 模式下不支持）
	 */
	async sendImage(chatId: string, imageKey: string): Promise<string> {
		return `[Image: ${imageKey}]`;
	}

	/**
	 * 发送语音消息（TUI 模式下不支持）
	 */
	async sendVoiceMessage(chatId: string, fileKey: string): Promise<string> {
		return `[Voice: ${fileKey}]`;
	}

	/**
	 * 更新消息（TUI 模式下不支持）
	 */
	async updateMessage(messageId: string, content: string): Promise<void> {
		// TUI 模式不支持消息更新
	}

	/**
	 * 删除消息（TUI 模式下不支持）
	 */
	async deleteMessage(messageId: string): Promise<void> {
		// TUI 模式不支持消息删除
	}

	/**
	 * 回复到话题（TUI 模式下不支持）
	 */
	async postInThread(parentMessageId: string, content: string): Promise<string> {
		return content;
	}

	/**
	 * 上传文件（TUI 模式下不支持）
	 */
	async uploadFile(filePath: string, chatId: string): Promise<void> {
		// TUI 模式不支持文件上传
	}

	/**
	 * 上传图片（TUI 模式下不支持）
	 */
	async uploadImage(imagePath: string): Promise<string> {
		throw new Error("TUI mode does not support image upload");
	}

	/**
	 * 获取用户信息（TUI 模式下返回默认值）
	 */
	async getUserInfo(userId: string): Promise<UserInfo | undefined> {
		return {
			id: userId,
			userName: userId === "user" ? "User" : "TUI User",
			displayName: userId === "user" ? "User" : "TUI User",
		};
	}

	/**
	 * 获取所有用户（TUI 模式下返回默认用户）
	 */
	async getAllUsers(): Promise<UserInfo[]> {
		return [
			{ id: "user", userName: "User", displayName: "User" },
			{ id: "assistant", userName: "Assistant", displayName: "Assistant" },
		];
	}

	/**
	 * 获取频道信息（TUI 模式下返回默认值）
	 */
	async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
		return {
			id: channelId,
			name: "TUI Channel",
		};
	}

	/**
	 * 获取所有频道（TUI 模式下返回默认频道）
	 */
	async getAllChannels(): Promise<ChannelInfo[]> {
		return [
			{ id: this.channelId, name: "TUI Channel" },
		];
	}

	/**
	 * 获取平台工具（TUI 模式下无额外工具）
	 */
	async getTools?(context: { chatId: string; workspaceDir: string; channelDir: string }): Promise<any[]> {
		return [];
	}
}

/**
 * 创建 TUI 平台上下文
 */
export function createTUIPlatformContext(
	channelId: string,
	options?: TUIPlatformContextOptions,
): TUIPlatformContext {
	return new TUIPlatformContext(channelId, options);
}
