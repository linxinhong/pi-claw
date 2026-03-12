/**
 * Navigation Tools
 * 
 * 幻灯片导航相关工具
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SlideRenderer } from "../SlideRenderer.js";
import type { StateMachine } from "../StateMachine.js";
import { Type, type Static } from "@sinclair/typebox";

// ============================================================================
// Tool Schemas
// ============================================================================

const NavigateSchema = Type.Object({
  action: Type.String({ 
    description: "导航动作: next(下一页), prev(上一页), goto(跳转到指定页), first(第一页), last(最后一页)" 
  }),
  slideNo: Type.Optional(Type.Number({ 
    description: "目标页码（当 action 为 goto 时使用，从 1 开始）" 
  })),
});

const GetSlideInfoSchema = Type.Object({});

const GetOutlineSchema = Type.Object({});

// ============================================================================
// Tool Factory
// ============================================================================

export function createNavigationTools(
  renderer: SlideRenderer,
  stateMachine: StateMachine
): AgentTool<any>[] {
  
  const navigateTool: AgentTool<typeof NavigateSchema> = {
    name: "slide_navigate",
    label: "幻灯片导航",
    description: "控制幻灯片翻页，支持下一页、上一页、跳转到指定页等操作。只能在 PLAYING 或 PAUSED 状态下使用。",
    parameters: NavigateSchema,
    execute: async (toolCallId: string, params: Static<typeof NavigateSchema>) => {
      // 检查状态
      if (!stateMachine.canNavigate()) {
        return {
          content: [{ type: "text", text: "当前状态不允许导航，请先开始演示" }],
          details: { success: false, error: "Invalid state" },
        };
      }

      const { action, slideNo } = params;
      let success = false;
      let message = "";

      switch (action) {
        case "next":
          success = renderer.next();
          message = success ? "已切换到下一页" : "已经是最后一页";
          break;
        
        case "prev":
          success = renderer.prev();
          message = success ? "已切换到上一页" : "已经是第一页";
          break;
        
        case "goto":
          if (slideNo === undefined) {
            return {
              content: [{ type: "text", text: "请提供目标页码" }],
              details: { success: false, error: "Missing slideNo" },
            };
          }
          success = renderer.goto(slideNo);
          message = success ? `已跳转到第 ${slideNo} 页` : `无效的页码: ${slideNo}`;
          break;
        
        case "first":
          success = renderer.first();
          message = success ? "已跳转到第一页" : "跳转失败";
          break;
        
        case "last":
          success = renderer.last();
          message = success ? "已跳转到最后一页" : "跳转失败";
          break;
        
        default:
          return {
            content: [{ type: "text", text: `未知的导航动作: ${action}` }],
            details: { success: false, error: `Unknown action: ${action}` },
          };
      }

      // 获取当前页信息
      const currentSlide = renderer.getCurrentSlide();

      return {
        content: [{ 
          type: "text", 
          text: `${message}\n当前: 第 ${currentSlide.current} / ${currentSlide.total} 页${currentSlide.title ? `，标题: "${currentSlide.title}"` : ""}` 
        }],
        details: { 
          success, 
          currentSlide: currentSlide.current,
          totalSlides: currentSlide.total,
          title: currentSlide.title,
        },
      };
    },
  };

  const getSlideInfoTool: AgentTool<typeof GetSlideInfoSchema> = {
    name: "slide_get_info",
    label: "获取幻灯片信息",
    description: "获取当前幻灯片的详细信息，包括页码、标题、内容等。",
    parameters: GetSlideInfoSchema,
    execute: async () => {
      const info = renderer.getCurrentSlide();
      const content = renderer.getSlideContent();
      
      // 限制内容长度
      const maxLength = 500;
      const truncatedContent = content.length > maxLength 
        ? content.slice(0, maxLength) + "..." 
        : content;

      return {
        content: [{ 
          type: "text", 
          text: `第 ${info.current} / ${info.total} 页\n标题: ${info.title || "(无标题)"}\n内容:\n${truncatedContent}` 
        }],
        details: { 
          current: info.current, 
          total: info.total, 
          title: info.title,
          contentLength: content.length,
        },
      };
    },
  };

  const getOutlineTool: AgentTool<typeof GetOutlineSchema> = {
    name: "slide_get_outline",
    label: "获取演示大纲",
    description: "获取整个演示文稿的大纲结构，包含所有页面的标题。",
    parameters: GetOutlineSchema,
    execute: async () => {
      const outline = renderer.getOutline();
      
      const outlineText = outline
        .map(item => `${item.slideNo}. ${item.title || "(无标题)"}`)
        .join("\n");

      return {
        content: [{ 
          type: "text", 
          text: `演示大纲:\n${outlineText}` 
        }],
        details: { outline, totalSlides: outline.length },
      };
    },
  };

  return [navigateTool, getSlideInfoTool, getOutlineTool];
}
