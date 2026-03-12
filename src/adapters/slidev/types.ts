/**
 * Slidev Adapter Types
 * 
 * PPT 演示 Adapter 的类型定义
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import "./types.browser.js";

// ============================================================================
// State Machine Types
// ============================================================================

/** 演示状态 */
export type PresentationState = 
  | "IDLE"      // 空闲，未开始
  | "PLAYING"   // 正在播放
  | "PAUSED"    // 已暂停
  | "CONVERSING"; // 对话中

/** 状态变更事件 */
export interface StateChangeEvent {
  from: PresentationState;
  to: PresentationState;
  timestamp: number;
  context?: Record<string, unknown>;
}

/** 状态机配置 */
export interface StateMachineConfig {
  initialState?: PresentationState;
  onStateChange?: (event: StateChangeEvent) => void;
}

// ============================================================================
// Slide Renderer Types
// ============================================================================

/** Slidev 配置 */
export interface SlidevConfig {
  /** 幻灯片数据源（Markdown 或 URL） */
  source: string;
  /** 主题 */
  theme?: string;
  /** 起始页码（从 1 开始） */
  initialSlide?: number;
  /** 是否循环播放 */
  loop?: boolean;
  /** 是否显示页码 */
  showPageNumbers?: boolean;
  /** 自定义 CSS */
  customCSS?: string;
}

/** 幻灯片信息 */
export interface SlideInfo {
  total: number;
  current: number;
  title?: string;
  content?: string;
}

/** 渲染器配置 */
export interface SlideRendererConfig {
  /** 容器元素（浏览器环境中为 HTMLElement） */
  container: any;
  /** Slidev 配置 */
  slidevConfig: SlidevConfig;
  /** 页面变更回调 */
  onSlideChange?: (slide: SlideInfo) => void;
}

// ============================================================================
// TTS/STT Types
// ============================================================================

/** TTS 配置 */
export interface TTSConfig {
  /** 语音类型 */
  voice?: string;
  /** 语速 */
  rate?: number;
  /** 音调 */
  pitch?: number;
  /** 音量 */
  volume?: number;
  /** 引擎类型 */
  engine?: "web-speech" | "dashscope" | "custom";
  /** 自定义引擎 */
  customEngine?: TTSEngine;
}

/** STT 配置 */
export interface STTConfig {
  /** 语言 */
  language?: string;
  /** 连续识别 */
  continuous?: boolean;
  /**  interim 结果 */
  interimResults?: boolean;
  /** 引擎类型 */
  engine?: "web-speech" | "custom";
  /** 自定义引擎 */
  customEngine?: STTEngine;
}

/** TTS 引擎接口 */
export interface TTSEngine {
  speak(text: string, config?: Partial<TTSConfig>): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeaking(): boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

/** STT 引擎接口 */
export interface STTEngine {
  start(): void;
  stop(): void;
  abort(): void;
  isListening(): boolean;
  onResult?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

// ============================================================================
// Adapter Types
// ============================================================================

/** Slidev Adapter 配置 */
export interface SlidevAdapterConfig {
  /** 容器元素（浏览器环境中为 HTMLElement） */
  container: any;
  /** Slidev 配置 */
  slidev: SlidevConfig;
  /** TTS 配置 */
  tts?: TTSConfig;
  /** STT 配置 */
  stt?: STTConfig;
  /** AI 配置 */
  ai?: {
    /** 模型 */
    model?: string;
    /** API Key */
    apiKey?: string;
    /** 系统提示词 */
    systemPrompt?: string;
  };
  /** 悬浮对话框配置 */
  chat?: {
    /** 位置 */
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    /** 初始打开状态 */
    initialOpen?: boolean;
    /** 占位符文本 */
    placeholder?: string;
  };
  /** 事件回调 */
  events?: {
    onStateChange?: (event: StateChangeEvent) => void;
    onSlideChange?: (slide: SlideInfo) => void;
    onVoiceStart?: () => void;
    onVoiceEnd?: () => void;
    onError?: (error: Error) => void;
  };
}

/** 演示模式 */
export type PresentationMode = "manual" | "auto" | "interactive";

/** Adapter 公共接口 */
export interface ISlidevAdapter {
  /** 启动演示 */
  start(): Promise<void>;
  /** 停止演示 */
  stop(): void;
  /** 暂停 */
  pause(): void;
  /** 继续 */
  resume(): void;
  /** 下一页 */
  next(): void;
  /** 上一页 */
  prev(): void;
  /** 跳转到指定页 */
  goto(slideNo: number): void;
  /** 开始语音对话 */
  startVoiceChat(): void;
  /** 发送文本消息 */
  sendMessage(text: string): Promise<void>;
  /** 获取当前状态 */
  getState(): PresentationState;
  /** 获取当前幻灯片信息 */
  getCurrentSlide(): SlideInfo | null;
  /** 销毁 */
  destroy(): void;
}

// ============================================================================
// Tool Types
// ============================================================================

/** 导航工具参数 */
export interface NavigationToolParams {
  action: "next" | "prev" | "goto" | "first" | "last";
  slideNo?: number;
}

/** TTS 工具参数 */
export interface TTSToolParams {
  text: string;
  voice?: string;
  rate?: number;
}

/** 编辑工具参数 */
export interface EditorToolParams {
  action: "update" | "append" | "insert" | "delete";
  slideNo?: number;
  content: string;
}

// ============================================================================
// Component Types
// ============================================================================

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isVoice?: boolean;
}

/** 悬浮对话框 Props */
export interface FloatingChatProps {
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  placeholder?: string;
  initialOpen?: boolean;
}

/** 语音波形 Props */
export interface VoiceWaveProps {
  active: boolean;
  mode?: "input" | "output";
}
