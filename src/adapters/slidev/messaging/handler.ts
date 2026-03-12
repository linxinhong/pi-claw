/**
 * Message Handler
 * 
 * 将 Slidev 的用户输入转换为 UniversalMessage
 */

import type { UniversalMessage } from "../../../core/platform/message.js";
import type { Logger } from "../../../utils/logger/types.js";

// ============================================================================
// Types
// ============================================================================

export interface MessageContext {
  /** 消息 ID */
  messageId: string;
  /** 聊天/频道 ID */
  chatId: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type: "text" | "voice";
  /** 发送者信息 */
  sender: {
    id: string;
    name: string;
    displayName?: string;
  };
  /** 时间戳 */
  timestamp: Date;
  /** 是否是语音输入 */
  isVoice?: boolean;
}

export interface ParseResult {
  /** 是否成功解析 */
  success: boolean;
  /** 解析后的上下文 */
  context?: MessageContext;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// Message Handler
// ============================================================================

export class MessageHandler {
  private logger?: Logger;

  constructor(options: { logger?: Logger } = {}) {
    this.logger = options.logger;
  }

  /**
   * 解析用户输入为消息上下文
   */
  parse(input: {
    content: string;
    chatId?: string;
    isVoice?: boolean;
  }): ParseResult {
    try {
      const { content, chatId = "default", isVoice = false } = input;

      this.logger?.debug("[MessageHandler] Parsing input", { 
        content: content.slice(0, 100),
        isVoice,
      });

      // 创建消息上下文
      const context: MessageContext = {
        messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        chatId,
        content: content.trim(),
        type: isVoice ? "voice" : "text",
        sender: {
          id: "user",
          name: "User",
          displayName: "User",
        },
        timestamp: new Date(),
        isVoice,
      };

      return {
        success: true,
        context,
      };
    } catch (error) {
      this.logger?.error(`[MessageHandler] Parse error: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 转换为 UniversalMessage
   */
  toUniversalMessage(context: MessageContext): UniversalMessage {
    return {
      id: context.messageId,
      platform: "slidev" as const,
      type: "text" as const,
      content: context.content,
      sender: {
        id: context.sender.id,
        name: context.sender.name,
        displayName: context.sender.displayName || context.sender.name,
      },
      chat: {
        id: context.chatId,
        type: "private" as const,
      },
      timestamp: context.timestamp,
    } as unknown as UniversalMessage;
  }

  /**
   * 检查消息是否有效
   */
  validate(context: MessageContext): { valid: boolean; reason?: string } {
    // 检查空消息
    if (!context.content || context.content.trim().length === 0) {
      return { valid: false, reason: "Empty message" };
    }

    // 检查消息长度
    if (context.content.length > 10000) {
      return { valid: false, reason: "Message too long (max 10000 characters)" };
    }

    return { valid: true };
  }

  /**
   * 提取命令
   * 
   * 支持的特殊命令格式：
   * - /next - 下一页
   * - /prev - 上一页
   * - /goto 5 - 跳转到第5页
   * - /play - 开始播放
   * - /pause - 暂停
   * - /voice - 开始语音对话
   */
  extractCommand(content: string): { isCommand: boolean; command?: string; args?: string[] } {
    if (!content.startsWith("/")) {
      return { isCommand: false };
    }

    const parts = content.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    return {
      isCommand: true,
      command,
      args,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createMessageHandler(options?: { logger?: Logger }): MessageHandler {
  return new MessageHandler(options);
}
