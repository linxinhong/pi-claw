/**
 * Base Store
 *
 * 通用存储基类，平台无关
 * 提供频道目录管理和消息日志功能
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { Attachment, BaseStoreConfig, LoggedMessage, PlatformStore, AttachmentInput } from "./types.js";

// ============================================================================
// Base Store
// ============================================================================

/**
 * 通用存储基类
 *
 * 提供平台无关的存储功能：
 * - 频道目录管理
 * - 消息日志
 * - 时间戳查询
 */
export abstract class BaseStore implements PlatformStore {
	protected workspaceDir: string;
	private recentlyLogged = new Map<string, number>();

	constructor(config: BaseStoreConfig) {
		this.workspaceDir = config.workspaceDir;

		if (!existsSync(this.workspaceDir)) {
			mkdirSync(this.workspaceDir, { recursive: true });
		}
	}

	// ========== 目录管理 ==========

	/**
	 * 获取频道目录
	 */
	getChannelDir(channelId: string): string {
		const dir = join(this.workspaceDir, "chats", channelId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	/**
	 * 获取工作目录
	 */
	getWorkspaceDir(): string {
		return this.workspaceDir;
	}

	/**
	 * 生成本地文件名
	 */
	generateLocalFilename(originalName: string, timestamp: string): string {
		const ts = timestamp.length > 10 ? timestamp.slice(0, 13) : Date.now().toString();
		const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
		return `${ts}_${sanitized}`;
	}

	// ========== 消息日志 ==========

	/**
	 * 记录消息
	 */
	async logMessage(channelId: string, message: LoggedMessage): Promise<boolean> {
		const dedupeKey = `${channelId}:${message.ts}`;
		if (this.recentlyLogged.has(dedupeKey)) {
			return false;
		}

		this.recentlyLogged.set(dedupeKey, Date.now());
		setTimeout(() => this.recentlyLogged.delete(dedupeKey), 60000);

		const logPath = join(this.getChannelDir(channelId), "history.jsonl");

		if (!message.date) {
			const date = message.ts.includes(".")
				? new Date(parseFloat(message.ts) * 1000)
				: new Date(parseInt(message.ts, 10));
			message.date = date.toISOString();
		}

		const line = `${JSON.stringify(message)}\n`;
		await appendFile(logPath, line, "utf-8");
		return true;
	}

	/**
	 * 记录 Bot 响应
	 */
	async logBotResponse(channelId: string, text: string, ts: string): Promise<void> {
		await this.logMessage(channelId, {
			date: new Date().toISOString(),
			ts,
			user: "bot",
			text,
			attachments: [],
			isBot: true,
		});
	}

	/**
	 * 获取最后一条消息的时间戳
	 */
	getLastTimestamp(channelId: string): string | null {
		const logPath = join(this.workspaceDir, "chats", channelId, "history.jsonl");
		if (!existsSync(logPath)) return null;

		try {
			const content = readFileSync(logPath, "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0 || lines[0] === "") return null;
			const lastLine = lines[lines.length - 1];
			const message = JSON.parse(lastLine) as LoggedMessage;
			return message.ts;
		} catch {
			return null;
		}
	}

	// ========== 抽象方法（由平台实现） ==========

	/**
	 * 处理附件（由平台实现）
	 */
	abstract processAttachments(
		channelId: string,
		files: AttachmentInput[],
		timestamp: string
	): Attachment[] | Promise<Attachment[]>;
}
