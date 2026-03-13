/**
 * Audio Message Converter
 *
 * 语音消息转换器 - 解析飞书语音消息并执行语音识别
 */

import type { Attachment } from "../../../../../core/platform/message.js";
import type { FeishuMessageContext } from "../../../types.js";
import type { FeishuStore } from "../../../store.js";
import { VoiceManager } from "../../../../../core/voice/manager.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 音频资源描述符
 */
export interface AudioResource {
	/** 资源类型 */
	type: "audio";
	/** 飞书文件 key */
	fileKey: string;
	/** 音频时长（毫秒） */
	duration?: number;
}

/**
 * 飞书音频消息内容
 */
interface FeishuAudioContent {
	/** 文件 key */
	file_key: string;
	/** 音频时长（毫秒） */
	duration?: number;
}

// ============================================================================
// Audio Converter
// ============================================================================

/**
 * 解析音频消息内容
 */
function parseAudioContent(content: string): FeishuAudioContent | null {
	try {
		const parsed = JSON.parse(content);
		if (!parsed.file_key) {
			return null;
		}
		return {
			file_key: parsed.file_key,
			duration: parsed.duration,
		};
	} catch {
		return null;
	}
}

/**
 * 格式化时长显示
 */
function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
}

/**
 * 转换语音消息
 *
 * 1. 解析消息内容获取 file_key
 * 2. 下载音频文件到本地
 * 3. 使用 STT 进行语音识别
 * 4. 返回识别结果
 */
export async function convertAudioMessage(
	content: string,
	context: FeishuMessageContext,
	store: FeishuStore,
	options?: {
		sttProvider?: string;
		language?: string;
	}
): Promise<{ content: string; attachments?: Attachment[] }> {
	console.log("[Feishu Audio] Starting audio conversion, content:", content);
	
	// 解析音频消息内容
	const audioInfo = parseAudioContent(content);
	console.log("[Feishu Audio] Parsed audio info:", audioInfo);
	
	if (!audioInfo) {
		console.log("[Feishu Audio] Failed to parse audio content");
		return { content: "[语音消息]" };
	}

	const { file_key, duration } = audioInfo;
	const durationStr = duration ? formatDuration(duration) : "";

	// 下载音频文件
	const timestamp = context.timestamp.toISOString().replace(/[:.]/g, "-");
	const fileName = `audio-${timestamp}.mp3`;

	let localPath: string | null = null;
	try {
		localPath = await store.downloadFile({
			fileKey: file_key,
			channelId: context.chatId,
			timestamp,
			fileName,
		});
	} catch (error: any) {
		console.error("[Feishu] Failed to download audio:", error);
		
		// 检测权限错误 - 直接检查错误码 99991672
		const errorStr = JSON.stringify(error);
		const codeMatch = errorStr.match(/"code":\s*(99991672)/);
		const urlMatch = errorStr.match(/(https:\/\/open\.feishu\.cn\/app\/[^"\s]+)/);
		
		if (codeMatch && urlMatch) {
			// 提取权限列表
			const scopeMatch = errorStr.match(/\[([^\]]*contact:[^\]]*)\]/);
			const scopes = scopeMatch ? scopeMatch[1] : "im:resource";
			return {
				content: `[PERMISSION_ERROR:scopes=${scopes}:url=${urlMatch[1]}]`,
			};
		}
		
		return {
			content: durationStr
				? `[语音消息 ${durationStr} - 下载失败]`
				: "[语音消息 - 下载失败]",
		};
	}

	if (!localPath) {
		return {
			content: durationStr
				? `[语音消息 ${durationStr} - 下载失败]`
				: "[语音消息 - 下载失败]",
		};
	}

	// 执行语音识别
	const voiceManager = new VoiceManager();
	let recognizedText: string;

	try {
		const result = await voiceManager.transcribe({
			audioPath: localPath,
			language: options?.language || "zh",
			provider: options?.sttProvider,
		});
		recognizedText = result.text;
	} catch (error) {
		console.error("[Feishu] STT failed:", error);
		return {
			content: durationStr
				? `[语音消息 ${durationStr} - 识别失败]`
				: "[语音消息 - 识别失败]",
			attachments: [
				{
					name: fileName,
					originalId: file_key,
					localPath,
					type: "audio",
				},
			],
		};
	}

	// 构建返回内容
	const displayText = recognizedText.trim() || "[空语音]";
	const resultContent = durationStr
		? `[语音 ${durationStr}]: ${displayText}`
		: `[语音]: ${displayText}`;

	return {
		content: resultContent,
		attachments: [
			{
				name: fileName,
				originalId: file_key,
				localPath,
				type: "audio",
			},
		],
	};
}

/**
 * 同步解析语音消息（仅提取信息，不执行识别）
 *
 * 用于参考实现兼容模式，返回资源描述符供上层处理
 */
export function parseAudioMessage(content: string): {
	content: string;
	resources: AudioResource[];
} {
	const audioInfo = parseAudioContent(content);
	if (!audioInfo) {
		return { content: "[语音消息]", resources: [] };
	}

	const { file_key, duration } = audioInfo;
	const durationStr = duration ? formatDuration(duration) : "";

	return {
		content: durationStr
			? `[语音消息 ${durationStr}]`
			: "[语音消息]",
		resources: [
			{
				type: "audio",
				fileKey: file_key,
				duration,
			},
		],
	};
}
