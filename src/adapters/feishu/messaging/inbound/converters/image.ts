/**
 * Image Message Converter
 *
 * 图片消息转换器
 */

import type { Attachment } from "../../../../../core/platform/message.js";
import type { FeishuMessageContext } from "../../../types.js";
import type { FeishuStore } from "../../../store.js";

/**
 * 转换图片消息
 */
export async function convertImageMessage(
	content: string,
	context: FeishuMessageContext,
	store: FeishuStore
): Promise<{ content: string; attachments?: Attachment[] }> {
	try {
		const body = JSON.parse(content);
		const imageKey = body.image_key;

		if (!imageKey) {
			return { content: "[图片]" };
		}

		// 下载图片到本地
		const timestamp = context.timestamp.toISOString().replace(/[:.]/g, "-");
		const localPath = await store.downloadImage({
			fileKey: imageKey,
			channelId: context.chatId,
			timestamp,
		});

		if (!localPath) {
			return { content: "[图片]" };
		}

		const attachments: Attachment[] = [
			{
				name: `image-${timestamp}.jpg`,
				originalId: imageKey,
				localPath,
				type: "image",
			},
		];

		return {
			content: "[图片]",
			attachments,
		};
	} catch (error) {
		return { content: "[图片]" };
	}
}
