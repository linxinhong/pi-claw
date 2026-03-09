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

		if (!fileKey) {
			return { content: `[文件: ${fileName}]` };
		}

		// 下载文件到本地
		const timestamp = context.timestamp.toISOString().replace(/[:.]/g, "-");
		const localPath = await store.downloadFile({
			fileKey,
			channelId: context.chatId,
			timestamp,
			fileName,
		});

		if (!localPath) {
			return { content: `[文件: ${fileName}]` };
		}

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
	} catch (error) {
		return { content: "[文件]" };
	}
}
