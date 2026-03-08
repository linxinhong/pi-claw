/**
 * Feishu V2 Adapter
 *
 * 飞书平台适配器 V2 - 完整支持消息收发、卡片、表情反应、线程回复
 */

import { adapterRegistry } from "../../core/adapter/index.js";
import { feishuV2AdapterFactory } from "./factory.js";

// ============================================================================
// Self Registration
// ============================================================================

// 飞书 V2 适配器自行注册到全局注册表
adapterRegistry.register(feishuV2AdapterFactory);

// ============================================================================
// 核心适配器
// ============================================================================

export { FeishuAdapter } from "./adapter.js";
export { feishuV2AdapterFactory, type FeishuV2BotConfig } from "./factory.js";
export { FeishuPlatformContext, type FeishuContextConfig } from "./context.js";

// ============================================================================
// 消息解析
// ============================================================================

export {
	parseFeishuMessage,
	isThreadReply,
	isP2PMessage,
	isBotMention,
	buildTextContent,
	buildPostContent,
} from "./message-parser.js";

// 从 types 重新导出消息类型
export type {
	FeishuMessageEvent,
	FeishuEventMessage,
	FeishuEventSender,
} from "./types.js";

// ============================================================================
// 类型定义
// ============================================================================

export type {
	// 消息类型
	FeishuMessageType,
	FeishuEventMessage as FeishuEvent,
	TextContent,
	PostContent,
	PostParagraph,
	PostElement,
	ImageContent,
	FileContent,
	AudioContent,
	MediaContent,
	// 提及
	Mention,
	// 表情反应
	FeishuEmojiType,
	Reaction,
	// 卡片
	CardContent,
	CardElement,
	// 配置
	FeishuAdapterConfig as FeishuConfig,
	// 出站选项
	SendMessageOptions,
	UpdateMessageOptions,
	ThreadReplyOptions,
} from "./types.js";

// ============================================================================
// 出站消息功能
// ============================================================================

export {
	// 发送
	FeishuOutbound,
	// 表情反应
	FeishuReactions,
	EMOJI_TYPES,
	// 线程回复
	FeishuThread,
	// 群组管理
	FeishuChatManage,
	type ChatInfo,
	type ChatMember,
} from "./outbound/index.js";

// ============================================================================
// 卡片功能
// ============================================================================

export {
	// 构建函数
	buildTextCard,
	buildCodeCard,
	buildErrorCard,
	buildSuccessCard,
	buildStatusCard,
	buildProgressCard,
	autoBuildCard,
	// 发送类
	FeishuCards,
} from "./cards.js";

// ============================================================================
// 工具功能
// ============================================================================

export {
	// 工具类
	FeishuTaskTool,
	FeishuBitableTool,
	FeishuDocTool,
	FeishuCalendarTool,
	FeishuWikiTool,
	FeishuDriveTool,
	// 工具管理器
	FeishuToolsManager,
	createFeishuTools,
	// 工具类型
	type Task,
	type TaskList,
	type BitableRecord,
	type BitableField,
	type BitableInfo,
	type BitableTable,
	type BitableView,
	type DocInfo,
	type DocContent,
	type DocBlock,
	type CalendarEvent,
	type CalendarInfo,
	type WikiNode,
	type WikiSpace,
	type DriveFile,
	type DriveFolder,
} from "./tools/index.js";
