/**
 * Feishu Platform Capabilities
 *
 * 飞书平台能力实现，封装所有飞书特定的功能
 */

import type { PlatformCapabilities, CAPABILITIES } from "../../core/plugin/types.js";
import { buildTextCard, autoBuildCard } from "./cards/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 飞书能力配置
 */
export interface FeishuCapabilitiesConfig {
	/** 频道 ID */
	chatId: string;
	/** 消息 ID（用于更新/删除） */
	messageId?: string;
	/** 更新消息函数 */
	replaceMessage: (text: string) => Promise<void>;
	/** 在线程中回复 */
	respondInThread: (text: string) => Promise<void>;
	/** 设置打字状态 */
	setTyping: (isTyping: boolean) => Promise<void>;
	/** 设置工作状态 */
	setWorking: (working: boolean) => Promise<void>;
	/** 上传文件 */
	uploadFile: (filePath: string, title?: string) => Promise<void>;
	/** 上传图片 */
	uploadImage: (imagePath: string) => Promise<string>;
	/** 发送图片 */
	sendImage: (imageKey: string) => Promise<string>;
	/** 发送语音消息 */
	sendVoiceMessage: (filePath: string) => Promise<string>;
	/** 删除消息 */
	deleteMessage: () => Promise<void>;
	/** 发送错误卡片 */
	sendErrorCard: (message: string) => Promise<void>;
	/** 获取平台特定功能 */
	getFeature?: <T = unknown>(feature: string) => T;
}

// ============================================================================
// Feishu Capabilities Implementation
// ============================================================================

/**
 * 飞书平台能力实现
 *
 * 实现了所有飞书特定的功能，并通过 hasCapability 和 getFeature 提供能力检测
 */
export class FeishuCapabilities implements PlatformCapabilities {
	readonly platform = "feishu";

	private config: FeishuCapabilitiesConfig;

	// 能力映射表
	private readonly capabilityMap: Map<string, boolean>;

	constructor(config: FeishuCapabilitiesConfig) {
		this.config = config;

		// 初始化能力映射表
		this.capabilityMap = new Map([
			["replaceMessage", true],
			["respondInThread", true],
			["setTyping", true],
			["setWorking", true],
			["uploadFile", true],
			["uploadImage", true],
			["sendImage", true],
			["sendVoiceMessage", true],
			["deleteMessage", true],
			["sendErrorCard", true],
		]);
	}

	// ========== PlatformCapabilities Interface ==========

	/**
	 * 检查是否支持某项能力
	 */
	hasCapability(capability: string): boolean {
		return this.capabilityMap.has(capability) && this.capabilityMap.get(capability) === true;
	}

	/**
	 * 获取平台特定功能
	 */
	getFeature<T = unknown>(feature: string): T {
		// 如果配置中提供了自定义的 getFeature，使用它
		if (this.config.getFeature) {
			return this.config.getFeature<T>(feature);
		}

		// 默认功能实现
		switch (feature) {
			case "buildCard": {
				// 返回飞书卡片构建函数
				const fn = (content: string) => JSON.stringify(buildTextCard(content));
				return fn as T;
			}

			case "autoBuildCard": {
				// 返回智能卡片构建函数
				const fn = (content: string) => JSON.stringify(autoBuildCard(content));
				return fn as T;
			}

			case "chatId": {
				return this.config.chatId as T;
			}

			case "messageId": {
				return this.config.messageId as T;
			}

			default:
				throw new Error(`[FeishuCapabilities] Unknown feature: ${feature}`);
		}
	}

	// ========== Capability Methods ==========

	/**
	 * 更新消息
	 */
	replaceMessage = async (text: string): Promise<void> => {
		return this.config.replaceMessage(text);
	};

	/**
	 * 在线程中回复
	 */
	respondInThread = async (text: string): Promise<void> => {
		return this.config.respondInThread(text);
	};

	/**
	 * 设置打字状态
	 */
	setTyping = async (isTyping: boolean): Promise<void> => {
		return this.config.setTyping(isTyping);
	};

	/**
	 * 设置工作状态
	 */
	setWorking = async (working: boolean): Promise<void> => {
		return this.config.setWorking(working);
	};

	/**
	 * 上传文件
	 */
	uploadFile = async (filePath: string, title?: string): Promise<void> => {
		return this.config.uploadFile(filePath, title);
	};

	/**
	 * 上传图片
	 */
	uploadImage = async (imagePath: string): Promise<string> => {
		return this.config.uploadImage(imagePath);
	};

	/**
	 * 发送图片
	 */
	sendImage = async (imageKey: string): Promise<string> => {
		return this.config.sendImage(imageKey);
	};

	/**
	 * 发送语音消息
	 */
	sendVoiceMessage = async (filePath: string): Promise<string> => {
		return this.config.sendVoiceMessage(filePath);
	};

	/**
	 * 删除消息
	 */
	deleteMessage = async (): Promise<void> => {
		return this.config.deleteMessage();
	};

	/**
	 * 发送错误卡片
	 */
	sendErrorCard = async (message: string): Promise<void> => {
		return this.config.sendErrorCard(message);
	};
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 创建飞书能力实例的简化工厂函数
 */
export function createFeishuCapabilities(config: FeishuCapabilitiesConfig): FeishuCapabilities {
	return new FeishuCapabilities(config);
}

/**
 * 获取飞书支持的所有能力列表
 */
export function getFeishuCapabilityList(): string[] {
	return [
		"replaceMessage",
		"respondInThread",
		"setTyping",
		"setWorking",
		"uploadFile",
		"uploadImage",
		"sendImage",
		"sendVoiceMessage",
		"deleteMessage",
		"sendErrorCard",
	];
}
