/**
 * Voice Manager
 *
 * TTS/STT 管理器，统一管理语音服务
 */

import type {
	VoiceConfig,
	TTSProvider,
	TTSOptions,
	TTSResult,
	STTProvider,
	STTOptions,
	STTResult,
} from "./types.js";
import { EdgeTTS, DashScopeTTS, WhisperSTT, DashScopeSTT } from "../../plugins/voice/providers/index.js";

// ============================================================================
// Voice Manager
// ============================================================================

/**
 * 语音管理器
 *
 * 统一管理 TTS 和 STT 服务提供商
 */
export class VoiceManager {
	private ttsProviders = new Map<string, TTSProvider>();
	private sttProviders = new Map<string, STTProvider>();
	private config: VoiceConfig;

	constructor(config: VoiceConfig = {}) {
		this.config = config;
		this.registerDefaultProviders();
	}

	/**
	 * 注册默认提供商
	 */
	private registerDefaultProviders(): void {
		// 注册 Edge TTS（免费）
		this.registerTTS(new EdgeTTS());

		// 注册 DashScope TTS（阿里云）
		this.registerTTS(new DashScopeTTS());

		// 注册 Whisper STT（支持本地和 API）
		this.registerSTT(
			new WhisperSTT({
				apiKey: process.env.OPENAI_API_KEY,
			})
		);

		// 注册 DashScope STT（阿里云）
		this.registerSTT(new DashScopeSTT());
	}

	/**
	 * 注册 TTS 提供商
	 */
	registerTTS(provider: TTSProvider): void {
		this.ttsProviders.set(provider.name, provider);
	}

	/**
	 * 注册 STT 提供商
	 */
	registerSTT(provider: STTProvider): void {
		this.sttProviders.set(provider.name, provider);
	}

	/**
	 * 获取 TTS 提供商
	 */
	getTTSProvider(name?: string): TTSProvider {
		const providerName = name || this.config.tts?.provider || "edge";
		const provider = this.ttsProviders.get(providerName);
		if (!provider) {
			throw new Error(`TTS provider not found: ${providerName}`);
		}
		return provider;
	}

	/**
	 * 获取 STT 提供商
	 */
	getSTTProvider(name?: string): STTProvider {
		const providerName = name || this.config.stt?.provider || "whisper";
		const provider = this.sttProviders.get(providerName);
		if (!provider) {
			throw new Error(`STT provider not found: ${providerName}`);
		}
		return provider;
	}

	/**
	 * 获取所有 TTS 提供商
	 */
	getTTSProviders(): TTSProvider[] {
		return Array.from(this.ttsProviders.values());
	}

	/**
	 * 获取所有 STT 提供商
	 */
	getSTTProviders(): STTProvider[] {
		return Array.from(this.sttProviders.values());
	}

	/**
	 * 获取所有 TTS 音色
	 */
	getAllVoices() {
		const voices: { provider: string; voice: string; name: string; description?: string }[] = [];
		for (const [name, provider] of this.ttsProviders) {
			for (const voice of provider.voices) {
				voices.push({
					provider: name,
					voice: voice.id,
					name: voice.name,
					description: voice.description,
				});
			}
		}
		return voices;
	}

	/**
	 * 文字转语音
	 */
	async synthesize(options: TTSOptions & { provider?: string }): Promise<TTSResult> {
		const { provider: providerName, ...ttsOptions } = options;
		const provider = this.getTTSProvider(providerName);

		// 应用默认配置
		if (!ttsOptions.voice && this.config.tts?.defaultVoice) {
			ttsOptions.voice = this.config.tts.defaultVoice;
		}
		if (!ttsOptions.speed && this.config.tts?.defaultSpeed) {
			ttsOptions.speed = this.config.tts.defaultSpeed;
		}

		return await provider.synthesize(ttsOptions);
	}

	/**
	 * 语音转文字
	 */
	async transcribe(options: STTOptions & { provider?: string }): Promise<STTResult> {
		const { provider: providerName, ...sttOptions } = options;
		const provider = this.getSTTProvider(providerName);

		// 应用默认配置
		if (!sttOptions.language && this.config.stt?.defaultLanguage) {
			sttOptions.language = this.config.stt.defaultLanguage;
		}

		return await provider.transcribe(sttOptions);
	}

	/**
	 * 快速文字转语音（简化接口）
	 */
	async speak(text: string, voice?: string, outputPath?: string): Promise<TTSResult> {
		return this.synthesize({
			text,
			voice,
			outputPath,
			format: "opus", // 默认使用 opus 格式，适合飞书
		});
	}

	/**
	 * 快速语音转文字（简化接口）
	 */
	async listen(audioPath: string, language?: string): Promise<string> {
		const result = await this.transcribe({
			audioPath,
			language,
		});
		return result.text;
	}
}

// ============================================================================
// Singleton
// ============================================================================

let globalVoiceManager: VoiceManager | null = null;

/**
 * 获取全局 VoiceManager 实例
 */
export function getVoiceManager(config?: VoiceConfig): VoiceManager {
	if (!globalVoiceManager) {
		globalVoiceManager = new VoiceManager(config);
	}
	return globalVoiceManager;
}

/**
 * 设置全局 VoiceManager 实例
 */
export function setVoiceManager(manager: VoiceManager): void {
	globalVoiceManager = manager;
}
