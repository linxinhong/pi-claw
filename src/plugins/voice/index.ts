/**
 * Voice Plugin - 语音插件
 *
 * 提供 TTS（文字转语音）和 ASR（语音识别）功能
 * 这是一个通用插件，可以在任何支持语音消息的平台上使用
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { existsSync, readFileSync } from "fs";
import OpenAI from "openai";
import { homedir } from "os";
import { join } from "path";
import type { Plugin, PluginContext, MessageEvent, PluginInitContext } from "../../core/plugin/types.js";
import { CAPABILITIES } from "../../core/plugin/types.js";
import * as log from "../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

interface VoiceConfig {
	defaultVoice?: string;
}

// ============================================================================
// ASR (Speech Recognition)
// ============================================================================

interface ModelsConfig {
	providers?: {
		dashscope?: { apiKey?: string };
		bailian?: { apiKey?: string };
		aliyun?: { apiKey?: string; baseUrl?: string };
	};
}

class SpeechRecognizer {
	private apiKey: string;
	private baseUrl: string;

	constructor() {
		const config = this.getConfig();
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl;
	}

	private getConfig(): { apiKey: string; baseUrl: string } {
		const envKey = process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_API_KEY;
		if (envKey) {
			return {
				apiKey: envKey,
				baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			};
		}

		try {
			const modelsPath = join(homedir(), ".pi", "agent", "models.json");
			if (existsSync(modelsPath)) {
				const content = readFileSync(modelsPath, "utf-8");
				const config = JSON.parse(content) as ModelsConfig;

				const dashscopeKey = config?.providers?.dashscope?.apiKey;
				if (dashscopeKey) {
					return { apiKey: dashscopeKey, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
				}

				const aliyunConfig = config?.providers?.aliyun;
				if (aliyunConfig?.apiKey) {
					return { apiKey: aliyunConfig.apiKey, baseUrl: aliyunConfig.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1" };
				}

				const bailianKey = config?.providers?.bailian?.apiKey;
				if (bailianKey) {
					return { apiKey: bailianKey, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
				}
			}
		} catch {}

		return { apiKey: "", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
	}

	async recognize(opusFilePath: string): Promise<string | null> {
		if (!this.apiKey) return null;

		try {
			const audioData = readFileSync(opusFilePath).toString("base64");

			const client = new OpenAI({
				apiKey: this.apiKey,
				baseURL: this.baseUrl,
			});

			const completion = await client.chat.completions.create({
				model: "qwen3-asr-flash",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "input_audio",
								input_audio: { data: `data:audio/opus;base64,${audioData}` },
							},
						],
					},
				] as any,
				extra_body: { asr_options: { language: "zh", enable_itn: false } },
			} as any);

			return completion.choices[0].message.content || null;
		} catch (error) {
			log.logWarning("[ASR] Failed to transcribe audio", error);
			return null;
		}
	}
}

// ============================================================================
// Tool Schemas
// ============================================================================

const TTSSchema = Type.Object({
	text: Type.String({ description: "Text to convert to speech" }),
	voice: Type.Optional(Type.String({ description: "Voice name (default: Cherry)" })),
	label: Type.String({ description: "Short label shown to user" }),
});
type TTSParams = Static<typeof TTSSchema>;

const VoiceSchema = Type.Object({
	file_path: Type.String({ description: "Path to the audio file" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type VoiceParams = Static<typeof VoiceSchema>;

const TranscribeSchema = Type.Object({
	file_path: Type.String({ description: "Path to the audio file" }),
	label: Type.String({ description: "Short label shown to user" }),
});
type TranscribeParams = Static<typeof TranscribeSchema>;

// ============================================================================
// Tools
// ============================================================================

function createTTSTool(
	context: PluginContext,
	defaultVoice: string,
	sendVoiceMessage: (filePath: string) => Promise<string>
): AgentTool<typeof TTSSchema> {
	return {
		name: "tts",
		label: "TTS",
		description: "Convert text to speech and send as voice message. This is the ONLY way to generate voice messages.",
		parameters: TTSSchema,
		execute: async (_toolCallId, params: TTSParams, _signal, _onUpdate) => {
			const { text, voice = defaultVoice } = params;
			try {
				// 使用 edge-tts 生成语音
				const { exec } = await import("child_process");
				const { promisify } = await import("util");
				const { join } = await import("path");
				const { existsSync, mkdirSync } = await import("fs");

				const execAsync = promisify(exec);
				const scratchDir = join(context.channelDir, "scratch");
				if (!existsSync(scratchDir)) mkdirSync(scratchDir, { recursive: true });

				const outputPath = join(scratchDir, `tts_${Date.now()}.mp3`);

				// 使用 edge-tts 命令行工具
				await execAsync(`edge-tts --voice "${voice}" --text "${text.replace(/"/g, '\\"')}" --write-media "${outputPath}"`);

				// 发送语音消息
				await sendVoiceMessage(outputPath);

				return {
					content: [{ type: "text", text: `Voice message sent (${text.length} characters)` }],
					details: { outputPath, voice },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}

function createVoiceTool(sendVoiceMessage: (filePath: string) => Promise<string>): AgentTool<typeof VoiceSchema> {
	return {
		name: "voice",
		label: "Voice",
		description: "Send an existing audio file as voice message. Use when you already have an audio file.",
		parameters: VoiceSchema,
		execute: async (_toolCallId, params: VoiceParams, _signal, _onUpdate) => {
			const { file_path } = params;
			try {
				await sendVoiceMessage(file_path);
				return {
					content: [{ type: "text", text: `Voice message sent from ${file_path}` }],
					details: { filePath: file_path },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}

function createTranscribeTool(recognizer: SpeechRecognizer): AgentTool<typeof TranscribeSchema> {
	return {
		name: "transcribe",
		label: "Transcribe",
		description: "Transcribe an audio file to text. Use when user explicitly asks to transcribe an audio file.",
		parameters: TranscribeSchema,
		execute: async (_toolCallId, params: TranscribeParams, _signal, _onUpdate) => {
			const { file_path } = params;
			try {
				const result = await recognizer.recognize(file_path);
				return {
					content: [{ type: "text", text: result || "Transcription failed or returned empty" }],
					details: { filePath: file_path, transcribed: !!result },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}

// ============================================================================
// Plugin
// ============================================================================

let speechRecognizer: SpeechRecognizer | null = null;

/**
 * Voice Plugin
 *
 * 通用语音插件，支持 TTS 和 ASR 功能
 * 需要平台支持 sendVoiceMessage 能力才能使用 TTS 功能
 */
export const voicePlugin: Plugin = {
	meta: {
		id: "voice",
		name: "Voice",
		version: "2.0.0",
		description: "TTS and ASR capabilities (cross-platform)",
		// 不限制平台，但需要语音能力
		supportedPlatforms: undefined,
		// 声明所需能力（可选，如果不支持语音，只会禁用 TTS 工具）
		requiredCapabilities: [], // 不强制要求，通过 hasCapability 动态检查
	},

	async init(context: PluginInitContext): Promise<void> {
		speechRecognizer = new SpeechRecognizer();
		const config = context.config as VoiceConfig;
		log.logInfo(`[Voice Plugin] Initialized with default voice: ${config.defaultVoice || "Cherry"}`);
	},

	async getTools(context: PluginContext): Promise<any[]> {
		const config = { defaultVoice: "Cherry" };
		const tools: AgentTool<any>[] = [];

		// 检查平台是否支持语音消息
		const hasVoiceCapability = context.capabilities.hasCapability(CAPABILITIES.SEND_VOICE_MESSAGE);

		if (hasVoiceCapability && context.capabilities.sendVoiceMessage) {
			// 平台支持语音，添加 TTS 和语音工具
			tools.push(createTTSTool(context, config.defaultVoice, context.capabilities.sendVoiceMessage));
			tools.push(createVoiceTool(context.capabilities.sendVoiceMessage));
			log.logInfo(`[Voice Plugin] Platform supports voice messages, TTS enabled`);
		} else {
			log.logWarning(
				`[Voice Plugin] Platform ${context.capabilities.platform} does not support voice messages, TTS disabled`
			);
		}

		// 转录工具不依赖平台能力，只要有 ASR API 即可
		if (speechRecognizer) {
			tools.push(createTranscribeTool(speechRecognizer));
		}

		return tools;
	},

	async preprocessMessage(event: MessageEvent, context: PluginContext): Promise<MessageEvent | null> {
		// 检查是否有音频附件需要自动转录
		// 注意：音频转录现在在 FeishuBot 中处理
		return event;
	},
};
