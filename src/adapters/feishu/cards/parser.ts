/**
 * Feishu Card Parser
 *
 * 内容解析器 - 解析 AI 回复，提取结构化内容
 */

import type { ParsedResponse, CodeBlock, FileChange, ToolCallResult, TableData } from "./types.js";
import {
	buildCard,
	buildTextCard,
	buildCodeCard,
	buildStructuredCard,
	buildThinkingCard,
	buildToolCallCard,
	buildFileChangeCard,
	buildTableCard,
	buildDivider,
	buildDiv,
	buildCollapsibleSection,
} from "./builder.js";
import type { FeishuCardContent, CardElement } from "./types.js";

// ============================================================================
// 正则表达式
// ============================================================================

/** 代码块正则 */
const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;

/** 文件变更正则 */
const FILE_CHANGE_REGEX = /^(Created|Modified|Deleted|创建|修改|删除)\s+(?:file\s+)?[`"]?([^`"\n]+)[`"]?/gm;

/** 思考过程正则 */
const THINKING_REGEX = /^(?:Thinking|思考|Step|步骤)[：:\s]*(.+)$/gm;

/** 工具调用正则 */
const TOOL_CALL_REGEX = /^(?:Tool|工具)[：:\s]*`?([^`\n]+)`?\s*[-–—]\s*(Running|Success|Error|运行中|成功|失败)/gm;

/** Markdown 表格正则 */
const TABLE_REGEX = /^\|(.+)\|\s*\n\|[-:\s|]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm;

/** 标题正则 */
const HEADING_REGEX = /^(#{1,3})\s+(.+)$/gm;

// ============================================================================
// 解析函数
// ============================================================================

/**
 * 解析代码块
 */
function parseCodeBlocks(text: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	let match;

	while ((match = CODE_BLOCK_REGEX.exec(text)) !== null) {
		blocks.push({
			language: match[1] || "text",
			code: match[2].trim(),
		});
	}

	return blocks;
}

/**
 * 解析文件变更
 */
function parseFileChanges(text: string): FileChange[] {
	const changes: FileChange[] = [];
	let match;

	while ((match = FILE_CHANGE_REGEX.exec(text)) !== null) {
		const typeStr = match[1].toLowerCase();
		let type: "created" | "modified" | "deleted" = "modified";

		if (typeStr === "created" || typeStr === "创建") {
			type = "created";
		} else if (typeStr === "deleted" || typeStr === "删除") {
			type = "deleted";
		}

		changes.push({
			type,
			path: match[2].trim(),
		});
	}

	return changes;
}

/**
 * 解析思考步骤
 */
function parseThinking(text: string): string[] {
	const steps: string[] = [];
	let match;

	while ((match = THINKING_REGEX.exec(text)) !== null) {
		steps.push(match[1].trim());
	}

	return steps;
}

/**
 * 解析工具调用
 */
function parseToolCalls(text: string): ToolCallResult[] {
	const calls: ToolCallResult[] = [];
	let match;

	while ((match = TOOL_CALL_REGEX.exec(text)) !== null) {
		const statusStr = match[2].toLowerCase();
		let status: "running" | "success" | "error" = "success";

		if (statusStr === "running" || statusStr === "运行中") {
			status = "running";
		} else if (statusStr === "error" || statusStr === "失败") {
			status = "error";
		}

		calls.push({
			name: match[1].trim(),
			status,
		});
	}

	return calls;
}

/**
 * 解析表格
 */
function parseTables(text: string): TableData[] {
	const tables: TableData[] = [];
	let match;

	while ((match = TABLE_REGEX.exec(text)) !== null) {
		const headerLine = match[1];
		const bodyLines = match[2].trim().split("\n");

		const headers = headerLine
			.split("|")
			.map((h) => h.trim())
			.filter(Boolean);

		const rows = bodyLines.map((line) =>
			line
				.split("|")
				.map((c) => c.trim())
				.filter(Boolean)
		);

		if (headers.length > 0 && rows.length > 0) {
			tables.push({ headers, rows });
		}
	}

	return tables;
}

/**
 * 移除已解析的结构化内容，提取摘要
 */
function extractSummary(text: string): string {
	let summary = text;

	// 移除代码块
	summary = summary.replace(CODE_BLOCK_REGEX, "");

	// 移除表格
	summary = summary.replace(TABLE_REGEX, "");

	// 移除文件变更
	summary = summary.replace(FILE_CHANGE_REGEX, "");

	// 移除思考步骤
	summary = summary.replace(THINKING_REGEX, "");

	// 移除工具调用
	summary = summary.replace(TOOL_CALL_REGEX, "");

	// 清理多余空行
	summary = summary.replace(/\n{3,}/g, "\n\n").trim();

	return summary;
}

/**
 * 解析 AI 回复，提取所有结构化内容
 */
export function parseResponse(text: string): ParsedResponse {
	return {
		summary: extractSummary(text),
		codeBlocks: parseCodeBlocks(text),
		fileChanges: parseFileChanges(text),
		thinking: parseThinking(text),
		toolCalls: parseToolCalls(text),
		tables: parseTables(text),
		details: text,
	};
}

// ============================================================================
// 智能卡片构建
// ============================================================================

/**
 * 内容特征
 */
interface ContentFeatures {
	hasCode: boolean;
	hasMultipleCodeBlocks: boolean;
	hasFileChanges: boolean;
	hasThinking: boolean;
	hasToolCalls: boolean;
	hasTables: boolean;
	isLongText: boolean;
	hasStructure: boolean;
}

/**
 * 分析内容特征
 */
function analyzeContent(text: string): ContentFeatures {
	const parsed = parseResponse(text);
	const lines = text.split("\n").length;

	return {
		hasCode: parsed.codeBlocks.length > 0,
		hasMultipleCodeBlocks: parsed.codeBlocks.length > 1,
		hasFileChanges: parsed.fileChanges.length > 0,
		hasThinking: parsed.thinking.length > 0,
		hasToolCalls: parsed.toolCalls.length > 0,
		hasTables: parsed.tables.length > 0,
		isLongText: lines > 20 || text.length > 2000,
		hasStructure:
			parsed.codeBlocks.length > 0 ||
			parsed.fileChanges.length > 0 ||
			parsed.tables.length > 0 ||
			parsed.thinking.length > 0,
	};
}

/**
 * 判断是否需要结构化显示
 */
export function shouldUseStructuredCard(text: string): boolean {
	const features = analyzeContent(text);
	return features.hasStructure || features.isLongText;
}

/**
 * 根据内容自动选择最佳卡片类型
 */
export function autoBuildCard(text: string): FeishuCardContent {
	const features = analyzeContent(text);
	const parsed = parseResponse(text);

	// 如果没有特殊结构，返回简单文本卡片
	if (!features.hasStructure && !features.isLongText) {
		return buildTextCard(text);
	}

	// 构建结构化卡片
	const elements: CardElement[] = [];

	// 添加摘要
	if (parsed.summary) {
		elements.push(buildDiv(parsed.summary.substring(0, 4000))); // 飞书限制
	}

	// 添加思考步骤
	if (features.hasThinking) {
		elements.push(buildDivider());
		elements.push(buildDiv("**💭 思考过程**"));
		for (const step of parsed.thinking) {
			elements.push(buildDiv(`• ${step}`));
		}
	}

	// 添加工具调用
	if (features.hasToolCalls) {
		elements.push(buildDivider());
		elements.push(buildDiv("**🔧 工具调用**"));
		for (const call of parsed.toolCalls) {
			const emoji = call.status === "running" ? "⏳" : call.status === "success" ? "✅" : "❌";
			elements.push(buildDiv(`${emoji} \`${call.name}\``));
		}
	}

	// 添加文件变更
	if (features.hasFileChanges) {
		elements.push(buildDivider());
		elements.push(buildDiv("**📝 文件变更**"));
		const typeEmoji = {
			created: "✨",
			modified: "📝",
			deleted: "🗑️",
		};
		for (const change of parsed.fileChanges) {
			const emoji = typeEmoji[change.type];
			elements.push(buildDiv(`${emoji} \`${change.path}\``));
		}
	}

	// 添加代码块
	if (features.hasCode) {
		for (let i = 0; i < Math.min(parsed.codeBlocks.length, 3); i++) {
			const block = parsed.codeBlocks[i];
			elements.push(buildDivider());
			const title = block.language ? `代码 (${block.language})` : "代码";
			// 如果代码太长，折叠显示
			if (block.code.length > 500) {
				elements.push(buildCollapsibleSection(title, `\`\`\`${block.language}\n${block.code}\n\`\`\``));
			} else {
				elements.push(buildDiv(`**${title}**\n\`\`\`${block.language}\n${block.code}\n\`\`\``));
			}
		}
		// 如果有更多代码块，显示提示
		if (parsed.codeBlocks.length > 3) {
			elements.push(buildDiv(`_...还有 ${parsed.codeBlocks.length - 3} 个代码块_`));
		}
	}

	// 添加表格
	if (features.hasTables) {
		for (const table of parsed.tables) {
			elements.push(buildDivider());
			// 使用 Markdown 表格格式
			const headerLine = "| " + table.headers.join(" | ") + " |";
			const separator = "| " + table.headers.map(() => "---").join(" | ") + " |";
			const rowLines = table.rows.map((row) => "| " + row.join(" | ") + " |");
			const tableText = [headerLine, separator, ...rowLines].join("\n");
			elements.push(buildDiv(tableText));
		}
	}

	// 如果没有摘要但有其他内容，直接使用原文
	if (elements.length === 0) {
		return buildTextCard(text);
	}

	return buildCard(elements);
}

/**
 * 智能截断长文本
 */
export function truncateText(text: string, maxLength: number = 4000): string {
	if (text.length <= maxLength) {
		return text;
	}

	// 尝试在句子结束处截断
	const truncated = text.substring(0, maxLength);
	const lastPeriod = Math.max(truncated.lastIndexOf("。"), truncated.lastIndexOf("."), truncated.lastIndexOf("\n"));

	if (lastPeriod > maxLength * 0.8) {
		return truncated.substring(0, lastPeriod + 1) + "\n\n_...内容已截断_";
	}

	return truncated + "\n\n_...内容已截断_";
}

/**
 * 构建状态更新卡片（用于实时显示工具执行状态）
 */
export function buildProgressCard(status: string, toolHistory: string[]): FeishuCardContent {
	const elements: CardElement[] = [buildDiv(status)];

	if (toolHistory.length > 0) {
		elements.push(buildDivider());
		const historyText = toolHistory.map((h) => `• ${h}`).join("\n");
		elements.push(buildDiv(historyText));
	}

	return buildCard(elements);
}
