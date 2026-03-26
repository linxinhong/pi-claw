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
		});

		if (!localPath) {
			console.error(`[FileConverter] Download returned null: ${fileName}`);
			// 返回特殊标记，提示需要文件权限
			return { 
				content: `[文件: ${fileName}]\n\n⚠️ **无法下载文件**：应用缺少文件读取权限（im:resource）。\n\n请前往飞书开发者后台开通权限：\n1. 打开 https://open.feishu.cn/app/cli_a93bdf008f389bcb\n2. 进入「权限管理」\n3. 添加「im:resource」权限\n4. 重新授权应用`,
			};
		}

		console.log(`[FileConverter] Download successful: ${localPath}`);

		const attachments: Attachment[] = [
			{
				name: fileName,
				originalId: fileKey,
				localPath,
				type: "file",
			},
		];

		return {
			content: `[文件: ${fileName}]`,
			attachments,
		};
	} catch (error: any) {
		console.error(`[FileConverter] Failed to convert file message:`, error?.message || error);
		return { content: "[文件]" };
	}
}
