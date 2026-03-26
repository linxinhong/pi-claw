/**
 * File Message Converter
 *
 * 文件消息转换器
 */

import type { Attachment } from "../../../../../core/platform/message.js";
import type { FeishuMessageContext } from "../../../types.js";
import type { FeishuStore } from "../../../store.js";

/**
 * 转换文件消息
 * 
 * 下载文件到本地，但不自动处理，而是返回文件信息等待用户决策
 */
export async function convertFileMessage(
	content: string,
	context: FeishuMessageContext,
	store: FeishuStore
): Promise<{ content: string; attachments?: Attachment[] }> {
	try {
		const body = JSON.parse(content);
		const fileKey = body.file_key;
		const fileName = body.file_name || "unknown";

		console.log(`[FileConverter] Received file message: ${fileName}, key: ${fileKey}`);

		if (!fileKey) {
			console.log(`[FileConverter] No file_key found`);
			return { content: `[文件: ${fileName}]` };
		}

		// 下载文件到本地
		const timestamp = context.timestamp.toISOString().replace(/[:.]/g, "-");
		console.log(`[FileConverter] Starting download: ${fileName}`);
		
		const localPath = await store.downloadFile({
			fileKey,
			channelId: context.chatId,
			timestamp,
			fileName,
			messageId: context.messageId,  // 传递 message_id 使用 messageResource API
		});

		if (!localPath) {
			console.error(`[FileConverter] Download returned null: ${fileName}`);
			// 返回特殊标记，提示需要文件权限
			return { 
				content: `[文件: ${fileName}]\n\n⚠️ **无法下载文件**：应用缺少文件读取权限（im:resource）。\n\n请前往飞书开发者后台开通权限：\n1. 打开 https://open.feishu.cn/app/cli_a93bdf008f389bcb\n2. 进入「权限管理」\n3. 添加「im:resource」权限\n4. 重新授权应用`,
			};
		}

		console.log(`[FileConverter] Download successful: ${localPath}`);

		// 获取文件信息（大小、类型等）
		const fs = await import("fs");
		const stats = fs.statSync(localPath);
		const fileSize = formatFileSize(stats.size);
		const fileType = getFileType(fileName);
		const isText = isTextFile(fileName) ? "文本" : "二进制";

		// 返回文件信息，不返回 attachments，等待用户决策
		const fileInfo = `📎 **收到文件**

- **文件名**：${fileName}
- **类型**：${fileType}
- **大小**：${fileSize}
- **格式**：${isText}
- **路径**：${localPath}

请告诉我如何处理这个文件：
- 「读取内容」- 读取文件内容
- 「总结文件」- 总结文件要点
- 「转换为xxx」- 转换为其他格式
- 或其他处理方式`;

		return {
			content: fileInfo,
			// 不返回 attachments，防止 AI 自动处理
		};
	} catch (error: any) {
		console.error(`[FileConverter] Failed to convert file message:`, error?.message || error);
		return { content: "[文件]" };
	}
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * 获取文件类型描述
 */
function getFileType(fileName: string): string {
	const ext = fileName.toLowerCase().split(".").pop() || "";
	const typeMap: Record<string, string> = {
		"pdf": "PDF 文档",
		"doc": "Word 文档",
		"docx": "Word 文档",
		"xls": "Excel 表格",
		"xlsx": "Excel 表格",
		"ppt": "PPT 演示文稿",
		"pptx": "PPT 演示文稿",
		"txt": "文本文件",
		"md": "Markdown 文档",
		"json": "JSON 数据",
		"csv": "CSV 表格",
		"js": "JavaScript 代码",
		"ts": "TypeScript 代码",
		"py": "Python 代码",
		"html": "HTML 文档",
		"css": "CSS 样式",
		"png": "PNG 图片",
		"jpg": "JPEG 图片",
		"jpeg": "JPEG 图片",
		"gif": "GIF 图片",
		"mp4": "视频文件",
		"mp3": "音频文件",
		"zip": "ZIP 压缩包",
	};
	return typeMap[ext] || `${ext.toUpperCase()} 文件`;
}

/**
 * 判断是否为文本文件
 */
function isTextFile(fileName: string): boolean {
	const textExtensions = new Set([
		"txt", "md", "json", "yaml", "yml", "xml", "csv",
		"js", "ts", "jsx", "tsx", "py", "java", "go", "rs",
		"html", "htm", "css", "scss", "less", "sql", "sh",
		"conf", "config", "ini", "properties", "env", "log",
	]);
	const ext = fileName.toLowerCase().split(".").pop() || "";
	return textExtensions.has(ext);
}
