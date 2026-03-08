/**
 * Feishu V2 Adapter Types
 *
 * 飞书适配器类型定义
 */

// ============================================================================
// 消息类型
// ============================================================================

/**
 * 飞书消息类型
 */
export type FeishuMessageType =
	| "text"
	| "post"
	| "image"
	| "file"
	| "audio"
	| "media"
	| "interactive"
	| "sticker";

/**
 * 飞书事件消息
 */
export interface FeishuEventMessage {
	/** 消息 ID */
	message_id: string;
	/** 根消息 ID（话题回复时） */
	root_id?: string;
	/** 父消息 ID */
	parent_id?: string;
	/** 聊天 ID */
	chat_id: string;
	/** 聊天类型 */
	chat_type: "p2p" | "group";
	/** 消息类型 */
	message_type: FeishuMessageType;
	/** 消息内容 */
	content: string;
	/** 创建时间 */
	create_time: string;
	/** 更新时间 */
	update_time?: string;
	/** 是否已撤回 */
	deleted?: boolean;
	/** 是否已更新 */
	updated?: boolean;
}

/**
 * 飞书事件发送者
 */
export interface FeishuEventSender {
	/** 发送者 ID */
	sender_id: {
		user_id?: string;
		open_id?: string;
		union_id?: string;
	};
	/** 发送者类型 */
	sender_type: "user" | "app";
	/** 租户 key */
	tenant_key?: string;
}

/**
 * 飞书消息事件
 */
export interface FeishuMessageEvent {
	/** 消息 */
	message: FeishuEventMessage;
	/** 发送者 */
	sender: FeishuEventSender;
}

// ============================================================================
// 文本内容
// ============================================================================

/**
 * 文本消息内容
 */
export interface TextContent {
	/** 文本内容 */
	text: string;
}

/**
 * 富文本段落
 */
export interface PostParagraph {
	/** 段落标签 */
	tag: "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "ol" | "ul";
	/** 子元素 */
	children?: PostElement[];
	/** 文本内容（用于文本元素） */
	text?: string;
	/** 链接地址 */
	href?: string;
	/** 用户 ID（用于 @ 提及） */
	user_id?: string;
}

/**
 * 富文本元素
 */
export interface PostElement {
	/** 元素标签 */
	tag: "text" | "a" | "at" | "img";
	/** 文本内容 */
	text?: string;
	/** 链接地址 */
	href?: string;
	/** 用户 ID */
	user_id?: string;
	/** 图片 key */
	image_key?: string;
	/** 子元素 */
	children?: PostElement[];
}

/**
 * 富文本消息内容
 */
export interface PostContent {
	/** 富文本内容 */
	content: PostParagraph[];
	/** 版本 */
	version?: string;
	/** 标题 */
	title?: string;
}

/**
 * 图片消息内容
 */
export interface ImageContent {
	/** 图片 key */
	image_key: string;
}

/**
 * 文件消息内容
 */
export interface FileContent {
	/** 文件 key */
	file_key: string;
	/** 文件名 */
	file_name?: string;
	/** 文件 token */
	file_token?: string;
}

/**
 * 音频消息内容
 */
export interface AudioContent {
	/** 文件 key */
	file_key: string;
	/** 时长（毫秒） */
	duration?: number;
}

/**
 * 媒体消息内容
 */
export interface MediaContent {
	/** 文件 key */
	file_key: string;
	/** 文件名 */
	file_name?: string;
	/** 时长（毫秒） */
	duration?: number;
	/** 缩略图 key */
	thumbnail?: string;
}

// ============================================================================
// 提及类型
// ============================================================================

/**
 * 提及信息
 */
export interface Mention {
	/** 提及类型 */
	type: "user" | "all";
	/** 用户 ID */
	userId?: string;
	/** 用户名 */
	userName?: string;
	/** 原始文本 */
	rawText: string;
}

// ============================================================================
// 表情反应类型
// ============================================================================

/**
 * 飞书支持的表情类型
 */
export type FeishuEmojiType =
	| "THUMBSUP"
	| "OK"
	| "THANKS"
	| "MUSCLE"
	| "FINGERHEART"
	| "APPLAUSE"
	| "FISTBUMP"
	| "JIAYI"
	| "DONE"
	| "SMILE"
	| "BLUSH"
	| "CANCELLED"
	| "CONFUSED"
	| "LOVE"
	| "LAUGH"
	| "CRY"
	| "ANGRY"
	| "SURPRISED"
	| "SAD"
	| "EMBARRASSED"
	| "SLEEPY"
	| "YUM"
	| "ROCKET"
	| "PARTY"
	| "SHAKE"
	| "HEART"
	| "PUMPKIN"
	| "CHRISTMAS_TREE"
	| "GIFT"
	| "XMAS"
	| "SNOWMAN"
	| "SANTA";

/**
 * 表情反应
 */
export interface Reaction {
	/** 表情类型 */
	emojiType: FeishuEmojiType;
	/** 反应用户列表 */
	users: Array<{
		userId: string;
		userName?: string;
	}>;
}

// ============================================================================
// 卡片类型
// ============================================================================

/**
 * 卡片内容
 */
export interface CardContent {
	/** 卡片 schema */
	schema: "2.0";
	/** 卡片配置 */
	config?: {
		width_mode?: "fill" | "adaptive";
		update_multi?: boolean;
	};
	/** 卡片头部 */
	header?: {
		title?: {
			tag: string;
			content: string;
		};
		template?: string;
	};
	/** 卡片主体 */
	body: {
		elements: CardElement[];
	};
}

/**
 * 卡片元素
 */
export interface CardElement {
	/** 元素标签 */
	tag: string;
	/** 文本内容 */
	text?: {
		tag: string;
		content: string;
	};
	/** 子元素 */
	elements?: CardElement[];
	/** 其他属性 */
	[key: string]: unknown;
}

// ============================================================================
// 适配器配置
// ============================================================================

/**
 * 飞书适配器配置
 */
export interface FeishuAdapterConfig {
	/** 应用 ID */
	appId: string;
	/** 应用密钥 */
	appSecret: string;
	/** 工作目录 */
	workingDir: string;
	/** 平台标识 */
	platform?: string;
	/** 是否启用 */
	enabled?: boolean;
	/** 是否使用 WebSocket */
	useWebSocket?: boolean;
	/** 服务端口 */
	port?: number;
	/** 日志器 */
	logger?: any;
	/** 默认模型 */
	model?: string;
}

// ============================================================================
// 出站消息选项
// ============================================================================

/**
 * 发送消息选项
 */
export interface SendMessageOptions {
	/** 接收者 ID */
	receiveId: string;
	/** 接收者类型 */
	receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
	/** 消息类型 */
	msgType: FeishuMessageType;
	/** 消息内容 */
	content: string | CardContent;
	/** 根消息 ID（话题回复） */
	rootId?: string;
}

/**
 * 更新消息选项
 */
export interface UpdateMessageOptions {
	/** 消息 ID */
	messageId: string;
	/** 消息内容 */
	content: string | CardContent;
}

/**
 * 线程回复选项
 */
export interface ThreadReplyOptions {
	/** 聊天 ID */
	chatId: string;
	/** 根消息 ID */
	rootId: string;
	/** 消息内容 */
	content: string;
	/** 消息类型 */
	msgType?: FeishuMessageType;
}
