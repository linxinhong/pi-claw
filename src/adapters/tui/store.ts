/**
 * TUI Store
 *
 * TUI 平台存储实现 - 简化版本，不需要附件处理
 */

import { BaseStore, type Attachment, type AttachmentInput } from "../../core/store/index.js";

// ============================================================================
// TUI Store
// ============================================================================

/**
 * TUI 存储实现
 *
 * TUI 模式不需要附件下载，只提供基本的日志功能
 */
export class TUIStore extends BaseStore {
	constructor(config: { workspaceDir: string }) {
		super({ workspaceDir: config.workspaceDir });
	}

	/**
	 * 处理附件（TUI 模式不需要）
	 */
	async processAttachments(
		_channelId: string,
		_files: AttachmentInput[],
		_timestamp: string,
	): Promise<Attachment[]> {
		// TUI 模式不支持附件，返回空数组
		return [];
	}
}
