/**
 * Platform Context
 *
 * 平台上下文接口，提供平台特定的能力
 */

import type { UserInfo, ChannelInfo } from "./message.js";
import type { PlatformTool } from "./tools/index.js";

// Re-export for convenience
export type { UserInfo, ChannelInfo } from "./message.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 平台上下文 - 提供平台特定的能力
 *
 * 这个接口允许 Agent 轻量感知平台特性，同时保持核心逻辑的平台无关性
 */
export interface PlatformContext {
	/**
	 * 平台类型
	 */
	readonly platform: string;

	/**
	 * 发送文本消息
	 * @param chatId 聊天 ID
	 * @param text 消息文本
	 * @returns 消息 ID
	 */
	sendText(chatId: string, text: string): Promise<string>;

	/**
	 * 更新消息
	 * @param messageId 消息 ID
	 * @param content 新内容
	 */
	updateMessage(messageId: string, content: string): Promise<void>;

	/**
	 * 删除消息
	 * @param messageId 消息 ID
	 */
	deleteMessage(messageId: string): Promise<void>;

	/**
	 * 上传文件
	 * @param filePath 文件路径
	 * @param chatId 聊天 ID
	 */
	uploadFile(filePath: string, chatId: string): Promise<void>;

	/**
	 * 上传图片
	 * @param imagePath 图片路径
	 * @returns 图片键
	 */
	uploadImage(imagePath: string): Promise<string>;

	/**
	 * 发送图片
	 * @param chatId 聊天 ID
	 * @param imageKey 图片键
	 */
	sendImage(chatId: string, imageKey: string): Promise<string>;

	/**
	 * 发送语音消息
	 * @param chatId 聊天 ID
	 * @param filePath 音频文件路径
	 */
	sendVoiceMessage(chatId: string, filePath: string): Promise<string>;

	/**
	 * 在线程中回复
	 * @param chatId 聊天 ID
	 * @param parentMessageId 父消息 ID
	 * @param text 回复内容
	 */
	postInThread(chatId: string, parentMessageId: string, text: string): Promise<string>;

	/**
	 * 设置打字状态（如果平台支持）
	 * @param chatId 聊天 ID
	 * @param isTyping 是否正在输入
	 */
	setTyping?(chatId: string, isTyping: boolean): Promise<void>;

	/**
	 * 获取平台特定功能（如飞书卡片、微信模板消息等）
	 * @param feature 功能名称
	 * @returns 功能对象
	 *
	 * 示例：
	 * - 飞书: getPlatformFeature("buildCard") -> 卡片构建函数
	 * - 微信: getPlatformFeature("templateMessage") -> 模板消息发送函数
	 */
	getPlatformFeature?<T = any>(feature: string): T;

	/**
	 * 获取平台特定工具（可选实现）
	 *
	 * 平台适配器可以实现此方法，提供平台特定的 AI 工具。
	 * 这些工具会被 CoreAgent 加载到 AI 的 prompt 中。
	 *
	 * @param context Agent 上下文信息
	 * @returns 平台工具列表
	 */
	getTools?(context: {
		chatId: string;
		workspaceDir: string;
		channelDir: string;
	}): PlatformTool[] | Promise<PlatformTool[]>;

	/**
	 * 检查响应是否已发送（可选实现）
	 *
	 * 某些平台（如飞书）支持流式更新状态卡片，
	 * 此方法用于检查是否已通过其他方式发送过响应
	 *
	 * @returns 是否已发送响应
	 */
	isResponseSent?(): boolean;

	/**
	 * 完成响应（可选实现）
	 *
	 * 某些平台（如飞书）支持状态卡片的最终更新，
	 * 此方法用于在流式输出完成后更新为最终状态
	 *
	 * @param content 最终内容
	 */
	finalizeResponse?(content: string): Promise<void>;
}

/**
 * 平台配置
 */
export interface PlatformConfig {
	/** 平台类型 */
	platform: string;
	/** 是否启用 */
	enabled: boolean;
	/** 平台特定的配置 */
	[key: string]: any;
}
