/**
 * 鶈书 WebSocket 监控
 *
 * 监控飞书 provider 连接状态
 */

import type { LarkClient } from "../client/lark-client.js";
import type { FeishuMessageEvent, FeishuCardEvent } from "../types.js";
import type { MessageHandler } from "../messaging/inbound/handler.js";

// ============================================================================
// 类型
// ============================================================================

export interface MonitorCallbacks {
	/** 消息事件回调 */
	onMessage?: (event: FeishuMessageEvent) => Promise<void> | void;
	/** 卡片事件回调 */
	onCard?: (event: FeishuCardEvent) => Promise<void> | void;
	/** 连接状态变化 */
	onConnectionChange?: (connected: boolean) => void;
	/** 错误回调 */
	onError?: (error: Error) => void;
}

 export interface MonitorOptions {
    /** LarkClient 实例 */
    client: LarkClient;
    /** 回调函数 */
    callbacks: MonitorCallbacks;
    /** 中止信号 */
    abortSignal?: AbortSignal;
}

// ============================================================================
// 监控器
// ============================================================================

export class FeishuMonitor {
    private client: LarkClient;
    private callbacks: MonitorCallbacks;
    private abortSignal?: AbortSignal;
    private connected = false;

    constructor(options: MonitorOptions) {
        this.client = options.client;
        this.callbacks = options.callbacks;
        this.abortSignal = options.abortSignal;
    }
    /**
     * 启动监控
     */
    async start(): Promise<void> {
        // 构建事件处理器映射
        const handlers: Record<string, (event: any) => Promise<void> | void> = {
            "im.message.receive_v1": async (data: any) => {
                const event = data as FeishuMessageEvent;
                await this.callbacks.onMessage?.(event);
            },
        };

        // 卡片事件通过特殊处理（SDK 需要 patch)
        const cardHandler = async (data: any) => {
            const event = data as FeishuCardEvent;
            await this.callbacks.onCard?.(event);
        };
        // 注册卡片处理器（如果有回调）
        if (this.callbacks.onCard) {
            handlers["card"] = cardHandler;
        }
        // 通知连接状态
        this.connected = true;
        this.callbacks.onConnectionChange?.(true);
        try {
            await this.client.startWS({
                handlers,
                abortSignal: this.abortSignal,
            });
        } catch (error) {
            this.connected = false;
            this.callbacks.onConnectionChange?.(false);
            this.callbacks.onError?.(
                error instanceof Error ? error : new Error(String(error))
            );
            throw error;
        } finally {
            this.connected = false;
            this.callbacks.onConnectionChange?.(false);
        }
    }
    /**
     * 停止监控
     */
    stop(): void {
        this.client.disconnect();
        this.connected = false;
        this.callbacks.onConnectionChange?.(false);
    }
    /**
     * 是否已连接
     */
    isConnected(): boolean {
        return this.connected;
    }
}
// ============================================================================
// 工厂函数
// ============================================================================
/**
 * 创建飞书监控器
 */
export function createFeishuMonitor(options: MonitorOptions): FeishuMonitor {
    return new FeishuMonitor(options);
}
