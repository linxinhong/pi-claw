/**
 * Voice Plugin
 *
 * 统一的语音插件，提供 TTS 和 STT 功能
 */

import type { Plugin, PluginContext, PluginInitContext } from "../../core/plugin/types.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, Static } from "@sinclair/typebox";
import * as log from "../../utils/logger/index.js";
import { DashScopeTTS, EdgeTTS } from "./providers/index.js";
import type { TTSProvider, STTProvider } from "../../core/voice/types.js";

// ============================================================================
// Types
// ============================================================================

const TTSSchema = Type.Object({
	text: Type.String({ description: "Text to convert to speech" }),
	voice: Type.Optional(Type.String({ description: "Voice ID (default: Cherry for DashScope, zh-CN-XiaoxiaoNeural for Edge)" })),
	provider: Type.Optional(Type.String({ description: "TTS provider: 'dashscope' (default) or 'edge'", default: "dashscope" })),
	label: Type.String({ description: "Short label shown to user" }),
});
type TTSParams = Static<typeof TTSSchema>;

const TranscribeSchema = Type.Object({
	file_path: Type.String({ description: "Path to the audio file" }),
	provider: Type.Optional(Type.String({ description: "STT provider: 'dashscope' (default) or 'whisper'", default: "dashscope" })),
	language: Type.Optional(Type.String({ description: "Language code, e.g., 'zh', 'en'", default: "zh" })),
	label: Type.String({ description: "Short label shown to user" }),
});
type TranscribeParams = Static<typeof TranscribeSchema>;

// ============================================================================
// Plugin
// ============================================================================

export const voicePlugin: Plugin = {
	meta: {
		id: "voice",
		name: "Voice",
		version: "2.0.0",
		description: "TTS and STT capabilities via unified providers",
		supportedPlatforms: undefined, // All platforms
		requiredCapabilities: [],
	},

	async init(_context: PluginInitContext): Promise<void> {
		log.logInfo("[Voice Plugin] Initialized");
	},

	async getTools(context: PluginContext): Promise<AgentTool<any>[]> {
		const tools: AgentTool<any>[] = [];
		const sendVoiceMessage = context.capabilities.sendVoiceMessage;

		// TTS Tool - only if platform supports voice messages
		if (sendVoiceMessage) {
			tools.push({
				name: "speak",
				label: "🔊 Text to Speech",
				description: "Convert text to speech and send as voice message. Use this to reply with voice.",
				parameters: TTSSchema,
				execute: async (_id, params: TTSParams) => {
					try {
						const { text, voice, provider = "dashscope" } = params;
						const { tmpdir } = await import("os");
						const { join } = await import("path");

						// Select provider
						const ttsProvider: TTSProvider = provider === "edge" ? new EdgeTTS() : new DashScopeTTS();
						const defaultVoice = provider === "edge" ? "zh-CN-XiaoxiaoNeural" : "Cherry";

						// Generate speech
						const outputPath = join(tmpdir(), `tts-${Date.now()}.wav`);
						const result = await ttsProvider.synthesize({
							text,
							voice: voice || defaultVoice,
							outputPath,
							format: "wav",
						});

						// Send voice message
						await sendVoiceMessage(result.audioPath);

						return {
							content: [{ type: "text", text: `Voice sent (${Math.round(result.duration / 1000)}s)` }],
							details: { duration: result.duration },
						};
					} catch (error: any) {
						return {
							content: [{ type: "text", text: `TTS failed: ${error.message}` }],
							details: { error: error.message },
						};
					}
				},
			});
		}

		// STT Tool - always available for transcribing audio files
		tools.push({
			name: "transcribe",
			label: "📝 Transcribe Audio",
			description: "Transcribe an audio file to text. Use when user sends an audio file (not voice message).",
			parameters: TranscribeSchema,
			execute: async (_id, params: TranscribeParams) => {
				try {
					const { file_path, provider = "dashscope", language = "zh" } = params;
					
					// Import providers dynamically
					const { DashScopeSTT, WhisperSTT } = await import("./providers/index.js");
					const sttProvider: STTProvider = provider === "whisper" ? new WhisperSTT() : new DashScopeSTT();

					const result = await sttProvider.transcribe({
						audioPath: file_path,
						language,
					});

					return {
						content: [{ type: "text", text: result.text }],
						details: { confidence: result.confidence },
					};
				} catch (error: any) {
					return {
						content: [{ type: "text", text: `Transcription failed: ${error.message}` }],
						details: { error: error.message },
					};
				}
			},
		});

		return tools;
	},
};
