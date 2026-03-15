/**
 * Memory Tools - Memory tool creation for Agent
 *
 * Provides Agent tool interface for memory operations with enhanced search support.
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { MemoryStore } from "./store.js";

// =============================================================================
// Search Type Enum
// =============================================================================

const SearchTypeEnum = Type.Union([Type.Literal("hybrid"), Type.Literal("fts"), Type.Literal("vector")], {
	description: "Search type: hybrid (default), fts (full-text only), or vector (semantic only)",
});

// =============================================================================
// Memory Save Tool
// =============================================================================

const MemorySaveSchema = Type.Object({
	content: Type.String({ description: "Information to save to memory" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type MemorySaveParams = Static<typeof MemorySaveSchema>;

export function createMemorySaveTool(store: MemoryStore): AgentTool<typeof MemorySaveSchema> {
	return {
		name: "memory_save",
		label: "Memory Save",
		description: "Save important information to long-term memory.",
		parameters: MemorySaveSchema,
		execute: async (_toolCallId, params: MemorySaveParams, _signal, _onUpdate) => {
			const { content } = params;
			try {
				store.append(content);
				return {
					content: [{ type: "text", text: `Saved to memory: ${content.substring(0, 100)}...` }],
					details: { saved: true },
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

// =============================================================================
// Memory Recall Tool (Enhanced)
// =============================================================================

const MemoryRecallSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	label: Type.String({ description: "Short label shown to user" }),
	searchType: Type.Optional(SearchTypeEnum),
	topK: Type.Optional(Type.Number({ description: "Maximum number of results (default: 10)", minimum: 1, maximum: 50 })),
	scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("channel")], { description: "Filter by scope" })),
});
type MemoryRecallParams = Static<typeof MemoryRecallSchema>;

export function createMemoryRecallTool(store: MemoryStore): AgentTool<typeof MemoryRecallSchema> {
	return {
		name: "memory_recall",
		label: "Memory Recall",
		description: "Search and retrieve information from long-term memory. Supports hybrid search combining full-text and semantic search.",
		parameters: MemoryRecallSchema,
		execute: async (_toolCallId, params: MemoryRecallParams, _signal, _onUpdate) => {
			const { query, searchType, topK, scope } = params;
			try {
				const results = await store.searchEnhanced(query, {
					searchType: searchType ?? "hybrid",
					topK: topK ?? 10,
					scope: scope,
				});

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "No matching memories found." }],
						details: { count: 0, searchType: searchType ?? "hybrid" },
					};
				}

				// Format results
				const formattedResults = results
					.map((r, i) => {
						const header = r.sectionTitle ? `### ${r.sectionTitle}` : `### Result ${i + 1}`;
						const score = `Score: ${r.score.toFixed(3)} (${r.searchType})`;
						const source = r.sourcePath.split("/").pop();
						return `${header}\n${r.content}\n${score} | Source: ${source}`;
					})
					.join("\n\n---\n\n");

				return {
					content: [{ type: "text", text: formattedResults }],
					details: {
						count: results.length,
						searchType: searchType ?? "hybrid",
						topScores: results.slice(0, 3).map((r) => r.score),
					},
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

// =============================================================================
// Memory Forget Tool
// =============================================================================

const MemoryForgetSchema = Type.Object({
	pattern: Type.String({ description: "Pattern to match and remove" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type MemoryForgetParams = Static<typeof MemoryForgetSchema>;

export function createMemoryForgetTable(store: MemoryStore): AgentTool<typeof MemoryForgetSchema> {
	return {
		name: "memory_forget",
		label: "Memory Forget",
		description: "Remove information from memory by pattern.",
		parameters: MemoryForgetSchema,
		execute: async (_toolCallId, params: MemoryForgetParams, _signal, _onUpdate) => {
			const { pattern } = params;
			try {
				const removed = store.forget(pattern);
				return {
					content: [{ type: "text", text: `Removed ${removed} lines from memory.` }],
					details: { removedLines: removed },
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

// =============================================================================
// Memory Append Daily Tool
// =============================================================================

const MemoryAppendDailySchema = Type.Object({
	content: Type.String({ description: "Content to append to daily log" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type MemoryAppendDailyParams = Static<typeof MemoryAppendDailySchema>;

export function createMemoryAppendDailyTool(workspaceDir: string): AgentTool<typeof MemoryAppendDailySchema> {
	return {
		name: "memory_append_daily",
		label: "Memory Append Daily",
		description: "Append to today's daily log.",
		parameters: MemoryAppendDailySchema,
		execute: async (_toolCallId, params: MemoryAppendDailyParams, _signal, _onUpdate) => {
			const { content } = params;
			try {
				const today = new Date().toISOString().split("T")[0];
				const dailyLogPath = join(workspaceDir, "memory", `${today}.md`);
				const dir = join(dailyLogPath, "..");

				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
				}

				const timestamp = new Date().toTimeString().split(" ")[0];
				const entry = `- [${timestamp}] ${content}\n`;
				appendFileSync(dailyLogPath, entry, "utf-8");

				return {
					content: [{ type: "text", text: `Appended to daily log: ${content.substring(0, 100)}...` }],
					details: { date: today },
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

// =============================================================================
// Memory Stats Tool (New)
// =============================================================================

const MemoryStatsSchema = Type.Object({
	label: Type.String({ description: "Short label shown to user" }),
});
type MemoryStatsParams = Static<typeof MemoryStatsSchema>;

export function createMemoryStatsTool(store: MemoryStore): AgentTool<typeof MemoryStatsSchema> {
	return {
		name: "memory_stats",
		label: "Memory Stats",
		description: "Get statistics about the memory index.",
		parameters: MemoryStatsSchema,
		execute: async (_toolCallId, _params: MemoryStatsParams, _signal, _onUpdate) => {
			try {
				const stats = await store.getStats();
				const enhanced = await store.isEnhancedSearchAvailable();

				const lines = [
					`Memory Statistics:`,
					`- Total chunks: ${stats.totalChunks}`,
					`- Total files indexed: ${stats.totalFiles}`,
					`- Vector search: ${stats.vectorSearchEnabled ? "✅ Enabled" : "❌ Disabled"}`,
					`- Enhanced search: ${enhanced ? "✅ Available" : "❌ Not available"}`,
				];

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { ...stats, enhancedSearchAvailable: enhanced },
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

// =============================================================================
// Memory Reindex Tool (New)
// =============================================================================

const MemoryReindexSchema = Type.Object({
	label: Type.String({ description: "Short label shown to user" }),
});
type MemoryReindexParams = Static<typeof MemoryReindexSchema>;

export function createMemoryReindexTool(store: MemoryStore): AgentTool<typeof MemoryReindexSchema> {
	return {
		name: "memory_reindex",
		label: "Memory Reindex",
		description: "Manually trigger reindexing of all memory files.",
		parameters: MemoryReindexSchema,
		execute: async (_toolCallId, _params: MemoryReindexParams, _signal, _onUpdate) => {
			try {
				const result = await store.reindex();

				return {
					content: [
						{
							type: "text",
							text: `Reindexing complete:\n- Files indexed: ${result.filesIndexed}\n- Chunks added: ${result.chunksAdded}`,
						},
					],
					details: result,
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

// =============================================================================
// Channel Memory Tools
// =============================================================================

const ChannelMemorySaveSchema = Type.Object({
	content: Type.String({ description: "Information to save to channel memory" }),
	channelId: Type.String({ description: "Channel ID" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type ChannelMemorySaveParams = Static<typeof ChannelMemorySaveSchema>;

export function createChannelMemorySaveTool(
	workspaceDir: string
): AgentTool<typeof ChannelMemorySaveSchema> {
	return {
		name: "channel_memory_save",
		label: "Channel Memory Save",
		description: "Save information to a specific channel's memory.",
		parameters: ChannelMemorySaveSchema,
		execute: async (_toolCallId, params: ChannelMemorySaveParams, _signal, _onUpdate) => {
			const { content, channelId } = params;
			try {
				const channelDir = join(workspaceDir, "channels", channelId);
				const memoryPath = join(channelDir, "MEMORY.md");

				if (!existsSync(channelDir)) {
					mkdirSync(channelDir, { recursive: true });
				}

				const timestamp = new Date().toISOString().split("T")[0];
				const entry = `\n## ${timestamp}\n${content}\n`;
				appendFileSync(memoryPath, entry, "utf-8");

				return {
					content: [{ type: "text", text: `Saved to channel ${channelId} memory: ${content.substring(0, 100)}...` }],
					details: { saved: true, channelId },
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

// =============================================================================
// Tool Collection
// =============================================================================

/**
 * Get all memory tools
 */
export function getAllMemoryTools(store: MemoryStore, workspaceDir: string): AgentTool<any>[] {
	return [
		createMemorySaveTool(store),
		createMemoryRecallTool(store),
		createMemoryForgetTable(store),
		createMemoryAppendDailyTool(workspaceDir),
		createMemoryStatsTool(store),
		createMemoryReindexTool(store),
		createChannelMemorySaveTool(workspaceDir),
	];
}
