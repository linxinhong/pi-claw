/**
 * Feishu Adapter Types
 *
 * 飞书适配器的类型定义
 */

import type { Attachment, Sender, Chat } from "../../core/platform/message.js";

// ============================================================================
// Config Types
// ============================================================================

/**
 * 飞书平台配置
 */
export interface FeishuConfig {
	/** 应用 ID */
	appId: string;
	/** 应用密钥 */
	appSecret: string;
	/** 域名：feishu | lark | 自定义 */
	domain?: "feishu" | "lark" | string;
	/** 连接模式：websocket | webhook */
	connectionMode?: "websocket" | "webhook";
	/** Webhook 端口（仅 webhook 模式） */
	webhookPort?: number;
	/** Webhook 路径（仅 webhook 模式） */
	webhookPath?: string;
}

/**
 * 策略配置
 */
export interface FeishuPolicyConfig {
	/** 私聊策略：open | pairing | allowlist | disabled */
	dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
	/** 群聊策略：open | allowlist | disabled */
	groupPolicy?: "open" | "allowlist" | "disabled";
	/** 群聊是否需要 @提及 */
	requireMention?: boolean;
	/** 私聊白名单 */
	dmAllowlist?: string[];
	/** 群聊白名单 */
	groupAllowlist?: string[];
}

/**
 * 响应配置
 */
export interface FeishuResponseConfig {
	/** 回复模式：auto | static | streaming */
	replyMode?: "auto" | "static" | "streaming";
	/** 历史消息限制 */
	historyLimit?: number;
	/** 文本分块限制 */
	textChunkLimit?: number;
	/** 媒体文件大小限制（MB） */
	mediaMaxMb?: number;
}

/**
 * 显示配置
 */
export interface FeishuDisplayConfig {
	/** 表情反应通知：off | own | all */
	reactionNotifications?: "off" | "own" | "all";
	/** 页脚配置 */
	footer?: {
		status?: boolean;
		elapsed?: boolean;
	};
}

/**
 * 飞书 Adapter 配置
 */
export interface FeishuAdapterConfig extends FeishuConfig, FeishuPolicyConfig, FeishuResponseConfig, FeishuDisplayConfig {
	/** 是否启用 */
	enabled?: boolean;
	/** 默认模型 */
	defaultModel?: string;
	/** 预热频道列表（启动时提前初始化这些频道的 Agent） */
	warmupChannels?: string[];
	/** 工具开关 */
	tools?: {
		doc?: boolean;
		bitable?: boolean;
		calendar?: boolean;
		task?: boolean;
	};
	/** 群组级配置 */
	groups?: Record<string, Partial<FeishuPolicyConfig & { systemPrompt?: string }>>;
}

// ============================================================================
// Message Context Types
// ============================================================================

/**
 * 飞书原始发送者信息
 */
export interface FeishuRawSender {
	/** 用户 Open ID */
	open_id?: string;
	/** 用户 Union ID */
	union_id?: string;
	/** 用户 ID */
	user_id?: string;
	/** 发送者类型 */
	sender_type?: "app" | "user" | "openchat" | "unknown";
	/** 租户 Key */
	tenant_key?: string;
}

/**
 * 飞书原始消息体
 */
export interface FeishuRawMessageBody {
	/** 消息内容 */
	content: string;
	/** 消息类型 */
	msg_type: string;
}

/**
 * 飞书原始消息
 */
export interface FeishuRawMessage {
	/** 消息 ID */
	message_id: string;
	/** 根消息 ID（话题消息） */
	root_id?: string;
	/** 父消息 ID */
	parent_id?: string;
	/** 聊天 ID */
	chat_id: string;
	/** 消息类型 */
	msg_type: string;
	/** 消息内容（JSON 字符串） */
	content: string;
	/** 创建时间戳 */
	create_time: string;
	/** 更新时间戳 */
	update_time?: string;
	/** 是否被撤回 */
	deleted?: boolean;
	/** 是否已更新 */
	updated?: boolean;
	/** 提及信息 */
	mentions?: FeishuMention[];
	/** 发送者 */
	sender?: FeishuRawSender;
	/** 消息体 */
	body?: FeishuRawMessageBody;
}

/**
 * 飞书提及信息
 */
export interface FeishuMention {
	/** 提及的 Open ID */
	open_id?: string;
	/** 用户 ID */
	user_id?: string;
	/** 提及的 Key */
	key: string;
	/** 提及类型 */
	type?: string;
	/** 用户名 */
	name?: string;
	/** 租户 Key */
	tenant_key?: string;
}

/**
 * 飞书消息事件
 */
export interface FeishuMessageEvent {
	/** 事件类型 */
	type: string;
	/** 应用 ID */
	app_id?: string;
	/** 租户 Key */
	tenant_key?: string;
	/** 事件时间戳 */
	ts?: string;
	/** 事件 UUID */
	uuid?: string;
	/** 事件 ID */
	event_id?: string;
	/** 消息内容 */
	message?: FeishuRawMessage;
	/** 发送者 */
	sender?: FeishuRawSender;
}

/**
 * 飞书反应事件
 */
export interface FeishuReactionEvent {
	/** 事件类型 */
	type: string;
	/** 反应类型 */
	reaction?: {
		/** 消息 ID */
		message_id: string;
		/** 反应类型 */
		reaction_type: string;
		/** 操作类型 */
		action: "create" | "delete";
		/** 用户 Open ID */
		user_id?: string;
		/** 聊天 ID */
		chat_id?: string;
	};
}

/**
 * 飞书消息上下文
 */
export interface FeishuMessageContext {
	/** 原始事件 */
	rawEvent: FeishuMessageEvent;
	/** 消息 ID */
	messageId: string;
	/** 聊天 ID */
	chatId: string;
	/** 聊天类型 */
	chatType: "p2p" | "group" | "unknown";
	/** 根消息 ID（话题） */
	rootId?: string;
	/** 父消息 ID */
	parentId?: string;
	/** 消息类型 */
	messageType: string;
	/** 消息内容 */
	content: string;
	/** 发送者 */
	sender: {
		openId: string;
		unionId?: string;
		userId?: string;
		name?: string;
	};
	/** 提及信息 */
	mentions?: FeishuMention[];
	/** 时间戳 */
	timestamp: Date;
	/** 是否 @了 Bot */
	mentionedBot: boolean;
	/** 非 Bot 的提及列表 */
	nonBotMentions: FeishuMention[];
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * 飞书 API 通用响应
 */
export interface FeishuApiResponse<T = any> {
	/** 状态码 */
	code: number;
	/** 消息 */
	msg: string;
	/** 数据 */
	data?: T;
}

/**
 * 飞书发送结果
 */
export interface FeishuSendResult {
	/** 消息 ID */
	message_id: string;
}

/**
 * 飞书媒体信息
 */
export interface FeishuMediaInfo {
	/** 文件 Key */
	file_key: string;
	/** 文件 Token */
	file_token?: string;
	/** 文件类型 */
	type?: string;
}

/**
 * 飞书用户信息
 */
export interface FeishuUserInfo {
	/** Open ID */
	open_id: string;
	/** Union ID */
	union_id?: string;
	/** 用户 ID */
	user_id?: string;
	/** 用户名 */
	name?: string;
	/** 昵称 */
	nickname?: string;
	/** 头像 */
	avatar_url?: string;
	/** 邮箱 */
	email?: string;
	/** 手机号 */
	mobile?: string;
}

/**
 * 飞书群聊信息
 */
export interface FeishuChatInfo {
	/** 聊天 ID */
	chat_id: string;
	/** 聊天名称 */
	name?: string;
	/** 聊天描述 */
	description?: string;
	/** 聊天类型 */
	chat_mode?: "group" | "p2p" | "topic";
	/** 聊天类型 */
	chat_type?: "group" | "p2p";
	/** 所有者 ID */
	owner_id?: string;
	/** 所有者 ID 类型 */
	owner_id_type?: string;
	/** 成员数量 */
	user_count?: number;
}

// ============================================================================
// Card Types
// ============================================================================

/**
 * 卡片状态
 */
export type CardStatus = "thinking" | "streaming" | "complete" | "error";

/**
 * 卡片上下文
 */
export interface CardContext {
	/** 消息 ID */
	messageId: string;
	/** 聊天 ID */
	chatId: string;
	/** 当前状态 */
	status: CardStatus;
	/** 开始时间 */
	startTime: number;
	/** 当前内容 */
	content: string;
	/** 思考内容 */
	thinkingContent?: string;
	/** 工具调用 */
	toolCalls?: ToolCallInfo[];
}

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
	/** 工具名称 */
	name: string;
	/** 工具参数 */
	args?: Record<string, any>;
	/** 调用状态 */
	status: "pending" | "running" | "success" | "error";
	/** 结果 */
	result?: string;
}

// ============================================================================
// Bot Identity Types
// ============================================================================

/**
 * Bot 身份信息
 */
export interface BotIdentity {
	/** Open ID */
	openId: string;
	/** 用户 ID */
	userId?: string;
	/** 名称 */
	name: string;
	/** 头像 */
	avatarUrl?: string;
}

// ============================================================================
// Dedup Types
// ============================================================================

/**
 * 去重器配置
 */
export interface DedupConfig {
	/** 最大条目数 */
	maxSize?: number;
	/** 过期时间（毫秒） */
	ttl?: number;
}

// ============================================================================
// Multi-Card Types
// ============================================================================

/**
 * 多卡片 ID 管理
 */
export interface MultiCardIds {
	/** 状态卡片 ID */
	statusCardId: string | null;
	/** 思考卡片 ID */
	thinkingCardId: string | null;
	/** 工具卡片 ID */
	toolCardId: string | null;
}

/**
 * 时间线事件
 */
export interface TimelineEvent {
	/** 事件类型 */
	type: "thinking" | "toolcall";
	/** 所属轮次 */
	turn: number;
	/** 内容：thinking 摘要 或 工具名 */
	content: string;
	/** 工具参数（仅 toolcall 类型） */
	args?: string;
	/** 工具状态（仅 toolcall 类型） */
	status?: "pending" | "running" | "success" | "error";
}
