/**
 * Feishu Card Presets
 *
 * 预设卡片模板
 */

import type { FeishuCardContent, CardElement, FileChange } from "./types.js";
import {
	buildCard,
	buildTextCard,
	buildDiv,
	buildDivider,
	buildCollapsibleSection,
	buildCodeBlock,
	buildTable,
	buildButton,
	buildAction,
} from "./builder.js";

// ============================================================================
// 状态模板
// ============================================================================

/**
 * 构建处理中状态卡片
 */
export function buildProcessingCard(message: string = "处理中..."): FeishuCardContent {
	return buildCard([buildDiv(`🤔 ${message}`)]);
}

/**
 * 构建成功状态卡片
 */
export function buildSuccessCard(message: string, details?: string): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`✅ ${message}`)];

	if (details) {
		elements.push(buildDivider());
		elements.push(buildCollapsibleSection("详细信息", details, true));
	}

	return buildCard(elements);
}

/**
 * 构建警告卡片
 */
export function buildWarningCard(message: string, details?: string): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`⚠️ **警告**\n${message}`)];

	if (details) {
		elements.push(buildDivider());
		elements.push(buildCollapsibleSection("详情", details, true));
	}

	return buildCard(elements);
}

// ============================================================================
// 思考和工具调用模板
// ============================================================================

/**
 * 构建思考步骤卡片
 */
export function buildThinkingCard(steps: string[]): FeishuCardContent {
	const elements: CardElement[] = [buildDiv("**💭 思考过程**"), buildDivider()];

	for (let i = 0; i < steps.length; i++) {
		elements.push(buildDiv(`${i + 1}. ${steps[i]}`));
	}

	return buildCard(elements);
}

/**
 * 构建工具调用卡片
 */
export function buildToolCallCard(
	toolName: string,
	status: "running" | "success" | "error",
	result?: string
): FeishuCardContent {
	const statusEmoji = status === "running" ? "⏳" : status === "success" ? "✅" : "❌";
	const statusText = status === "running" ? "执行中" : status === "success" ? "成功" : "失败";

	const elements: CardElement[] = [buildDiv(`${statusEmoji} **${toolName}** - ${statusText}`)];

	if (result) {
		elements.push(buildDivider());
		elements.push(buildCollapsibleSection("结果", result, status === "success"));
	}

	return buildCard(elements);
}

/**
 * 构建工具历史卡片
 */
export function buildToolHistoryCard(tools: Array<{ name: string; status: string }>): FeishuCardContent {
	const elements: CardElement[] = [buildDiv("**🔧 工具执行历史**"), buildDivider()];

	for (const tool of tools) {
		const statusEmoji = tool.status === "success" ? "✅" : tool.status === "error" ? "❌" : "⏳";
		elements.push(buildDiv(`${statusEmoji} \`${tool.name}\``));
	}

	return buildCard(elements);
}

// ============================================================================
// 文件操作模板
// ============================================================================

/**
 * 构建文件变更列表（纯文本格式）
 */
export function buildFileChangeList(changes: FileChange[]): string {
	const typeEmoji = {
		created: "✨",
		modified: "📝",
		deleted: "🗑️",
	};

	return changes.map((c) => `${typeEmoji[c.type]} ${c.path}`).join("\n");
}

/**
 * 构建文件变更卡片
 */
export function buildFileChangeCard(
	changes: FileChange[],
	options?: { showSummary?: boolean }
): FeishuCardContent {
	const elements: CardElement[] = [buildDiv("**📝 文件变更**"), buildDivider()];

	const typeEmoji = {
		created: "✨",
		modified: "📝",
		deleted: "🗑️",
	};

	for (const change of changes) {
		const emoji = typeEmoji[change.type];
		const typeText = change.type === "created" ? "新建" : change.type === "deleted" ? "删除" : "修改";
		elements.push(buildDiv(`${emoji} \`${change.path}\` (${typeText})`));
	}

	if (options?.showSummary) {
		const summary = {
			created: changes.filter((c) => c.type === "created").length,
			modified: changes.filter((c) => c.type === "modified").length,
			deleted: changes.filter((c) => c.type === "deleted").length,
		};
		elements.push(buildDivider());
		elements.push(
			buildDiv(`_新建: ${summary.created} | 修改: ${summary.modified} | 删除: ${summary.deleted}_`)
		);
	}

	return buildCard(elements);
}

/**
 * 构建代码预览卡片
 */
export function buildCodePreviewCard(
	filePath: string,
	code: string,
	language?: string
): FeishuCardContent {
	const elements: CardElement[] = [
		buildDiv(`**📄 ${filePath}**`),
		buildDivider(),
		buildCollapsibleSection("查看代码", `\`\`\`${language || ""}\n${code}\n\`\`\``, true),
	];

	return buildCard(elements);
}

// ============================================================================
// 数据展示模板
// ============================================================================

/**
 * 构建表格卡片
 */
export function buildTableCard(title: string, headers: string[], rows: string[][]): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**📊 ${title}**`), buildDivider(), buildTable(headers, rows)];

	return buildCard(elements);
}

/**
 * 构建列表卡片
 */
export function buildListCard(title: string, items: string[]): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**📋 ${title}**`), buildDivider()];

	for (const item of items) {
		elements.push(buildDiv(`• ${item}`));
	}

	return buildCard(elements);
}

/**
 * 构建键值对卡片
 */
export function buildKeyValueCard(
	title: string,
	data: Record<string, string>
): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**📋 ${title}**`), buildDivider()];

	for (const [key, value] of Object.entries(data)) {
		elements.push(buildDiv(`**${key}:** ${value}`));
	}

	return buildCard(elements);
}

// ============================================================================
// 交互模板
// ============================================================================

/**
 * 构建确认卡片
 */
export function buildConfirmCard(
	message: string,
	confirmUrl: string,
	cancelUrl?: string
): FeishuCardContent {
	const elements: CardElement[] = [
		buildDiv(`**❓ 确认操作**\n${message}`),
		buildDivider(),
		buildAction([
			buildButton("确认", confirmUrl, "primary"),
			...(cancelUrl ? [buildButton("取消", cancelUrl, "default")] : []),
		]),
	];

	return buildCard(elements);
}

/**
 * 构建链接卡片
 */
export function buildLinkCard(title: string, links: Array<{ text: string; url: string }>): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(`**🔗 ${title}**`), buildDivider()];

	const buttons = links.map((link) => buildButton(link.text, link.url, "default"));
	elements.push(buildAction(buttons));

	return buildCard(elements);
}

// ============================================================================
// 消息模板
// ============================================================================

/**
 * 构建简单消息卡片
 */
export function buildMessageCard(
	message: string,
	options?: { emoji?: string; title?: string }
): FeishuCardContent {
	const emoji = options?.emoji || "";
	const title = options?.title;

	let content = message;
	if (title) {
		content = `**${title}**\n${message}`;
	}
	if (emoji) {
		content = `${emoji} ${content}`;
	}

	return buildTextCard(content);
}

/**
 * 构建分割消息卡片
 */
export function buildSectionedCard(
	sections: Array<{ title?: string; content: string }>
): FeishuCardContent {
	const elements: CardElement[] = [];

	for (let i = 0; i < sections.length; i++) {
		const section = sections[i];
		if (section.title) {
			elements.push(buildDiv(`**${section.title}**`));
		}
		elements.push(buildDiv(section.content));

		if (i < sections.length - 1) {
			elements.push(buildDivider());
		}
	}

	return buildCard(elements);
}

// ============================================================================
// 导出所有预设
// ============================================================================

export const presets = {
	// 状态
	processing: buildProcessingCard,
	success: buildSuccessCard,
	warning: buildWarningCard,

	// 思考和工具
	thinking: buildThinkingCard,
	toolCall: buildToolCallCard,
	toolHistory: buildToolHistoryCard,

	// 文件
	fileChangeList: buildFileChangeList,
	fileChange: buildFileChangeCard,
	codePreview: buildCodePreviewCard,

	// 数据
	table: buildTableCard,
	list: buildListCard,
	keyValue: buildKeyValueCard,

	// 交互
	confirm: buildConfirmCard,
	link: buildLinkCard,

	// 消息
	message: buildMessageCard,
	sectioned: buildSectionedCard,
};
