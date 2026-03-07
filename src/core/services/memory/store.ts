/**
 * Memory Store - 记忆存储服务
 *
 * 核心记忆存储功能，不依赖插件接口
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * 记忆存储类
 */
export class MemoryStore {
	private memoryPath: string;

	constructor(workspaceDir: string) {
		this.memoryPath = join(workspaceDir, "memory", "memory.md");
		this.ensureDir();
	}

	private ensureDir(): void {
		const dir = join(this.memoryPath, "..");
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	/**
	 * 添加记忆
	 */
	append(content: string): void {
		this.ensureDir();
		const timestamp = new Date().toISOString().split("T")[0];
		const entry = `\n## ${timestamp}\n${content}\n`;
		appendFileSync(this.memoryPath, entry, "utf-8");
	}

	/**
	 * 读取所有记忆
	 */
	read(): string {
		if (!existsSync(this.memoryPath)) return "";
		return readFileSync(this.memoryPath, "utf-8");
	}

	/**
	 * 搜索记忆
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
	 * 删除匹配的记忆
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
		return removed;
	}
}
