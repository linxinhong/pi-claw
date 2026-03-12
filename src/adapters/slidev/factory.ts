/**
 * Slidev Adapter Factory
 * 
 * 创建配置好的 Slidev Bot 实例
 */

import type { Express } from "express";
import type { AdapterFactory, BotConfig, Bot } from "../../core/adapter/types.js";
import type { SlidevAdapterConfig } from "./types.js";
import type { Logger } from "../../utils/logger/types.js";
import { SlidevAdapter } from "./adapter.js";
import { setupSlidevServer } from "./server/index.js";

// ============================================================================
// Factory
// ============================================================================

/**
 * Slidev Adapter 工厂
 */
export const slidevAdapterFactory: AdapterFactory = {
  meta: {
    id: "slidev",
    name: "Slidev (PPT Presentation)",
    version: "1.0.0",
    description: "Browser-based presentation adapter with Slidev and AI capabilities",
  },

  async createBot(config: BotConfig): Promise<Bot> {
    const slidevConfig = config.slidev as SlidevAdapterConfig | undefined;
    if (!slidevConfig) {
      throw new Error("Missing slidev configuration in config");
    }

    // 创建 SlidevAdapter
    const adapter = new SlidevAdapter(slidevConfig);

    // 初始化适配器
    await adapter.initialize({
      platform: "slidev",
      enabled: true,
    });

    // 返回 Bot 接口实现
    return {
      start: async () => {
        await adapter.start();
      },
      stop: async () => {
        await adapter.stop();
      },
      // 暴露 adapter 供外部使用
      adapter,
    } as Bot & { adapter: SlidevAdapter };
  },

  validateConfig(config: any): boolean {
    const slidev = config.slidev;
    if (!slidev) {
      return false;
    }

    // 检查必需的配置
    if (!slidev.container) {
      console.error("[SlidevAdapter] Missing required config: container");
      return false;
    }

    if (!slidev.slidev?.source) {
      console.error("[SlidevAdapter] Missing required config: slidev.source");
      return false;
    }

    return true;
  },

  getDefaultConfig(): Partial<BotConfig> {
    return {
      slidev: {
        container: null, // 必须由用户提供
        slidev: {
          source: "",
          theme: "default",
          initialSlide: 1,
          loop: false,
        },
        tts: {
          engine: "web-speech",
          rate: 1,
        },
        stt: {
          engine: "web-speech",
          language: "zh-CN",
          continuous: true,
        },
        chat: {
          position: "bottom-right",
          initialOpen: false,
          placeholder: "输入消息或点击麦克风语音对话...",
        },
      },
    };
  },

  /**
   * 创建 Express 服务器路由
   * 
   * 将 Slidev API 和静态文件服务添加到 Express 应用
   */
  async createServer(app: Express, config: BotConfig): Promise<void> {
    const slidevConfig = config.slidev as SlidevAdapterConfig | undefined;
    if (!slidevConfig) {
      console.warn("[SlidevAdapter] No slidev config, skipping server setup");
      return;
    }

    console.log("[SlidevAdapter] Setting up Express server...");

    // 创建 Adapter（不启动，仅用于服务器模式）
    const adapter = new SlidevAdapter(slidevConfig);

    // 初始化
    await adapter.initialize({
      platform: "slidev",
      enabled: true,
    });

    // 设置服务器路由
    setupSlidevServer({
      app,
      adapter,
      logger: console as unknown as Logger,
    });

    console.log("[SlidevAdapter] Express server setup complete");
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 创建 Slidev Bot（简化接口）
 * 
 * 用于浏览器环境直接调用
 */
export async function createSlidevBot(
  config: BotConfig & { slidev: SlidevAdapterConfig }
): Promise<Bot & { adapter: SlidevAdapter }> {
  return slidevAdapterFactory.createBot(config) as Promise<Bot & { adapter: SlidevAdapter }>;
}
