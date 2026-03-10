/**
 * Card Builder
 *
 * 飞书卡片构建器
 */

import type { CardStatus, ToolCallInfo, TimelineEvent } from "../types.js";

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

interface CardHeader {
	title: { content: string; tag: "plain_text" | "lark_md" };
	subtitle?: { content: string; tag: "plain_text" | "lark_md" };
	template?: string;
}

interface Card {
	schema: "2.0";
	config?: CardConfig;
	header?: CardHeader;
	body: {
		elements: CardElement[];
	};
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
	 * 构建状态卡片（带计时器）
	 * @param elapsed 已耗时（毫秒）
	 * @param status 状态：processing 或 complete
	 */
	buildStatusCard(elapsed?: number, status?: "processing" | "complete"): Card {
		const statusIcon = status === "complete" ? "😊" : "🤔";
		const timeDisplay = elapsed !== undefined
			? ` (${this.formatElapsedTime(elapsed)})`
			: "……";

		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: {
				elements: [{
					tag: "div",
					text: {
						tag: "plain_text",
						content: `${statusIcon} 处理中${timeDisplay}`,
					},
				}],
			},
		};
	}

	/**
	 * 构建思考内容卡片
	 * @param content 思考内容
	 */
	buildThinkingContentCard(content: string): Card {
		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: {
				elements: [
					{
						tag: "div",
						text: {
							tag: "lark_md",
							content: this.formatContent(content),
						},
					},
				],
			},
		};
	}

	/**
	 * 构建工具调用卡片
	 * @param toolCalls 工具调用列表
	 */
	buildToolCallsCard(toolCalls: ToolCallInfo[]): Card {
		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: {
				elements: [this.buildToolCallsList(toolCalls)],
			},
		};
	}

	/**
	 * 构建时间线卡片
	 * @param timeline 时间线事件列表
	 */
	buildTimelineCard(timeline: TimelineEvent[]): Card {
		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: {
				elements: [this.buildTimelineList(timeline)],
			},
		};
	}

	/**
	 * 构建思考中状态卡片（兼容旧接口）
	 */
	buildThinkingCard(): Card {
		return this.buildStatusCard(undefined, "processing");
	}

	/**
	 * 构建流式输出卡片
	 */
	buildStreamingCard(content: string, toolCalls?: ToolCallInfo[]): Card {
		const elements: CardElement[] = [];

		// 1. 工具调用区域（如果有）
		if (toolCalls && toolCalls.length > 0) {
			elements.push(this.buildToolCallsList(toolCalls));
		}

		// 2. 主要内容区域（如果有）
		if (content && content.trim()) {
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: this.formatContent(content),
				},
			});
		}

		// 3. 状态指示
		elements.push({
			tag: "markdown",
			content: "⏳ 正在生成...",
			text_size: "notation",
		});

		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: { elements },
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
		if (options?.elapsed !== undefined) {
			elements.push({
				tag: "markdown",
				content: `⏱️ 耗时: ${this.formatElapsed(options.elapsed)}`,
				text_size: "notation",
			});
		}

		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: { elements },
		};
	}

	/**
	 * 构建错误状态卡片
	 */
	buildErrorCard(error: string): Card {
		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: {
				elements: [
					{
						tag: "div",
						text: {
							tag: "lark_md",
							content: `❌ **发生错误**\n\n${this.escapeMarkdown(error)}`,
						},
					},
				],
			},
		};
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * 构建工具调用列表（带参数显示）
	 */
	private buildToolCallsList(toolCalls: ToolCallInfo[]): CardElement {
		const lines = toolCalls.map(tc => {
			const argsStr = tc.args ? this.formatArgs(tc.args) : "";
			const argsDisplay = argsStr ? ` \`${argsStr}\`` : "";
			return `\\> ${tc.name}:${argsDisplay}`;
		});

		return {
			tag: "div",
			text: {
				tag: "lark_md",
				content: lines.join("\n"),
			},
		};
	}

	/**
	 * 构建时间线列表
	 */
	private buildTimelineList(timeline: TimelineEvent[]): CardElement {
		const lines = timeline.map(event => {
			if (event.type === "thinking") {
				return `🤔 thinking: \`${event.content}\``;
			} else {
				const statusIcon = event.status === "success" ? "✅" :
				                   event.status === "error" ? "❌" :
				                   event.status === "running" ? "🔄" : "⏳";
				const argsDisplay = event.args ? ` \`${event.args}\`` : "";
				return `${statusIcon} ${event.content}${argsDisplay}`;
			}
		});

		return {
			tag: "div",
			text: {
				tag: "lark_md",
				content: lines.join("\n"),
			},
		};
	}

	/**
	 * 格式化参数（简化显示）
	 */
	private formatArgs(args: Record<string, any>): string {
		const keys = Object.keys(args).filter(k => !k.startsWith("_"));
		if (keys.length === 0) return "";

		// 对于 bash 工具，显示命令
		if (args.command) {
			const cmd = String(args.command);
			return cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd;
		}

		// 对于 read 工具，显示文件路径
		if (args.file_path) {
			const path = String(args.file_path);
			return path.split("/").pop() || path;
		}

		// 其他工具，显示第一个参数的值
		const firstKey = keys[0];
		const value = String(args[firstKey]);
		return value.length > 50 ? value.substring(0, 50) + "..." : value;
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
			tag: "markdown",
			content: parts.join(" | "),
			text_size: "notation",
		};
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

		// 转义 @ 符号，防止被误解析为用户提及
		// 飞书 lark_md 会将 @xxx 解析为用户提及，但 xxx 通常不是有效的用户 ID
		// 匹配 @ 后面跟着字母、数字、下划线或中文的模式
		result = result.replace(/@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g, "\\@$1");

		return result;
	}

	/**
	 * 转义 Markdown 特殊字符
	 */
	private escapeMarkdown(text: string): string {
		return text.replace(/([*_`\[\]()#+\-.!])/g, "\\$1");
	}

	/**
	 * 格式化耗时（MM:SS 格式）
	 * @param ms 毫秒数
	 */
	formatElapsedTime(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}

	/**
	 * 格式化耗时（兼容旧接口）
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
