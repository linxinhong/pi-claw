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
 * 记忆文件配置
 */
interface MemoryFile {
	path: string;
	title: string;
}

/**
 * 缓存条目
 */
interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const BOOT_FILES: MemoryFile[] = [
	{ path: "boot/profile.md", title: "User Profile" },
	{ path: "boot/soul.md", title: "Core Identity" },
	{ path: "boot/identity.md", title: "Identity Details" },
	{ path: "boot/tools.md", title: "Tool Guidelines" },
];

/** 缓存 TTL：30 秒 */
const CACHE_TTL = 30000;

// ============================================================================
// Cache
// ============================================================================

const skillsCache = new Map<string, CacheEntry<Skill[]>>();
const memoryCache = new Map<string, CacheEntry<string>>();

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
// Prompt Builder
// ============================================================================

/**
 * 构建系统提示词
 */
export function buildSystemPrompt(
	context: AgentContext,
	skills: Skill[],
	memoryContent: string,
	channelDir?: string,
): string {
	const { workspaceDir, chatId, channels, users } = context;

	const channelMappings =
		channels.length > 0 ? channels.map((c) => `${c.id}\t#${c.name}`).join("\n") : "(no channels)";
	const userMappings =
		users.length > 0 ? users.map((u) => `${u.id}\t@${u.userName}\t${u.displayName}`).join("\n") : "(no users)";

	const skillsText =
		skills.length > 0 ? formatSkillsForPrompt(skills) : "(no skills installed yet)";

	const prompt = `You are pi-feishu, a platform-agnostic AI assistant. Be concise. No emojis.

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

## Skills (Custom CLI Tools)
You can create reusable CLI tools for recurring tasks.

### Creating Skills
Store in \`${context.workspaceDir}/skills/<name>/\` (global) or \`${context.workspaceDir}/${chatId}/skills/<name>/\` (channel-specific).
Each skill directory needs a \`SKILL.md\` with YAML frontmatter.

### Available Skills
${skillsText}

## Memory System
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

## Tools
- bash: Run shell commands (primary tool)
- read: Read files
- write: Create/overwrite files
- edit: Surgical file edits

Each tool requires a "label" parameter (shown to user).
`;

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

	// 加载引导文件
	for (const { path, title } of BOOT_FILES) {
		const filePath = join(workspaceDir, path);
		if (existsSync(filePath)) {
			try {
				const content = readFileSync(filePath, "utf-8").trim();
				if (content) parts.push(`### ${title}\n${content}`);
			} catch {
				// 忽略错误
			}
		}
	}

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
