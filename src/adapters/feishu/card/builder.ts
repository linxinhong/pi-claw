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
		console.log("[CARD_TYPE] buildStatusCard - 状态卡片");
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
		console.log("[CARD_TYPE] buildThinkingContentCard - 思考内容卡片");
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
	 * @param timeline 时间线事件列表（可选）
	 * @param expanded 折叠面板是否展开（思考过程中展开，完成后折叠）
	 */
	buildToolCallsCard(toolCalls: ToolCallInfo[], timeline?: TimelineEvent[], expanded: boolean = true): Card {
		const hasTimeline = timeline && timeline.length > 0;
		console.log("[CARD_TYPE] buildToolCallsCard - 工具调用卡片", {
			toolCallsCount: toolCalls?.length || 0,
			timelineCount: timeline?.length || 0,
			hasTimeline: hasTimeline,
			expanded: expanded,
		});
		const elements: CardElement[] = [];

		// 添加时间线折叠面板（如果有）
		if (hasTimeline) {
			console.log("[CARD_TYPE] buildToolCallsCard: 使用时间线折叠面板");
			elements.push(this.buildTimelinePanel(timeline!, expanded));
		} else {
			console.log("[CARD_TYPE] buildToolCallsCard: 使用旧的工具调用列表（无timeline）");
			// 没有 timeline 时使用旧的工具调用列表
			elements.push(this.buildToolCallsList(toolCalls));
		}

		return {
			schema: "2.0",
			config: this.defaultConfig,
			body: { elements },
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
	buildStreamingCard(content: string, options?: {
		toolCalls?: ToolCallInfo[];
		timeline?: TimelineEvent[];
	}): Card {
		console.log("[CARD_TYPE] buildStreamingCard - 流式输出卡片", {
			contentLength: content?.length || 0,
			toolCallsCount: options?.toolCalls?.length || 0,
			timelineCount: options?.timeline?.length || 0,
		});
		const elements: CardElement[] = [];

		// 1. 工具调用区域（如果有）
		if (options?.toolCalls && options.toolCalls.length > 0) {
			console.log("[DEBUG] Adding toolCalls to card body");
			elements.push(this.buildToolCallsList(options.toolCalls));
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

		// 3. 时间线折叠面板（如果有）
		if (options?.timeline && options.timeline.length > 0) {
			console.log("[DEBUG] Building timeline panel with", options.timeline.length, "events");
			const panel = this.buildTimelinePanel(options.timeline);
			console.log("[DEBUG] Timeline panel built:", JSON.stringify(panel, null, 2));
			elements.push(panel);
		} else {
			console.log("[DEBUG] No timeline to display (length:", options?.timeline?.length || 0, ")");
		}

		// 4. 状态指示
		elements.push({
			tag: "markdown",
			content: "⏳ 正在生成...",
			text_size: "notation",
		});

		return {
			schema: "2.0",
			config: this.defaultConfig,
			// 移除 header，让引用功能正常工作
			body: { elements },
		};
	}

	/**
	 * 构建完成状态卡片
	 * 注意：移除 header 以支持飞书的 quote_message_id 引用功能
	 */
	buildCompleteCard(content: string, options?: {
		elapsed?: number;
		toolCalls?: ToolCallInfo[];
		thinkingContent?: string;
		timeline?: TimelineEvent[];
		expanded?: boolean;  // 折叠面板是否展开（完成后应该折叠）
	}): Card {
		const elements: CardElement[] = [];

		// 1. 先添加主要内容
		elements.push({
			tag: "div",
			text: {
				tag: "lark_md",
				content: this.formatContent(content),
			},
		});

		// 2. 添加时间线折叠面板（思考过程在主要内容下方）
		if (options?.timeline && options.timeline.length > 0) {
			// 完成时折叠面板（expanded 默认为 false）
			elements.push(this.buildTimelinePanel(options.timeline, options.expanded ?? false));
		}

		// 3. 最后添加页脚信息
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
			// 移除 header，让引用功能正常工作
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
				return `thinking: \`${event.content}\``;
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
	 * 构建时间线折叠面板（按 turn 分组）
	 * @param timeline 时间线事件列表
	 * @param expanded 是否展开（思考过程中展开，完成后折叠）
	 */
	buildTimelinePanel(timeline: TimelineEvent[], expanded: boolean = false): CardElement {
		console.log("[DEBUG] buildTimelinePanel called with", timeline.length, "events, expanded:", expanded);

		// 按 turn 分组
		const turnGroups = this.groupByTurn(timeline);
		console.log("[DEBUG] Turn groups:", Object.keys(turnGroups));

		// 构建每轮的内容
		const turnLines: string[] = [];
		const turns = Object.keys(turnGroups).sort((a, b) => Number(a) - Number(b));

		turns.forEach((turn, index) => {
			const events = turnGroups[Number(turn)];

			// 添加该轮的事件
			events.forEach(event => {
				if (event.type === "thinking") {
					turnLines.push(`thinking: \`${event.content}\``);
				} else {
					const statusIcon = this.getStatusIcon(event.status);
					// 如果有 label，显示 label 作为标题
					if (event.label) {
						turnLines.push(`**${event.label}**`);
					}
					// 显示工具名和参数
					const argsDisplay = event.args ? ` ${event.args}` : "";
					turnLines.push(`${event.content}:${argsDisplay} ${statusIcon}`);
				}
			});

			// 添加分割线（最后一轮不加）
			if (index < turns.length - 1) {
				turnLines.push("");
			}
		});

		console.log("[DEBUG] Timeline content lines:", turnLines);

		const panel = {
			tag: "collapsible_panel",
			expanded: expanded,
			header: {
				title: {
					tag: "plain_text",
					content: "思考过程",
					text_size: "normal",
				},
				vertical_align: "center",
				icon: {
					tag: "standard_icon",
					token: "down-small-ccm_outlined",
					size: "14px 14px",
				},
				icon_position: "follow_text",
				icon_expanded_angle: -180,
			},
			border: { color: "grey", corner_radius: "5px" },
			vertical_spacing: "8px",
			padding: "8px 8px 8px 8px",
			elements: [{
				tag: "markdown",
				content: turnLines.join("\n"),
				text_size: "notation",
			}],
		};

		console.log("[DEBUG] Final panel structure:", JSON.stringify(panel, null, 2));
		return panel;
	}

	/**
	 * 按 turn 分组
	 */
	private groupByTurn(timeline: TimelineEvent[]): Record<number, TimelineEvent[]> {
		return timeline.reduce((groups, event) => {
			const turn = event.turn || 1;
			if (!groups[turn]) groups[turn] = [];
			groups[turn].push(event);
			return groups;
		}, {} as Record<number, TimelineEvent[]>);
	}

	/**
	 * 获取状态图标
	 */
	private getStatusIcon(status?: string): string {
		switch (status) {
			case "success": return "✅";
			case "error": return "❌";
			case "running": return "🔄";
			default: return "⏳";
		}
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
