/**
 * Voice Types
 *
 * TTS/STT 类型定义
 */

// ============================================================================
// TTS Types
// ============================================================================

/**
 * TTS 选项
 */
export interface TTSOptions {
	/** 要合成的文本 */
	text: string;
	/** 音色/声音 ID */
	voice?: string;
	/** 语速 (0.5 - 2.0，默认 1.0) */
	speed?: number;
	/** 音调 (0.5 - 2.0，默认 1.0) */
	pitch?: number;
	/** 音量 (0.0 - 2.0，默认 1.0) */
	volume?: number;
	/** 输出文件路径 */
	outputPath?: string;
	/** 音频格式 */
	format?: "mp3" | "wav" | "ogg" | "opus";
}

/**
 * TTS 结果
 */
export interface TTSResult {
	/** 音频文件路径 */
	audioPath: string;
	/** 音频时长（毫秒） */
	duration: number;
	/** 音频格式 */
	format: string;
}

/**
 * TTS 提供商接口
 */
export interface TTSProvider {
	/** 提供商名称 */
	readonly name: string;
	/** 支持的音色列表 */
	readonly voices: TTSVoice[];
	/** 合成语音 */
	synthesize(options: TTSOptions): Promise<TTSResult>;
}

/**
 * TTS 音色信息
 */
export interface TTSVoice {
	/** 音色 ID */
	id: string;
	/** 音色名称 */
	name: string;
	/** 性别 */
	gender?: "male" | "female" | "neutral";
	/** 语言 */
	language?: string;
	/** 描述 */
	description?: string;
}

// ============================================================================
// STT Types
// ============================================================================

/**
 * STT 选项
 */
export interface STTOptions {
	/** 音频文件路径 */
	audioPath: string;
	/** 语言代码 (如 "zh", "en") */
	language?: string;
	/** 是否启用标点 */
	punctuation?: boolean;
	/** 是否启用说话人分离 */
	diarization?: boolean;
}

/**
 * STT 结果
 */
export interface STTResult {
	/** 识别文本 */
	text: string;
	/** 置信度 (0-1) */
	confidence?: number;
	/** 分段结果 */
	segments?: STTSegment[];
}

/**
 * STT 分段结果
 */
export interface STTSegment {
	/** 文本内容 */
	text: string;
	/** 开始时间（毫秒） */
	startTime: number;
	/** 结束时间（毫秒） */
	endTime: number;
	/** 说话人 ID（如果启用了说话人分离） */
	speaker?: string;
	/** 置信度 */
	confidence?: number;
}

/**
 * STT 提供商接口
 */
export interface STTProvider {
	/** 提供商名称 */
	readonly name: string;
	/** 支持的语言列表 */
	readonly languages: string[];
	/** 识别音频 */
	transcribe(options: STTOptions): Promise<STTResult>;
}

// ============================================================================
// Voice Config
// ============================================================================

/**
 * 语音配置
 */
export interface VoiceConfig {
	/** TTS 配置 */
	tts?: {
		/** 默认提供商 */
		provider?: string;
		/** 默认音色 */
		defaultVoice?: string;
		/** 默认语速 */
		defaultSpeed?: number;
	};
	/** STT 配置 */
	stt?: {
		/** 默认提供商 */
		provider?: string;
		/** 默认语言 */
		defaultLanguage?: string;
	};
}
