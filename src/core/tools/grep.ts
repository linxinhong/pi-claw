/**
 * Grep Tool - 内容搜索
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Executor } from "../sandbox/index.js";

const GrepToolSchema = Type.Object({
	pattern: Type.String({ description: "Pattern to search for (supports regex)" }),
	label: Type.String({ description: "Short label shown to user" }),
	path: Type.Optional(Type.String({ description: "File or directory to search in (default: current directory)" })),
	recursive: Type.Optional(Type.Boolean({ description: "Search recursively in directories (default: true)" })),
	caseInsensitive: Type.Optional(Type.Boolean({ description: "Case insensitive search (default: false)" })),
	maxResults: Type.Optional(Type.Number({ description: "Maximum number of results to return (default: 100)" })),
});

type GrepToolParams = Static<typeof GrepToolSchema>;

interface GrepMatch {
	file: string;
	line: number;
	content: string;
}

export function createGrepTool(executor: Executor): AgentTool<typeof GrepToolSchema> {
	return {
		name: "grep",
		label: "Grep",
		description: "Search for a pattern in files. Supports regular expressions.",
		parameters: GrepToolSchema,
		execute: async (_toolCallId, params: GrepToolParams, _signal, _onUpdate) => {
			const { pattern, path = ".", recursive = true, caseInsensitive = false, maxResults = 100 } = params;

			if (!pattern) {
				return {
					content: [{ type: "text", text: "Pattern is required" }],
					details: { error: "empty_pattern" },
				};
			}

			try {
				// 检查路径是否存在
				const checkResult = await executor.exec(`test -e "${path}" && echo "exists" || echo "not_found"`);
				if (checkResult.stdout.trim() === "not_found") {
					return {
						content: [{ type: "text", text: `Path not found: ${path}` }],
						details: { error: "not_found" },
					};
				}

				// 构建 grep 命令
				const grepFlags: string[] = ["-n"]; // 显示行号

				if (caseInsensitive) {
					grepFlags.push("-i");
				}

				if (recursive) {
					grepFlags.push("-r");
				}

				// 使用 -E 支持扩展正则表达式
				grepFlags.push("-E");

				// 限制结果数量
				const command = `grep ${grepFlags.join(" ")} "${escapeGrepPattern(pattern)}" "${path}" 2>/dev/null | head -n ${maxResults}`;

				const result = await executor.exec(command);

				// grep 返回 1 表示没有匹配，这不是错误
				if (result.code !== 0 && result.code !== 1) {
					return {
						content: [{ type: "text", text: `Error searching: ${result.stderr}` }],
						details: { error: result.stderr },
					};
				}

				if (!result.stdout.trim()) {
					return {
						content: [{ type: "text", text: `No matches found for pattern: ${pattern}` }],
						details: { matchCount: 0 },
					};
				}

				// 解析结果
				const matches: GrepMatch[] = [];
				const lines = result.stdout.split("\n").filter((l) => l.trim());

				for (const line of lines) {
					// 格式: file:line:content 或 file:content（如果不是递归）
					const colonIndex = line.indexOf(":");
					if (colonIndex === -1) continue;

					const afterFirstColon = line.slice(colonIndex + 1);
					const secondColonIndex = afterFirstColon.indexOf(":");
					if (secondColonIndex === -1) continue;

					const file = line.slice(0, colonIndex);
					const lineNum = parseInt(afterFirstColon.slice(0, secondColonIndex), 10);
					const content = afterFirstColon.slice(secondColonIndex + 1);

					if (!isNaN(lineNum)) {
						matches.push({ file, line: lineNum, content });
					}
				}

				// 格式化输出
				const output = matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join("\n");

				return {
					content: [{ type: "text", text: output }],
					details: { matchCount: matches.length, truncated: lines.length >= maxResults },
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

/**
 * 转义 grep 模式中的特殊字符
 */
function escapeGrepPattern(pattern: string): string {
	// 对于 -E 模式，需要转义这些字符: \ ^ $ . | ? * + ( ) [ ] { }
	// 但我们希望保留正则表达式功能，所以只转义可能导致命令注入的字符
	return pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}
