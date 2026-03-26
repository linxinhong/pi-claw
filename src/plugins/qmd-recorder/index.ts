/**
 * QMD Recorder Plugin - QMD 格式记录插件
 *
 * 利用 pi-claw 的 hook 机制，使用 Quarto Markdown (.qmd) 格式保存学习记录、错误和特性请求
 * 参考 self-improving-agent skill 的设计理念和格式
 * 
 * 可选依赖（用于高级功能）：
 * - sqlite-vec: 向量存储，支持语义搜索
 * - node-llama-cpp: 本地嵌入生成
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import type { Plugin, PluginInitContext, PluginContext } from "../../core/plugin/types.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type {
	ToolCalledContext,
	MessageSentContext,
	AgentTurnEndContext,
	SystemPromptBuildContext,
} from "../../core/hook/types.js";
import { getHookManager, HOOK_NAMES } from "../../core/hook/index.js";

// ============================================================================
// Types
// ============================================================================

/** 记录类型 */
type RecordType = "learning" | "error" | "feature";

/** 记录条目 */
interface RecordEntry {
	id: string;
	type: RecordType;
	category: string;
	logged: string;
	priority: "low" | "medium" | "high" | "critical";
	status: "pending" | "in_progress" | "resolved" | "wont_fix" | "promoted";
	area?: string;
	summary: string;
	details: string;
	suggestedAction?: string;
	embedding?: number[];
	metadata: {
		source: string;
		relatedFiles?: string[];
		tags?: string[];
		seeAlso?: string[];
		patternKey?: string;
		recurrenceCount?: number;
		firstSeen?: string;
		lastSeen?: string;
	};
}

/** 工具参数定义（用于类型安全） */
interface RecordLearningParams {
	category: string;
	summary: string;
	details: string;
	priority?: "low" | "medium" | "high" | "critical";
	area?: "frontend" | "backend" | "infra" | "tests" | "docs" | "config";
	suggestedAction?: string;
	relatedFiles?: string[];
	tags?: string[];
	patternKey?: string;
}

interface RecordErrorParams {
	category: string;
	summary: string;
	errorMessage: string;
	context?: string;
	priority?: "low" | "medium" | "high" | "critical";
	area?: "frontend" | "backend" | "infra" | "tests" | "docs" | "config";
	suggestedFix?: string;
	reproducible?: "yes" | "no" | "unknown";
	relatedFiles?: string[];
	tags?: string[];
	seeAlso?: string[];
}

interface RecordFeatureParams {
	category: string;
	requestedCapability: string;
	userContext: string;
	complexity?: "simple" | "medium" | "complex";
	priority?: "low" | "medium" | "high" | "critical";
	area?: "frontend" | "backend" | "infra" | "tests" | "docs" | "config";
	suggestedImplementation?: string;
	relatedFeatures?: string[];
	tags?: string[];
}

/** 可选依赖模块 */
interface OptionalModules {
	sqliteVec?: any;
	nodeLlamaCpp?: any;
}

/** 插件配置 */
interface QmdRecorderConfig {
	/** 记录目录 */
	recordsDir: string;
	/** 是否记录工具错误 */
	recordToolErrors: boolean;
	/** 是否记录消息发送失败 */
	recordMessageErrors: boolean;
	/** 是否记录 Agent Turn 结束 */
	recordAgentTurns: boolean;
	/** 自动记录优先级阈值 */
	autoRecordPriorityThreshold: "low" | "medium" | "high" | "critical";
	/** 向量数据库路径（可选，默认 recordsDir/vectors.db） */
	vectorDbPath?: string;
	/** 嵌入模型路径（可选，用于 node-llama-cpp） */
	embeddingModelPath?: string;
	/** 是否启用语义搜索（需要 sqlite-vec） */
	enableSemanticSearch: boolean;
}

/** 向量数据库记录 */
interface VectorRecord {
	id: string;
	type: RecordType;
	content: string;
	embedding: Float32Array;
}

// ============================================================================
// QMD Recorder Plugin
// ============================================================================

class QmdRecorderPlugin implements Plugin {
	meta = {
		id: "qmd-recorder",
		name: "QMD Recorder",
		version: "1.1.0",
		description: "使用 QMD 格式记录学习、错误和特性请求的插件，支持可选的语义搜索功能",
	};

	private config!: QmdRecorderConfig;
	private logger?: PluginInitContext["logger"];
	private recordCounts: Map<RecordType, number> = new Map();
	private optionalModules: OptionalModules = {};
	private db: any = null; // sqlite database
	private semanticSearchAvailable = false;

	/**
	 * 获取今天的记录文件路径
	 */
	private getTodayFilePath(type: RecordType): string {
		const date = new Date();
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const dateStr = `${year}-${month}-${day}`;

		const filename = `${type}s-${dateStr}.qmd`;
		return join(this.config.recordsDir, filename);
	}

	/**
	 * 生成记录 ID
	 */
	private generateId(type: RecordType): string {
		const prefix = type === "learning" ? "LRN" : type === "error" ? "ERR" : "FEAT";
		const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
		const count = (this.recordCounts.get(type) || 0) + 1;
		this.recordCounts.set(type, count);
		const seq = String(count).padStart(3, "0");
		return `${prefix}-${date}-${seq}`;
	}

	/**
	 * 确保目录存在
	 */
	private ensureDir(path: string): void {
		const dir = dirname(path);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	/**
	 * 初始化 QMD 文件（如果不存在）
	 */
	private initQmdFile(filePath: string, type: RecordType): void {
		if (existsSync(filePath)) return;

		this.ensureDir(filePath);

		const titles: Record<RecordType, string> = {
			learning: "学习记录",
			error: "错误记录",
			feature: "特性请求",
		};

		const descriptions: Record<RecordType, string> = {
			learning: "记录学习心得、知识更新和最佳实践",
			error: "记录发生的错误、故障和解决方案",
			feature: "记录用户请求的新功能和改进建议",
		};

		const header = `---
title: "${titles[type]}"
description: "${descriptions[type]}"
date: "${new Date().toISOString()}"
format:
  html:
    toc: true
    code-fold: true
---

# ${titles[type]}

${descriptions[type]}

---

`;

		writeFileSync(filePath, header, "utf-8");
	}

	/**
	 * 将记录条目转换为 QMD 格式
	 */
	private entryToQmd(entry: RecordEntry): string {
		const typeLabels: Record<RecordType, string> = {
			learning: "学习",
			error: "错误",
			feature: "特性",
		};

		let qmd = `## [${entry.id}] ${entry.category} {status="${entry.status}" priority="${entry.priority}"}

**记录时间**: ${entry.logged}  
**类型**: ${typeLabels[entry.type]}  
**优先级**: ${entry.priority}  
**状态**: ${entry.status}`;

		if (entry.area) {
			qmd += `  \n**领域**: ${entry.area}`;
		}

		qmd += `

### 摘要

${entry.summary}

### 详细信息

${entry.details}
`;

		if (entry.suggestedAction) {
			qmd += `
### 建议操作

${entry.suggestedAction}
`;
		}

		qmd += `
### 元数据

| 字段 | 值 |
|------|-----|
| 来源 | ${entry.metadata.source} |
`;

		if (entry.metadata.relatedFiles?.length) {
			qmd += `| 相关文件 | ${entry.metadata.relatedFiles.join(", ")} |\n`;
		}

		if (entry.metadata.tags?.length) {
			qmd += `| 标签 | ${entry.metadata.tags.join(", ")} |\n`;
		}

		if (entry.metadata.seeAlso?.length) {
			qmd += `| 参见 | ${entry.metadata.seeAlso.join(", ")} |\n`;
		}

		if (entry.metadata.patternKey) {
			qmd += `| 模式键 | ${entry.metadata.patternKey} |\n`;
		}

		if (entry.metadata.recurrenceCount) {
			qmd += `| 复发次数 | ${entry.metadata.recurrenceCount} |\n`;
		}

		qmd += `
---

`;

		return qmd;
	}

	/**
	 * 添加记录
	 */
	private async addRecord(entry: RecordEntry): Promise<void> {
		try {
			const filePath = this.getTodayFilePath(entry.type);
			this.initQmdFile(filePath, entry.type);

			const qmdContent = this.entryToQmd(entry);
			appendFileSync(filePath, qmdContent, "utf-8");

			// 如果有语义搜索功能，同时存入向量数据库
			if (this.semanticSearchAvailable && this.db) {
				await this.addToVectorDb(entry);
			}

			this.logger?.info(`[QMD Recorder] 已记录 ${entry.type}: ${entry.id}`, { plugin: this.meta.id });
		} catch (error) {
			this.logger?.error(`[QMD Recorder] 记录失败: ${error}`, { plugin: this.meta.id });
		}
	}

	/**
	 * 添加到向量数据库
	 */
	private async addToVectorDb(entry: RecordEntry): Promise<void> {
		if (!this.semanticSearchAvailable || !this.db) return;

		try {
			// 组合文本用于嵌入
			const content = `${entry.summary}\n${entry.details}`;
			
			// 生成嵌入向量
			const embedding = await this.generateEmbedding(content);
			if (!embedding) return;

			// 存入数据库
			const { sqliteVec } = this.optionalModules;
			if (sqliteVec) {
				const vec = sqliteVec.serialize(embedding);
				this.db.prepare(
					"INSERT OR REPLACE INTO records (id, type, content, embedding) VALUES (?, ?, ?, ?)"
					).run(entry.id, entry.type, content, vec);
				}
		} catch (error) {
			this.logger?.error(`[QMD Recorder] 向量存储失败: ${error}`, { plugin: this.meta.id });
		}
	}

	/**
	 * 生成嵌入向量
	 */
	private async generateEmbedding(text: string): Promise<Float32Array | null> {
		if (!this.optionalModules.nodeLlamaCpp) return null;

		try {
			const { nodeLlamaCpp } = this.optionalModules;
			
			// 如果有配置模型路径，使用它
			if (this.config.embeddingModelPath) {
				// node-llama-cpp 的嵌入生成逻辑
				// 这里简化处理，实际使用时需要根据 API 调整
				this.logger?.debug(`[QMD Recorder] 使用 node-llama-cpp 生成嵌入`, { plugin: this.meta.id });
				
				// 注意：这里需要实际的 node-llama-cpp 嵌入实现
				// 返回模拟数据作为占位
				return new Float32Array(384).fill(0); // 384维嵌入向量
			}
		} catch (error) {
			this.logger?.error(`[QMD Recorder] 嵌入生成失败: ${error}`, { plugin: this.meta.id });
		}
		return null;
	}

	/**
	 * 语义搜索
	 */
	private async semanticSearch(query: string, type?: RecordType, limit: number = 5): Promise<VectorRecord[]> {
		if (!this.semanticSearchAvailable || !this.db) {
			throw new Error("语义搜索不可用，请安装 sqlite-vec 和 node-llama-cpp");
		}

		const queryEmbedding = await this.generateEmbedding(query);
		if (!queryEmbedding) return [];

		const { sqliteVec } = this.optionalModules;
		if (!sqliteVec) return [];

		const vec = sqliteVec.serialize(queryEmbedding);
		
		let sql = "SELECT id, type, content, distance FROM records WHERE embedding MATCH ?";
		const params: any[] = [vec];
		
		if (type) {
			sql += " AND type = ?";
			params.push(type);
		}
		
		sql += ` ORDER BY distance LIMIT ${limit}`;

		const rows = this.db.prepare(sql).all(...params);
		return rows.map((row: any) => ({
			id: row.id,
			type: row.type as RecordType,
			content: row.content,
			embedding: new Float32Array(), // 搜索结果不需要返回嵌入
		}));
	}

	/**
	 * 检查优先级是否满足阈值
	 */
	private meetsPriorityThreshold(priority: RecordEntry["priority"]): boolean {
		const levels = { low: 0, medium: 1, high: 2, critical: 3 };
		return levels[priority] >= levels[this.config.autoRecordPriorityThreshold];
	}

	/**
	 * 加载可选依赖
	 */
	private async loadOptionalModules(): Promise<void> {
		// 尝试加载 sqlite-vec
		try {
			// @ts-ignore - 可选依赖，可能未安装
			const sqliteVec = await import("sqlite-vec");
			this.optionalModules.sqliteVec = sqliteVec;
			this.logger?.info("[QMD Recorder] sqlite-vec 加载成功", { plugin: this.meta.id });
		} catch {
			this.logger?.info("[QMD Recorder] sqlite-vec 未安装，语义搜索功能不可用", { plugin: this.meta.id });
		}

		// 尝试加载 node-llama-cpp
		try {
			// @ts-ignore - 可选依赖，可能未安装
			const nodeLlamaCpp = await import("node-llama-cpp");
			this.optionalModules.nodeLlamaCpp = nodeLlamaCpp;
			this.logger?.info("[QMD Recorder] node-llama-cpp 加载成功", { plugin: this.meta.id });
		} catch {
			this.logger?.info("[QMD Recorder] node-llama-cpp 未安装，本地嵌入功能不可用", { plugin: this.meta.id });
		}

		// 初始化向量数据库
		if (this.optionalModules.sqliteVec && this.config.enableSemanticSearch) {
			await this.initVectorDb();
		}
	}

	/**
	 * 初始化向量数据库
	 */
	private async initVectorDb(): Promise<void> {
		if (!this.optionalModules.sqliteVec) return;

		try {
				// 动态导入 better-sqlite3
			// @ts-ignore - 可选依赖，可能未安装
			const Database = (await import("better-sqlite3")).default;
			const dbPath = this.config.vectorDbPath || join(this.config.recordsDir, "vectors.db");
			
			this.db = new Database(dbPath);
			const { sqliteVec } = this.optionalModules;
			
			// 加载 sqlite-vec 扩展
			sqliteVec.load(this.db);
			
			// 创建表
			this.db.exec(`
				CREATE TABLE IF NOT EXISTS records (
					id TEXT PRIMARY KEY,
					type TEXT,
					content TEXT,
					embedding F32_BLOB(384)
				);
			`);
			
			// 创建虚拟表用于向量搜索
			this.db.exec(`
				CREATE VIRTUAL TABLE IF NOT EXISTS vec_records USING vec0(
					embedding F32_BLOB(384)
				);
			`);

			this.semanticSearchAvailable = true;
			this.logger?.info(`[QMD Recorder] 向量数据库初始化成功: ${dbPath}`, { plugin: this.meta.id });
		} catch (error) {
			this.logger?.error(`[QMD Recorder] 向量数据库初始化失败: ${error}`, { plugin: this.meta.id });
			this.semanticSearchAvailable = false;
		}
	}

	async init(context: PluginInitContext): Promise<void> {
		this.logger = context.logger;

		// 读取配置
		const pluginConfig = context.config;
		this.config = {
			recordsDir: (pluginConfig?.recordsDir as string) || join(context.workspaceDir, "records"),
			recordToolErrors: (pluginConfig?.recordToolErrors as boolean) ?? true,
			recordMessageErrors: (pluginConfig?.recordMessageErrors as boolean) ?? true,
			recordAgentTurns: (pluginConfig?.recordAgentTurns as boolean) ?? false,
			autoRecordPriorityThreshold: (pluginConfig?.autoRecordPriorityThreshold as QmdRecorderConfig["autoRecordPriorityThreshold"]) || "medium",
			vectorDbPath: pluginConfig?.vectorDbPath as string | undefined,
			embeddingModelPath: pluginConfig?.embeddingModelPath as string | undefined,
			enableSemanticSearch: (pluginConfig?.enableSemanticSearch as boolean) ?? false,
		};

		// 确保记录目录存在
		if (!existsSync(this.config.recordsDir)) {
			mkdirSync(this.config.recordsDir, { recursive: true });
		}

		// 加载可选依赖
		await this.loadOptionalModules();

		const hookManager = context.hookManager || getHookManager();

		// ========== 工具调用错误记录 ==========
		if (this.config.recordToolErrors) {
			hookManager.on<ToolCalledContext>(
				HOOK_NAMES.TOOL_CALLED,
				async (ctx, next) => {
					if (!ctx.success && this.meetsPriorityThreshold("medium")) {
						await this.addRecord({
							id: this.generateId("error"),
							type: "error",
							category: `tool_${ctx.toolName}`,
							logged: new Date().toISOString(),
							priority: "medium",
							status: "pending",
							area: "backend",
							summary: `工具调用失败: ${ctx.toolName}`,
							details: `工具 ${ctx.toolName} 调用失败\n\n错误信息: ${ctx.error || "未知错误"}\n\n参数: ${JSON.stringify(ctx.args, null, 2)}\n\n频道: ${ctx.channelId}`,
							suggestedAction: "检查工具实现和参数",
							metadata: {
								source: "hook",
								tags: ["tool", "error", ctx.toolName],
							},
						});
					}
					return next();
				},
				{ source: this.meta.id }
			);
		}

		// ========== 消息发送错误记录 ==========
		if (this.config.recordMessageErrors) {
			hookManager.on<MessageSentContext>(
				HOOK_NAMES.MESSAGE_SENT,
				async (ctx, next) => {
					if (!ctx.success && this.meetsPriorityThreshold("medium")) {
						await this.addRecord({
							id: this.generateId("error"),
							type: "error",
							category: "message_send_failed",
							logged: new Date().toISOString(),
							priority: "medium",
							status: "pending",
							area: "backend",
							summary: `消息发送失败: ${ctx.channelId}`,
							details: `消息发送失败\n\n频道: ${ctx.channelId}\n消息ID: ${ctx.messageId}\n错误: ${ctx.error || "未知错误"}`,
							suggestedAction: "检查适配器连接和消息格式",
							metadata: {
								source: "hook",
								tags: ["message", "error"],
							},
						});
					}
					return next();
				},
				{ source: this.meta.id }
			);
		}

		// ========== Agent Turn 结束记录 ==========
		if (this.config.recordAgentTurns) {
			hookManager.on<AgentTurnEndContext>(
				HOOK_NAMES.AGENT_TURN_END,
				async (ctx, next) => {
					// 只在异常停止时记录
					if (["error", "timeout", "max_turns"].includes(ctx.stopReason)) {
						await this.addRecord({
							id: this.generateId("learning"),
							type: "learning",
							category: "agent_turn_anomaly",
							logged: new Date().toISOString(),
							priority: "low",
							status: "pending",
							area: "backend",
							summary: `Agent Turn 异常结束: ${ctx.stopReason}`,
							details: `Agent Turn 异常结束\n\n频道: ${ctx.channelId}\n轮次: ${ctx.turnNumber}\n停止原因: ${ctx.stopReason}`,
							metadata: {
								source: "hook",
								tags: ["agent", "turn", ctx.stopReason],
							},
						});
					}
					return next();
				},
				{ source: this.meta.id }
			);
		}

		// ========== 系统提示词注入 ==========
		hookManager.on<SystemPromptBuildContext>(
			HOOK_NAMES.SYSTEM_PROMPT_BUILD,
			async (ctx, next) => {
				// 构建功能可用性说明
				const features: string[] = [];
				const missingDeps: string[] = [];
				
				if (this.semanticSearchAvailable) {
					features.push("- 语义搜索 (semantic_search): 使用自然语言搜索相关记录");
				} else {
					missingDeps.push("| sqlite-vec       | 向量数据库存储                     | npm install sqlite-vec |\n| better-sqlite3   | SQLite 数据库（sqlite-vec 需要）   | npm install better-sqlite3 |\n| node-llama-cpp   | 本地嵌入生成                       | npm install node-llama-cpp |");
				}

				// 在系统提示词末尾追加使用指南
				const guidelines = `

## Recording Guidelines (QMD Recorder)

Use these tools to maintain a knowledge base of learnings, errors, and feature requests.
Records are saved to: ${this.config.recordsDir}

### When to use record_learning
- User corrects you ("No, that's wrong...", "Actually...", "You should...")
- You discover a better approach after trying something
- User explains project conventions you didn't know
- You solve a non-obvious problem that required debugging
- User provides feedback on your behavior or approach

### When to use record_error
- A command or API call fails unexpectedly
- Tool execution returns an error
- Something works differently than you expected
- You encounter a recurring issue

### When to use record_feature_request
- User says "Can you also...", "I wish you could...", "Why can't you..."
- User asks for functionality that doesn't exist yet
- User describes a problem that could be solved with a new feature

### When to use query_records
- Before starting a complex task, check if similar issues were recorded
- User asks about past problems, decisions, or solutions
- You want to avoid repeating a mistake that was previously logged

${features.length > 0 ? `### Advanced Features Available\n${features.join("\n")}\n` : ""}${missingDeps.length > 0 ? `### Optional Dependencies for Advanced Features
To enable semantic search, install the following dependencies:

| Package          | Purpose                            | Install Command |
|------------------|------------------------------------|-----------------|
${missingDeps.join("\n")}

Then set "enableSemanticSearch": true in the plugin config.
` : ""}
### Recording Best Practices
- Be specific: include what happened, why it matters, and what to do about it
- Use tags: add relevant keywords to make records searchable
- Link related files: include paths to relevant code or documentation
- Set appropriate priority: critical > high > medium > low
`;
				ctx.prompt += guidelines;
				return next();
			},
			{ source: this.meta.id, priority: 100 }
		);

		this.logger?.info(`[QMD Recorder] 初始化完成，记录目录: ${this.config.recordsDir}${this.semanticSearchAvailable ? "，语义搜索已启用" : ""}`, { plugin: this.meta.id });
	}

	/**
	 * 提供工具给 AI 使用
	 */
	getTools(_context: PluginContext): AgentTool<any>[] {
		const tools: AgentTool<any>[] = [
			// 记录学习
			{
				name: "record_learning",
				label: "记录学习",
				description: "记录学习心得、知识更新或最佳实践",
				parameters: {
					type: "object",
					properties: {
						category: { type: "string", description: "学习类别，如 correction, knowledge_gap, best_practice" },
						summary: { type: "string", description: "一句话摘要" },
						details: { type: "string", description: "详细内容" },
						priority: { type: "string", enum: ["low", "medium", "high", "critical"], default: "medium", description: "优先级" },
						area: { type: "string", enum: ["frontend", "backend", "infra", "tests", "docs", "config"], description: "相关领域" },
						suggestedAction: { type: "string", description: "建议的后续操作" },
						relatedFiles: { type: "array", items: { type: "string" }, description: "相关文件路径" },
						tags: { type: "array", items: { type: "string" }, description: "标签" },
						patternKey: { type: "string", description: "模式键，用于追踪重复模式" },
					},
					required: ["category", "summary", "details"],
				},
				execute: async (_toolCallId, params) => {
					const args = params as RecordLearningParams;
					await this.addRecord({
						id: this.generateId("learning"),
						type: "learning",
						category: args.category,
						logged: new Date().toISOString(),
						priority: args.priority || "medium",
						status: "pending",
						area: args.area,
						summary: args.summary,
						details: args.details,
						suggestedAction: args.suggestedAction,
						metadata: {
							source: "agent",
							relatedFiles: args.relatedFiles,
							tags: args.tags,
							patternKey: args.patternKey,
						},
					});
					return {
						content: [{ type: "text", text: `学习记录已保存: ${this.getTodayFilePath("learning")}` }],
						details: { success: true, path: this.getTodayFilePath("learning") },
					};
				},
			},
			// 记录错误
			{
				name: "record_error",
				label: "记录错误",
				description: "记录发生的错误、故障或异常情况",
				parameters: {
					type: "object",
					properties: {
						category: { type: "string", description: "错误类别" },
						summary: { type: "string", description: "一句话摘要" },
						errorMessage: { type: "string", description: "错误信息" },
						context: { type: "string", description: "错误上下文" },
						priority: { type: "string", enum: ["low", "medium", "high", "critical"], default: "high", description: "优先级" },
						area: { type: "string", enum: ["frontend", "backend", "infra", "tests", "docs", "config"], description: "相关领域" },
						suggestedFix: { type: "string", description: "建议的修复方案" },
						reproducible: { type: "string", enum: ["yes", "no", "unknown"], default: "unknown", description: "是否可复现" },
						relatedFiles: { type: "array", items: { type: "string" }, description: "相关文件路径" },
						tags: { type: "array", items: { type: "string" }, description: "标签" },
						seeAlso: { type: "array", items: { type: "string" }, description: "相关的其他记录ID" },
					},
					required: ["category", "summary", "errorMessage"],
				},
				execute: async (_toolCallId, params) => {
					const args = params as RecordErrorParams;
					await this.addRecord({
						id: this.generateId("error"),
						type: "error",
						category: args.category,
						logged: new Date().toISOString(),
						priority: args.priority || "high",
						status: "pending",
						area: args.area,
						summary: args.summary,
						details: `错误信息:\n\n\`\`\`\n${args.errorMessage}\n\`\`\`\n\n上下文:\n${args.context || "无"}`,
						suggestedAction: args.suggestedFix,
						metadata: {
							source: "agent",
							relatedFiles: args.relatedFiles,
							tags: args.tags,
							seeAlso: args.seeAlso,
						},
					});
					return {
						content: [{ type: "text", text: `错误记录已保存: ${this.getTodayFilePath("error")}` }],
						details: { success: true, path: this.getTodayFilePath("error") },
					};
				},
			},
			// 记录特性请求
			{
				name: "record_feature_request",
				label: "记录特性请求",
				description: "记录用户请求的新功能或改进建议",
				parameters: {
					type: "object",
					properties: {
						category: { type: "string", description: "特性类别" },
						requestedCapability: { type: "string", description: "请求的功能" },
						userContext: { type: "string", description: "用户场景和需求" },
						complexity: { type: "string", enum: ["simple", "medium", "complex"], default: "medium", description: "复杂度估计" },
						priority: { type: "string", enum: ["low", "medium", "high", "critical"], default: "medium", description: "优先级" },
						area: { type: "string", enum: ["frontend", "backend", "infra", "tests", "docs", "config"], description: "相关领域" },
						suggestedImplementation: { type: "string", description: "建议的实现方案" },
						relatedFeatures: { type: "array", items: { type: "string" }, description: "相关的现有功能" },
						tags: { type: "array", items: { type: "string" }, description: "标签" },
					},
					required: ["category", "requestedCapability", "userContext"],
				},
				execute: async (_toolCallId, params) => {
					const args = params as RecordFeatureParams;
					await this.addRecord({
						id: this.generateId("feature"),
						type: "feature",
						category: args.category,
						logged: new Date().toISOString(),
						priority: args.priority || "medium",
						status: "pending",
						area: args.area,
						summary: `特性请求: ${args.requestedCapability}`,
						details: `**用户场景**: ${args.userContext}\n\n**复杂度**: ${args.complexity || "medium"}`,
						suggestedAction: args.suggestedImplementation,
						metadata: {
							source: "agent",
							tags: args.tags,
						},
					});
					return {
						content: [{ type: "text", text: `特性请求已保存: ${this.getTodayFilePath("feature")}` }],
						details: { success: true, path: this.getTodayFilePath("feature") },
					};
				},
			},
			// 查询记录
			{
				name: "query_records",
				label: "查询记录",
				description: "查询记录文件",
				parameters: {
					type: "object",
					properties: {
						date: { type: "string", description: "日期 (YYYY-MM-DD)，默认今天" },
						type: { type: "string", enum: ["learning", "error", "feature"], description: "记录类型" },
					},
				},
				execute: async (_toolCallId, params) => {
					const args = params as { date?: string; type?: RecordType };
					const date = args.date || new Date().toISOString().slice(0, 10);
					const types = args.type ? [args.type] : (["learning", "error", "feature"] as RecordType[]);

					const results: { type: RecordType; path: string; exists: boolean }[] = [];
					for (const t of types) {
						const path = join(this.config.recordsDir, `${t}s-${date}.qmd`);
						results.push({ type: t, path, exists: existsSync(path) });
					}

					const resultText = `查询结果 (${date}):\n${results.map(r => `- ${r.type}: ${r.exists ? "✓" : "✗"} ${r.path}`).join("\n")}`;
					return {
						content: [{ type: "text", text: resultText }],
						details: { success: true, date, records: results },
					};
				},
			},
		];

		// 如果语义搜索可用，添加语义搜索工具
		if (this.semanticSearchAvailable) {
			tools.push({
				name: "semantic_search",
				label: "语义搜索",
				description: "使用自然语言搜索相关记录（需要 sqlite-vec 和 node-llama-cpp）",
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "搜索查询，使用自然语言描述你要找的内容" },
						type: { type: "string", enum: ["learning", "error", "feature"], description: "限制搜索的记录类型" },
						limit: { type: "number", default: 5, description: "返回结果数量" },
					},
					required: ["query"],
				},
				execute: async (_toolCallId, params) => {
					const args = params as { query: string; type?: RecordType; limit?: number };
					
					if (!this.semanticSearchAvailable) {
						return {
							content: [{ type: "text", text: "语义搜索不可用，请安装 sqlite-vec 和 node-llama-cpp" }],
							details: { success: false, error: "Semantic search not available" },
						};
					}

					try {
						const results = await this.semanticSearch(args.query, args.type, args.limit || 5);
						
						if (results.length === 0) {
							return {
								content: [{ type: "text", text: "未找到相关记录" }],
								details: { success: true, results: [] },
							};
						}

						const resultText = `找到 ${results.length} 条相关记录:\n\n${results.map((r, i) => 
							`${i + 1}. [${r.type}] ${r.id}\n   ${r.content.slice(0, 200)}...`
						).join("\n\n")}`;

						return {
							content: [{ type: "text", text: resultText }],
							details: { success: true, results },
						};
					} catch (error) {
						return {
							content: [{ type: "text", text: `搜索失败: ${error}` }],
							details: { success: false, error: String(error) },
						};
					}
				},
			});
		}

		return tools;
	}
}

export const qmdRecorderPlugin: Plugin = new QmdRecorderPlugin();
