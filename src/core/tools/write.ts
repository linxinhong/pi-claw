/**
 * Write Tool - 写入文件
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Executor } from "../sandbox/index.js";

const WriteToolSchema = Type.Object({
	path: Type.String({ description: "File path to write (relative to workspace or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
	label: Type.String({ description: "Short label shown to user" }),
	encoding: Type.Optional(Type.Union([Type.Literal("utf8"), Type.Literal("base64")], { description: "Content encoding (utf8 or base64, default: utf8)" })),
});

type WriteToolParams = Static<typeof WriteToolSchema>;

export function createWriteTool(executor: Executor): AgentTool<typeof WriteToolSchema> {
	return {
		name: "write",
		label: "Write",
		description: "Create or overwrite a file with content. Supports both text and binary (base64) content.",
		parameters: WriteToolSchema,
		execute: async (_toolCallId, params: WriteToolParams, _signal, _onUpdate) => {
			const { path, content, encoding = "utf8" } = params;
			try {
				// 创建目录
				const dirPath = path.substring(0, path.lastIndexOf("/"));
				if (dirPath) {
					await executor.exec(`mkdir -p "${dirPath}"`);
				}

				let command: string;
				if (encoding === "base64") {
					// base64 解码后写入文件
					command = `echo "${content}" | base64 -d > "${path}"`;
				} else {
					// 使用 heredoc 写入文件，处理特殊字符
					command = `cat > "${path}" << 'PMF_EOF'\n${content}\nPMF_EOF`;
				}

				const result = await executor.exec(command);

				if (result.code !== 0) {
					return {
						content: [{ type: "text", text: `Error writing file: ${result.stderr}` }],
						details: { error: result.stderr, exitCode: result.code },
					};
				}

				// 获取实际写入的文件大小
				const sizeResult = await executor.exec(`wc -c < "${path}"`);
				const bytesWritten = parseInt(sizeResult.stdout.trim(), 10) || content.length;

				return {
					content: [{ type: "text", text: `Wrote ${bytesWritten} bytes to ${path} (encoding: ${encoding})` }],
					details: { path, bytesWritten, encoding },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error writing file: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}
