/**
 * Voice Module
 *
 * TTS/STT 语音模块入口 - 保留类型和 Manager 供兼容性使用
 * 实际的 Providers 已移到 plugins/voice/providers/
 */

// Types
export type {
	VoiceConfig,
	TTSOptions,
	TTSResult,
	TTSProvider,
	TTSVoice,
	STTOptions,
	STTResult,
	STTProvider,
	STTSegment,
} from "./types.js";

// Manager - 保留供现有代码使用
export { VoiceManager, getVoiceManager, setVoiceManager } from "./manager.js";

// Utils
export {
	parseOggOpusDuration,
	parseWavDuration,
	estimateMp3Duration,
	parseAudioDuration,
	isValidAudioFile,
} from "../../adapters/feishu/utils/audio-utils.js";
