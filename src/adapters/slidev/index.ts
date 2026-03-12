/**
 * Slidev Adapter
 * 
 * PPT 演示 Adapter - 主入口
 * 
 * 使用示例:
 * ```typescript
 * import { createSlidevAdapter } from "@linxinhong/pi-claw/adapters/slidev";
 * 
 * const adapter = createSlidevAdapter({
 *   container: document.getElementById("slidev-container")!,
 *   slidev: {
 *     source: `# 标题\n\n---\n\n# 第二页`,
 *   },
 *   ai: {
 *     model: "gpt-4",
 *     apiKey: "your-api-key",
 *   },
 * });
 * 
 * await adapter.initialize({ platform: "slidev", enabled: true });
 * await adapter.start();
 * ```
 */

// ============================================================================
// Core Exports
// ============================================================================

export { SlidevAdapter, createSlidevAdapter } from "./adapter.js";
export { SlidevPlatformContext, createSlidevPlatformContext } from "./context.js";
export { createSlidevBot, slidevAdapterFactory } from "./factory.js";

// ============================================================================
// Core Classes
// ============================================================================

export { StateMachine, createStateMachine } from "./StateMachine.js";
export { SlideRenderer, createSlideRenderer } from "./SlideRenderer.js";

// ============================================================================
// Engines
// ============================================================================

export {
  WebSpeechTTSEngine,
  DashscopeTTSEngine,
  createTTSEngine,
} from "./TTSEngine.js";

export {
  WebSpeechSTTEngine,
  MockSTTEngine,
  createSTTEngine,
} from "./STTEngine.js";

// ============================================================================
// Tools
// ============================================================================

export {
  createNavigationTools,
  createTTSTools,
  createEditorTools,
  createAllTools,
  createNavigationToolsOnly,
  createTTSToolsOnly,
} from "./tools/index.js";

export type { ToolDependencies } from "./tools/index.js";

// ============================================================================
// Messaging
// ============================================================================

export {
  MessageHandler,
  createMessageHandler,
} from "./messaging/index.js";

export type {
  MessageContext,
  ParseResult,
} from "./messaging/index.js";

// ============================================================================
// Server (Express Integration)
// ============================================================================

export {
  setupSlidevServer,
  createSlidevRouter,
  setupStaticFiles,
} from "./server/index.js";

export type {
  SlidevServerOptions,
} from "./server/index.js";

// ============================================================================
// Components (Vue)
// ============================================================================

export {
  FloatingChat,
  VoiceWave,
  createFloatingChat,
} from "./components/index.js";

// ============================================================================
// Types
// ============================================================================

export type {
  // Core Types
  SlidevAdapterConfig,
  ISlidevAdapter,
  PresentationState,
  PresentationMode,
  
  // State Machine
  StateChangeEvent,
  StateMachineConfig,
  
  // Renderer
  SlidevConfig,
  SlideInfo,
  SlideRendererConfig,
  
  // TTS/STT
  TTSEngine,
  STTEngine,
  TTSConfig,
  STTConfig,
  
  // Tools
  NavigationToolParams,
  TTSToolParams,
  EditorToolParams,
  
  // Components
  ChatMessage,
  FloatingChatProps,
  VoiceWaveProps,
} from "./types.js";

// ============================================================================
// Auto Registration
// ============================================================================

import { adapterRegistry } from "../../core/adapter/index.js";
import { slidevAdapterFactory } from "./factory.js";

// 自注册到 Adapter Registry
adapterRegistry.register(slidevAdapterFactory);

console.log("[SlidevAdapter] Registered to adapterRegistry");

// ============================================================================
// Version
// ============================================================================

export const VERSION = "1.0.0";
