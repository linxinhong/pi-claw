/**
 * Prompt Builder
 *
 * 提示词构建器 - 为 Agent 构建系统提示词
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { AgentContext } from "./context.js";
import type { Skill } from "@mariozechner/pi-coding-agent";
import { formatSkillsForPrompt, loadSkillsFromDir } from "@mariozechner/pi-coding-agent";

// ============================================================================
// Types
// ============================================================================

/**
 * 缓存条目
 */
interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

/**
 * Boot 文件内容
 */
export interface BootContents {
	identity: string;  // 放在开头
	profile: string;   // 放在中间（精简后）
	soul: string;      // 放在末尾
	tools: string;     // 工具使用指南
}

// ============================================================================
// Constants
// ============================================================================

/** 缓存 TTL：30 秒 */
const CACHE_TTL = 30000;

// ============================================================================
// Content Sanitization
// ============================================================================

/**
 * 清理 boot 文件内容
 *
 * 过滤掉无效信息，节省 token：
 * - 跳过文件头部说明（以 > 开头的引用块）
 * - 跳过未选中的 checkbox
 * - 跳过占位符行
 * - 保留已选中的 checkbox，移除 checkbox 标记
 */
function sanitizeBootContent(content: string): string {
	const lines = content.split('\n');
	const result: string[] = [];
	let inCodeBlock = false;

	for (const line of lines) {
		// 追踪代码块状态
		if (line.trim().startsWith('```')) {
			inCodeBlock = !inCodeBlock;
			result.push(line);
			continue;
		}

		// 代码块内保留原样
		if (inCodeBlock) {
			result.push(line);
			continue;
		}

		// 跳过文件头部说明
		if (line.trim().startsWith('> 此文件')) continue;

		// 跳过未选中的 checkbox
		if (line.match(/^\s*- \[ \]/)) continue;

		// 跳过占位符行
		if (/\[你的|\[请|\[项目|\[React/.test(line)) continue;

		// 保留已选中的 checkbox，移除标记
		const checkedMatch = line.match(/^(\s*)- \[x\] (.+)$/);
		if (checkedMatch) {
			result.push(`${checkedMatch[1]}- ${checkedMatch[2]}`);
			continue;
		}

		result.push(line);
	}

	// 移除多余空行
	return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================================
// Cache
// ============================================================================

const skillsCache = new Map<string, CacheEntry<Skill[]>>();
const memoryCache = new Map<string, CacheEntry<string>>();
const bootCache = new Map<string, CacheEntry<BootContents>>();

/**
 * 检查缓存是否有效
 */
function isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
	if (!entry) return false;
	return Date.now() - entry.timestamp < CACHE_TTL;
}

/**
 * 清理过期缓存
 */
function cleanupCache<T>(cache: Map<string, CacheEntry<T>>): void {
	const now = Date.now();
	for (const [key, entry] of cache.entries()) {
		if (now - entry.timestamp >= CACHE_TTL) {
			cache.delete(key);
		}
	}
}

// ============================================================================
// Boot Files Loader
// ============================================================================

/**
 * 分别加载各个 boot 文件
 */
export function loadBootFiles(workspaceDir: string): BootContents {
	// 检查缓存
	cleanupCache(bootCache);
	const cached = bootCache.get(workspaceDir);
	if (cached) {
		return cached.data;
	}

	const readFile = (path: string): string => {
		try {
			const content = readFileSync(path, "utf-8").trim();
			return sanitizeBootContent(content);
		} catch {
			return "";
		}
	};

	const result: BootContents = {
		identity: readFile(join(workspaceDir, "boot/identity.md")),
		profile: readFile(join(workspaceDir, "boot/profile.md")),
		soul: readFile(join(workspaceDir, "boot/soul.md")),
		tools: readFile(join(workspaceDir, "boot/tools.md")),
	};

	// 保存到缓存
	bootCache.set(workspaceDir, { data: result, timestamp: Date.now() });

	return result;
}

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * 构建系统提示词
 *
 * 结构：
 * 1. Identity（从 identity.md 提取，放在开头）
 * 2. Context + Platform Info
 * 3. Workspace Layout
 * 4. Skills
 * 5. Memory（profile + 长期记忆 + 今日日志 + 频道记忆）
 * 6. Tools
 * 7. Soul（从 soul.md 提取，放在末尾）
 * 8. 历史对话摘要（如果有）
 */
export function buildSystemPrompt(
	context: AgentContext,
	skills: Skill[],
	memoryContent: string,
	channelDir?: string,
	bootContents?: BootContents,
	historyMarkdown?: string,
): string {
	const { workspaceDir, chatId, channels, users } = context;

	const channelMappings =
		channels.length > 0 ? channels.map((c) => `${c.id}\t#${c.name}`).join("\n") : "(no channels)";
	const userMappings =
		users.length > 0 ? users.map((u) => `${u.id}\t@${u.userName}\t${u.displayName}`).join("\n") : "(no users)";

	const skillsText =
		skills.length > 0 ? formatSkillsForPrompt(skills) : "(no skills installed yet)";

	let prompt = '';

	// 1. Identity（开头）
	if (bootContents?.identity) {
		prompt += `## Identity\n${bootContents.identity}\n\n`;
	}

	// 2. Context
	prompt += `You are pi-claw, a platform-agnostic AI assistant. Be concise. No emojis.

## Context
- For current date/time, use: date
- You have access to previous conversation context including tool results from prior turns.
- For older history beyond your context, search log.jsonl (contains user messages and your final responses, but not tool results).
- Platform: ${context.platform.platform}

## Markdown Formatting
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Do NOT use HTML tags unless specifically required by the platform.

## Platform IDs
Channels: ${channelMappings}

Users: ${userMappings}

When mentioning users, use the platform's specific mention format.

## Workspace Layout
${context.workspaceDir}/
├── MEMORY.md                    # Global memory (all channels)
├── skills/                      # Global CLI tools you create
└── ${chatId}/                   # This channel
    ├── MEMORY.md                # Channel-specific memory
    ├── log.jsonl                # Message history (no tool results)
    ├── attachments/             # User shared files
    ├── scratch/                 # Your working directory
    └── skills/                  # Channel-specific tools

`;

	// 3. Skills
	prompt += `## Skills (Custom CLI Tools)
You can create reusable CLI tools for recurring tasks.

### Creating Skills
Store in \`${context.workspaceDir}/skills/<name>/\` (global) or \`${context.workspaceDir}/${chatId}/skills/<name>/\` (channel-specific).
Each skill directory needs a \`SKILL.md\` with YAML frontmatter.

### Available Skills
${skillsText}

`;

	// 4. Memory
	prompt += `## Memory System
Memory is organized in multiple layers.

### Memory Files
- **PROFILE.md** - User profile (preferences, identity)
- **SOUL.md** - Core identity and boundaries
- **IDENTITY.md** - Detailed behavior guidelines
- **TOOLS.md** - Tool usage best practices
- **MEMORY.md** - Long-term memory (AI-extracted stable facts)
- **memory/YYYY-MM-DD.md** - Daily activity logs (retained 7 days)
- **channel/MEMORY.md** - Channel-specific context

### Current Memory
${memoryContent || "(no memory yet)"}

`;

	// 5. Tools
	prompt += `## Tools
- bash: Run shell commands (primary tool)
- read: Read files
- write: Create/overwrite files
- edit: Surgical file edits

Each tool requires a "label" parameter (shown to user).

`;

	// 6. Profile（如果有）
	if (bootContents?.profile) {
		prompt += `## User Profile\n${bootContents.profile}\n\n`;
	}

	// 7. Tools 指南（如果有）
	if (bootContents?.tools) {
		prompt += `## Tool Guidelines\n${bootContents.tools}\n\n`;
	}

	// 8. Soul（末尾）
	if (bootContents?.soul) {
		prompt += `## Core Rules\n${bootContents.soul}\n\n`;
	}

	// 9. 历史对话（如果有）
	if (historyMarkdown) {
		prompt += `## Recent Conversation\n${historyMarkdown}\n`;
	}

	// 保存 prompt 到频道目录（调试用）
	if (channelDir) {
		const promptPath = join(channelDir, "system-prompt.md");
		try {
			writeFileSync(promptPath, prompt, "utf-8");
		} catch {
			// 忽略写入错误
		}
	}

	return prompt;
}

/**
 * 加载记忆内容（带缓存）
 *
 * 注意：不再加载 boot 文件，它们由 loadBootFiles 单独加载
 */
export function loadMemoryContent(channelDir: string, workspaceDir: string): string {
	// 检查缓存
	const cacheKey = `${channelDir}:${workspaceDir}`;
	cleanupCache(memoryCache);
	const cached = memoryCache.get(cacheKey);
	if (cached) {
		return cached.data;
	}

	// 加载内容
	const parts: string[] = [];

	// 加载长期记忆
	const memoryPath = join(workspaceDir, "memory", "memory.md");
	if (existsSync(memoryPath)) {
		try {
			const content = readFileSync(memoryPath, "utf-8").trim();
			if (content) parts.push(`### Long-term Memory\n${content}`);
		} catch {
			// 忽略错误
		}
	}

	// 加载今日日志
	const today = new Date().toISOString().split("T")[0];
	const todayLogPath = join(workspaceDir, "memory", `${today}.md`);
	if (existsSync(todayLogPath)) {
		try {
			const content = readFileSync(todayLogPath, "utf-8").trim();
			if (content) parts.push(`### Today's Log\n${content}`);
		} catch {
			// 忽略错误
		}
	}

	// 加载频道记忆
	const channelMemoryPath = join(channelDir, "MEMORY.md");
	if (existsSync(channelMemoryPath)) {
		try {
			const content = readFileSync(channelMemoryPath, "utf-8").trim();
			if (content) parts.push(`### Channel Memory\n${content}`);
		} catch {
			// 忽略错误
		}
	}

	const result = parts.length === 0 ? "" : parts.join("\n\n");

	// 保存到缓存
	memoryCache.set(cacheKey, { data: result, timestamp: Date.now() });

	return result;
}

/**
 * 加载技能（带缓存）
 */
export function loadSkills(channelDir: string, workspacePath: string): Skill[] {
	// 检查缓存
	const cacheKey = `${channelDir}:${workspacePath}`;
	cleanupCache(skillsCache);
	const cached = skillsCache.get(cacheKey);
	if (cached) {
		return cached.data;
	}

	const skillMap = new Map<string, Skill>();

	const translatePath = (hostPath: string): string => {
		if (hostPath.startsWith(workspacePath)) {
			return workspacePath + hostPath.slice(workspacePath.length);
		}
		return hostPath;
	};

	// 加载全局技能
	const workspaceSkillsDir = join(workspacePath, "skills");
	for (const skill of loadSkillsFromDir({ dir: workspaceSkillsDir, source: "workspace" }).skills) {
		skill.filePath = translatePath(skill.filePath);
		skill.baseDir = translatePath(skill.baseDir);
		skillMap.set(skill.name, skill);
	}

	// 加载频道技能
	const channelSkillsDir = join(channelDir, "skills");
	for (const skill of loadSkillsFromDir({ dir: channelSkillsDir, source: "channel" }).skills) {
		skill.filePath = translatePath(skill.filePath);
		skill.baseDir = translatePath(skill.baseDir);
		skillMap.set(skill.name, skill);
	}

	const result = Array.from(skillMap.values());

	// 保存到缓存
	skillsCache.set(cacheKey, { data: result, timestamp: Date.now() });

	return result;
}
