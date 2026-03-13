/**
 * Web Search Tool
 *
 * 简单的网络搜索工具，使用 DuckDuckGo 或类似服务
 */

import { Type, Static } from "@sinclair/typebox";
import { AgentTool } from "@mariozechner/pi-agent-core";

const WebSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type WebSearchParams = Static<typeof WebSearchSchema>;

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

/**
 * 创建 Web Search 工具
 */
export function createWebSearchTool(): AgentTool<typeof WebSearchSchema> {
	return {
		name: "web_search",
		label: "Web Search",
		description: "Search the web for information using DuckDuckGo",
		parameters: WebSearchSchema,
		execute: async (_toolCallId, params: WebSearchParams, _signal, _onUpdate) => {
			const { query } = params;
			
			try {
				// 使用 DuckDuckGo 的 HTML 版本进行搜索
				const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
				
				const response = await fetch(searchUrl, {
					headers: {
						"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					},
				});
				
				if (!response.ok) {
					return {
						content: [{ type: "text", text: `Search failed: HTTP ${response.status}` }],
						details: { error: `HTTP ${response.status}` },
					};
				}
				
				const html = await response.text();
				
				// 简单解析搜索结果
				const results: SearchResult[] = [];
				const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>.*?<a class="result__snippet"[^>]*>([^<]*)<\/a>/gs;
				
				let match;
				while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
					results.push({
						url: match[1],
						title: match[2].replace(/<[^>]+>/g, ""), // 移除 HTML 标签
						snippet: match[3].replace(/<[^>]+>/g, ""),
					});
				}
				
				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "No search results found. The search service may be unavailable or rate-limited." }],
						details: { query },
					};
				}
				
				// 格式化结果
				const formatted = results
					.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`)
					.join("\n\n");
				
				return {
					content: [{ type: "text", text: `Search results for "${query}":\n\n${formatted}` }],
					details: { query, resultCount: results.length },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Search error: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}
