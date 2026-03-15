/**
 * Memory Store - Enhanced memory storage service with hybrid search
 *
 * Core memory storage functionality with:
 * - Markdown file persistence (backward compatible)
 * - SQLite indexing for fast search
 * - Hybrid search (FTS5 + vector) when available
 * - Incremental indexing
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { openDatabase, initMemoryDatabase, isVectorSearchAvailable } from "./db.js";
import { IndexManager } from "./indexer.js";
import { SearchService, type MemorySearchResult, type SearchOptions } from "./search.js";
import { getEmbeddingService, type EmbeddingService } from "./embedding.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Memory store configuration
 */
export interface MemoryStoreConfig {
	/** Workspace directory path */
	workspaceDir: string;
	/** Enable enhanced search (SQLite + vector) */
	enhancedSearch?: boolean;
	/** Custom embedding service */
	embeddingService?: EmbeddingService;
}

/**
 * Search result from memory
 */
export interface MemoryResult {
	content: string;
	sourcePath: string;
	score: number;
}

// =============================================================================
// Memory Store
// =============================================================================

/**
 * Enhanced memory store with hybrid search support
 *
 * Features:
 * - Backward compatible with simple markdown storage
 * - SQLite indexing for fast full-text search
 * - Vector search when embedding service is available
 * - Automatic incremental indexing
 */
export class MemoryStore {
	private memoryPath: string;
	private workspaceDir: string;
	private dbPath: string;
	private enhancedSearch: boolean;

	private db: ReturnType<typeof openDatabase> | null = null;
	private indexManager: IndexManager | null = null;
	private searchService: SearchService | null = null;
	private embeddingService: EmbeddingService | null = null;

	private initialized = false;

	constructor(workspaceDir: string, config: Partial<MemoryStoreConfig> = {}) {
		this.workspaceDir = workspaceDir;
		this.memoryPath = join(workspaceDir, "memory", "memory.md");
		this.dbPath = join(workspaceDir, "memory", "memory.db");
		this.enhancedSearch = config.enhancedSearch ?? true;
		this.embeddingService = config.embeddingService ?? null;
		this.ensureDir();
	}

	/**
	 * Initialize enhanced search (lazy)
	 */
	private async initEnhancedSearch(): Promise<void> {
		if (this.initialized || !this.enhancedSearch) return;

		try {
			// Open database
			this.db = openDatabase(this.dbPath);
			initMemoryDatabase(this.db);

			// Initialize embedding service
			if (!this.embeddingService) {
				this.embeddingService = getEmbeddingService();
			}

			// Initialize index manager
			this.indexManager = new IndexManager({
				dbPath: this.dbPath,
				workspaceDir: this.workspaceDir,
				embeddingService: this.embeddingService,
			});

			// Initialize search service
			this.searchService = new SearchService({
				db: this.db,
				embeddingService: this.embeddingService,
			});

			// Index existing files if needed
			await this.indexManager.indexAll();

			this.initialized = true;
		} catch (error) {
			console.error("Failed to initialize enhanced search:", error);
			// Fall back to simple mode
			this.enhancedSearch = false;
		}
	}

	/**
	 * Ensure memory directory exists
	 */
	private ensureDir(): void {
		const dir = join(this.memoryPath, "..");
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	// =============================================================================
	// Core Operations (backward compatible)
	// =============================================================================

	/**
	 * Add memory entry
	 */
	append(content: string): void {
		this.ensureDir();
		const timestamp = new Date().toISOString().split("T")[0];
		const entry = `\n## ${timestamp}\n${content}\n`;
		appendFileSync(this.memoryPath, entry, "utf-8");

		// Trigger reindex if enhanced search is enabled
		if (this.enhancedSearch && this.indexManager) {
			this.indexManager.indexFile(this.memoryPath, "global").catch(console.error);
		}
	}

	/**
	 * Read all memory content
	 */
	read(): string {
		if (!existsSync(this.memoryPath)) return "";
		return readFileSync(this.memoryPath, "utf-8");
	}

	/**
	 * Search memory (simple string matching - backward compatible)
	 */
	search(query: string): string[] {
		const content = this.read();
		if (!content) return [];

		const lines = content.split("\n");
		const results: string[] = [];
		let currentSection = "";

		for (const line of lines) {
			if (line.startsWith("## ")) {
				currentSection = line;
			}
			if (line.toLowerCase().includes(query.toLowerCase())) {
				results.push(`${currentSection}\n${line}`);
			}
		}

		return results;
	}

	/**
	 * Delete matching memory entries
	 */
	forget(pattern: string): number {
		const content = this.read();
		if (!content) return 0;

		const lines = content.split("\n");
		const newLines: string[] = [];
		let removed = 0;
		let skipUntilNextSection = false;

		for (const line of lines) {
			if (line.startsWith("## ")) {
				skipUntilNextSection = false;
			}

			if (skipUntilNextSection) {
				removed++;
				continue;
			}

			if (line.toLowerCase().includes(pattern.toLowerCase())) {
				skipUntilNextSection = true;
				removed++;
				continue;
			}

			newLines.push(line);
		}

		writeFileSync(this.memoryPath, newLines.join("\n"), "utf-8");

		// Trigger reindex if enhanced search is enabled
		if (this.enhancedSearch && this.indexManager) {
			this.indexManager.indexFile(this.memoryPath, "global").catch(console.error);
		}

		return removed;
	}

	// =============================================================================
	// Enhanced Search Operations
	// =============================================================================

	/**
	 * Enhanced search with hybrid search support
	 */
	async searchEnhanced(query: string, options: SearchOptions = {}): Promise<MemorySearchResult[]> {
		await this.initEnhancedSearch();

		if (!this.searchService) {
			// Fall back to simple search
			const results = this.search(query);
			return results.slice(0, options.topK ?? 10).map((content, i) => ({
				id: i,
				content,
				sourcePath: this.memoryPath,
				scope: "global" as const,
				score: 1 - i * 0.1,
				searchType: "fts" as const,
			}));
		}

		return this.searchService.searchHybrid(query, options);
	}

	/**
	 * Quick search (FTS only, no async)
	 */
	quickSearch(query: string, topK: number = 5): MemoryResult[] {
		const results = this.search(query);
		return results.slice(0, topK).map((content) => ({
			content,
			sourcePath: this.memoryPath,
			score: 1,
		}));
	}

	/**
	 * Check if enhanced search is available
	 */
	async isEnhancedSearchAvailable(): Promise<boolean> {
		await this.initEnhancedSearch();
		return this.searchService !== null && this.searchService.isVectorAvailable;
	}

	/**
	 * Get search statistics
	 */
	async getStats(): Promise<{ totalChunks: number; totalFiles: number; vectorSearchEnabled: boolean }> {
		await this.initEnhancedSearch();

		if (!this.indexManager) {
			return { totalChunks: 0, totalFiles: 0, vectorSearchEnabled: false };
		}

		return this.indexManager.getStats();
	}

	/**
	 * Manually trigger reindex
	 */
	async reindex(): Promise<{ filesIndexed: number; chunksAdded: number }> {
		await this.initEnhancedSearch();

		if (!this.indexManager) {
			return { filesIndexed: 0, chunksAdded: 0 };
		}

		return this.indexManager.indexAll();
	}

	/**
	 * Close resources
	 */
	close(): void {
		if (this.indexManager) {
			this.indexManager.close();
		}
		if (this.db) {
			this.db.close();
		}
	}
}

// =============================================================================
// Channel Memory Store
// =============================================================================

/**
 * Channel-specific memory store
 */
export class ChannelMemoryStore {
	private channelDir: string;
	private memoryPath: string;

	constructor(channelDir: string) {
		this.channelDir = channelDir;
		this.memoryPath = join(channelDir, "MEMORY.md");
		this.ensureDir();
	}

	private ensureDir(): void {
		if (!existsSync(this.channelDir)) {
			mkdirSync(this.channelDir, { recursive: true });
		}
	}

	append(content: string): void {
		this.ensureDir();
		const timestamp = new Date().toISOString().split("T")[0];
		const entry = `\n## ${timestamp}\n${content}\n`;
		appendFileSync(this.memoryPath, entry, "utf-8");
	}

	read(): string {
		if (!existsSync(this.memoryPath)) return "";
		return readFileSync(this.memoryPath, "utf-8");
	}

	search(query: string): string[] {
		const content = this.read();
		if (!content) return [];

		const lines = content.split("\n");
		const results: string[] = [];
		let currentSection = "";

		for (const line of lines) {
			if (line.startsWith("## ")) {
				currentSection = line;
			}
			if (line.toLowerCase().includes(query.toLowerCase())) {
				results.push(`${currentSection}\n${line}`);
			}
		}

		return results;
	}

	forget(pattern: string): number {
		const content = this.read();
		if (!content) return 0;

		const lines = content.split("\n");
		const newLines: string[] = [];
		let removed = 0;
		let skipUntilNextSection = false;

		for (const line of lines) {
			if (line.startsWith("## ")) {
				skipUntilNextSection = false;
			}

			if (skipUntilNextSection) {
				removed++;
				continue;
			}

			if (line.toLowerCase().includes(pattern.toLowerCase())) {
				skipUntilNextSection = true;
				removed++;
				continue;
			}

			newLines.push(line);
		}

		writeFileSync(this.memoryPath, newLines.join("\n"), "utf-8");
		return removed;
	}
}
