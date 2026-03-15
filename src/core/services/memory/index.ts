/**
 * Memory Service - Enhanced memory storage and retrieval service
 *
 * Provides:
 * - Markdown file persistence (backward compatible)
 * - SQLite indexing for fast search
 * - Hybrid search (FTS5 + vector) when available
 * - Incremental indexing
 */

// Core store
export { MemoryStore, ChannelMemoryStore } from "./store.js";
export type { MemoryStoreConfig, MemoryResult } from "./store.js";

// Tools
export {
	createMemorySaveTool,
	createMemoryRecallTool,
	createMemoryForgetTable,
	createMemoryAppendDailyTool,
	createMemoryStatsTool,
	createMemoryReindexTool,
	createChannelMemorySaveTool,
	getAllMemoryTools,
} from "./tools.js";

// Database
export { openDatabase, initMemoryDatabase, isVectorSearchAvailable } from "./db.js";
export type { Database, Statement } from "./db.js";

// Embedding
export { EmbeddingService, getEmbeddingService, resetEmbeddingService } from "./embedding.js";
export { formatQueryForEmbedding, formatDocForEmbedding, isQwen3EmbeddingModel } from "./embedding.js";
export type { EmbeddingResult, EmbedOptions, EmbeddingConfig } from "./embedding.js";

// Indexing
export { IndexManager, chunkDocument, scanBreakPoints, findBestCutoff, findCodeFences } from "./indexer.js";
export type { MemoryChunk, FileIndexEntry, IndexManagerConfig, BreakPoint, CodeFenceRegion } from "./indexer.js";

// Search
export { SearchService, reciprocalRankFusion } from "./search.js";
export type { MemorySearchResult, SearchOptions, SearchServiceConfig } from "./search.js";
