/**
 * Feishu Adapter Module
 *
 * 飞书平台适配器 - 实现 PlatformAdapter 接口
 * 自行注册到 AdapterRegistry
 */

import { adapterRegistry } from "../../core/adapter/index.js";
import { feishuAdapterFactory } from "./factory.js";

// ============================================================================
// Self Registration
// ============================================================================

// 飞书适配器自行注册到全局注册表
adapterRegistry.register(feishuAdapterFactory);

// ============================================================================
// Exports
// ============================================================================

export * from "./adapter.js";
export * from "./context.js";
export * from "./message-parser.js";
export * from "./capabilities.js";
export * from "./store.js";
export * from "./bot.js";
export * from "./factory.js";

// OAuth 模块
export * from "./oauth/index.js";

// Utils 模块
export * from "./utils/index.js";
