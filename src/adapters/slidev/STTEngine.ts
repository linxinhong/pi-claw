/**
 * STT Engine
 * 
 * 语音转文本引擎，支持 Web Speech API 和自定义引擎
 */

import type { STTEngine, STTConfig } from "./types.js";
import "./types.browser.js";

// ============================================================================
// Web Speech STT
// ============================================================================

export class WebSpeechSTTEngine implements STTEngine {
  private recognition: SpeechRecognition | null = null;
  private listening = false;
  private config: STTConfig;

  onResult?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onEnd?: () => void;

  constructor(config: STTConfig = {}) {
    this.config = {
      language: "zh-CN",
      continuous: true,
      interimResults: true,
      ...config,
    };

    this.initializeRecognition();
  }

  private initializeRecognition(): void {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      throw new Error("Web Speech API not supported in this browser");
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.config.language!;
    this.recognition.continuous = this.config.continuous!;
    this.recognition.interimResults = this.config.interimResults!;

    // 事件处理
    this.recognition.onstart = () => {
      this.listening = true;
      this.onStart?.();
    };

    this.recognition.onend = () => {
      this.listening = false;
      this.onEnd?.();

      // 如果设置为连续识别，自动重启
      if (this.config.continuous && this.listening) {
        this.start();
      }
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results;
      
      for (let i = event.resultIndex; i < results.length; i++) {
        const result = results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;

        this.onResult?.(transcript, isFinal);
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const error = new Error(`Speech recognition error: ${event.error}`);
      this.onError?.(error);

      // 某些错误可以自动恢复
      if (event.error === "no-speech" || event.error === "audio-capture") {
        // 短暂延迟后重启
        setTimeout(() => {
          if (this.listening) {
            this.start();
          }
        }, 1000);
      }
    };
  }

  start(): void {
    if (!this.recognition) {
      this.initializeRecognition();
    }

    try {
      this.recognition?.start();
    } catch (error) {
      // 如果已经在运行，先停止再启动
      if ((error as Error).message.includes("already started")) {
        this.stop();
        setTimeout(() => this.start(), 100);
      } else {
        throw error;
      }
    }
  }

  stop(): void {
    this.listening = false;
    this.recognition?.stop();
  }

  abort(): void {
    this.listening = false;
    this.recognition?.abort();
  }

  isListening(): boolean {
    return this.listening;
  }
}

// ============================================================================
// Mock STT Engine (for testing)
// ============================================================================

export class MockSTTEngine implements STTEngine {
  private listening = false;
  private interval: number | null = null;

  onResult?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onEnd?: () => void;

  start(): void {
    this.listening = true;
    this.onStart?.();

    // 模拟识别结果
    let count = 0;
    const mockTexts = [
      "你好",
      "你好，请",
      "你好，请问",
      "你好，请问下一页",
    ];

    this.interval = window.setInterval(() => {
      if (count < mockTexts.length) {
        const isFinal = count === mockTexts.length - 1;
        this.onResult?.(mockTexts[count], isFinal);
        count++;
      } else {
        this.stop();
      }
    }, 500);
  }

  stop(): void {
    this.listening = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.onEnd?.();
  }

  abort(): void {
    this.stop();
  }

  isListening(): boolean {
    return this.listening;
  }
}

// ============================================================================
// STT Engine Factory
// ============================================================================

export function createSTTEngine(config?: STTConfig): STTEngine {
  const engine = config?.engine || "web-speech";

  switch (engine) {
    case "web-speech":
      return new WebSpeechSTTEngine(config);
    
    case "custom":
      if (!config?.customEngine) {
        throw new Error("Custom STT engine not provided");
      }
      return config.customEngine;
    
    default:
      throw new Error(`Unknown STT engine: ${engine}`);
  }
}
