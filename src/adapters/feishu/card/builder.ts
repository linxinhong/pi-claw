/**
 * Card Builder
 *
 * 飞书卡片构建器
 */

import type { CardStatus, ToolCallInfo } from "../types.js";

// ============================================================================
// Types
// ============================================================================

interface CardConfig {
	width_mode?: "fill" | "normal";
	update_multi?: boolean;
}

interface CardElement {
	tag: string;
	[key: string]: any;
}

interface Card {
	config?: CardConfig;
	elements: CardElement[];
}

// ============================================================================
// Card Builder
// ============================================================================

/**
 * 飞书卡片构建器
 */
export class CardBuilder {
	private defaultConfig: CardConfig = {
		width_mode: "fill",
		update_multi: true,
	};

	/**
	 * 构建思考中状态卡片
	 */
	buildThinkingCard(): Card {
		return {
			config: this.defaultConfig,
			elements: [
				{
					tag: "div",
					text: {
						tag: "plain_text",
						content: "🤔 思考中...",
					},
				},
				{
					tag: "note",
					elements: [
						{
							tag: "plain_text",
							content: "正在处理您的请求，请稍候...",
						},
					],
				},
			],
		};
	}

	/**
	 * 构建流式输出卡片
	 */
	buildStreamingCard(content: string, toolCalls?: ToolCallInfo[]): Card {
		const elements: CardElement[] = [];

		// 添加主要内容
		elements.push({
			tag: "div",
			text: {
				tag: "lark_md",
				content: this.formatContent(content),
			},
		});

		// 添加工具调用状态
		if (toolCalls && toolCalls.length > 0) {
			elements.push(this.buildToolCallsSection(toolCalls));
		}

		// 添加状态指示
		elements.push({
			tag: "note",
			elements: [
				{
					tag: "plain_text",
					content: "⏳ 正在生成...",
				},
			],
		});

		return {
			config: this.defaultConfig,
			elements,
		};
	}

	/**
	 * 构建完成状态卡片
	 */
	buildCompleteCard(content: string, options?: {
		elapsed?: number;
		toolCalls?: ToolCallInfo[];
		thinkingContent?: string;
	}): Card {
		const elements: CardElement[] = [];

		// 添加思考过程（如果有）
		if (options?.thinkingContent) {
			elements.push({
				tag: "collapsible_panel",
				expanded: false,
				header: {
					title: {
						tag: "plain_text",
						content: "💭 思考过程",
					},
				},
				body: {
					elements: [
						{
							tag: "div",
							text: {
								tag: "lark_md",
								content: this.formatContent(options.thinkingContent),
							},
						},
					],
				},
			});
		}

		// 添加主要内容
		elements.push({
			tag: "div",
			text: {
				tag: "lark_md",
				content: this.formatContent(content),
			},
		});

		// 添加工具调用汇总
		if (options?.toolCalls && options.toolCalls.length > 0) {
			elements.push(this.buildToolCallsSummary(options.toolCalls));
		}

		// 添加页脚信息
		const footerElements: CardElement[] = [];
		if (options?.elapsed !== undefined) {
			footerElements.push({
				tag: "plain_text",
				content: `⏱️ 耗时: ${this.formatElapsed(options.elapsed)}`,
			});
		}

		if (footerElements.length > 0) {
			elements.push({
				tag: "note",
				elements: footerElements,
			});
		}

		return {
			config: this.defaultConfig,
			elements,
		};
	}

	/**
	 * 构建错误状态卡片
	 */
	buildErrorCard(error: string): Card {
		return {
			config: this.defaultConfig,
			elements: [
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content: `❌ **发生错误**\n\n${this.escapeMarkdown(error)}`,
					},
				},
			],
		};
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * 构建工具调用状态区域
	 */
	private buildToolCallsSection(toolCalls: ToolCallInfo[]): CardElement {
		const toolElements = toolCalls.map((tc) => {
			const statusIcon = this.getToolStatusIcon(tc.status);
			return {
				tag: "div",
				text: {
					tag: "lark_md",
					content: `${statusIcon} \`${tc.name}\``,
				},
			};
		});

		return {
			tag: "div",
			fields: toolElements,
		};
	}

	/**
	 * 构建工具调用汇总
	 */
	private buildToolCallsSummary(toolCalls: ToolCallInfo[]): CardElement {
		const successfulTools = toolCalls.filter((tc) => tc.status === "success");
		const failedTools = toolCalls.filter((tc) => tc.status === "error");

		const parts: string[] = [];

		if (successfulTools.length > 0) {
			parts.push(`✅ ${successfulTools.length} 个工具调用成功`);
		}

		if (failedTools.length > 0) {
			parts.push(`❌ ${failedTools.length} 个工具调用失败`);
		}

		return {
			tag: "note",
			elements: [
				{
					tag: "plain_text",
					content: parts.join(" | "),
				},
			],
		};
	}

	/**
	 * 获取工具状态图标
	 */
	private getToolStatusIcon(status: string): string {
		switch (status) {
			case "pending":
				return "⏳";
			case "running":
				return "🔄";
			case "success":
				return "✅";
			case "error":
				return "❌";
			default:
				return "❓";
		}
	}

	/**
	 * 格式化内容
	 */
	private formatContent(content: string): string {
		// 转换为飞书兼容的 Markdown
		return this.convertToFeishuMarkdown(content);
	}

	/**
	 * 转换为飞书兼容的 Markdown
	 */
	private convertToFeishuMarkdown(content: string): string {
		let result = content;

		// 转换代码块
		result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
			return `\`\`\`${lang || ""}\n${code.trim()}\n\`\`\``;
		});

		// 转换行内代码
		result = result.replace(/`([^`]+)`/g, "`$1`");

		// 转换链接
		result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "[$1]($2)");

		return result;
	}

	/**
	 * 转义 Markdown 特殊字符
	 */
	private escapeMarkdown(text: string): string {
		return text.replace(/([*_`\[\]()#+\-.!])/g, "\\$1");
	}

	/**
	 * 格式化耗时
	 */
	private formatElapsed(ms: number): string {
		if (ms < 1000) {
			return `${ms}ms`;
		} else if (ms < 60000) {
			return `${(ms / 1000).toFixed(1)}s`;
		} else {
			const minutes = Math.floor(ms / 60000);
			const seconds = Math.round((ms % 60000) / 1000);
			return `${minutes}m ${seconds}s`;
		}
	}
}
