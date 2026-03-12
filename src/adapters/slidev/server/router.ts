/**
 * Slidev Server Router
 * 
 * Express 路由定义，提供 API 端点供前端调用
 */

import type { Express, Request, Response } from "express";
import type { SlidevAdapter } from "../adapter.js";
import type { Logger } from "../../../utils/logger/types.js";

// ============================================================================
// Router Setup
// ============================================================================

export interface RouterOptions {
  adapter: SlidevAdapter;
  logger?: Logger;
}

/**
 * 创建 Slidev API 路由
 */
export function createSlidevRouter(app: Express, options: RouterOptions): void {
  const { adapter, logger } = options;

  logger?.info("[SlidevRouter] Setting up routes...");

  // 解析 JSON body
  app.use(express.json());

  // API 路由前缀
  const API_PREFIX = "/api/slidev";

  // ============================================================================
  // Status Endpoints
  // ============================================================================

  /**
   * GET /api/slidev/status
   * 获取演示状态
   */
  app.get(`${API_PREFIX}/status`, (_req: Request, res: Response) => {
    try {
      const state = adapter.getState();
      const slide = adapter.getCurrentSlide();

      res.json({
        success: true,
        data: {
          state,
          slide,
        },
      });
    } catch (error) {
      logger?.error("[SlidevRouter] Error getting status", {}, error as Error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/slidev/slide
   * 获取当前幻灯片详细信息
   */
  app.get(`${API_PREFIX}/slide`, (_req: Request, res: Response) => {
    try {
      const slide = adapter.getCurrentSlide();
      const content = adapter.getRenderer().getSlideContent();
      const title = adapter.getRenderer().getSlideTitle();

      res.json({
        success: true,
        data: {
          ...slide,
          title,
          content,
        },
      });
    } catch (error) {
      logger?.error("[SlidevRouter] Error getting slide", {}, error as Error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/slidev/outline
   * 获取演示大纲
   */
  app.get(`${API_PREFIX}/outline`, (_req: Request, res: Response) => {
    try {
      const outline = adapter.getRenderer().getOutline();

      res.json({
        success: true,
        data: { outline },
      });
    } catch (error) {
      logger?.error("[SlidevRouter] Error getting outline", {}, error as Error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // Navigation Endpoints
  // ============================================================================

  /**
   * POST /api/slidev/navigate
   * 控制幻灯片导航
   * Body: { action: "next" | "prev" | "goto", slideNo?: number }
   */
  app.post(`${API_PREFIX}/navigate`, (req: Request, res: Response) => {
    try {
      const { action, slideNo } = req.body;

      switch (action) {
        case "next":
          adapter.next();
          break;
        case "prev":
          adapter.prev();
          break;
        case "goto":
          if (typeof slideNo !== "number") {
            return res.status(400).json({
              success: false,
              error: "Missing or invalid slideNo",
            });
          }
          adapter.goto(slideNo);
          break;
        case "first":
          adapter.goto(1);
          break;
        case "last":
          const total = adapter.getCurrentSlide().total;
          adapter.goto(total);
          break;
        default:
          return res.status(400).json({
            success: false,
            error: `Unknown action: ${action}`,
          });
      }

      const slide = adapter.getCurrentSlide();

      res.json({
        success: true,
        data: { slide },
      });
    } catch (error) {
      logger?.error("[SlidevRouter] Error navigating", {}, error as Error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // Message Endpoints
  // ============================================================================

  /**
   * POST /api/slidev/message
   * 发送消息到 AI
   * Body: { content: string }
   */
  app.post(`${API_PREFIX}/message`, async (req: Request, res: Response) => {
    try {
      const { content } = req.body;

      if (!content || typeof content !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid content",
        });
      }

      // 处理用户输入（这会触发 onMessage 回调）
      adapter.handleUserInput(content);

      res.json({
        success: true,
        data: { message: "Message sent" },
      });
    } catch (error) {
      logger?.error("[SlidevRouter] Error sending message", {}, error as Error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // Voice Endpoints
  // ============================================================================

  /**
   * POST /api/slidev/voice
   * 控制语音对话
   * Body: { action: "start" | "stop" }
   */
  app.post(`${API_PREFIX}/voice`, (req: Request, res: Response) => {
    try {
      const { action } = req.body;

      switch (action) {
        case "start":
          adapter.startVoiceChat();
          break;
        case "stop":
          adapter.stopVoiceChat();
          break;
        default:
          return res.status(400).json({
            success: false,
            error: `Unknown action: ${action}`,
          });
      }

      res.json({
        success: true,
        data: { voiceState: action === "start" ? "active" : "inactive" },
      });
    } catch (error) {
      logger?.error("[SlidevRouter] Error controlling voice", {}, error as Error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // Control Endpoints
  // ============================================================================

  /**
   * POST /api/slidev/control
   * 控制演示状态
   * Body: { action: "start" | "stop" | "pause" | "resume" }
   */
  app.post(`${API_PREFIX}/control`, (req: Request, res: Response) => {
    try {
      const { action } = req.body;

      switch (action) {
        case "start":
          adapter.start();
          break;
        case "stop":
          adapter.stop();
          break;
        case "pause":
          adapter.pause();
          break;
        case "resume":
          adapter.resume();
          break;
        default:
          return res.status(400).json({
            success: false,
            error: `Unknown action: ${action}`,
          });
      }

      res.json({
        success: true,
        data: { state: adapter.getState() },
      });
    } catch (error) {
      logger?.error("[SlidevRouter] Error controlling", {}, error as Error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  logger?.info("[SlidevRouter] Routes setup complete");
}

// ============================================================================
// Import express
// ============================================================================

import express from "express";

// ============================================================================
// Static Files Setup
// ============================================================================

/**
 * 设置静态文件服务
 * @param app Express 应用实例
 * @param staticPath 静态文件路径
 * @param route 路由路径（默认为 /slidev）
 */
export function setupStaticFiles(app: Express, staticPath: string, route: string = "/slidev"): void {
  app.use(route, express.static(staticPath));
  console.log(`[SlidevServer] Static files served from ${staticPath} at ${route}`);
}
