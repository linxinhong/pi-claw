/**
 * TTS Engine
 * 
 * 文本转语音引擎，支持 Web Speech API 和自定义引擎
 */

import type { TTSEngine, TTSConfig } from "./types.js";

// ============================================================================
// Web Speech TTS
// ============================================================================

export class WebSpeechTTSEngine implements TTSEngine {
  private synthesis: SpeechSynthesis;
  private utterance: SpeechSynthesisUtterance | null = null;
  private speaking = false;
  private paused = false;

  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;

  constructor() {
    this.synthesis = window.speechSynthesis;
  }

  async speak(text: string, config?: Partial<TTSConfig>): Promise<void> {
    return new Promise((resolve, reject) => {
      // 取消之前的语音
      this.stop();

      // 创建新的 utterance
      const SpeechSynthesisUtteranceClass = (globalThis as any).SpeechSynthesisUtterance;
      this.utterance = new SpeechSynthesisUtteranceClass(text);

      // 应用配置
      if (config?.voice) {
        const voices = this.synthesis.getVoices();
        const voice = voices.find((v: SpeechSynthesisVoice) => v.name === config.voice);
        if (voice) {
          this.utterance!.voice = voice;
        }
      }

      this.utterance!.rate = config?.rate ?? 1;
      this.utterance!.pitch = config?.pitch ?? 1;
      this.utterance!.volume = config?.volume ?? 1;

      // 事件监听
      this.utterance!.onstart = () => {
        this.speaking = true;
        this.paused = false;
        this.onStart?.();
      };

      this.utterance!.onend = () => {
        this.speaking = false;
        this.paused = false;
        this.onEnd?.();
        resolve();
      };

      this.utterance!.onerror = (event: SpeechSynthesisErrorEvent) => {
        this.speaking = false;
        const error = new Error(`Speech synthesis error: ${event.error}`);
        this.onError?.(error);
        reject(error);
      };

      // 开始播放
      this.synthesis.speak(this.utterance!);
    });
  }

  stop(): void {
    this.synthesis.cancel();
    this.speaking = false;
    this.paused = false;
    this.utterance = null;
  }

  pause(): void {
    if (this.speaking && !this.paused) {
      this.synthesis.pause();
      this.paused = true;
    }
  }

  resume(): void {
    if (this.speaking && this.paused) {
      this.synthesis.resume();
      this.paused = false;
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * 获取可用语音列表
   */
  static getVoices(): SpeechSynthesisVoice[] {
    return window.speechSynthesis.getVoices();
  }
}

// ============================================================================
// Dashscope TTS (阿里云)
// ============================================================================

export interface DashscopeTTSConfig {
  apiKey: string;
  model?: string;
  voice?: string;
}

export class DashscopeTTSEngine implements TTSEngine {
  private config: DashscopeTTSConfig;
  private audio: HTMLAudioElement | null = null;
  private speaking = false;

  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;

  constructor(config: DashscopeTTSConfig) {
    this.config = {
      model: "sambert-zhichu-v1",
      voice: "zhichu",
      ...config,
    };
  }

  async speak(text: string, config?: Partial<TTSConfig>): Promise<void> {
    try {
      // 调用 Dashscope API
      const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/text2speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: { text },
          parameters: {
            voice: config?.voice || this.config.voice,
            rate: config?.rate,
            pitch: config?.pitch,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Dashscope API error: ${response.status}`);
      }

      const data = await response.json() as { output?: { audio_url?: string }; audio_url?: string };
      const audioUrl = data.output?.audio_url || data.audio_url;

      if (!audioUrl) {
        throw new Error("No audio URL in response");
      }

      // 播放音频
      await this.playAudio(audioUrl);
    } catch (error) {
      this.onError?.(error as Error);
      throw error;
    }
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.speaking = false;
  }

  pause(): void {
    if (this.audio && this.speaking) {
      this.audio.pause();
    }
  }

  resume(): void {
    if (this.audio) {
      this.audio.play();
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  private playAudio(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const AudioClass = (globalThis as any).Audio;
      this.audio = new AudioClass(url);

      this.audio!.onplay = () => {
        this.speaking = true;
        this.onStart?.();
      };

      this.audio!.onended = () => {
        this.speaking = false;
        this.onEnd?.();
        resolve();
      };

      this.audio!.onerror = (_error: ErrorEvent) => {
        this.speaking = false;
        const err = new Error("Audio playback error");
        this.onError?.(err);
        reject(err);
      };

      this.audio!.play();
    });
  }
}

// ============================================================================
// TTS Engine Factory
// ============================================================================

export function createTTSEngine(config: TTSConfig): TTSEngine {
  const engine = config.engine || "web-speech";

  switch (engine) {
    case "web-speech":
      return new WebSpeechTTSEngine();
    
    case "dashscope":
      if (!(config as any).apiKey) {
        throw new Error("Dashscope TTS requires apiKey");
      }
      return new DashscopeTTSEngine({
        apiKey: (config as any).apiKey,
        model: (config as any).model,
        voice: (config as any).voice,
      });
    
    case "custom":
      if (!config.customEngine) {
        throw new Error("Custom TTS engine not provided");
      }
      return config.customEngine;
    
    default:
      throw new Error(`Unknown TTS engine: ${engine}`);
  }
}
