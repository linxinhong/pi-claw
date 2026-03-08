/**
 * TUI Module Entry
 *
 * TUI 模块入口
 */

export { PiClawTUI } from "./app.js";
export * from "./types.js";
export { darkTheme, createTheme } from "./theme.js";

// CoreAgent 集成
export { TUIAdapter } from "./adapter.js";
export type { TUIAdapterConfig } from "./adapter.js";
export { TUIStore } from "./store.js";
export { createTUIBot } from "./factory.js";
export type { CreateTUIBotConfig } from "./factory.js";
export { TUIPlatformContext, createTUIPlatformContext } from "./context.js";
export type { TUIPlatformContextOptions } from "./context.js";
