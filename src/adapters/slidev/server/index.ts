/**
 * Slidev Server
 * 
 * Express 服务器集成入口
 */

import type { Express } from "express";
import type { SlidevAdapter } from "../adapter.js";
import type { Logger } from "../../../utils/logger/types.js";
import { createSlidevRouter, setupStaticFiles } from "./router.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ============================================================================
// Server Setup
// ============================================================================

export interface SlidevServerOptions {
  /** Express 应用实例 */
  app: Express;
  /** Slidev Adapter 实例 */
  adapter: SlidevAdapter;
  /** 日志器 */
  logger?: Logger;
  /** 静态文件路径（可选，默认使用内置静态文件） */
  staticPath?: string;
  /** API 路由前缀 */
  apiPrefix?: string;
  /** 静态文件路由 */
  staticRoute?: string;
}

/**
 * 设置 Slidev 服务器
 * 
 * 将 Slidev API 路由和静态文件服务添加到 Express 应用
 */
export function setupSlidevServer(options: SlidevServerOptions): void {
  const {
    app,
    adapter,
    logger,
    staticPath,
    apiPrefix = "/api/slidev",
    staticRoute = "/slidev",
  } = options;

  logger?.info("[SlidevServer] Setting up server...");

  // 1. 设置 API 路由
  createSlidevRouter(app, { adapter, logger });

  // 2. 设置静态文件服务
  const resolvedStaticPath =
    staticPath || getDefaultStaticPath();
  
  setupStaticFiles(app, resolvedStaticPath, staticRoute);

  logger?.info(`[SlidevServer] Server setup complete`);
  logger?.info(`[SlidevServer] - API: ${apiPrefix}`);
  logger?.info(`[SlidevServer] - Static: ${staticRoute} -> ${resolvedStaticPath}`);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 获取默认静态文件路径
 */
function getDefaultStaticPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, "static");
}

// ============================================================================
// Re-exports
// ============================================================================

export { createSlidevRouter, setupStaticFiles } from "./router.js";
