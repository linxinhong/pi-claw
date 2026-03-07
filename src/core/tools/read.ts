/**
 * Read Tool - 读取文件
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Executor } from "../sandbox/index.js";

const ReadToolSchema = Type.Object({
	path: Type.String({ description: "File path to read (relative to workspace or absolute)" }),
	label: Type.String({ description: "Short label shown to user" }),
	encoding: Type.Optional(Type.Union([Type.Literal("utf8"), Type.Literal("base64")], { description: "File encoding (utf8 or base64, default: utf8)" })),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed, only for utf8)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read (only for utf8)" })),
});

type ReadToolParams = Static<typeof ReadToolSchema>;

// 常见二进制文件扩展名
const BINARY_EXTENSIONS = [
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
	".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
	".zip", ".tar", ".gz", ".rar", ".7z",
	".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
	".exe", ".dll", ".so", ".dylib",
	".woff", ".woff2", ".ttf", ".otf", ".eot",
];

function isBinaryFile(path: string): boolean {
	const ext = path.toLowerCase();
	return BINARY_EXTENSIONS.some((binExt) => ext.endsWith(binExt));
}

export function createReadTool(executor: Executor): AgentTool<typeof ReadToolSchema> {
	return {
		name: "read",
		label: "Read",
		description: "Read a file. Returns file contents. Supports text and binary files (images, PDFs, etc.).",
		parameters: ReadToolSchema,
		execute: async (_toolCallId, params: ReadToolParams, _signal, _onUpdate) => {
			const { path, encoding = "utf8", offset = 1, limit = 2000 } = params;

			// 先检查文件是否存在
			const checkResult = await executor.exec(`test -f "${path}" && echo "exists" || echo "not_found"`);
			if (checkResult.stdout.trim() === "not_found") {
				return {
					content: [{ type: "text", text: `File not found: ${path}` }],
					details: { error: "not_found" },
				};
			}

			// 检查是否是目录
			const dirCheck = await executor.exec(`test -d "${path}" && echo "is_dir" || echo "not_dir"`);
			if (dirCheck.stdout.trim() === "is_dir") {
				return {
					content: [{ type: "text", text: `Path is a directory, not a file: ${path}` }],
					details: { error: "is_directory" },
				};
			}

			// 自动检测二进制文件或使用指定的 base64 encoding
			const shouldUseBase64 = encoding === "base64" || isBinaryFile(path);

			if (shouldUseBase64) {
				// 以 base64 读取文件
				try {
					const result = await executor.exec(`base64 "${path}"`);
					if (result.code !== 0) {
						return {
							content: [{ type: "text", text: `Error reading file: ${result.stderr}` }],
							details: { error: result.stderr },
						};
					}

					// 检测 MIME 类型
					const mimeResult = await executor.exec(`file --mime-type -b "${path}"`);
					const mimeType = mimeResult.stdout.trim() || "application/octet-stream";

					return {
						content: [
							{
								type: "text",
								text: `File: ${path}\nMIME Type: ${mimeType}\nEncoding: base64\n\n${result.stdout}`,
							},
						],
						details: { encoding: "base64", mimeType, size: result.stdout.length },
					};
				} catch (error: any) {
					return {
						content: [{ type: "text", text: `Error reading file: ${error.message}` }],
						details: { error: error.message },
					};
				}
			}

			// UTF-8 文本模式读取
			try {
				// 使用 cat 命令读取文件，配合 sed/awk 处理分页
				const startLine = Math.max(1, offset);
				const endLine = limit ? startLine + limit - 1 : "";

				let command: string;
				if (limit) {
					command = `sed -n '${startLine},${endLine}p' "${path}" | cat -n`;
				} else {
					command = `sed -n '${startLine},\\$p' "${path}" | cat -n`;
				}

				const result = await executor.exec(command);
				let output = result.stdout;

				// 获取总行数
				const lineCountResult = await executor.exec(`wc -l < "${path}"`);
				const totalLines = parseInt(lineCountResult.stdout.trim(), 10);

				if (endLine && totalLines > endLine) {
					output += `\n\n... (${totalLines - endLine} more lines)`;
				}

				return {
					content: [{ type: "text", text: output || "(empty file)" }],
					details: { totalLines, linesRead: limit ? Math.min(limit, totalLines) : totalLines, encoding: "utf8" },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error reading file: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}
