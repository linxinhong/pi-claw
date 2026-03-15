/**
 * search.ts - Hybrid search service for pi-claw memory system
 *
 * Provides FTS5 full-text search, vector search, and RRF fusion.
 */

import type { Database } from "./db.js";
import { isVectorSearchAvailable } from "./db.js";
import type { EmbeddingService } from "./embedding.js";
import { getEmbeddingService, formatQueryForEmbedding } from "./embedding.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Search result from memory
 */
export interface MemorySearchResult {
	id: number;
	content: string;
	sourcePath: string;
	scope: "global" | "channel";
	channelId?: string;
	sectionTitle?: string;
	dateTag?: string;
	score: number;
	searchType: "fts" | "vector" | "hybrid";
}

/**
 * Internal ranked result for RRF fusion
 */
interface RankedResult {
	id: number;
	content: string;
	sourcePath: string;
	scope: string;
	channelId?: string;
	sectionTitle?: string;
	dateTag?: string;
	score: number;
}

/**
 * Search options
 */
export interface SearchOptions {
	/** Search type: hybrid (default), fts, or vector */
	searchType?: "hybrid" | "fts" | "vector";
	/** Maximum number of results */
	topK?: number;
	/** Filter by scope */
	scope?: "global" | "channel";
	/** Filter by channel ID */
	channelId?: string;
	/** Minimum score threshold */
	minScore?: number;
}

/**
 * Search service configuration
 */
export interface SearchServiceConfig {
	/** Database instance */
	db: Database;
	/** Embedding service (optional) */
	embeddingService?: EmbeddingService;
}

// =============================================================================
// Reciprocal Rank Fusion
// =============================================================================

/**
 * Reciprocal Rank Fusion algorithm
 *
 * Combines multiple ranked lists into a single ranked list.
 * Uses position-based scoring with top-rank bonus.
 *
 * @param resultLists - Array of ranked result lists
 * @param weights - Weight for each list (default: all 1.0)
 * @param k - RRF constant (default: 60)
 */
export function reciprocalRankFusion<T extends { id: number }>(
	resultLists: T[][],
	weights: number[] = [],
	k: number = 60
): T[] {
	const scores = new Map<number, { result: T; rrfScore: number; topRank: number }>();

	for (let listIdx = 0; listIdx < resultLists.length; listIdx++) {
		const list = resultLists[listIdx];
		if (!list) continue;
		const weight = weights[listIdx] ?? 1.0;

		for (let rank = 0; rank < list.length; rank++) {
			const result = list[rank];
			if (!result) continue;
			const rrfContribution = weight / (k + rank + 1);
			const existing = scores.get(result.id);

			if (existing) {
				existing.rrfScore += rrfContribution;
				existing.topRank = Math.min(existing.topRank, rank);
			} else {
				scores.set(result.id, {
					result,
					rrfScore: rrfContribution,
					topRank: rank,
				});
			}
		}
	}

	// Top-rank bonus
	for (const entry of scores.values()) {
		if (entry.topRank === 0) {
			entry.rrfScore += 0.05;
		} else if (entry.topRank <= 2) {
			entry.rrfScore += 0.02;
		}
	}

	return Array.from(scores.values())
		.sort((a, b) => b.rrfScore - a.rrfScore)
		.map((e) => ({ ...e.result, score: e.rrfScore }));
}

// =============================================================================
// Search Service
// =============================================================================

/**
 * Hybrid search service for memory
 *
 * Features:
 * - FTS5 full-text search with BM25 ranking
 * - Vector search with cosine similarity (when available)
 * - RRF fusion for hybrid search
 * - Scope and channel filtering
 */
export class SearchService {
	private db: Database;
	private embeddingService: EmbeddingService;
	private vectorAvailable: boolean;

	constructor(config: SearchServiceConfig) {
		this.db = config.db;
		this.embeddingService = config.embeddingService ?? getEmbeddingService();
		this.vectorAvailable = isVectorSearchAvailable();
	}

	/**
	 * Full-text search using FTS5
	 */
	searchFts(query: string, options: SearchOptions = {}): RankedResult[] {
		const topK = options.topK ?? 10;
		const scope = options.scope;
		const channelId = options.channelId;

		// Build filter conditions
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (scope) {
			conditions.push("c.scope = ?");
			params.push(scope);
		}

		if (channelId) {
			conditions.push("c.channel_id = ?");
			params.push(channelId);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		// FTS5 search with BM25 ranking
		const sql = `
      SELECT
        c.id,
        c.content,
        c.source_path as sourcePath,
        c.scope,
        c.channel_id as channelId,
        c.section_title as sectionTitle,
        c.date_tag as dateTag,
        bm25(memory_fts) as score
      FROM memory_fts f
      JOIN memory_chunks c ON f.chunk_id = c.id
      ${whereClause}
      WHERE memory_fts MATCH ?
      ORDER BY score ASC
      LIMIT ?
    `;

		// Escape special FTS5 characters
		const escapedQuery = query.replace(/['"]/g, "").replace(/[^\w\s\u4e00-\u9fff-]/g, " ");

		try {
			const stmt = this.db.prepare(sql);
			const results = stmt.all(...params, escapedQuery, topK) as any[];

			// BM25 returns negative scores, negate for consistency
			return results.map((r) => ({
				id: r.id,
				content: r.content,
				sourcePath: r.sourcePath,
				scope: r.scope,
				channelId: r.channelId,
				sectionTitle: r.sectionTitle,
				dateTag: r.dateTag,
				score: -r.score, // Negate BM25 score (lower is better for BM25)
			}));
		} catch (error) {
			// FTS5 query syntax error - return empty
			console.error("FTS5 search error:", error);
			return [];
		}
	}

	/**
	 * Vector search using sqlite-vec
	 */
	async searchVector(query: string, options: SearchOptions = {}): Promise<RankedResult[]> {
		if (!this.vectorAvailable || !this.embeddingService.isAvailable) {
			return [];
		}

		const topK = options.topK ?? 10;
		const scope = options.scope;
		const channelId = options.channelId;

		// Get query embedding
		const formattedQuery = formatQueryForEmbedding(query);
		const embedding = await this.embeddingService.embed(formattedQuery, { isQuery: true });

		if (!embedding) {
			return [];
		}

		// Serialize embedding as JSON array
		const embeddingJson = JSON.stringify(embedding.embedding);

		// Build filter conditions
		const conditions: string[] = [];
		const params: (string | number | string)[] = [embeddingJson];

		if (scope) {
			conditions.push("c.scope = ?");
			params.push(scope);
		}

		if (channelId) {
			conditions.push("c.channel_id = ?");
			params.push(channelId);
		}

		const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

		// Vector search with cosine similarity
		const sql = `
      SELECT
        c.id,
        c.content,
        c.source_path as sourcePath,
        c.scope,
        c.channel_id as channelId,
        c.section_title as sectionTitle,
        c.date_tag as dateTag,
        v.distance as score
      FROM memory_vectors v
      JOIN memory_chunks c ON v.chunk_id = c.id
      WHERE v.embedding MATCH ? ${whereClause}
      ORDER BY v.distance ASC
      LIMIT ?
    `;

		try {
			const stmt = this.db.prepare(sql);
			const results = stmt.all(...params, topK) as any[];

			// Cosine distance: 0 = identical, 2 = opposite
			// Convert to similarity score: 1 - distance/2
			return results.map((r) => ({
				id: r.id,
				content: r.content,
				sourcePath: r.sourcePath,
				scope: r.scope,
				channelId: r.channelId,
				sectionTitle: r.sectionTitle,
				dateTag: r.dateTag,
				score: 1 - r.score / 2, // Convert distance to similarity
			}));
		} catch (error) {
			console.error("Vector search error:", error);
			return [];
		}
	}

	/**
	 * Hybrid search combining FTS and vector search
	 */
	async searchHybrid(query: string, options: SearchOptions = {}): Promise<MemorySearchResult[]> {
		const searchType = options.searchType ?? "hybrid";
		const topK = options.topK ?? 10;
		const minScore = options.minScore ?? 0;

		let results: RankedResult[];

		if (searchType === "fts") {
			results = this.searchFts(query, options);
		} else if (searchType === "vector") {
			results = await this.searchVector(query, options);
		} else {
			// Hybrid: combine FTS and vector search with RRF
			const ftsResults = this.searchFts(query, { ...options, topK: topK * 2 });
			const vectorResults = await this.searchVector(query, { ...options, topK: topK * 2 });

			// Apply RRF fusion with equal weights
			results = reciprocalRankFusion([ftsResults, vectorResults], [1.0, 1.0]);
		}

		// Filter by minimum score and limit
		return results
			.filter((r) => r.score >= minScore)
			.slice(0, topK)
			.map((r) => ({
				id: r.id,
				content: r.content,
				sourcePath: r.sourcePath,
				scope: r.scope as "global" | "channel",
				channelId: r.channelId,
				sectionTitle: r.sectionTitle,
				dateTag: r.dateTag,
				score: r.score,
				searchType,
			}));
	}

	/**
	 * Quick search (FTS only, no vector)
	 */
	quickSearch(query: string, topK: number = 5): MemorySearchResult[] {
		const results = this.searchFts(query, { topK });
		return results.map((r) => ({
			id: r.id,
			content: r.content,
			sourcePath: r.sourcePath,
			scope: r.scope as "global" | "channel",
			channelId: r.channelId,
			sectionTitle: r.sectionTitle,
			dateTag: r.dateTag,
			score: r.score,
			searchType: "fts" as const,
		}));
	}

	/**
	 * Check if vector search is available
	 */
	get isVectorAvailable(): boolean {
		return this.vectorAvailable && this.embeddingService.isAvailable;
	}
}
