/**
 * Slidev Adapter
 * 
 * Slidev 平台适配器 - 实现 PlatformAdapter 接口
 * 在浏览器环境中提供 PPT 演示和 AI 对话能力
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  UserInfo,
  ChannelInfo,
} from "../../core/platform/adapter.js";
import type { UniversalMessage, UniversalResponse } from "../../core/platform/message.js";
import type { PlatformContext } from "../../core/platform/context.js";
import type { Logger } from "../../utils/logger/types.js";
import { PiLogger } from "../../utils/logger/index.js";
import { SlidevPlatformContext } from "./context.js";
import { StateMachine } from "./StateMachine.js";
import { SlideRenderer } from "./SlideRenderer.js";
import { WebSpeechTTSEngine, createTTSEngine } from "./TTSEngine.js";
import { createSTTEngine } from "./STTEngine.js";
import type { 
  SlidevAdapterConfig, 
  PresentationState,
  SlidevConfig,
  TTSConfig,
  STTConfig,
  TTSEngine,
  ChatMessage,
} from "./types.js";

// ============================================================================
// Slidev Adapter
// ============================================================================

export class SlidevAdapter implements PlatformAdapter {
  readonly platform = "slidev" as const;

  private config: SlidevAdapterConfig;
  private logger: Logger;
  private stateMachine: StateMachine;
  private renderer: SlideRenderer;
  private ttsEngine: TTSEngine;
  private sttEngine: ReturnType<typeof createSTTEngine> | null = null;
  private platformContext: SlidevPlatformContext | null = null;

  private messageHandlers: Array<(message: UniversalMessage) => void> = [];
  private runningChannels = new Map<string, { abort: () => void }>();
  private defaultModel: string | undefined;
  private isInitialized = false;
  private isStarted = false;

  // 消息历史
  private messages: ChatMessage[] = [];

  constructor(config: SlidevAdapterConfig) {
    this.config = config;
    
    // 创建 Logger
    this.logger = new PiLogger("slidev", {
      enabled: true,
      level: "debug",
      console: true,
    });

    this.defaultModel = config.ai?.model;

    // 初始化状态机
    this.stateMachine = new StateMachine({
      onStateChange: (event) => {
        this.logger.debug(`[SlidevAdapter] State changed: ${event.from} -> ${event.to}`);
        this.config.events?.onStateChange?.(event);
      },
    });

    // 初始化渲染器
    this.renderer = new SlideRenderer({
      container: config.container,
      slidevConfig: config.slidev,
      onSlideChange: (slide) => {
        this.logger.debug(`[SlidevAdapter] Slide changed: ${slide.current}/${slide.total}`);
        this.config.events?.onSlideChange?.(slide);
      },
    });

    // 初始化 TTS 引擎（浏览器环境）
    try {
      this.ttsEngine = createTTSEngine(config.tts || { engine: "web-speech" });
      this.setupTTSEvents();
    } catch (error) {
      this.logger.warn(`[SlidevAdapter] TTS not available (browser only): ${error}`);
      // 创建 noop TTS 引擎
      this.ttsEngine = this.createNoopTTSEngine();
    }

    // 初始化 STT 引擎（浏览器环境）
    if (config.stt) {
      try {
        this.sttEngine = createSTTEngine(config.stt);
        this.setupSTTEvents();
      } catch (error) {
        this.logger.warn(`[SlidevAdapter] STT not supported: ${error}`);
      }
    }

    this.logger.info("[SlidevAdapter] Created");
  }

  // ============================================================================
  // PlatformAdapter Implementation
  // ============================================================================

  async initialize(_config: PlatformConfig): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.logger.info("[SlidevAdapter] Initializing...");

    // 初始化渲染器
    await this.renderer.initialize();

    // 创建 PlatformContext
    this.platformContext = new SlidevPlatformContext({
      chatId: "default",
      renderer: this.renderer,
      stateMachine: this.stateMachine,
      ttsEngine: this.ttsEngine,
      onSendMessage: (content) => {
        this.handleAssistantMessage(content);
      },
      logger: this.logger,
    });

    this.isInitialized = true;
    this.logger.info("[SlidevAdapter] Initialized");
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("SlidevAdapter not initialized");
    }

    if (this.isStarted) {
      return;
    }

    this.logger.info("[SlidevAdapter] Starting...");

    // 进入播放状态
    this.stateMachine.start();

    this.isStarted = true;
    this.logger.info("[SlidevAdapter] Started");
  }

  async stop(): Promise<void> {
    this.logger.info("[SlidevAdapter] Stopping...");

    // 停止状态机
    this.stateMachine.stop();

    // 停止 TTS/STT
    this.ttsEngine.stop();
    this.sttEngine?.stop();

    // 清理运行状态
    this.runningChannels.clear();

    this.isStarted = false;
    this.logger.info("[SlidevAdapter] Stopped");
  }

  /**
   * 暂停演示
   */
  pause(): void {
    this.logger.info("[SlidevAdapter] Pausing...");
    this.stateMachine.pause();
  }

  /**
   * 继续演示
   */
  resume(): void {
    this.logger.info("[SlidevAdapter] Resuming...");
    this.stateMachine.resume();
  }

  async sendMessage(response: UniversalResponse): Promise<void> {
    const content = typeof response.content === "string" 
      ? response.content 
      : JSON.stringify(response.content);
    await this.platformContext?.sendText("default", content);
  }

  async updateMessage(_messageId: string, _response: UniversalResponse): Promise<void> {
    // 浏览器环境不支持消息更新
    this.logger.debug("[SlidevAdapter] updateMessage (not supported)");
  }

  async deleteMessage(_messageId: string): Promise<void> {
    // 浏览器环境不支持消息删除
    this.logger.debug("[SlidevAdapter] deleteMessage (not supported)");
  }

  async uploadFile(_filePath: string): Promise<string> {
    throw new Error("SlidevAdapter does not support file upload");
  }

  async uploadImage(_imagePath: string): Promise<string> {
    throw new Error("SlidevAdapter does not support image upload");
  }

  async getUserInfo(userId: string): Promise<UserInfo | undefined> {
    return {
      id: userId,
      userName: userId === "user" ? "User" : "Slidev User",
      displayName: userId === "user" ? "User" : "Slidev User",
    };
  }

  async getAllUsers(): Promise<UserInfo[]> {
    return [
      { id: "user", userName: "User", displayName: "User" },
      { id: "assistant", userName: "AI Assistant", displayName: "AI Assistant" },
    ];
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
    return {
      id: channelId,
      name: "Slidev Presentation",
    };
  }

  async getAllChannels(): Promise<ChannelInfo[]> {
    return [
      { id: "default", name: "Slidev Presentation" },
    ];
  }

  onMessage(handler: (message: UniversalMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  createPlatformContext(chatId: string, _quoteMessageId?: string): SlidevPlatformContext {
    if (!this.platformContext) {
      throw new Error("SlidevAdapter not initialized");
    }

    // 更新 chatId
    return new SlidevPlatformContext({
      chatId,
      renderer: this.renderer,
      stateMachine: this.stateMachine,
      ttsEngine: this.ttsEngine,
      onSendMessage: (content) => {
        this.handleAssistantMessage(content);
      },
      logger: this.logger,
    });
  }

  isRunning(channelId: string): boolean {
    return this.runningChannels.has(channelId);
  }

  setRunning(channelId: string, abort: () => void): void {
    this.runningChannels.set(channelId, { abort });
  }

  clearRunning(channelId: string): void {
    this.runningChannels.delete(channelId);
  }

  abortChannel(channelId: string): void {
    const running = this.runningChannels.get(channelId);
    if (running) {
      running.abort();
      this.runningChannels.delete(channelId);
    }
  }

  getDefaultModel(): string | undefined {
    return this.defaultModel;
  }

  // ============================================================================
  // Slidev-specific Methods
  // ============================================================================

  /**
   * 处理用户输入（从 FloatingChat 调用）
   */
  handleUserInput(content: string, channelId: string = "default"): void {
    this.logger.debug("[SlidevAdapter] handleUserInput", { content: content.slice(0, 100) });

    // 添加用户消息到历史
    this.addMessage({
      id: `msg_${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    });

    // 创建 UniversalMessage
    const message = {
      id: `msg_${Date.now()}`,
      platform: "slidev" as const,
      type: "text" as const,
      content,
      sender: {
        id: "user",
        name: "User",
        displayName: "User",
      },
      chat: {
        id: channelId,
        type: "private" as const,
      },
      timestamp: new Date(),
    } as unknown as UniversalMessage;

    // 触发消息处理器
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        this.logger.error(`[SlidevAdapter] Message handler error: ${(error as Error).message}`);
      }
    }
  }

  /**
   * 获取当前状态
   */
  getState(): PresentationState {
    return this.stateMachine.getState();
  }

  /**
   * 获取当前幻灯片信息
   */
  getCurrentSlide() {
    return this.renderer.getCurrentSlide();
  }

  /**
   * 获取渲染器
   */
  getRenderer(): SlideRenderer {
    return this.renderer;
  }

  /**
   * 获取状态机
   */
  getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  /**
   * 获取 PlatformContext
   */
  getPlatformContext(): SlidevPlatformContext | null {
    return this.platformContext;
  }

  // ============================================================================
  // Navigation
  // ============================================================================

  next(): void {
    if (this.stateMachine.canNavigate()) {
      this.renderer.next();
    }
  }

  prev(): void {
    if (this.stateMachine.canNavigate()) {
      this.renderer.prev();
    }
  }

  goto(slideNo: number): void {
    if (this.stateMachine.canNavigate()) {
      this.renderer.goto(slideNo);
    }
  }

  // ============================================================================
  // Voice
  // ============================================================================

  startVoiceChat(): void {
    if (!this.sttEngine) {
      this.logger.warn("[SlidevAdapter] STT not available");
      return;
    }

    if (!this.stateMachine.canConverse()) {
      this.logger.warn("[SlidevAdapter] Cannot converse in current state");
      return;
    }

    this.stateMachine.enterConversation();
    this.sttEngine.start();
    this.config.events?.onVoiceStart?.();
  }

  stopVoiceChat(): void {
    this.sttEngine?.stop();
    this.stateMachine.exitConversation();
    this.config.events?.onVoiceEnd?.();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupTTSEvents(): void {
    this.ttsEngine.onStart = () => {
      this.config.events?.onVoiceStart?.();
    };

    this.ttsEngine.onEnd = () => {
      this.config.events?.onVoiceEnd?.();
    };

    this.ttsEngine.onError = (error) => {
      this.logger.error(`[SlidevAdapter] TTS error: ${error.message}`);
      this.config.events?.onError?.(error);
    };
  }

  private setupSTTEvents(): void {
    if (!this.sttEngine) return;

    this.sttEngine.onResult = (text, isFinal) => {
      if (isFinal) {
        this.handleUserInput(text);
      }
    };

    this.sttEngine.onError = (error) => {
      this.logger.error(`[SlidevAdapter] STT error: ${error.message}`);
      this.stateMachine.exitConversation();
    };
  }

  private handleAssistantMessage(content: string): void {
    // 添加助手消息到历史
    this.addMessage({
      id: `msg_${Date.now()}`,
      role: "assistant",
      content,
      timestamp: Date.now(),
    });

    // 触发外部回调
    // 这里可以通过事件系统通知 FloatingChat 更新 UI
  }

  private addMessage(message: ChatMessage): void {
    this.messages.push(message);
    
    // 限制历史长度
    if (this.messages.length > 100) {
      this.messages = this.messages.slice(-50);
    }
  }

  private getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * 创建 noop TTS 引擎（用于非浏览器环境）
   */
  private createNoopTTSEngine(): TTSEngine {
    return {
      speak: async () => {
        this.logger.warn("[SlidevAdapter] TTS not available in server mode");
      },
      stop: () => {},
      pause: () => {},
      resume: () => {},
      isSpeaking: () => false,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSlidevAdapter(config: SlidevAdapterConfig): SlidevAdapter {
  return new SlidevAdapter(config);
}
