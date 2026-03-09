/**
 * Post Message Converter
 *
 * 富文本消息转换器
 */

import type { Attachment } from "../../../../../core/platform/message.js";

interface PostElement {
	tag?: string;
	text?: string;
	content?: string;
	href?: string;
	user_id?: string;
	open_id?: string;
	[key: string]: any;
}

interface PostParagraph {
	(elements?: PostElement[]): any;
}

/**
 * 转换富文本消息
 */
export function convertPostMessage(content: string): { content: string; attachments?: Attachment[] } {
	try {
		const body = JSON.parse(content);

		// 飞书富文本格式：[[{elem1}, {elem2}], [{elem3}]]
		const paragraphs = body.content ? JSON.parse(body.content) : body;

		if (!Array.isArray(paragraphs)) {
			return { content: body.text || content };
		}

		const textParts: string[] = [];

		for (const paragraph of paragraphs) {
			if (!Array.isArray(paragraph)) {
				continue;
			}

			for (const element of paragraph) {
				const text = extractElementText(element);
				if (text) {
					textParts.push(text);
				}
			}

			// 段落间添加换行
			textParts.push("\n");
		}

		const text = textParts.join("").trim();
		return { content: text || "[富文本消息]" };
	} catch {
		return { content };
	}
}

/**
 * 提取元素文本
 */
function extractElementText(element: PostElement): string {
	switch (element.tag) {
		case "text":
			return element.text || "";

		case "a":
			return element.text || element.href || "";

		case "at":
			// @用户
			const userName = element.text || element.user_id || element.open_id || "";
			return userName ? `@${userName} ` : "";

		case "img":
			return "[图片]";

		case "media":
			return "[媒体]";

		case "file":
			return `[文件: ${element.text || "unknown"}]`;

		case "emoji":
			return element.text || "";

		default:
			return element.text || "";
	}
}
