/**
 * Components Index
 * 
 * Vue 组件导出
 * 
 * 注意: 这些组件是浏览器环境使用的 Vue 组件。
 * 在 Node.js 环境中，这些组件会被动态导入或作为 shim 提供。
 */

import type { FloatingChatProps } from "../types.js";

// ============================================================================
// Vue Component Types (for browser environment)
// ============================================================================

/**
 * FloatingChat 组件类型
 */
export interface FloatingChatComponent {
  addMessage(message: { id: string; role: string; content: string; timestamp: number }): void;
  addAssistantMessage(content: string, isVoice?: boolean): void;
  setLoading(loading: boolean): void;
  setListening(listening: boolean): void;
  setSpeaking(speaking: boolean): void;
  toggleChat(): void;
  isOpen: boolean;
}

/**
 * VoiceWave 组件类型
 */
export interface VoiceWaveComponent {
  active: boolean;
  mode: "input" | "output";
}

// ============================================================================
// Component Exports
// ============================================================================

/**
 * FloatingChat 组件（浏览器环境动态导入）
 * 
 * 在 Node.js 环境中使用时，这是一个 shim。
 * 实际组件文件: ./FloatingChat.vue
 */
export const FloatingChat: any = null;

/**
 * VoiceWave 组件（浏览器环境动态导入）
 * 
 * 在 Node.js 环境中使用时，这是一个 shim。
 * 实际组件文件: ./VoiceWave.vue
 */
export const VoiceWave: any = null;

// ============================================================================
// Component Factory Functions
// ============================================================================

/**
 * 创建悬浮聊天组件（浏览器环境）
 * 
 * 注意: 此函数仅在浏览器环境中可用
 */
export async function createFloatingChat(props: FloatingChatProps & {
  onSend?: (text: string) => void;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
}): Promise<{ instance: any; unmount: () => void } | null> {
  // 检查是否在浏览器环境
  if (typeof (globalThis as any).window === "undefined") {
    console.warn("[createFloatingChat] This function is only available in browser environment");
    return null;
  }

  // 动态导入 Vue 和组件 - 只在浏览器环境执行
  const [{ createApp }, FloatingChatModule] = await Promise.all([
    import("vue" as string),
    import("./FloatingChat.vue" as string),
  ]);

  const FloatingChatComponent = FloatingChatModule.default || FloatingChatModule;

  const doc = (globalThis as any).document;
  const container = doc.createElement("div");
  doc.body.appendChild(container);

  const app = createApp(FloatingChatComponent, {
    position: props.position,
    placeholder: props.placeholder,
    initialOpen: props.initialOpen,
  });

  const instance = app.mount(container);

  return {
    instance,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

// ============================================================================
// Re-exports for backward compatibility
// ============================================================================

export default {
  FloatingChat,
  VoiceWave,
  createFloatingChat,
};
