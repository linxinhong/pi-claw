/**
 * Glob Tool - 文件路径匹配
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Executor } from "../sandbox/index.js";

const GlobToolSchema = Type.Object({
	pattern: Type.String({ description: "Glob pattern to match files (e.g., **/*.ts, src/**/*.js)" }),
	label: Type.String({ description: "Short label shown to user" }),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: workspace root)" })),
});

type GlobToolParams = Static<typeof GlobToolSchema>;

/**
 * 将 glob 模式转换为 find 命令参数
 */
function globToFindArgs(pattern: string): string[] {
	const args: string[] = [];

	// 简单的 glob 模式转换
	// ** -> 递归匹配
	// * -> 单层匹配
	// ? -> 单字符匹配

	// 处理 **/*.ext 模式
	if (pattern.startsWith("**/")) {
		// 递归匹配
		const suffix = pattern.slice(3);
		args.push("-type", "f", "-name", suffix.replace(/\*/g, "\\*").replace(/\?/g, "\\?"));
		return args;
	}

	// 处理 *.ext 模式（当前目录）
	if (!pattern.includes("/")) {
		args.push("-maxdepth", "1", "-type", "f", "-name", pattern.replace(/\*/g, "\\*").replace(/\?/g, "\\?"));
		return args;
	}

	// 处理 path/**/*.ext 模式
	if (pattern.includes("/**/")) {
		const [basePath, suffix] = pattern.split("/**/");
		args.push(basePath || ".", "-type", "f", "-name", suffix.replace(/\*/g, "\\*").replace(/\?/g, "\\?"));
		return args;
	}

	// 处理 path/*.ext 模式
	if (pattern.includes("/") && !pattern.includes("**")) {
		const lastSlash = pattern.lastIndexOf("/");
		const basePath = pattern.slice(0, lastSlash);
		const filePattern = pattern.slice(lastSlash + 1);
		args.push("-path", basePath, "-maxdepth", "1", "-type", "f", "-name", filePattern.replace(/\*/g, "\\*").replace(/\?/g, "\\?"));
		return args;
	}

	// 默认：使用 find 的 -path 参数
	args.push("-path", pattern.replace(/\*/g, "\\*").replace(/\?/g, "\\?"));
	return args;
}

export function createGlobTool(executor: Executor): AgentTool<typeof GlobToolSchema> {
	return {
		name: "glob",
		label: "Glob",
		description: "Find files matching a glob pattern. Returns list of file paths.",
		parameters: GlobToolSchema,
		execute: async (_toolCallId, params: GlobToolParams, _signal, _onUpdate) => {
			const { pattern, cwd } = params;
			try {
				// 构建目录检查
				const dirPath = cwd || ".";

				// 检查目录是否存在
				const checkResult = await executor.exec(`test -d "${dirPath}" && echo "exists" || echo "not_found"`);
				if (checkResult.stdout.trim() === "not_found") {
					return {
						content: [{ type: "text", text: `Directory not found: ${dirPath}` }],
						details: { error: "not_found" },
					};
				}

				// 使用 find 命令查找文件
				// 使用通配符扩展来匹配文件
				const findArgs = globToFindArgs(pattern);
				const command = `cd "${dirPath}" && find ${findArgs.join(" ")} 2>/dev/null | sort`;

				const result = await executor.exec(command);

				if (result.code !== 0 && !result.stdout) {
					return {
						content: [{ type: "text", text: `Error finding files: ${result.stderr}` }],
						details: { error: result.stderr },
					};
				}

				const files = result.stdout
					.split("\n")
					.map((f) => f.trim())
					.filter((f) => f.length > 0);

				if (files.length === 0) {
					return {
						content: [{ type: "text", text: `No files matching pattern: ${pattern}` }],
						details: { fileCount: 0 },
					};
				}

				return {
					content: [{ type: "text", text: files.join("\n") }],
					details: { fileCount: files.length },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}
