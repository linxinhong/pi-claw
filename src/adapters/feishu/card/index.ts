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
import {
	buildCard,
	buildDiv,
	buildDivider,
	buildTextCard,
	buildErrorCard,
	autoBuildCard,
	type CardElement,
	type FeishuCardContent,
} from "../cards/index.js";

// ============================================================================
// Types
// ============================================================================

// 重新导出类型以保持向后兼容
export type { CardElement, FeishuCardContent as CardContent } from "../cards/index.js";

// ============================================================================
// Tools
// ============================================================================

const CardSchema = Type.Object({
	elements: Type.String({ description: "JSON array of card elements" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type CardParams = Static<typeof CardSchema>;

function createBuildCardTool(): AgentTool<typeof CardSchema> {
	return {
		name: "buildCard",
		label: "Build Card",
		description: "Build a Feishu card message from JSON elements.",
		parameters: CardSchema,
		execute: async (_toolCallId, params: CardParams, _signal, _onUpdate) => {
			const { elements } = params;
			try {
				const parsed = JSON.parse(elements);
				const cardElements: CardElement[] = [];

				for (const el of parsed) {
					if (el.type === "markdown") {
						cardElements.push(buildDiv(el.content));
					} else if (el.type === "divider") {
						cardElements.push(buildDivider());
					} else if (el.type === "title") {
						cardElements.push(buildDiv(`**${el.content}**`));
					} else if (el.type === "button" && el.text && el.url) {
						// 按钮需要单独处理
						cardElements.push(buildDiv(`[${el.text}](${el.url})`));
					}
				}

				const card = buildCard(cardElements);
				const result = JSON.stringify(card, null, 2);
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
		version: "3.0.0",
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

// ============================================================================
// 便捷导出（向后兼容）
// ============================================================================

/**
 * @deprecated 使用 buildTextCard 或 buildCard 代替
 * 保留此导出以保持向后兼容
 */
export function createTextCard(content: string): FeishuCardContent {
	return buildTextCard(content);
}

/**
 * @deprecated 使用 autoBuildCard 代替
 * 保留此导出以保持向后兼容
 */
export function createSmartCard(content: string): FeishuCardContent {
	return autoBuildCard(content);
}

// 重新导出卡片构建函数
export {
	buildCard,
	buildTextCard,
	buildErrorCard,
	autoBuildCard,
	buildDiv,
	buildDivider,
} from "../cards/index.js";
