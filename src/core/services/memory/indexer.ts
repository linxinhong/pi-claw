/**
 * indexer.ts - Memory indexing system for pi-claw
 *
 * Provides smart chunking and indexing for memory files.
 * Extracted from qmd's chunking implementation.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, statSync, readdirSync } from "fs";
import { join } from "path";
import type { Database, Statement } from "./db.js";
import { openDatabase, initMemoryDatabase, isVectorSearchAvailable } from "./db.js";
import type { EmbeddingService } from "./embedding.js";
import { getEmbeddingService } from "./embedding.js";

// =============================================================================
// Chunking Configuration
// =============================================================================

// 900 tokens per chunk with 15% overlap
export const CHUNK_SIZE_TOKENS = 900;
export const CHUNK_OVERLAP_TOKENS = Math.floor(CHUNK_SIZE_TOKENS * 0.15); // 135 tokens
// Char-based approximation (~4 chars per token)
export const CHUNK_SIZE_CHARS = CHUNK_SIZE_TOKENS * 4; // 3600 chars
export const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * 4; // 540 chars
// Search window for finding break points (~200 tokens)
export const CHUNK_WINDOW_TOKENS = 200;
export const CHUNK_WINDOW_CHARS = CHUNK_WINDOW_TOKENS * 4; // 800 chars

// =============================================================================
// Break Point Detection
// =============================================================================

/**
 * A potential break point in the document with a base score indicating quality.
 */
export interface BreakPoint {
	pos: number; // character position
	score: number; // base score (higher = better break point)
	type: string; // for debugging: 'h1', 'h2', 'blank', etc.
}

/**
 * A region where a code fence exists (between ``` markers).
 */
export interface CodeFenceRegion {
	start: number; // position of opening ```
	end: number; // position of closing ``` (or document end if unclosed)
}

/**
 * Patterns for detecting break points in markdown documents.
 * Higher scores indicate better places to split.
 */
export const BREAK_PATTERNS: [RegExp, number, string][] = [
	[/\n#{1}(?!#)/g, 100, "h1"], // # but not ##
	[/\n#{2}(?!#)/g, 90, "h2"], // ## but not ###
	[/\n#{3}(?!#)/g, 80, "h3"], // ### but not ####
	[/\n#{4}(?!#)/g, 70, "h4"], // #### but not #####
	[/\n#{5}(?!#)/g, 60, "h5"], // ##### but not ######
	[/\n#{6}(?!#)/g, 50, "h6"], // ######
	[/\n```/g, 80, "codeblock"], // code block boundary (same as h3)
	[/\n(?:---|\*\*\*|___)\s*\n/g, 60, "hr"], // horizontal rule
	[/\n\n+/g, 20, "blank"], // paragraph boundary
	[/\n[-*]\s/g, 5, "list"], // unordered list item
	[/\n\d+\.\s/g, 5, "numlist"], // ordered list item
	[/\n/g, 1, "newline"], // minimal break
];

/**
 * Scan text for all potential break points.
 */
export function scanBreakPoints(text: string): BreakPoint[] {
	const points: BreakPoint[] = [];
	const seen = new Map<number, BreakPoint>(); // pos -> best break point at that pos

	for (const [pattern, score, type] of BREAK_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const pos = match.index!;
			const existing = seen.get(pos);
			// Keep higher score if position already seen
			if (!existing || score > existing.score) {
				const bp = { pos, score, type };
				seen.set(pos, bp);
			}
		}
	}

	// Convert to array and sort by position
	for (const bp of seen.values()) {
		points.push(bp);
	}
	return points.sort((a, b) => a.pos - b.pos);
}

/**
 * Find all code fence regions in the text.
 */
export function findCodeFences(text: string): CodeFenceRegion[] {
	const regions: CodeFenceRegion[] = [];
	const fencePattern = /\n```/g;
	let inFence = false;
	let fenceStart = 0;

	for (const match of text.matchAll(fencePattern)) {
		if (!inFence) {
			fenceStart = match.index!;
			inFence = true;
		} else {
			regions.push({ start: fenceStart, end: match.index! + match[0].length });
			inFence = false;
		}
	}

	// Handle unclosed fence - extends to end of document
	if (inFence) {
		regions.push({ start: fenceStart, end: text.length });
	}

	return regions;
}

/**
 * Check if a position is inside a code fence region.
 */
export function isInsideCodeFence(pos: number, fences: CodeFenceRegion[]): boolean {
	return fences.some((f) => pos > f.start && pos < f.end);
}

/**
 * Find the best cut position using scored break points with distance decay.
 */
export function findBestCutoff(
	breakPoints: BreakPoint[],
	targetCharPos: number,
	windowChars: number = CHUNK_WINDOW_CHARS,
	decayFactor: number = 0.7,
	codeFences: CodeFenceRegion[] = []
): number {
	const windowStart = targetCharPos - windowChars;
	let bestScore = -1;
	let bestPos = targetCharPos;

	for (const bp of breakPoints) {
		if (bp.pos < windowStart) continue;
		if (bp.pos > targetCharPos) break; // sorted, so we can stop

		// Skip break points inside code fences
		if (isInsideCodeFence(bp.pos, codeFences)) continue;

		const distance = targetCharPos - bp.pos;
		// Squared distance decay
		const normalizedDist = distance / windowChars;
		const multiplier = 1.0 - normalizedDist * normalizedDist * decayFactor;
		const finalScore = bp.score * multiplier;

		if (finalScore > bestScore) {
			bestScore = finalScore;
			bestPos = bp.pos;
		}
	}

	return bestPos;
}

/**
 * Chunk a document into smaller pieces for embedding.
 */
export function chunkDocument(
	content: string,
	maxChars: number = CHUNK_SIZE_CHARS,
	overlapChars: number = CHUNK_OVERLAP_CHARS,
	windowChars: number = CHUNK_WINDOW_CHARS
): { text: string; pos: number }[] {
	if (content.length <= maxChars) {
		return [{ text: content, pos: 0 }];
	}

	// Pre-scan all break points and code fences once
	const breakPoints = scanBreakPoints(content);
	const codeFences = findCodeFences(content);

	const chunks: { text: string; pos: number }[] = [];
	let charPos = 0;

	while (charPos < content.length) {
		// Calculate target end position for this chunk
		const targetEndPos = Math.min(charPos + maxChars, content.length);

		let endPos = targetEndPos;

		// If not at the end, find the best break point
		if (endPos < content.length) {
			const bestCutoff = findBestCutoff(breakPoints, targetEndPos, windowChars, 0.7, codeFences);

			// Only use the cutoff if it's within our current chunk
			if (bestCutoff > charPos && bestCutoff <= targetEndPos) {
				endPos = bestCutoff;
			}
		}

		// Ensure we make progress
		if (endPos <= charPos) {
			endPos = Math.min(charPos + maxChars, content.length);
		}

		chunks.push({ text: content.slice(charPos, endPos), pos: charPos });

		// Move forward, but overlap with previous chunk
		if (endPos >= content.length) {
			break;
		}
		charPos = endPos - overlapChars;
		const lastChunkPos = chunks.at(-1)!.pos;
		if (charPos <= lastChunkPos) {
			// Prevent infinite loop - move forward at least a bit
			charPos = endPos;
		}
	}

	return chunks;
}

// =============================================================================
// Index Types
// =============================================================================

/**
 * Memory chunk with metadata
 */
export interface MemoryChunk {
	id: number;
	chunkHash: string;
	content: string;
	sourcePath: string;
	scope: "global" | "channel";
	channelId?: string;
	sectionTitle?: string;
	dateTag?: string;
	tokenCount: number;
	createdAt: number;
	updatedAt: number;
}

/**
 * File index entry
 */
export interface FileIndexEntry {
	path: string;
	lastModified: number;
	fileHash: string;
	indexedAt: number;
}

/**
 * Index manager configuration
 */
export interface IndexManagerConfig {
	/** Path to the SQLite database */
	dbPath: string;
	/** Workspace directory (for memory files) */
	workspaceDir: string;
	/** Embedding service (optional, will use global if not provided) */
	embeddingService?: EmbeddingService;
}

// =============================================================================
// Index Manager
// =============================================================================

/**
 * Manages indexing of memory files into SQLite.
 *
 * Features:
 * - Smart chunking of markdown files
 * - Incremental indexing (based on mtime and hash)
 * - Deduplication via SHA-256 hash
 * - Vector embeddings (when available)
 */
export class IndexManager {
	private db: Database;
	private workspaceDir: string;
	private embeddingService: EmbeddingService;

	// Prepared statements
	private insertChunk!: Statement;
	private insertVector!: Statement;
	private insertFts!: Statement;
	private updateFileIndex!: Statement;
	private getFileIndex!: Statement;
	private deleteChunksByPath!: Statement;
	private deleteVectorsByChunk!: Statement;
	private deleteFtsByChunk!: Statement;
	private getChunkByHash!: Statement;

	constructor(config: IndexManagerConfig) {
		this.db = openDatabase(config.dbPath);
		initMemoryDatabase(this.db);
		this.workspaceDir = config.workspaceDir;
		this.embeddingService = config.embeddingService ?? getEmbeddingService();
		this.initStatements();
	}

	private initStatements(): void {
		this.insertChunk = this.db.prepare(`
      INSERT INTO memory_chunks (chunk_hash, content, source_path, scope, channel_id, section_title, date_tag, token_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		if (isVectorSearchAvailable()) {
			this.insertVector = this.db.prepare(`
        INSERT INTO memory_vectors (chunk_id, embedding)
        VALUES (?, ?)
      `);
		}

		this.insertFts = this.db.prepare(`
      INSERT INTO memory_fts (chunk_id, content, section_title)
      VALUES (?, ?, ?)
    `);

		this.updateFileIndex = this.db.prepare(`
      INSERT OR REPLACE INTO file_index (path, last_modified, file_hash, indexed_at)
      VALUES (?, ?, ?, ?)
    `);

		this.getFileIndex = this.db.prepare(`
      SELECT * FROM file_index WHERE path = ?
    `);

		this.deleteChunksByPath = this.db.prepare(`
      DELETE FROM memory_chunks WHERE source_path = ?
    `);

		this.deleteVectorsByChunk = this.db.prepare(`
      DELETE FROM memory_vectors WHERE chunk_id = ?
    `);

		this.deleteFtsByChunk = this.db.prepare(`
      DELETE FROM memory_fts WHERE chunk_id = ?
    `);

		this.getChunkByHash = this.db.prepare(`
      SELECT id FROM memory_chunks WHERE chunk_hash = ?
    `);
	}

	/**
	 * Compute SHA-256 hash of content
	 */
	private hashContent(content: string): string {
		return createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Extract section title from chunk content (first ## heading)
	 */
	private extractSectionTitle(content: string): string | undefined {
		const match = content.match(/^##\s+(.+)$/m);
		return match ? match[1].trim() : undefined;
	}

	/**
	 * Extract date tag from chunk content (YYYY-MM-DD format)
	 */
	private extractDateTag(content: string): string | undefined {
		const match = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
		return match ? match[1] : undefined;
	}

	/**
	 * Estimate token count (char count / 4)
	 */
	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	/**
	 * Check if a file needs reindexing
	 */
	needsReindex(path: string, content: string): boolean {
		const existing = this.getFileIndex.get(path) as FileIndexEntry | undefined;
		if (!existing) return true;

		const stats = statSync(path);
		if (stats.mtimeMs > existing.lastModified) {
			const newHash = this.hashContent(content);
			return newHash !== existing.fileHash;
		}

		return false;
	}

	/**
	 * Index a memory file
	 */
	async indexFile(
		path: string,
		scope: "global" | "channel",
		channelId?: string
	): Promise<{ chunksAdded: number; chunksSkipped: number }> {
		if (!existsSync(path)) {
			return { chunksAdded: 0, chunksSkipped: 0 };
		}

		const content = readFileSync(path, "utf-8");
		if (!this.needsReindex(path, content)) {
			return { chunksAdded: 0, chunksSkipped: 0 };
		}

		// Delete existing chunks for this file
		this.deleteChunksByPath.run(path);

		// Chunk the document
		const rawChunks = chunkDocument(content);
		let chunksAdded = 0;
		let chunksSkipped = 0;

		const now = Date.now();
		const fileHash = this.hashContent(content);
		const stats = statSync(path);

		for (const chunk of rawChunks) {
			const chunkHash = this.hashContent(chunk.text);

			// Check for duplicate chunks
			const existing = this.getChunkByHash.get(chunkHash) as { id: number } | undefined;
			if (existing) {
				chunksSkipped++;
				continue;
			}

			const sectionTitle = this.extractSectionTitle(chunk.text);
			const dateTag = this.extractDateTag(chunk.text);
			const tokenCount = this.estimateTokens(chunk.text);

			// Insert chunk
			const result = this.insertChunk.run(
				chunkHash,
				chunk.text,
				path,
				scope,
				channelId ?? null,
				sectionTitle ?? null,
				dateTag ?? null,
				tokenCount,
				now,
				now
			);

			const chunkId = Number(result.lastInsertRowid);

			// Insert into FTS
			this.insertFts.run(chunkId, chunk.text, sectionTitle ?? "");

			// Insert embedding if vector search is available
			if (isVectorSearchAvailable() && this.embeddingService.isAvailable) {
				try {
					const embedding = await this.embeddingService.embed(chunk.text, { title: sectionTitle });
					if (embedding) {
						// Serialize embedding as JSON array
						const embeddingJson = JSON.stringify(embedding.embedding);
						this.insertVector.run(chunkId, embeddingJson);
					}
				} catch (error) {
					console.error(`Failed to embed chunk ${chunkId}:`, error);
				}
			}

			chunksAdded++;
		}

		// Update file index
		this.updateFileIndex.run(path, stats.mtimeMs, fileHash, now);

		return { chunksAdded, chunksSkipped };
	}

	/**
	 * Index all memory files in workspace
	 */
	async indexAll(): Promise<{ filesIndexed: number; chunksAdded: number }> {
		let filesIndexed = 0;
		let chunksAdded = 0;

		// Index global memory
		const globalMemoryPath = join(this.workspaceDir, "memory", "memory.md");
		if (existsSync(globalMemoryPath)) {
			const result = await this.indexFile(globalMemoryPath, "global");
			if (result.chunksAdded > 0) {
				filesIndexed++;
				chunksAdded += result.chunksAdded;
			}
		}

		// Index daily memory files
		const memoryDir = join(this.workspaceDir, "memory");
		if (existsSync(memoryDir)) {
			const files = readdirSync(memoryDir);
			for (const file of files) {
				if (/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) {
					const result = await this.indexFile(join(memoryDir, file), "global");
					if (result.chunksAdded > 0) {
						filesIndexed++;
						chunksAdded += result.chunksAdded;
					}
				}
			}
		}

		// Index channel memories
		const channelsDir = join(this.workspaceDir, "channels");
		if (existsSync(channelsDir)) {
			const channels = readdirSync(channelsDir, { withFileTypes: true });
			for (const channel of channels) {
				if (channel.isDirectory()) {
					const channelMemory = join(channelsDir, channel.name, "MEMORY.md");
					if (existsSync(channelMemory)) {
						const result = await this.indexFile(channelMemory, "channel", channel.name);
						if (result.chunksAdded > 0) {
							filesIndexed++;
							chunksAdded += result.chunksAdded;
						}
					}
				}
			}
		}

		return { filesIndexed, chunksAdded };
	}

	/**
	 * Get indexing statistics
	 */
	getStats(): { totalChunks: number; totalFiles: number; vectorSearchEnabled: boolean } {
		const chunkResult = this.db.prepare("SELECT COUNT(*) as count FROM memory_chunks").get() as { count: number };
		const fileResult = this.db.prepare("SELECT COUNT(*) as count FROM file_index").get() as { count: number };

		return {
			totalChunks: chunkResult.count,
			totalFiles: fileResult.count,
			vectorSearchEnabled: isVectorSearchAvailable(),
		};
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		this.db.close();
	}
}
