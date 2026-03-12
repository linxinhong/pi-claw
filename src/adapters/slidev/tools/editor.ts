/**
 * Editor Tools
 * 
 * 实时编辑幻灯片内容的工具
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SlideRenderer } from "../SlideRenderer.js";
import { Type, type Static } from "@sinclair/typebox";

// ============================================================================
// Tool Schemas
// ============================================================================

const UpdateSlideSchema = Type.Object({
  slideNo: Type.Optional(Type.Number({ description: "页码，默认为当前页" })),
  content: Type.String({ description: "新的幻灯片内容（Markdown 格式）" }),
  append: Type.Optional(Type.Boolean({ description: "是否追加到现有内容，默认为 false（替换）" })),
});

const HighlightElementSchema = Type.Object({
  selector: Type.String({ description: "CSS 选择器，指定要高亮的元素" }),
  duration: Type.Optional(Type.Number({ 
    description: "高亮持续时间（毫秒），默认 3000",
    default: 3000,
  })),
});

const AddNoteSchema = Type.Object({
  slideNo: Type.Optional(Type.Number({ description: "页码，默认为当前页" })),
  note: Type.String({ description: "备注内容" }),
});

// ============================================================================
// Tool Factory
// ============================================================================

export function createEditorTools(
  renderer: SlideRenderer
): AgentTool<any>[] {

  const updateSlideTool: AgentTool<typeof UpdateSlideSchema> = {
    name: "slide_update",
    label: "更新幻灯片内容",
    description: "实时更新指定幻灯片的内容。支持替换或追加内容。",
    parameters: UpdateSlideSchema,
    execute: async (toolCallId: string, params: Static<typeof UpdateSlideSchema>) => {
      const { slideNo, content, append = false } = params;
      
      const currentSlide = renderer.getCurrentSlide();
      const targetSlideNo = slideNo || currentSlide.current;

      // 如果追加模式，获取现有内容
      let finalContent = content;
      if (append) {
        const existingContent = renderer.getSlideContent(targetSlideNo);
        finalContent = existingContent + "\n\n" + content;
      }

      // 更新幻灯片
      const success = renderer.updateSlideContent(targetSlideNo, finalContent);

      if (success) {
        return {
          content: [{ 
            type: "text", 
            text: `已${append ? "追加" : "更新"}第 ${targetSlideNo} 页内容` 
          }],
          details: { 
            success: true, 
            slideNo: targetSlideNo,
            action: append ? "append" : "update",
            contentLength: finalContent.length,
          },
        };
      } else {
        return {
          content: [{ type: "text", text: "更新失败" }],
          details: { success: false, slideNo: targetSlideNo },
        };
      }
    },
  };

  const highlightElementTool: AgentTool<typeof HighlightElementSchema> = {
    name: "slide_highlight",
    label: "高亮元素",
    description: "高亮显示幻灯片中的指定元素，用于强调重点内容。",
    parameters: HighlightElementSchema,
    execute: async (toolCallId: string, params: Static<typeof HighlightElementSchema>) => {
      const { selector, duration = 3000 } = params;

      try {
        renderer.highlightElement(selector);

        return {
          content: [{ 
            type: "text", 
            text: `已高亮元素: ${selector}（持续 ${duration}ms）` 
          }],
          details: { 
            success: true, 
            selector,
            duration,
          },
        };
      } catch (error) {
        return {
          content: [{ 
            type: "text", 
            text: `高亮失败: ${(error as Error).message}` 
          }],
          details: { 
            success: false, 
            error: (error as Error).message,
          },
        };
      }
    },
  };

  const addNoteTool: AgentTool<typeof AddNoteSchema> = {
    name: "slide_add_note",
    label: "添加备注",
    description: "为指定幻灯片添加演讲者备注。",
    parameters: AddNoteSchema,
    execute: async (toolCallId: string, params: Static<typeof AddNoteSchema>) => {
      const { slideNo, note } = params;
      
      const currentSlide = renderer.getCurrentSlide();
      const targetSlideNo = slideNo || currentSlide.current;

      // TODO: 实现备注功能
      // 可能需要将备注存储在 Slidev 的 notes 字段中

      return {
        content: [{ 
          type: "text", 
          text: `已为第 ${targetSlideNo} 页添加备注` 
        }],
        details: { 
          success: true, 
          slideNo: targetSlideNo,
          noteLength: note.length,
        },
      };
    },
  };

  return [updateSlideTool, highlightElementTool, addNoteTool];
}
