/**
 * Text Message Converter
 *
 * 文本消息转换器
 */

import type { Attachment } from "../../../../../core/platform/message.js";

/**
 * 转换文本消息
 */
export function convertTextMessage(content: string): { content: string; attachments?: Attachment[] } {
	// 尝试解析 JSON
	try {
		const body = JSON.parse(content);
		const text = body.text || content;
		return { content: text };
	} catch {
		return { content };
	}
}
