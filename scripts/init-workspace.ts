#!/usr/bin/env node
/**
 * Workspace 初始化脚本 (TypeScript 版本)
 *
 * 用法:
 *   npx tsx scripts/init-workspace.ts [workspace-dir] [--force]
 *
 * 选项:
 *   --force    强制覆盖已存在的文件
 *   --dry-run  只显示会创建的文件，不实际创建
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// ESM 获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析命令行参数
const args = process.argv.slice(2);
const forceMode = args.includes("--force");
const dryRun = args.includes("--dry-run");
const workspaceArg = args.find((a) => !a.startsWith("--"));

// 默认 workspace 目录
const DEFAULT_WORKSPACE = join(homedir(), ".pi-claw");
const WORKSPACE = resolve(workspaceArg || DEFAULT_WORKSPACE);

// 模板目录
const TEMPLATES_DIR = join(__dirname, "..", "templates");

// ============================================================================
// 类型定义
// ============================================================================

interface FileConfig {
	path: string;
	template: string;
	permissions?: number;
	readonly?: boolean;
	replaceVars?: boolean;
}

// ============================================================================
// 文件配置
// ============================================================================

const FILES: FileConfig[] = [
	// Boot 文件 - 只读配置
	{
		path: "boot/soul.md",
		template: "boot/soul.md",
		permissions: 0o600,
		readonly: true,
	},
	{
		path: "boot/identity.md",
		template: "boot/identity.md",
		permissions: 0o600,
		readonly: true,
	},
	{
		path: "boot/tools.md",
		template: "boot/tools.md",
		permissions: 0o600,
		readonly: true,
	},

	// Boot 文件 - 可编辑配置
	{
		path: "boot/profile.md",
		template: "boot/profile.md",
		permissions: 0o644,
	},

	// Memory 文件
	{
		path: "memory/memory.md",
		template: "memory/memory.md",
		permissions: 0o644,
	},

	// 配置文件
	{
		path: "config.json",
		template: "config.json",
		permissions: 0o600,
		replaceVars: true,
	},
	{
		path: "SYSTEM.md",
		template: "SYSTEM.md",
		permissions: 0o644,
	},

	// 目录占位 - 全局
	{
		path: "skills/.gitkeep",
		template: "skills/.gitkeep",
	},
	{
		path: "skills/example/SKILL.md",
		template: "skills/example/SKILL.md",
	},
	{
		path: "events/.gitkeep",
		template: "events/.gitkeep",
	},
	{
		path: "channels/.gitkeep",
		template: "channels/.gitkeep",
	},
	{
		path: "logs/.gitkeep",
		template: "logs/.gitkeep",
	},
	{
		path: "docs/.gitkeep",
		template: "docs/.gitkeep",
	},
	{
		path: "scratch/.gitkeep",
		template: "scratch/.gitkeep",
	},
];

// ============================================================================
// 工具函数
// ============================================================================

function log(emoji: string, message: string): void {
	console.log(`   ${emoji} ${message}`);
}

function replaceVariables(content: string): string {
	return content
		.replace(/\$\{WORKSPACE\}/g, WORKSPACE)
		.replace(/\$\{FEISHU_APP_ID\}/g, process.env.FEISHU_APP_ID || "your_app_id")
		.replace(/\$\{FEISHU_APP_SECRET\}/g, process.env.FEISHU_APP_SECRET || "your_app_secret")
		.replace(/\$\{FEISHU_MODEL:-([^}]+)\}/g, (_, defaultVal) => process.env.FEISHU_MODEL || defaultVal);
}

function setupCliLink(projectDir: string): void {
	const localBin = join(homedir(), ".local", "bin");
	const cliLink = join(localBin, "pi-claw");
	const cliPath = join(projectDir, "dist", "cli.js");

	// 确保 ~/.local/bin 存在
	if (!existsSync(localBin)) {
		mkdirSync(localBin, { recursive: true });
		log("✅", `Created: ${localBin}`);
	}

	// 检查/更新链接
	if (existsSync(cliLink)) {
		try {
			const currentTarget = readlinkSync(cliLink);
			if (currentTarget === cliPath) {
				log("⏭️", `Link exists: pi-claw`);
				return;
			}
			unlinkSync(cliLink);
		} catch {
			// ignore - 文件可能不是符号链接
		}
	}

	symlinkSync(cliPath, cliLink);
	log("✅", `Linked: pi-claw -> ${cliPath}`);

	// PATH 提示
	if (!process.env.PATH?.includes(".local/bin")) {
		console.log(`\n⚠️  ~/.local/bin not in PATH. Add to ~/.bashrc or ~/.zshrc:`);
		console.log(`   export PATH="$HOME/.local/bin:$PATH"`);
	}
}

// ============================================================================
// 主逻辑
// ============================================================================

async function main(): Promise<void> {
	console.log(`\n🚀 Initializing workspace: ${WORKSPACE}\n`);

	if (dryRun) {
		console.log("📋 Dry run mode - showing what would be created:\n");
	}

	// 创建目录
	console.log("📁 Creating directory structure...");
	const dirs = new Set<string>();
	for (const file of FILES) {
		dirs.add(dirname(join(WORKSPACE, file.path)));
	}

	for (const dir of dirs) {
		if (dryRun) {
			log("📂", `Would create: ${dir}`);
		} else if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
			log("✅", `Created: ${dir}`);
		} else {
			log("⏭️", `Exists: ${dir}`);
		}
	}

	// 创建文件
	console.log("\n📄 Creating files...");

	for (const file of FILES) {
		const fullPath = join(WORKSPACE, file.path);

		// 检查文件是否存在
		if (existsSync(fullPath) && !forceMode) {
			log("⏭️", `Exists: ${file.path}`);
			continue;
		}

		if (dryRun) {
			const status = file.readonly ? "🔒 (readonly)" : "";
			log("📝", `Would create: ${file.path} ${status}`);
			continue;
		}

		// 获取内容
		let content: string;
		const templatePath = join(TEMPLATES_DIR, file.template);
		if (existsSync(templatePath)) {
			content = readFileSync(templatePath, "utf-8");
		} else {
			console.warn(`   ⚠️ Template not found: ${file.template}`);
			continue;
		}

		// 替换变量
		if (file.replaceVars) {
			content = replaceVariables(content);
		}

		// 写入文件
		writeFileSync(fullPath, content, "utf-8");

		// 设置权限
		if (file.permissions) {
			chmodSync(fullPath, file.permissions);
		}

		// 日志
		if (file.readonly) {
			log("🔒", `${file.path} (600)`);
		} else {
			log("✅", file.path);
		}
	}

	// 完成
	if (dryRun) {
		console.log("\n📋 Dry run complete. Run without --dry-run to create files.\n");
		return;
	}

	// 设置 CLI 符号链接
	console.log("\n🔗 Setting up CLI link...");
	const projectDir = join(__dirname, "..");
	setupCliLink(projectDir);

	console.log(`
✅ Workspace initialized successfully!

📋 Next steps:

   1. Edit configuration:
      ${join(WORKSPACE, "config.json")}

   2. (Optional) Copy and edit models config:
      cp templates/models.example.json models.json

   3. Edit your profile:
      ${join(WORKSPACE, "boot/profile.md")}

   4. (Optional) Customize identity (readonly):
      ${join(WORKSPACE, "boot/soul.md")}
      ${join(WORKSPACE, "boot/identity.md")}
      ${join(WORKSPACE, "boot/tools.md")}

   5. Start the bot:
      npm run dev

🔒 Protected files (600):
   - boot/soul.md
   - boot/identity.md
   - boot/tools.md

   To modify protected files:
   npm run unlock
   # edit files
   npm run lock
`);
}

main().catch((err) => {
	console.error("❌ Error:", err.message);
	process.exit(1);
});
