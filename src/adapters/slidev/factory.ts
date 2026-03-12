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
   * 将 Slidev 静态文件服务添加到 Express 应用
   * 注意：服务器模式只提供静态页面，完整功能需要在浏览器环境使用
   */
  async createServer(app: Express, config: BotConfig): Promise<void> {
    const slidevConfig = config.slidev as SlidevAdapterConfig | undefined;
    if (!slidevConfig) {
      console.warn("[SlidevAdapter] No slidev config, skipping server setup");
      return;
    }

    console.log("[SlidevAdapter] Setting up Express server...");

    // 服务器模式：只提供静态文件服务
    // 完整的 Adapter 功能需要在浏览器环境中创建
    const { setupSlidevServer } = await import("./server/index.js");
    
    // 设置静态文件服务（不包含 API 路由，因为需要浏览器环境）
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const staticPath = join(__dirname, "server", "static");
    
    app.use("/slidev", (await import("express")).static(staticPath));
    
    // 将 slidev 配置注入到静态页面（通过设置全局变量或模板替换）
    // 这里简化处理，实际应用中可能需要更复杂的配置传递机制

    console.log(`[SlidevAdapter] Static files served at /slidev from ${staticPath}`);
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
