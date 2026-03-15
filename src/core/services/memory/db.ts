/**
 * db.ts - Cross-runtime SQLite compatibility layer for pi-claw
 *
 * Provides a unified Database export that works with better-sqlite3.
 * Includes sqlite-vec extension loading for vector search.
 *
 * On macOS with Bun, Apple's system SQLite is compiled with SQLITE_OMIT_LOAD_EXTENSION,
 * which prevents loading native extensions like sqlite-vec. When running under Bun
 * we call Database.setCustomSQLite() to swap in Homebrew's full-featured SQLite build.
 */

export const isBun = typeof (globalThis as any).Bun !== "undefined";

let _Database: any;
let _sqliteVecLoad: ((db: any) => void) | null;

if (isBun) {
	// Dynamic string prevents tsc from resolving bun:sqlite on Node.js builds
	const bunSqlite = "bun:" + "sqlite";
	const BunDatabase = (await import(/* @vite-ignore */ bunSqlite)).Database;

	// See: https://bun.com/docs/runtime/sqlite#setcustomsqlite
	if (process.platform === "darwin") {
		const homebrewPaths = [
			"/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon
			"/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel
		];
		for (const p of homebrewPaths) {
			try {
				BunDatabase.setCustomSQLite(p);
				break;
			} catch {}
		}
	}

	_Database = BunDatabase;

	// setCustomSQLite may have silently failed — test that extensions actually work.
	try {
		const { getLoadablePath } = await import("sqlite-vec");
		const vecPath = getLoadablePath();
		const testDb = new BunDatabase(":memory:");
		testDb.loadExtension(vecPath);
		testDb.close();
		_sqliteVecLoad = (db: any) => db.loadExtension(vecPath);
	} catch {
		// Vector search won't work, but BM25 and other operations are unaffected.
		_sqliteVecLoad = null;
	}
} else {
	_Database = (await import("better-sqlite3")).default;
	const sqliteVec = await import("sqlite-vec");
	_sqliteVecLoad = (db: any) => sqliteVec.load(db);
}

/**
 * Open a SQLite database. Works with both bun:sqlite and better-sqlite3.
 */
export function openDatabase(path: string): Database {
	return new _Database(path) as Database;
}

/**
 * Common subset of the Database interface used throughout pi-claw memory.
 */
export interface Database {
	exec(sql: string): void;
	prepare(sql: string): Statement;
	loadExtension(path: string): void;
	close(): void;
}

export interface Statement {
	run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
	get(...params: any[]): any;
	all(...params: any[]): any[];
}

/**
 * Check if sqlite-vec extension is available.
 */
export function isVectorSearchAvailable(): boolean {
	return _sqliteVecLoad !== null;
}

/**
 * Load the sqlite-vec extension into a database.
 *
 * Throws with platform-specific fix instructions when the extension is
 * unavailable.
 */
export function loadSqliteVec(db: Database): void {
	if (!_sqliteVecLoad) {
		const hint =
			isBun && process.platform === "darwin"
				? "On macOS with Bun, install Homebrew SQLite: brew install sqlite\n"
				: "Ensure the sqlite-vec native module is installed correctly.";
		throw new Error(`sqlite-vec extension is unavailable. ${hint}`);
	}
	_sqliteVecLoad(db);
}

/**
 * Initialize the memory database with required tables.
 */
export function initMemoryDatabase(db: Database): void {
	db.exec(`
    -- 记忆块表（分块后的内容）
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_hash TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      source_path TEXT NOT NULL,
      scope TEXT NOT NULL,
      channel_id TEXT,
      section_title TEXT,
      date_tag TEXT,
      token_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_source ON memory_chunks(source_path);
    CREATE INDEX IF NOT EXISTS idx_chunks_scope ON memory_chunks(scope, channel_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_date ON memory_chunks(date_tag);

    -- FTS5 全文索引
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      chunk_id,
      content,
      section_title,
      tokenize='unicode61'
    );

    -- 文件追踪（增量索引）
    CREATE TABLE IF NOT EXISTS file_index (
      path TEXT PRIMARY KEY,
      last_modified INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      indexed_at INTEGER NOT NULL
    );
  `);

	// 尝试加载 sqlite-vec 并创建向量表
	if (isVectorSearchAvailable()) {
		loadSqliteVec(db);
		db.exec(`
      -- 向量表（sqlite-vec）
      -- 维度 256 适用于 embeddinggemma-300M
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[256] DISTANCE_METRIC=COSINE
      );
    `);
	}
}
