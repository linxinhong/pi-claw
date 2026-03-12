/**
 * Slide Renderer
 * 
 * Slidev 渲染器，负责挂载和管理 Slidev 实例
 */

import type { SlideRendererConfig, SlideInfo, SlidevConfig } from "./types.js";
import type { Logger } from "../../utils/logger/types.js";

// ============================================================================
// Slide Renderer
// ============================================================================

export class SlideRenderer {
  private container: any;
  private config: SlideRendererConfig;
  private currentSlide: number = 1;
  private totalSlides: number = 0;
  private slidevInstance: any = null;
  private isInitialized: boolean = false;
  private logger?: Logger;

  constructor(config: SlideRendererConfig, logger?: Logger) {
    this.config = config;
    this.container = config.container;
    this.currentSlide = config.slidevConfig.initialSlide || 1;
    this.logger = logger;
    this.logger?.debug("[SlideRenderer] Created", { initialSlide: this.currentSlide });
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * 初始化渲染器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.logger?.info("[SlideRenderer] Initializing...");

    // 创建 Slidev 容器
    this.createContainer();

    // 加载 Slidev
    await this.loadSlidev();

    this.isInitialized = true;
    this.logger?.info("[SlideRenderer] Initialized", { totalSlides: this.totalSlides });
  }

  /**
   * 销毁渲染器
   */
  destroy(): void {
    if (!this.isInitialized) {
      return;
    }

    this.logger?.info("[SlideRenderer] Destroying...");

    // 销毁 Slidev 实例
    if (this.slidevInstance) {
      this.slidevInstance.destroy?.();
      this.slidevInstance = null;
    }

    // 清空容器
    this.container.innerHTML = "";

    this.isInitialized = false;
    this.logger?.info("[SlideRenderer] Destroyed");
  }

  // ============================================================================
  // Navigation
  // ============================================================================

  /**
   * 下一页
   */
  next(): boolean {
    if (!this.canGoNext()) {
      return false;
    }
    return this.goto(this.currentSlide + 1);
  }

  /**
   * 上一页
   */
  prev(): boolean {
    if (!this.canGoPrev()) {
      return false;
    }
    return this.goto(this.currentSlide - 1);
  }

  /**
   * 跳转到指定页
   */
  goto(slideNo: number): boolean {
    if (slideNo < 1 || slideNo > this.totalSlides) {
      this.logger?.warn(`[SlideRenderer] Invalid slide number: ${slideNo}`);
      return false;
    }

    this.currentSlide = slideNo;
    this.logger?.debug(`[SlideRenderer] Goto slide ${slideNo}`);

    // 更新 Slidev
    this.updateSlidevSlide();

    // 触发回调
    this.notifySlideChange();

    return true;
  }

  /**
   * 第一页
   */
  first(): boolean {
    return this.goto(1);
  }

  /**
   * 最后一页
   */
  last(): boolean {
    return this.goto(this.totalSlides);
  }

  // ============================================================================
  // Queries
  // ============================================================================

  /**
   * 获取当前幻灯片信息
   */
  getCurrentSlide(): SlideInfo {
    return {
      total: this.totalSlides,
      current: this.currentSlide,
      title: this.getSlideTitle(),
      content: this.getSlideContent(),
    };
  }

  /**
   * 是否可以下一页
   */
  canGoNext(): boolean {
    if (this.config.slidevConfig.loop) {
      return this.totalSlides > 1;
    }
    return this.currentSlide < this.totalSlides;
  }

  /**
   * 是否可以上一页
   */
  canGoPrev(): boolean {
    if (this.config.slidevConfig.loop) {
      return this.totalSlides > 1;
    }
    return this.currentSlide > 1;
  }

  /**
   * 获取幻灯片内容（用于 AI 理解）
   */
  getSlideContent(slideNo?: number): string {
    const targetSlide = slideNo || this.currentSlide;
    
    // 从 Slidev 获取当前页内容
    const slideElement = this.container.querySelector(`[data-slide="${targetSlide}"]`);
    if (!slideElement) {
      return "";
    }

    // 提取文本内容
    return slideElement.textContent || "";
  }

  /**
   * 获取幻灯片标题
   */
  getSlideTitle(slideNo?: number): string {
    const targetSlide = slideNo || this.currentSlide;
    
    // 查找 h1, h2, h3 作为标题
    const slideElement = this.container.querySelector(`[data-slide="${targetSlide}"]`);
    if (!slideElement) {
      return "";
    }

    const heading = slideElement.querySelector("h1, h2, h3");
    return heading?.textContent || "";
  }

  /**
   * 获取所有幻灯片大纲
   */
  getOutline(): Array<{ slideNo: number; title: string }> {
    const outline: Array<{ slideNo: number; title: string }> = [];
    
    for (let i = 1; i <= this.totalSlides; i++) {
      outline.push({
        slideNo: i,
        title: this.getSlideTitle(i),
      });
    }

    return outline;
  }

  // ============================================================================
  // Editing
  // ============================================================================

  /**
   * 更新幻灯片内容（实时编辑）
   */
  updateSlideContent(slideNo: number, content: string): boolean {
    // TODO: 实现通过 Slidev API 更新内容
    // 可能需要重新渲染或使用 Slidev 的实时编辑功能
    console.log(`[SlideRenderer] Update slide ${slideNo}:`, content);
    return true;
  }

  /**
   * 高亮指定元素
   */
  highlightElement(selector: string): void {
    const element = this.container.querySelector(selector);
    if (element) {
      element.classList.add("slidev-highlight");
      setTimeout(() => {
        element.classList.remove("slidev-highlight");
      }, 3000);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createContainer(): void {
    // 清空容器
    this.container.innerHTML = "";
    this.container.classList.add("slidev-container");

    // 添加基础样式
    const style = document.createElement("style");
    style.textContent = `
      .slidev-container {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }
      .slidev-highlight {
        animation: highlight-pulse 2s ease-in-out;
      }
      @keyframes highlight-pulse {
        0%, 100% { box-shadow: none; }
        50% { box-shadow: 0 0 20px #3b82f6; }
      }
    `;
    (document.head as any).appendChild(style);
  }

  private async loadSlidev(): Promise<void> {
    try {
      this.logger?.info("[SlideRenderer] Loading Slidev...");

      // 动态导入 Slidev（浏览器环境）
      const { createApp } = await import("@slidev/client" as string) as any;

      // 解析 Markdown 源
      const slides = this.parseMarkdown(this.config.slidevConfig.source);
      this.totalSlides = slides.length;

      // 创建 Slidev 应用
      const app = createApp({
        slides,
        theme: this.config.slidevConfig.theme,
        options: {
          loop: this.config.slidevConfig.loop,
        },
      });

      // 挂载
      const slidevContainer = document.createElement("div");
      this.container.appendChild(slidevContainer);
      
      this.slidevInstance = app.mount(slidevContainer);

      // 监听页面变更
      this.setupSlideListeners();

      // 跳转到初始页
      this.goto(this.currentSlide);

      this.logger?.info(`[SlideRenderer] Loaded ${this.totalSlides} slides`);
    } catch (error) {
      this.logger?.error("[SlideRenderer] Failed to load Slidev", undefined, error as Error);
      throw error;
    }
  }

  private parseMarkdown(source: string): Array<{ content: string; frontmatter?: Record<string, unknown> }> {
    // 简单的 Markdown 解析
    // 实际项目中可能需要更复杂的解析逻辑
    const slides = source.split(/^---\s*$/m);
    
    return slides.map((slide) => {
      const lines = slide.trim().split("\n");
      const frontmatter: Record<string, unknown> = {};
      let content = slide;

      // 解析 frontmatter
      if (lines[0]?.trim() === "---") {
        const endIndex = lines.indexOf("---", 1);
        if (endIndex > 0) {
          const frontmatterLines = lines.slice(1, endIndex);
          for (const line of frontmatterLines) {
            const match = line.match(/^(.+):\s*(.+)$/);
            if (match) {
              frontmatter[match[1].trim()] = match[2].trim();
            }
          }
          content = lines.slice(endIndex + 1).join("\n");
        }
      }

      return { content, frontmatter };
    }).filter(s => s.content.trim());
  }

  private setupSlideListeners(): void {
    // 监听键盘事件
    this.container.addEventListener("keydown", (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
          this.next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          this.prev();
          break;
        case "Home":
          this.first();
          break;
        case "End":
          this.last();
          break;
      }
    });

    // 确保容器可聚焦以接收键盘事件
    this.container.tabIndex = 0;
  }

  private updateSlidevSlide(): void {
    // 通过 Slidev API 更新当前页
    if (this.slidevInstance?.go) {
      this.slidevInstance.go(this.currentSlide);
    }
  }

  private notifySlideChange(): void {
    const slideInfo = this.getCurrentSlide();
    this.config.onSlideChange?.(slideInfo);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSlideRenderer(config: SlideRendererConfig, logger?: Logger): SlideRenderer {
  return new SlideRenderer(config, logger);
}
