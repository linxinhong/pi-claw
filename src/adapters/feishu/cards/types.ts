/**
 * Feishu Card Types
 *
 * 飞书卡片专用类型定义
 */

// ============================================================================
// 基础卡片元素类型
// ============================================================================

/**
 * 卡片文本样式
 */
export interface CardText {
	tag: "plain_text" | "lark_md";
	content: string;
}

/**
 * 分割线元素
 */
export interface DividerElement {
	tag: "hr";
}

/**
 * 文本块元素
 */
export interface DivElement {
	tag: "div";
	text?: CardText;
	extra?: CardText;
}

/**
 * Markdown 元素
 */
export interface MarkdownElement {
	tag: "div";
	text: CardText;
}

/**
 * 代码块元素
 */
export interface CodeBlockElement {
	tag: "div";
	text: CardText;
}

/**
 * 折叠面板元素
 */
export interface CollapsibleElement {
	tag: "collapsible_panel";
	header: CardText;
	body: CardText;
	collapsed?: boolean;
}

/**
 * 表格列
 */
export interface TableColumn {
	tag: "div";
	text: CardText;
}

/**
 * 表格行
 */
export interface TableRow {
	tag: "div";
	fields: TableColumn[];
}

/**
 * 表格元素
 */
export interface TableElement {
	tag: "div";
	text?: CardText;
}

/**
 * 按钮动作
 */
export interface ButtonAction {
	tag: "button";
	text: CardText;
	url?: string;
	type?: "primary" | "default" | "danger";
}

/**
 * 动作组元素
 */
export interface ActionElement {
	tag: "action";
	actions: ButtonAction[];
}

/**
 * 卡片元素联合类型
 */
export type CardElement =
	| DividerElement
	| DivElement
	| MarkdownElement
	| CodeBlockElement
	| CollapsibleElement
	| TableElement
	| ActionElement
	| { tag: string; [key: string]: any };

// ============================================================================
// 卡片配置
// ============================================================================

/**
 * 卡片配置
 */
export interface FeishuCardConfig {
	/** 宽度模式 */
	width_mode?: "fill" | "adapt";
	/** 是否支持多次更新 */
	update_multi?: boolean;
	/** 是否启用转发 */
	enable_forward?: boolean;
}

/**
 * 卡片头部
 */
export interface FeishuCardHeader {
	title: CardText;
	subtitle?: CardText;
	template?: string;
}

/**
 * 卡片主体
 */
export interface FeishuCardBody {
	elements: CardElement[];
}

/**
 * 飞书卡片内容（完整结构）
 */
export interface FeishuCardContent {
	schema: "2.0";
	config?: FeishuCardConfig;
	header?: FeishuCardHeader;
	body: FeishuCardBody;
}

// ============================================================================
// 构建选项
// ============================================================================

/**
 * 卡片构建选项
 */
export interface CardBuildOptions {
	/** 宽度模式 */
	widthMode?: "fill" | "adapt";
	/** 是否支持多次更新 */
	updateMulti?: boolean;
	/** 是否显示头部 */
	showHeader?: boolean;
	/** 头部标题 */
	headerTitle?: string;
	/** 头部副标题 */
	headerSubtitle?: string;
}

/**
 * 状态卡片选项
 */
export interface StatusCardOptions {
	/** 状态文本 */
	status: string;
	/** 工具历史记录 */
	toolHistory?: string[];
	/** 是否显示时间 */
	showTime?: boolean;
}

// ============================================================================
// 解析器类型
// ============================================================================

/**
 * 代码块
 */
export interface CodeBlock {
	language: string;
	code: string;
}

/**
 * 文件变更
 */
export interface FileChange {
	type: "created" | "modified" | "deleted";
	path: string;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
	name: string;
	status: "running" | "success" | "error";
	result?: string;
}

/**
 * 表格数据
 */
export interface TableData {
	headers: string[];
	rows: string[][];
}

/**
 * 解析后的响应结构
 */
export interface ParsedResponse {
	/** 摘要/主要文本 */
	summary: string;
	/** 代码块列表 */
	codeBlocks: CodeBlock[];
	/** 文件变更列表 */
	fileChanges: FileChange[];
	/** 思考步骤 */
	thinking: string[];
	/** 工具调用结果 */
	toolCalls: ToolCallResult[];
	/** 表格数据 */
	tables: TableData[];
	/** 详细信息 */
	details: string;
}

// ============================================================================
// 导出类型守卫
// ============================================================================

/**
 * 检查是否是有效的卡片元素
 */
export function isValidCardElement(element: unknown): element is CardElement {
	if (typeof element !== "object" || element === null) return false;
	const el = element as Record<string, unknown>;
	return typeof el.tag === "string";
}

/**
 * 检查是否是有效的卡片内容
 */
export function isValidCardContent(content: unknown): content is FeishuCardContent {
	if (typeof content !== "object" || content === null) return false;
	const c = content as Record<string, unknown>;
	return c.schema === "2.0" && typeof c.body === "object";
}
