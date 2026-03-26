/**
 * Feishu Store
 *
 * 飞书存储实现
 */

import { join, dirname } from "path";
import { mkdir, appendFile, readFile, writeFile } from "fs/promises";
import type { PlatformStore, Attachment as StoreAttachment, LoggedMessage, AttachmentInput } from "../../core/store/types.js";
import type { LarkClient } from "./client/index.js";
import type { PiLogger } from "../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

export interface FeishuStoreConfig {
	larkClient: LarkClient;
	workspaceDir: string;
	logger?: PiLogger;
}

export interface DownloadOptions {
	fileKey: string;
	channelId: string;
	timestamp: string;
	fileName?: string;
	messageId?: string;
	type?: "file" | "image";
}

// ============================================================================
// Feishu Store
// ============================================================================

/**
 * 飞书存储实现
 */
export class FeishuStore implements PlatformStore {
	private larkClient: LarkClient;
	private workspaceDir: string;
	private logger?: PiLogger;
	private lastTimestamps: Map<string, string> = new Map();

	constructor(config: FeishuStoreConfig) {
		this.larkClient = config.larkClient;
		this.workspaceDir = config.workspaceDir;
		this.logger = config.logger;
	}

	// ========================================================================
	// PlatformStore Implementation
	// ========================================================================

	async processAttachments(
		channelId: string,
		files: AttachmentInput[],
		timestamp: string
	): Promise<StoreAttachment[]> {
		const attachments: StoreAttachment[] = [];

		for (const file of files) {
			const attachment = await this.downloadAttachment(file, channelId, timestamp);
			if (attachment) {
				attachments.push(attachment);
			}
		}

		return attachments;
	}

	async downloadAttachmentNow(
		file: AttachmentInput,
		channelId: string,
		timestamp: string
	): Promise<StoreAttachment | null> {
		return this.downloadAttachment(file, channelId, timestamp);
	}

	async logMessage(channelId: string, message: LoggedMessage): Promise<boolean> {
		try {
			const logPath = this.getLogPath(channelId);
			await this.ensureDir(dirname(logPath));

			const logLine = `${message.date}\t${message.ts}\t${message.user}\t${message.userName || ""}\t${message.displayName || ""}\t${message.isBot ? "BOT" : "USER"}\t${message.text}\n`;
			await appendFile(logPath, logLine, "utf-8");

			this.lastTimestamps.set(channelId, message.ts);
			return true;
		} catch (error) {
			this.logger?.error("Failed to log message", undefined, error as Error);
			return false;
		}
	}

	async logBotResponse(channelId: string, text: string, ts: string): Promise<void> {
		const now = new Date();
		const date = now.toISOString().split("T")[0];

		await this.logMessage(channelId, {
			date,
			ts,
			user: "BOT",
			userName: "Bot",
			displayName: "Bot",
			text,
			isBot: true,
			attachments: [],
		});
	}

	getLastTimestamp(channelId: string): string | null {
		return this.lastTimestamps.get(channelId) || null;
	}

	// ========================================================================
	// Feishu Specific Methods
	// ========================================================================

	/**
	 * 下载图片
	 */
	async downloadImage(options: DownloadOptions): Promise<string | null> {
		const { fileKey, channelId, timestamp, fileName } = options;
		const localPath = this.getAttachmentPath(channelId, timestamp, fileName || `image-${timestamp}.jpg`);

		try {
			await this.ensureDir(dirname(localPath));
			await this.larkClient.downloadImage(fileKey, localPath);
			this.logger?.debug("Image downloaded", { fileKey, localPath });
			return localPath;
		} catch (error) {
			this.logger?.error("Failed to download image", undefined, error as Error);
			return null;
		}
	}

	/**
	 * 下载文件
	 */
	async downloadFile(options: DownloadOptions): Promise<string | null> {
		const { fileKey, channelId, timestamp, fileName, messageId, type } = options;
		const localPath = this.getAttachmentPath(channelId, timestamp, fileName || `file-${timestamp}`);
		
		console.log("[Feishu Store] Downloading file:", { fileKey, localPath, messageId });

		try {
			await this.ensureDir(dirname(localPath));
			
			// 如果有 messageId，使用 messageResource API（适用于音频、视频等）
			if (messageId) {
				await this.larkClient.downloadMessageResource(messageId, fileKey, localPath, type || "file");
			} else {
				await this.larkClient.downloadFile(fileKey, localPath);
			}
			
			// 验证文件是否真的被写入
			const { default: fs } = await import("fs");
			if (!fs.existsSync(localPath)) {
				console.error("[Feishu Store] File not found after download:", localPath);
				throw new Error("File not found after download");
			}
			
			const stats = fs.statSync(localPath);
			this.logger?.debug("File downloaded", { fileKey, localPath, size: stats.size });
			console.log("[Feishu Store] File downloaded successfully:", localPath, "Size:", stats.size);
			return localPath;
		} catch (error: any) {
			this.logger?.error("Failed to download file", undefined, error as Error);
			console.error("[Feishu Store] Failed to download file:", error);
			
			// 检测权限错误并抛出，让上层处理
			const errorStr = JSON.stringify(error);
			if (errorStr.includes("99991672")) {
				throw error;
			}
			
			return null;
		}
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * 下载单个附件
	 */
	private async downloadAttachment(
		file: AttachmentInput,
		channelId: string,
		timestamp: string
	): Promise<StoreAttachment | null> {
		const fileKey = file.file_key;
		if (!fileKey) {
			return null;
		}

		const fileName = file.name || `file-${timestamp}`;
		const localPath = this.getAttachmentPath(channelId, timestamp, fileName);

		try {
			await this.ensureDir(dirname(localPath));

			// 根据类型选择下载方法
			if (file.type === "image") {
				await this.larkClient.downloadImage(fileKey, localPath);
			} else {
				await this.larkClient.downloadFile(fileKey, localPath);
			}

			return {
				original: fileName,
				local: localPath,
			};
		} catch (error) {
			this.logger?.error("Failed to download attachment", undefined, error as Error);
			return null;
		}
	}

	/**
	 * 获取附件存储路径
	 */
	private getAttachmentPath(channelId: string, timestamp: string, fileName: string): string {
		return join(this.workspaceDir, "channels", channelId, "attachments", timestamp, fileName);
	}

	/**
	 * 获取日志文件路径
	 */
	private getLogPath(channelId: string): string {
		return join(this.workspaceDir, "channels", channelId, "messages.log");
	}

	/**
	 * 确保目录存在
	 */
	private async ensureDir(dir: string): Promise<void> {
		try {
			await mkdir(dir, { recursive: true });
		} catch (error: any) {
			if (error.code !== "EEXIST") {
				throw error;
			}
		}
	}
}
