/**
 * Send File Tool
 *
 * AI 工具：发送文件到飞书聊天
 */

import type { PlatformTool } from "../../../core/platform/tools/types.js";
import type { FeishuPlatformContext } from "../context.js";
import { existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";

/**
 * 创建发送文件工具
 */
export function createSendFileTool(context: FeishuPlatformContext): PlatformTool {
	return {
		name: "send_file",
		label: "📎 发送文件",
		description: "发送文件到当前聊天。支持 PDF、DOC、XLS、PPT 等常见格式。文件将显示为可下载附件。",
		parameters: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description: "要发送的文件路径（绝对路径）",
				},
				description: {
					type: "string",
					description: "文件描述（可选，显示在文件下方）",
				},
			},
			required: ["file_path"],
		},
		platformMeta: {
			platform: "feishu",
			category: "file",
			localName: "send",
		},
		execute: async (_toolCallId: string, params: any) => {
			try {
				let { file_path, description } = params;
				const chatId = context["chatId"];

				// 去除路径中的多余空格和引号
				file_path = file_path.trim().replace(/^["']|["']$/g, "");
				
				// 解析为绝对路径（支持中文路径）
				file_path = resolve(file_path);

				// 检查文件是否存在
				if (!existsSync(file_path)) {
					return {
						content: [{ type: "text", text: `文件不存在: ${file_path}` }],
						details: { success: false, error: "File not found", file_path },
					};
				}

				// 上传并发送文件
				await context.uploadFile(file_path, chatId);

				// 如果有描述，再发送一条文本消息
				if (description) {
					await context.sendText(chatId, description);
				}

				return {
					content: [{ type: "text", text: `文件已发送: ${file_path}` }],
					details: { success: true, file_path },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `发送文件失败: ${error?.message || String(error)}` }],
					details: { success: false, error: error?.message },
				};
			}
		},
	};
}
