/**
 * TTS Tools
 * 
 * 语音朗读相关工具
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TTSEngine } from "../types.js";
import type { SlideRenderer } from "../SlideRenderer.js";
import { Type, type Static } from "@sinclair/typebox";

// ============================================================================
// Tool Schemas
// ============================================================================

const SpeakSchema = Type.Object({
  text: Type.String({ description: "要朗读的文本内容" }),
  voice: Type.Optional(Type.String({ description: "语音类型（如支持）" })),
  rate: Type.Optional(Type.Number({ 
    description: "语速，0.1-10，默认为 1",
    minimum: 0.1,
    maximum: 10,
  })),
});

const SpeakSlideSchema = Type.Object({
  slideNo: Type.Optional(Type.Number({ description: "页码，默认为当前页" })),
  includeTitle: Type.Optional(Type.Boolean({ description: "是否包含标题，默认为 true" })),
});

const StopSpeakingSchema = Type.Object({});

// ============================================================================
// Tool Factory
// ============================================================================

export function createTTSTools(
  ttsEngine: TTSEngine,
  renderer: SlideRenderer
): AgentTool<any>[] {

  const speakTool: AgentTool<typeof SpeakSchema> = {
    name: "tts_speak",
    label: "语音朗读",
    description: "将指定文本转换为语音朗读。",
    parameters: SpeakSchema,
    execute: async (toolCallId: string, params: Static<typeof SpeakSchema>) => {
      const { text, voice, rate } = params;

      try {
        // 开始朗读
        await ttsEngine.speak(text, { voice, rate });

        return {
          content: [{ type: "text", text: `已朗读: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"` }],
          details: { success: true, textLength: text.length },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `朗读失败: ${(error as Error).message}` }],
          details: { success: false, error: (error as Error).message },
        };
      }
    },
  };

  const speakSlideTool: AgentTool<typeof SpeakSlideSchema> = {
    name: "tts_speak_slide",
    label: "朗读当前幻灯片",
    description: "朗读当前或指定幻灯片的内容。",
    parameters: SpeakSlideSchema,
    execute: async (toolCallId: string, params: Static<typeof SpeakSlideSchema>) => {
      const { slideNo, includeTitle = true } = params;

      // 获取幻灯片内容
      const slideInfo = renderer.getCurrentSlide();
      const targetSlideNo = slideNo || slideInfo.current;
      
      const title = includeTitle ? renderer.getSlideTitle(targetSlideNo) : "";
      const content = renderer.getSlideContent(targetSlideNo);

      if (!content && !title) {
        return {
          content: [{ type: "text", text: "当前幻灯片没有可朗读的内容" }],
          details: { success: false, error: "No content" },
        };
      }

      // 组合文本
      const textToSpeak = title ? `${title}。${content}` : content;

      try {
        await ttsEngine.speak(textToSpeak);

        return {
          content: [{ 
            type: "text", 
            text: `已朗读第 ${targetSlideNo} 页${title ? ` "${title}"` : ""}` 
          }],
          details: { 
            success: true, 
            slideNo: targetSlideNo,
            title,
            contentLength: content.length,
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `朗读失败: ${(error as Error).message}` }],
          details: { success: false, error: (error as Error).message },
        };
      }
    },
  };

  const stopSpeakingTool: AgentTool<typeof StopSpeakingSchema> = {
    name: "tts_stop",
    label: "停止朗读",
    description: "停止当前的语音朗读。",
    parameters: StopSpeakingSchema,
    execute: async () => {
      ttsEngine.stop();

      return {
        content: [{ type: "text", text: "已停止朗读" }],
        details: { success: true },
      };
    },
  };

  return [speakTool, speakSlideTool, stopSpeakingTool];
}
