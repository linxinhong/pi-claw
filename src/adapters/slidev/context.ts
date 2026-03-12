/**
 * Slidev Platform Context
 * 
 * 实现 PlatformContext 接口，提供浏览器环境下的平台能力
 */

import type { PlatformContext } from "../../core/platform/context.js";
import type { PlatformTool } from "../../core/platform/tools/index.js";
import type { Logger } from "../../utils/logger/types.js";
import type { SlideRenderer } from "./SlideRenderer.js";
import type { StateMachine } from "./StateMachine.js";
import type { TTSEngine } from "./types.js";
import { createAllTools } from "./tools/index.js";

// ============================================================================
// Slidev Platform Context
// ============================================================================

export interface SlidevPlatformContextConfig {
  /** 聊天/频道 ID */
  chatId: string;
  /** Slide 渲染器 */
  renderer: SlideRenderer;
  /** 状态机 */
  stateMachine: StateMachine;
  /** TTS 引擎 */
  ttsEngine: TTSEngine;
  /** 消息发送回调 */
  onSendMessage?: (content: string) => void;
  /** 日志器 */
  logger?: Logger;
}

/**
 * Slidev 平台上下文
 * 
 * 在浏览器环境中提供平台特定能力
 */
export class SlidevPlatformContext implements PlatformContext {
  readonly platform = "slidev" as const;

  private config: SlidevPlatformContextConfig;
  private logger?: Logger;
  private responseSent = false;

  constructor(config: SlidevPlatformContextConfig) {
    this.config = config;
    this.logger = config.logger;
    this.logger?.debug("[SlidevPlatformContext] Created", { chatId: config.chatId });
  }

  // ============================================================================
  // PlatformContext Implementation
  // ============================================================================

  /**
   * 发送文本消息到悬浮对话框
   */
  async sendText(_chatId: string, text: string): Promise<string> {
    this.logger?.debug("[SlidevPlatformContext] sendText", { text: text.slice(0, 100) });
    
    // 通过回调发送到 FloatingChat
    this.config.onSendMessage?.(text);
    
    // 生成消息 ID
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    return messageId;
  }

  /**
   * 更新消息（浏览器环境不支持，模拟实现）
   */
  async updateMessage(_messageId: string, _content: string): Promise<void> {
    // 浏览器环境下消息更新通过 UI 状态管理实现
    this.logger?.debug("[SlidevPlatformContext] updateMessage (not supported in browser)");
  }

  /**
   * 删除消息（浏览器环境不支持）
   */
  async deleteMessage(_messageId: string): Promise<void> {
    this.logger?.debug("[SlidevPlatformContext] deleteMessage (not supported in browser)");
  }

  /**
   * 上传文件（浏览器环境需要用户选择文件）
   */
  async uploadFile(_filePath: string, _chatId: string): Promise<void> {
    this.logger?.debug("[SlidevPlatformContext] uploadFile (browser environment)");
    // 浏览器环境下需要触发文件选择对话框
    throw new Error("File upload in browser requires file picker API");
  }

  /**
   * 上传图片（浏览器环境）
   */
  async uploadImage(imagePath: string): Promise<string> {
    this.logger?.debug("[SlidevPlatformContext] uploadImage", { imagePath });
    // 浏览器环境下返回 data URL 或 blob URL
    return imagePath;
  }

  /**
   * 发送图片
   */
  async sendImage(chatId: string, imageKey: string): Promise<string> {
    this.logger?.debug("[SlidevPlatformContext] sendImage", { chatId, imageKey });
    // 发送图片消息到对话框
    const messageId = await this.sendText(chatId, `![Image](${imageKey})`);
    return messageId;
  }

  /**
   * 发送语音消息
   */
  async sendVoiceMessage(chatId: string, filePath: string): Promise<string> {
    this.logger?.debug("[SlidevPlatformContext] sendVoiceMessage", { chatId, filePath });
    // 浏览器环境下使用音频 URL
    const messageId = await this.sendText(chatId, `🔊 [Voice Message](${filePath})`);
    return messageId;
  }

  /**
   * 在线程中回复（浏览器环境模拟）
   */
  async postInThread(chatId: string, _parentMessageId: string, text: string): Promise<string> {
    this.logger?.debug("[SlidevPlatformContext] postInThread", { chatId });
    // 浏览器环境下直接发送消息
    return this.sendText(chatId, text);
  }

  /**
   * 设置打字状态（浏览器环境不支持）
   */
  async setTyping(_chatId: string, _isTyping: boolean): Promise<void> {
    // 浏览器环境下可通过 UI 状态显示"AI 正在输入"
    this.logger?.debug("[SlidevPlatformContext] setTyping", { isTyping: _isTyping });
  }

  /**
   * 获取平台特定功能
   */
  getPlatformFeature<T = any>(feature: string): T {
    this.logger?.debug("[SlidevPlatformContext] getPlatformFeature", { feature });
    
    switch (feature) {
      case "slideRenderer":
        return this.config.renderer as T;
      case "stateMachine":
        return this.config.stateMachine as T;
      case "ttsEngine":
        return this.config.ttsEngine as T;
      default:
        return undefined as T;
    }
  }

  /**
   * 获取平台特定工具
   */
  async getTools(context: {
    chatId: string;
    workspaceDir: string;
    channelDir: string;
  }): Promise<any[]> {
    this.logger?.debug("[SlidevPlatformContext] getTools", { chatId: context.chatId });
    
    // 返回 Slidev 专用工具
    return createAllTools({
      renderer: this.config.renderer,
      stateMachine: this.config.stateMachine,
      ttsEngine: this.config.ttsEngine,
    });
  }

  /**
   * 检查响应是否已发送
   */
  isResponseSent(): boolean {
    return this.responseSent;
  }

  /**
   * 完成响应
   */
  async finalizeResponse(content: string): Promise<void> {
    this.logger?.debug("[SlidevPlatformContext] finalizeResponse");
    
    if (!this.responseSent) {
      await this.sendText(this.config.chatId, content);
      this.responseSent = true;
    }
  }

  /**
   * 处理错误
   */
  async handleError(error: unknown): Promise<boolean> {
    this.logger?.error("[SlidevPlatformContext] handleError", undefined, error as Error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    await this.sendText(this.config.chatId, `❌ 错误: ${errorMessage}`);
    
    return true;
  }

  // ============================================================================
  // Slidev-specific Methods
  // ============================================================================

  /**
   * 获取当前幻灯片信息
   */
  getCurrentSlide() {
    return this.config.renderer.getCurrentSlide();
  }

  /**
   * 获取状态机状态
   */
  getState() {
    return this.config.stateMachine.getState();
  }

  /**
   * 标记响应已发送
   */
  markResponseSent() {
    this.responseSent = true;
  }

  /**
   * 重置响应状态
   */
  resetResponseState() {
    this.responseSent = false;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSlidevPlatformContext(
  config: SlidevPlatformContextConfig
): SlidevPlatformContext {
  return new SlidevPlatformContext(config);
}
