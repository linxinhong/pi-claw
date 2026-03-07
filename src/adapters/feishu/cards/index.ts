/**
 * Feishu Cards Module
 *
 * 飞书卡片系统统一入口
 */

// 先导入需要的函数（用于便捷函数）
import { buildTextCard as _buildTextCard, buildErrorCard as _buildErrorCard, buildStatusCard as _buildStatusCard } from "./builder.js";
import { autoBuildCard as _autoBuildCard } from "./parser.js";

// ============================================================================
// 类型导出
// ============================================================================

export type {
	// 基础类型
	CardText,
	DividerElement,
	DivElement,
	MarkdownElement,
	CodeBlockElement,
	CollapsibleElement,
	TableColumn,
	TableRow,
	TableElement,
	ButtonAction,
	ActionElement,
	CardElement,
	// 卡片结构
	FeishuCardConfig,
	FeishuCardHeader,
	FeishuCardBody,
	FeishuCardContent,
	// 选项
	CardBuildOptions,
	StatusCardOptions,
	// 解析器类型
	CodeBlock,
	FileChange,
	ToolCallResult,
	TableData,
	ParsedResponse,
} from "./types.js";

export { isValidCardElement, isValidCardContent } from "./types.js";

// ============================================================================
// 构建函数导出
// ============================================================================

export {
	// 基础元素
	buildText,
	buildDivider,
	buildDiv,
	buildMarkdown,
	buildCodeBlock,
	buildCollapsibleSection,
	buildButton,
	buildAction,
	buildTable,
	// 完整卡片
	buildCard,
	buildTextCard,
	buildCodeCard,
	buildStructuredCard,
	buildErrorCard,
	buildStatusCard,
	buildThinkingCard,
	buildToolCallCard,
	buildFileChangeCard,
	buildTableCard,
	// 工具函数
	mergeElements,
	joinWithDivider,
} from "./builder.js";

// ============================================================================
// 解析器导出
// ============================================================================

export { parseResponse, shouldUseStructuredCard, autoBuildCard, truncateText, buildProgressCard } from "./parser.js";

// ============================================================================
// 预设模板导出
// ============================================================================

export {
	// 状态模板
	buildProcessingCard,
	buildSuccessCard,
	buildWarningCard,
	// 思考和工具
	buildThinkingCard as buildThinkingCardPreset,
	buildToolCallCard as buildToolCallCardPreset,
	buildToolHistoryCard,
	// 文件操作
	buildFileChangeList,
	buildFileChangeCard as buildFileChangeCardPreset,
	buildCodePreviewCard,
	// 数据展示
	buildTableCard as buildTableCardPreset,
	buildListCard,
	buildKeyValueCard,
	// 交互
	buildConfirmCard,
	buildLinkCard,
	// 消息
	buildMessageCard,
	buildSectionedCard,
	// 预设集合
	presets,
} from "./presets.js";

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 快速构建简单卡片（最常用）
 */
export function card(content: string): string {
	return JSON.stringify(_buildTextCard(content));
}

/**
 * 快速构建错误卡片
 */
export function errorCard(message: string, details?: string): string {
	return JSON.stringify(_buildErrorCard(message, details));
}

/**
 * 快速构建状态卡片
 */
export function statusCard(status: string, toolHistory?: string[]): string {
	return JSON.stringify(_buildStatusCard({ status, toolHistory }));
}

/**
 * 智能卡片（根据内容自动选择最佳样式）
 */
export function smartCard(text: string): string {
	return JSON.stringify(_autoBuildCard(text));
}
