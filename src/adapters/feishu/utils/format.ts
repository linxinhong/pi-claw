/**
 * Format Utilities
 *
 * Markdown 格式化工具
 */

/**
 * 转换为飞书兼容的 Markdown
 */
export function toFeishuMarkdown(content: string): string {
	let result = content;

	// 转换代码块
	result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
		return `\`\`\`${lang || ""}\n${code.trim()}\n\`\`\``;
	});

	// 转换标题
	result = result.replace(/^### (.+)$/gm, "**$1**");
	result = result.replace(/^## (.+)$/gm, "**$1**");
	result = result.replace(/^# (.+)$/gm, "**$1**");

	// 转换粗体和斜体（飞书支持）
	// result = result.replace(/\*\*([^*]+)\*\*/g, "**$1**");
	// result = result.replace(/\*([^*]+)\*/g, "*$1*");

	// 转换链接（飞书支持）
	// result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "[$1]($2)");

	// 转换列表
	result = result.replace(/^- (.+)$/gm, "• $1");
	result = result.replace(/^\* (.+)$/gm, "• $1");

	return result;
}

/**
 * 转义 Markdown 特殊字符
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/([*_`\[\]()#+\-.!])/g, "\\$1");
}

/**
 * 截断文本
 */
export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.slice(0, maxLength - 3) + "...";
}

/**
 * 分割文本为多个块
 */
export function splitTextToChunks(text: string, chunkSize: number): string[] {
	if (text.length <= chunkSize) {
		return [text];
	}

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= chunkSize) {
			chunks.push(remaining);
			break;
		}

		// 尝试在换行符处分割
		let splitIndex = remaining.lastIndexOf("\n", chunkSize);
		if (splitIndex === -1 || splitIndex < chunkSize / 2) {
			// 没有合适的换行符，强制分割
			splitIndex = chunkSize;
		}

		chunks.push(remaining.slice(0, splitIndex));
		remaining = remaining.slice(splitIndex).trim();
	}

	return chunks;
}

/**
 * 移除 HTML 标签
 */
export function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, "");
}

/**
 * 规范化空白字符
 */
export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
