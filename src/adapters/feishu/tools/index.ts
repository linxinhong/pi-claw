/**
 * Tools Module Entry
 *
 * 飞书工具模块入口
 *
 * 提供飞书平台特定的 AI 工具，包括：
 * - 任务工具 (task.ts)
 * - 日历工具 (calendar.ts)
 * - IM 工具 (im.ts)
 */

import type { PlatformTool } from "../../../core/platform/tools/types.js";

/**
 * 获取飞书平台工具列表
 */
export function getFeishuTools(): PlatformTool[] {
	// 暂时返回空数组，工具将在后续实现
	return [];
}

// 导出工具创建函数（占位符）
export { createTaskTools } from "./task.js";
export { createCalendarTools } from "./calendar.js";
export { createIMTools } from "./im.js";
