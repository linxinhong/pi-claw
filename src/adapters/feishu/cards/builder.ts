/**
 * Feishu Card Builder
 *
 * 函数式卡片构建器
 */

import type {
	FeishuCardContent,
	FeishuCardConfig,
	FeishuCardBody,
	CardElement,
	CardText,
	DividerElement,
	DivElement,
	CodeBlockElement,
	CollapsibleElement,
	ActionElement,
	ButtonAction,
	CardBuildOptions,
	StatusCardOptions,
} from "./types.js";

// ============================================================================
// 基础元素构建函数
// ============================================================================

/**
 * 构建文本对象
 */
export function buildText(content: string, isMarkdown: boolean = true): CardText {
	return {
		tag: isMarkdown ? "lark_md" : "plain_text",
		content,
	};
}

/**
 * 构建分割线
 */
export function buildDivider(): DividerElement {
	return { tag: "hr" };
}

/**
 * 构建文本块
 */
export function buildDiv(content: string, extra?: string): DivElement {
	const element: DivElement = {
		tag: "div",
		text: buildText(content),
	};
	if (extra) {
		element.extra = buildText(extra, false);
	}
	return element;
}

/**
 * 构建 Markdown 块
 */
export function buildMarkdown(content: string): CardElement {
	return {
		tag: "div",
		text: buildText(content),
	};
}

/**
 * 构建代码块（使用 Markdown 格式）
 */
export function buildCodeBlock(code: string, language?: string): CardElement {
	const content = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
	return {
		tag: "div",
		text: buildText(content),
	};
}

/**
 * 构建折叠面板
 */
export function buildCollapsibleSection(
	title: string,
	content: string,
	collapsed: boolean = true
): CollapsibleElement {
	return {
		tag: "collapsible_panel",
		header: buildText(title, false),
		body: buildText(content),
		collapsed,
	};
}

/**
 * 构建按钮
 */
export function buildButton(text: string, url?: string, type?: "primary" | "default" | "danger"): ButtonAction {
	const button: ButtonAction = {
		tag: "button",
		text: buildText(text, false),
		type: type || "default",
	};
	if (url) {
		button.url = url;
	}
	return button;
}

/**
 * 构建动作组
 */
export function buildAction(actions: ButtonAction[]): ActionElement {
	return {
		tag: "action",
		actions,
	};
}

/**
 * 构建表格（使用 Markdown 表格格式）
 */
export function buildTable(headers: string[], rows: string[][]): CardElement {
	if (headers.length === 0 || rows.length === 0) {
		return buildDiv("（空表格）");
	}

	// 构建表格线
	const separator = "| " + headers.map(() => "---").join(" | ") + " |";
	const headerLine = "| " + headers.join(" | ") + " |";
	const rowLines = rows.map((row) => "| " + row.join(" | ") + " |");

	const tableContent = [headerLine, separator, ...rowLines].join("\n");
	return buildMarkdown(tableContent);
}

// ============================================================================
// 完整卡片构建函数
// ============================================================================

/**
 * 默认卡片配置
 */
const DEFAULT_CONFIG: FeishuCardConfig = {
	width_mode: "fill",
	update_multi: true,
};

/**
 * 构建基础卡片
 */
export function buildCard(elements: CardElement[], options?: CardBuildOptions): FeishuCardContent {
	const config: FeishuCardConfig = {
		width_mode: options?.widthMode ?? DEFAULT_CONFIG.width_mode,
		update_multi: options?.updateMulti ?? DEFAULT_CONFIG.update_multi,
	};

	const body: FeishuCardBody = {
		elements,
	};

	const content: FeishuCardContent = {
		schema: "2.0",
		config,
		body,
	};

	if (options?.showHeader && options.headerTitle) {
		content.header = {
			title: buildText(options.headerTitle, false),
		};
		if (options.headerSubtitle) {
			content.header.subtitle = buildText(options.headerSubtitle, false);
		}
	}

	return content;
}

/**
 * 构建简单文本卡片
 */
export function buildTextCard(content: string, options?: CardBuildOptions): FeishuCardContent {
	return buildCard([buildDiv(content)], options);
}

/**
 * 构建代码卡片
 */
export function buildCodeCard(
	title: string,
	code: string,
	language?: string,
	options?: CardBuildOptions
): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**${title}**`), buildDivider(), buildCodeBlock(code, language)];

	return buildCard(elements, options);
}

/**
 * 构建结构化卡片
 */
export function buildStructuredCard(
	title: string,
	summary: string,
	sections?: Array<{ title: string; content: string; collapsible?: boolean }>,
	options?: CardBuildOptions
): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**${title}**`), buildDivider(), buildDiv(summary)];

	if (sections) {
		for (const section of sections) {
			elements.push(buildDivider());
			if (section.collapsible) {
				elements.push(buildCollapsibleSection(section.title, section.content));
			} else {
				elements.push(buildDiv(`**${section.title}**\n${section.content}`));
			}
		}
	}

	return buildCard(elements, options);
}

/**
 * 构建错误卡片
 */
export function buildErrorCard(message: string, details?: string, options?: CardBuildOptions): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**❌ 错误**\n${message}`)];

	if (details) {
		elements.push(buildDivider());
		elements.push(buildCollapsibleSection("详细信息", details, true));
	}

	return buildCard(elements, options);
}

/**
 * 构建状态卡片
 */
export function buildStatusCard(options: StatusCardOptions): FeishuCardContent {
	const elements: CardElement[] = [];

	// 状态头部
	let statusText = options.status;
	if (options.showTime) {
		const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
		statusText += ` (${time})`;
	}
	elements.push(buildDiv(statusText));

	// 工具历史
	if (options.toolHistory && options.toolHistory.length > 0) {
		elements.push(buildDivider());
		const historyText = options.toolHistory.map((h) => `• ${h}`).join("\n");
		elements.push(buildDiv(historyText));
	}

	return buildCard(elements, { widthMode: "fill", updateMulti: true });
}

/**
 * 构建思考步骤卡片
 */
export function buildThinkingCard(steps: string[], options?: CardBuildOptions): FeishuCardContent {
	const elements: CardElement[] = [buildDiv("**💭 思考过程**"), buildDivider()];

	for (let i = 0; i < steps.length; i++) {
		elements.push(buildDiv(`${i + 1}. ${steps[i]}`));
	}

	return buildCard(elements, options);
}

/**
 * 构建工具调用卡片
 */
export function buildToolCallCard(
	toolName: string,
	status: "running" | "success" | "error",
	result?: string,
	options?: CardBuildOptions
): FeishuCardContent {
	const statusEmoji = status === "running" ? "⏳" : status === "success" ? "✅" : "❌";
	const statusText = status === "running" ? "执行中" : status === "success" ? "成功" : "失败";

	const elements: CardElement[] = [buildDiv(`${statusEmoji} **${toolName}** - ${statusText}`)];

	if (result) {
		elements.push(buildCollapsibleSection("结果", result, status === "success"));
	}

	return buildCard(elements, options);
}

/**
 * 构建文件变更卡片
 */
export function buildFileChangeCard(
	changes: Array<{ type: "created" | "modified" | "deleted"; path: string }>,
	options?: CardBuildOptions
): FeishuCardContent {
	const elements: CardElement[] = [buildDiv("**📝 文件变更**"), buildDivider()];

	const typeEmoji = {
		created: "✨",
		modified: "📝",
		deleted: "🗑️",
	};

	for (const change of changes) {
		const emoji = typeEmoji[change.type];
		elements.push(buildDiv(`${emoji} \`${change.path}\``));
	}

	return buildCard(elements, options);
}

/**
 * 构建表格卡片
 */
export function buildTableCard(
	title: string,
	headers: string[],
	rows: string[][],
	options?: CardBuildOptions
): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**${title}**`), buildDivider(), buildTable(headers, rows)];

	return buildCard(elements, options);
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 合并多个卡片元素
 */
export function mergeElements(...cards: FeishuCardContent[]): CardElement[] {
	return cards.flatMap((card) => card.body.elements);
}

/**
 * 在卡片元素之间插入分割线
 */
export function joinWithDivider(elements: CardElement[]): CardElement[] {
	const result: CardElement[] = [];
	for (let i = 0; i < elements.length; i++) {
		result.push(elements[i]);
		if (i < elements.length - 1) {
			result.push(buildDivider());
		}
	}
	return result;
}
