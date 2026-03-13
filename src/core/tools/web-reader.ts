/**
 * Web Reader Tool
 *
 * 读取网页内容的工具
 */

import { Type, Static } from "@sinclair/typebox";
import { AgentTool } from "@mariozechner/pi-agent-core";

const WebReaderSchema = Type.Object({
	url: Type.String({ description: "URL to read" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type WebReaderParams = Static<typeof WebReaderSchema>;

/**
 * 创建 Web Reader 工具
 */
export function createWebReaderTool(): AgentTool<typeof WebReaderSchema> {
	return {
		name: "web_reader",
		label: "Web Reader",
		description: "Read content from a web page",
		parameters: WebReaderSchema,
		execute: async (_toolCallId, params: WebReaderParams, _signal, _onUpdate) => {
			const { url } = params;
			
			try {
				const response = await fetch(url, {
					headers: {
						"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					},
				});
				
				if (!response.ok) {
					return {
						content: [{ type: "text", text: `Failed to fetch page: HTTP ${response.status}` }],
						details: { error: `HTTP ${response.status}` },
					};
				}
				
				const html = await response.text();
				
				// 简单提取文本内容
				let text = html
					.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // 移除 script
					.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // 移除 style
					.replace(/<[^>]+>/g, " ") // 移除 HTML 标签
					.replace(/\s+/g, " ") // 压缩空白
					.trim();
				
				// 限制长度
				const maxLength = 8000;
				if (text.length > maxLength) {
					text = text.slice(0, maxLength) + "\n\n[Content truncated...]";
				}
				
				return {
					content: [{ type: "text", text: `Content from ${url}:\n\n${text}` }],
					details: { url, length: text.length },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Failed to read page: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}
