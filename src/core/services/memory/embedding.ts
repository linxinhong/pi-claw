/**
 * embedding.ts - Embedding service for pi-claw memory system
 *
 * Provides embeddings using local GGUF models via node-llama-cpp.
 * Simplified from qmd's LlamaCpp implementation for memory search use case.
 */

import {
	getLlama,
	resolveModelFile,
	LlamaLogLevel,
	type Llama,
	type LlamaModel,
	type LlamaEmbeddingContext,
} from "node-llama-cpp";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// =============================================================================
// Types
// =============================================================================

/**
 * Embedding result
 */
export type EmbeddingResult = {
	embedding: number[];
	model: string;
};

/**
 * Options for embedding
 */
export type EmbedOptions = {
	/** Whether this is a query (vs document) */
	isQuery?: boolean;
	/** Title for document embedding */
	title?: string;
};

/**
 * Configuration for embedding service
 */
export type EmbeddingConfig = {
	/** Model URI (e.g., hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf) */
	model?: string;
	/** Model cache directory */
	cacheDir?: string;
	/** Inactivity timeout in ms before unloading (default: 5 minutes, 0 to disable) */
	inactivityTimeoutMs?: number;
};

// =============================================================================
// Model Configuration
// =============================================================================

// Default: embeddinggemma-300M (256 dimensions, good balance of speed and quality)
const DEFAULT_EMBED_MODEL =
	process.env.PICLAW_EMBED_MODEL ??
	"hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";

// Default cache directory
const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "pi-claw", "models");

// Default inactivity timeout: 5 minutes
const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

// =============================================================================
// Embedding Formatting Functions
// =============================================================================

/**
 * Detect if a model URI uses the Qwen3-Embedding format.
 * Qwen3-Embedding uses a different prompting style than nomic/embeddinggemma.
 */
export function isQwen3EmbeddingModel(modelUri: string): boolean {
	return /qwen.*embed/i.test(modelUri) || /embed.*qwen/i.test(modelUri);
}

/**
 * Format a query for embedding.
 * Uses nomic-style task prefix format for embeddinggemma (default).
 * Uses Qwen3-Embedding instruct format when a Qwen embedding model is active.
 */
export function formatQueryForEmbedding(query: string, modelUri?: string): string {
	const uri = modelUri ?? DEFAULT_EMBED_MODEL;
	if (isQwen3EmbeddingModel(uri)) {
		return `Instruct: Retrieve relevant documents for the given query\nQuery: ${query}`;
	}
	return `task: search result | query: ${query}`;
}

/**
 * Format a document for embedding.
 * Uses nomic-style format with title and text fields (default).
 * Qwen3-Embedding encodes documents as raw text without special prefixes.
 */
export function formatDocForEmbedding(text: string, title?: string, modelUri?: string): string {
	const uri = modelUri ?? DEFAULT_EMBED_MODEL;
	if (isQwen3EmbeddingModel(uri)) {
		// Qwen3-Embedding: documents are raw text, no task prefix
		return title ? `${title}\n${text}` : text;
	}
	return `title: ${title || "none"} | text: ${text}`;
}

// =============================================================================
// Embedding Service
// =============================================================================

/**
 * Embedding service using node-llama-cpp
 *
 * Features:
 * - Lazy loading of models
 * - Automatic model caching
 * - Inactivity timeout for resource cleanup
 * - Batch embedding support
 */
export class EmbeddingService {
	private llama: Llama | null = null;
	private model: LlamaModel | null = null;
	private context: LlamaEmbeddingContext | null = null;

	private modelUri: string;
	private cacheDir: string;
	private inactivityTimeoutMs: number;

	private modelLoadPromise: Promise<LlamaModel> | null = null;
	private contextCreatePromise: Promise<LlamaEmbeddingContext> | null = null;
	private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	// Embedding dimension (depends on model)
	private _dimension: number | null = null;

	constructor(config: EmbeddingConfig = {}) {
		this.modelUri = config.model ?? DEFAULT_EMBED_MODEL;
		this.cacheDir = config.cacheDir ?? DEFAULT_CACHE_DIR;
		this.inactivityTimeoutMs = config.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
	}

	/**
	 * Get the embedding dimension for the current model
	 */
	get dimension(): number | null {
		return this._dimension;
	}

	/**
	 * Check if the service is available (model loaded successfully)
	 */
	get isAvailable(): boolean {
		return this.context !== null && !this.disposed;
	}

	/**
	 * Reset the inactivity timer
	 */
	private touchActivity(): void {
		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
			this.inactivityTimer = null;
		}

		if (this.inactivityTimeoutMs > 0 && this.context) {
			this.inactivityTimer = setTimeout(() => {
				this.unloadIdleResources().catch(console.error);
			}, this.inactivityTimeoutMs);
			this.inactivityTimer.unref();
		}
	}

	/**
	 * Unload idle resources
	 */
	private async unloadIdleResources(): Promise<void> {
		if (this.disposed) return;

		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
			this.inactivityTimer = null;
		}

		if (this.context) {
			await this.context.dispose();
			this.context = null;
		}
	}

	/**
	 * Ensure model cache directory exists
	 */
	private ensureCacheDir(): void {
		if (!existsSync(this.cacheDir)) {
			mkdirSync(this.cacheDir, { recursive: true });
		}
	}

	/**
	 * Initialize the llama instance (lazy)
	 */
	private async ensureLlama(): Promise<Llama> {
		if (!this.llama) {
			this.llama = await getLlama({
				build: "autoAttempt",
				logLevel: LlamaLogLevel.error,
			});
		}
		return this.llama;
	}

	/**
	 * Load the embedding model (lazy)
	 */
	private async ensureModel(): Promise<LlamaModel> {
		if (this.model) return this.model;
		if (this.modelLoadPromise) return this.modelLoadPromise;

		this.modelLoadPromise = (async () => {
			const llama = await this.ensureLlama();
			this.ensureCacheDir();
			const modelPath = await resolveModelFile(this.modelUri, this.cacheDir);
			const model = await llama.loadModel({ modelPath });
			this.model = model;
			this._dimension = model.trainContextSize > 0 ? 256 : null; // embeddinggemma has 256 dims
			this.touchActivity();
			return model;
		})();

		try {
			return await this.modelLoadPromise;
		} finally {
			this.modelLoadPromise = null;
		}
	}

	/**
	 * Load embedding context (lazy)
	 */
	private async ensureContext(): Promise<LlamaEmbeddingContext> {
		if (this.context) {
			this.touchActivity();
			return this.context;
		}
		if (this.contextCreatePromise) return this.contextCreatePromise;

		this.contextCreatePromise = (async () => {
			const model = await this.ensureModel();
			const context = await model.createEmbeddingContext({});
			this.context = context;
			this.touchActivity();
			return context;
		})();

		try {
			return await this.contextCreatePromise;
		} finally {
			this.contextCreatePromise = null;
		}
	}

	/**
	 * Get embedding for a single text
	 */
	async embed(text: string, options: EmbedOptions = {}): Promise<EmbeddingResult | null> {
		if (this.disposed) {
			throw new Error("EmbeddingService has been disposed");
		}

		this.touchActivity();

		try {
			const context = await this.ensureContext();

			// Format text based on type
			const formattedText = options.isQuery
				? formatQueryForEmbedding(text, this.modelUri)
				: formatDocForEmbedding(text, options.title, this.modelUri);

			const embedding = await context.getEmbeddingFor(formattedText);

			return {
				embedding: Array.from(embedding.vector),
				model: this.modelUri,
			};
		} catch (error) {
			console.error("Embedding error:", error);
			return null;
		}
	}

	/**
	 * Get embeddings for multiple texts (batch)
	 */
	async embedBatch(texts: string[], options: EmbedOptions = {}): Promise<(EmbeddingResult | null)[]> {
		if (this.disposed) {
			throw new Error("EmbeddingService has been disposed");
		}

		this.touchActivity();

		if (texts.length === 0) return [];

		try {
			const context = await this.ensureContext();

			// Format all texts
			const formattedTexts = texts.map((text) =>
				options.isQuery
					? formatQueryForEmbedding(text, this.modelUri)
					: formatDocForEmbedding(text, options.title, this.modelUri)
			);

			// Embed sequentially (node-llama-cpp handles batching internally)
			const results: (EmbeddingResult | null)[] = [];
			for (const text of formattedTexts) {
				try {
					const embedding = await context.getEmbeddingFor(text);
					results.push({
						embedding: Array.from(embedding.vector),
						model: this.modelUri,
					});
				} catch {
					results.push(null);
				}
			}

			return results;
		} catch (error) {
			console.error("Batch embedding error:", error);
			return texts.map(() => null);
		}
	}

	/**
	 * Count tokens in text using the embedding model's tokenizer
	 */
	async countTokens(text: string): Promise<number> {
		await this.ensureContext();
		if (!this.model) {
			throw new Error("Model not loaded");
		}
		const tokens = this.model.tokenize(text);
		return tokens.length;
	}

	/**
	 * Dispose of resources
	 */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
			this.inactivityTimer = null;
		}

		if (this.context) {
			await this.context.dispose();
			this.context = null;
		}

		if (this.model) {
			await this.model.dispose();
			this.model = null;
		}

		// Note: We keep llama instance - it's lightweight
	}
}

// =============================================================================
// Singleton Instance
// =============================================================================

let _instance: EmbeddingService | null = null;

/**
 * Get the global embedding service instance
 */
export function getEmbeddingService(config?: EmbeddingConfig): EmbeddingService {
	if (!_instance) {
		_instance = new EmbeddingService(config);
	}
	return _instance;
}

/**
 * Reset the global embedding service (for testing)
 */
export function resetEmbeddingService(): void {
	if (_instance) {
		_instance.dispose().catch(console.error);
		_instance = null;
	}
}
