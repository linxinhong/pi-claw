/**
 * Card Plugin - 卡片消息插件
 *
 * 提供飞书卡片消息的构建和发送功能
 * 这是飞书平台特定的插件
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Plugin, PluginContext, PluginInitContext } from "../../../core/plugin/types.js";
import * as log from "../../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

interface CardElement {
	tag: string;
	text?: { tag: string; content: string };
	actions?: CardAction[];
	[key: string]: any;
}

interface CardAction {
	tag: string;
	text?: { tag: string; content: string };
	url?: string;
	[key: string]: any;
}

interface CardContent {
	schema: string;
	config: { width_mode: string; update_multi: boolean };
	body: { elements: CardElement[] };
}

// ============================================================================
// Card Builder
// ============================================================================

class CardBuilder {
	private elements: CardElement[] = [];

	addMarkdown(content: string): this {
		this.elements.push({
			tag: "div",
			text: { tag: "lark_md", content },
		});
		return this;
	}

	addDivider(): this {
		this.elements.push({ tag: "hr" });
		return this;
	}

	addTitle(content: string): this {
		this.elements.push({
			tag: "div",
			text: { tag: "plain_text", content },
		});
		return this;
	}

	addAction(actions: CardAction[]): this {
		this.elements.push({
			tag: "action",
			actions,
		});
		return this;
	}

	addButton(text: string, url: string): this {
		return this.addAction([
			{
				tag: "button",
				text: { tag: "plain_text", content: text },
				url,
			},
		]);
	}

	build(): CardContent {
		return {
			schema: "2.0",
			config: { width_mode: "fill", update_multi: true },
			body: { elements: this.elements },
		};
	}
}

// ============================================================================
// Tools
// ============================================================================

const CardSchema = Type.Object({
	elements: Type.String({ description: "JSON array of card elements" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type CardParams = Static<typeof CardSchema>;

function createBuildCardTool(): AgentTool<typeof CardSchema> {
	const CardSchema = Type.Object({
		elements: Type.String({ description: "JSON array of card elements" }),
		label: Type.String({ description: "Short label shown to user" }),
	});
	type CardParams = Static<typeof CardSchema>;

	return {
		name: "buildCard",
		label: "Build Card",
		description: "Build a Feishu card message from JSON elements.",
		parameters: CardSchema,
		execute: async (_toolCallId, params: CardParams, _signal, _onUpdate) => {
			const { elements } = params;
			try {
				const parsed = JSON.parse(elements);
				const builder = new CardBuilder();

				for (const el of parsed) {
					if (el.type === "markdown") {
						builder.addMarkdown(el.content);
					} else if (el.type === "divider") {
						builder.addDivider();
					} else if (el.type === "title") {
						builder.addTitle(el.content);
					} else if (el.type === "button") {
						builder.addButton(el.text, el.url);
					}
				}

				const result = JSON.stringify(builder.build(), null, 2);
				return {
					content: [{ type: "text", text: result }],
					details: { elementCount: parsed.length },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * Card Plugin
 *
 * 飞书平台特定的卡片消息构建插件
 * 仅在飞书平台上启用
 */
export const cardPlugin: Plugin = {
	meta: {
		id: "card",
		name: "Card",
		version: "2.0.0",
		description: "Feishu card message builder (platform-specific)",
		// 仅支持飞书平台
		supportedPlatforms: ["feishu"],
	},

	async init(_context: PluginInitContext): Promise<void> {
		log.logInfo("[Card Plugin] Initialized for Feishu platform");
	},

	async getTools(_context: PluginContext): Promise<any[]> {
		return [createBuildCardTool()];
	},
};

export { CardBuilder, type CardContent, type CardElement };
