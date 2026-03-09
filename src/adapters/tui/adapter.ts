/**
 * TUI Adapter
 *
 * TUI 平台适配器 - 实现 PlatformAdapter 接口
 */

import { randomUUID } from "crypto";
import type {
	PlatformAdapter,
	PlatformConfig,
	UniversalMessage,
	UniversalResponse,
	UserInfo,
	ChannelInfo,
} from "../../core/platform/adapter.js";
import type { PlatformContext } from "../../core/platform/context.js";
import { TUIPlatformContext } from "./context.js";
import type { PiClawTUI } from "./app.js";
import type { ChatMessage } from "./types.js";
import type { Logger } from "../../utils/logger/types.js";

// ============================================================================
// TUI Adapter Config
// ============================================================================

export interface TUIAdapterConfig {
	/** 工作目录 */
	workingDir: string;
	/** TUI 实例 */
	tui: PiClawTUI;
	/** 默认模型 */
	model?: string;
	/** 日志器 */
	logger?: Logger;
}

// ============================================================================
// TUI Adapter
// ============================================================================

/**
 * TUI 平台适配器
 *
 * 实现 PlatformAdapter 接口，将 TUI 输入转换为 UniversalMessage
 */
export class TUIAdapter implements PlatformAdapter {
	readonly platform = "tui" as const;

	private config: TUIAdapterConfig;
	private logger?: Logger;
	private messageHandlers: Array<(message: UniversalMessage) => void> = [];
	private runningChannels = new Map<string, { abort: () => void }>();
	private defaultModel: string | undefined;
	private messageCounter = 0;

	constructor(config: TUIAdapterConfig) {
		this.config = config;
		this.logger = config.logger;
		this.defaultModel = config.model;
	}

	// ========================================================================
	// PlatformAdapter Implementation
	// ========================================================================

	async initialize(_config: PlatformConfig): Promise<void> {
		// 配置已在构造函数中设置
	}

	async start(): Promise<void> {
		// TUI 已由外部启动
		this.logger?.info("TUIAdapter started");
	}

	async stop(): Promise<void> {
		this.logger?.info("TUIAdapter stopped");
	}

	async sendMessage(response: UniversalResponse): Promise<void> {
		// 发送消息到 TUI 聊天面板
		const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
		this.config.tui.addChatMessage({
			id: randomUUID(),
			role: "assistant",
			content,
			timestamp: new Date(),
			channelId: "default",
		});
	}

	async updateMessage(_messageId: string, _response: UniversalResponse): Promise<void> {
		// TUI 模式不支持消息更新
	}

	async deleteMessage(_messageId: string): Promise<void> {
		// TUI 模式不支持消息删除
	}

	async uploadFile(_filePath: string): Promise<string> {
		throw new Error("TUI mode does not support file upload");
	}

	async uploadImage(_imagePath: string): Promise<string> {
		throw new Error("TUI mode does not support image upload");
	}

	async getUserInfo(userId: string): Promise<UserInfo | undefined> {
		return {
			id: userId,
			userName: userId === "user" ? "User" : "TUI User",
			displayName: userId === "user" ? "User" : "TUI User",
		};
	}

	async getAllUsers(): Promise<UserInfo[]> {
		return [
			{ id: "user", userName: "User", displayName: "User" },
			{ id: "assistant", userName: "Assistant", displayName: "Assistant" },
		];
	}

	async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
		return {
			id: channelId,
			name: "TUI Channel",
		};
	}

	async getAllChannels(): Promise<ChannelInfo[]> {
		return [
			{ id: "default", name: "TUI Channel" },
		];
	}

	onMessage(handler: (message: UniversalMessage) => void): void {
		this.messageHandlers.push(handler);
	}

	createPlatformContext(chatId: string): PlatformContext {
		return new TUIPlatformContext(chatId, {
			onSendText: (channelId, text) => {
				this.config.tui.addChatMessage({
					id: randomUUID(),
					role: "assistant",
					content: text,
					timestamp: new Date(),
					channelId,
				});
			},
			onLog: (message) => {
				this.logger?.debug(`[Agent] ${message}`);
			},
		});
	}

	isRunning(channelId: string): boolean {
		return this.runningChannels.has(channelId);
	}

	setRunning(channelId: string, abort: () => void): void {
		this.runningChannels.set(channelId, { abort });
	}

	clearRunning(channelId: string): void {
		this.runningChannels.delete(channelId);
	}

	abortChannel(channelId: string): void {
		const running = this.runningChannels.get(channelId);
		if (running) {
			running.abort();
			this.runningChannels.delete(channelId);
		}
	}

	getDefaultModel(): string | undefined {
		return this.defaultModel;
	}

	// ========================================================================
	// TUI-specific Methods
	// ========================================================================

	/**
	 * 处理 TUI 用户输入
	 *
	 * 将用户输入转换为 UniversalMessage 并触发消息处理器
	 */
	handleUserInput(content: string, channelId: string): void {
		// 添加用户消息到聊天面板
		this.config.tui.addChatMessage({
			id: randomUUID(),
			role: "user",
			content,
			timestamp: new Date(),
			channelId,
		});

		// 创建 UniversalMessage
		const message: UniversalMessage = {
			id: `tui-${Date.now()}-${++this.messageCounter}`,
			platform: "feishu", // TUI 使用 feishu 平台类型（兼容现有工具）
			type: "text",
			chat: {
				id: channelId,
				type: "private",
			},
			content,
			sender: {
				id: "user",
				name: "User",
			},
			timestamp: new Date(),
			attachments: [],
		};

		// 触发消息处理器
		for (const handler of this.messageHandlers) {
			try {
				handler(message);
			} catch (error) {
				this.logger?.error("TUIAdapter message handler error", undefined, error as Error);
			}
		}
	}
}
