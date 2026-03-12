/**
 * State Machine
 * 
 * 演示状态机管理
 * 状态：IDLE -> PLAYING <-> PAUSED
 *            ↕
 *       CONVERSING
 */

import type { 
  PresentationState, 
  StateChangeEvent, 
  StateMachineConfig 
} from "./types.js";
import type { Logger } from "../../utils/logger/types.js";

// ============================================================================
// State Transitions
// ============================================================================

/** 允许的状态转换 */
const ALLOWED_TRANSITIONS: Record<PresentationState, PresentationState[]> = {
  IDLE: ["PLAYING"],
  PLAYING: ["PAUSED", "CONVERSING", "IDLE"],
  PAUSED: ["PLAYING", "CONVERSING", "IDLE"],
  CONVERSING: ["PLAYING", "PAUSED", "IDLE"],
};

// ============================================================================
// State Machine
// ============================================================================

export class StateMachine {
  private currentState: PresentationState;
  private history: StateChangeEvent[] = [];
  private listeners: Set<(event: StateChangeEvent) => void> = new Set();
  private config: StateMachineConfig;
  private logger?: Logger;

  constructor(config: StateMachineConfig = {}, logger?: Logger) {
    this.config = config;
    this.currentState = config.initialState || "IDLE";
    this.logger = logger;
    this.logger?.debug("[StateMachine] Created", { initialState: this.currentState });
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * 获取当前状态
   */
  getState(): PresentationState {
    return this.currentState;
  }

  /**
   * 检查是否可以转换到目标状态
   */
  canTransition(to: PresentationState): boolean {
    return ALLOWED_TRANSITIONS[this.currentState].includes(to);
  }

  /**
   * 状态转换
   */
  transition(to: PresentationState, context?: Record<string, unknown>): boolean {
    const from = this.currentState;

    // 检查是否允许转换
    if (!this.canTransition(to)) {
      this.logger?.warn(`[StateMachine] Invalid transition: ${from} -> ${to}`);
      return false;
    }

    // 执行转换
    this.currentState = to;

    // 创建事件
    const event: StateChangeEvent = {
      from,
      to,
      timestamp: Date.now(),
      context,
    };

    // 记录历史
    this.history.push(event);

    // 触发回调
    this.notifyListeners(event);

    this.logger?.debug(`[StateMachine] ${from} -> ${to}`, context);
    return true;
  }

  /**
   * 订阅状态变更
   */
  subscribe(callback: (event: StateChangeEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 获取状态历史
   */
  getHistory(): StateChangeEvent[] {
    return [...this.history];
  }

  /**
   * 重置状态机
   */
  reset(): void {
    this.currentState = this.config.initialState || "IDLE";
    this.history = [];
  }

  // ============================================================================
  // State Helpers
  // ============================================================================

  /** 是否空闲 */
  isIdle(): boolean {
    return this.currentState === "IDLE";
  }

  /** 是否正在播放 */
  isPlaying(): boolean {
    return this.currentState === "PLAYING";
  }

  /** 是否已暂停 */
  isPaused(): boolean {
    return this.currentState === "PAUSED";
  }

  /** 是否在对线中 */
  isConversing(): boolean {
    return this.currentState === "CONVERSING";
  }

  /** 是否可以导航 */
  canNavigate(): boolean {
    return this.currentState === "PLAYING" || this.currentState === "PAUSED";
  }

  /** 是否可以对话 */
  canConverse(): boolean {
    return this.currentState !== "IDLE";
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /** 开始播放 */
  start(): boolean {
    return this.transition("PLAYING", { action: "start" });
  }

  /** 暂停 */
  pause(): boolean {
    return this.transition("PAUSED", { action: "pause" });
  }

  /** 继续播放 */
  resume(): boolean {
    return this.transition("PLAYING", { action: "resume" });
  }

  /** 进入对话模式 */
  enterConversation(): boolean {
    return this.transition("CONVERSING", { action: "enter_conversation" });
  }

  /** 退出对话模式 */
  exitConversation(): boolean {
    // 退出对线后回到暂停状态
    return this.transition("PAUSED", { action: "exit_conversation" });
  }

  /** 停止 */
  stop(): boolean {
    return this.transition("IDLE", { action: "stop" });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private notifyListeners(event: StateChangeEvent): void {
    // 调用配置中的回调
    this.config.onStateChange?.(event);

    // 通知所有订阅者
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[StateMachine] Listener error:", error);
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStateMachine(config?: StateMachineConfig, logger?: Logger): StateMachine {
  return new StateMachine(config, logger);
}
