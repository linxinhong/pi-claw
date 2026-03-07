/**
 * Feishu Adapter
 *
 * 飞书平台适配器 - 实现 PlatformAdapter 接口
 */

import * as lark from "@larksuiteoapi/node-sdk";
import express, { type Request, type Response } from "express";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import type {
	PlatformAdapter,
	PlatformConfig,
	UniversalMessage,
	UniversalResponse,
	UserInfo,
	ChannelInfo,
} from "../../core/platform/adapter.js";
import type { PlatformContext } from "../../core/platform/context.js";
import { FeishuPlatformContext } from "./context.js";
import { parseFeishuMessage } from "./message-parser.js";
import type { Logger } from "../../utils/logger/index.js";
import { PiLogger } from "../../utils/logger/index.js";
import { getHookManager, HOOK_NAMES } from "../../core/hook/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 飞书适配器配置
 */
export interface FeishuAdapterConfig extends PlatformConfig {
	/** 应用 ID */
	appId: string;
	/** 应用密钥 */
	appSecret: string;
	/** 工作目录 */
	workingDir: string;
	/** 是否使用 WebSocket */
	useWebSocket?: boolean;
	/** 服务端口 */
	port?: number;
	/** 日志器 */
	logger?: Logger;
}

/**
 * 频道队列
 */
type QueuedWork = () => Promise<void>;

class ChannelQueue {
	private queue: QueuedWork[] = [];
	private processing = false;

	enqueue(work: QueuedWork): void {
		this.queue.push(work);
		this.processNext();
	}

	size(): number {
		return this.queue.length;
	}

	private async processNext(): Promise<void> {
		if (this.processing || this.queue.length === 0) return;
		this.processing = true;
		const work = this.queue.shift()!;
		try {
			await work();
		} catch (err) {
			console.error("[FeishuAdapter Queue] Error:", err);
		}
		this.processing = false;
		this.processNext();
	}
}

// ============================================================================
// Feishu Adapter
// ============================================================================

/**
 * 飞书平台适配器
 */
export class FeishuAdapter implements PlatformAdapter {
	readonly platform = "feishu";

	private client: lark.Client;
	private wsClient: lark.WSClient | null = null;
	private app: ReturnType<typeof express> | null = null;
	private workingDir: string;
	private logger: Logger;

	private users = new Map<string, UserInfo>();
	private channels = new Map<string, ChannelInfo>();
	private queues = new Map<string, ChannelQueue>();
	private messageHandlers: Array<(message: UniversalMessage) => void> = [];

	private runningChannels = new Map<string, { abort: () => void }>();
	private startupTs: string | null = null;

	constructor(config: FeishuAdapterConfig) {
		this.workingDir = config.workingDir;
		this.logger = config.logger || new PiLogger("feishu:adapter");

		this.client = new lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
			disableTokenCache: false,
		});

		if (config.useWebSocket !== false) {
			this.wsClient = new lark.WSClient({
				appId: config.appId,
				appSecret: config.appSecret,
				loggerLevel: lark.LoggerLevel.info,
			});
		}

		this.logger.debug("FeishuAdapter initialized", { appId: config.appId });
	}

	// ========================================================================
	// PlatformAdapter Implementation
	// ========================================================================

	async initialize(config: PlatformConfig): Promise<void> {
		// 配置已在构造函数中设置
	}

	async start(): Promise<void> {
		// 获取用户和频道列表
		await Promise.all([this.fetchUsers(), this.fetchChannels()]);
		this.logger.info(`Loaded ${this.channels.size} channels, ${this.users.size} users`);

		// 记录启动时间
		this.startupTs = Date.now().toString();

		// 启动 WebSocket 或 Webhook
		if (this.wsClient) {
			await this.startWebSocket();
		} else {
			await this.startWebhook(3000); // 默认端口 3000
		}

		// 触发 ADAPTER_CONNECT hook
		const hookManager = getHookManager();
		if (hookManager.hasHooks(HOOK_NAMES.ADAPTER_CONNECT)) {
			await hookManager.emit(HOOK_NAMES.ADAPTER_CONNECT, {
				platform: "feishu",
				timestamp: new Date(),
			});
		}
	}

	async stop(): Promise<void> {
		// 触发 ADAPTER_DISCONNECT hook
		const hookManager = getHookManager();
		if (hookManager.hasHooks(HOOK_NAMES.ADAPTER_DISCONNECT)) {
			await hookManager.emit(HOOK_NAMES.ADAPTER_DISCONNECT, {
				platform: "feishu",
				timestamp: new Date(),
			});
		}
		this.logger.info("FeishuAdapter stopped");
	}

	async sendMessage(response: UniversalResponse): Promise<void> {
		this.logger.debug("Sending message", { response });
	}

	async updateMessage(messageId: string, response: UniversalResponse): Promise<void> {
		const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
		await this.client.im.message.patch({
			path: { message_id: messageId },
			data: { content: this.buildTextCard(content) },
		} as any);
	}

	async deleteMessage(messageId: string): Promise<void> {
		await this.client.im.message.delete({
			path: { message_id: messageId },
		});
	}

	async uploadFile(filePath: string): Promise<string> {
		const ext = filePath.toLowerCase().split(".").pop() || "";

		const fileTypeMap: Record<string, string> = {
			pdf: "pdf",
			doc: "doc",
			docx: "doc",
			xls: "xls",
			xlsx: "xls",
			ppt: "ppt",
			pptx: "ppt",
			mp4: "mp4",
			opus: "opus",
		};
		const fileType = fileTypeMap[ext] || "stream";

		const fileContent = readFileSync(filePath);

		const uploadResult = await (this.client.im.file as any).create({
			data: {
				file_type: fileType,
				file_name: basename(filePath),
				file: fileContent,
			},
		});

		if (!uploadResult?.file_key) {
			throw new Error("Failed to upload file: no file_key returned");
		}

		return uploadResult.file_key;
	}

	async uploadImage(imagePath: string): Promise<string> {
		const result = await this.client.im.image.create({
			data: {
				image_type: "message",
				image: readFileSync(imagePath),
			},
		});

		if (!result?.image_key) {
			throw new Error("Failed to upload image: no image_key returned");
		}

		return result.image_key;
	}

	async getUserInfo(userId: string): Promise<UserInfo | undefined> {
		return this.users.get(userId);
	}

	async getAllUsers(): Promise<UserInfo[]> {
		return Array.from(this.users.values());
	}

	async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
		return this.channels.get(channelId);
	}

	async getAllChannels(): Promise<ChannelInfo[]> {
		return Array.from(this.channels.values());
	}

	onMessage(handler: (message: UniversalMessage) => void): void {
		this.messageHandlers.push(handler);
	}

	createPlatformContext(chatId: string): PlatformContext {
		return new FeishuPlatformContext({
			client: this.client,
			chatId,
			postMessage: async (chatId, text) => this.postMessage(chatId, text),
			updateMessage: async (messageId, text) => this.updateMessage(messageId, { type: "text", content: text }),
			deleteMessage: async (messageId) => this.deleteMessage(messageId),
			uploadFile: async (chatId, filePath, title) => this.uploadFileToChat(chatId, filePath, title),
			uploadImage: async (imagePath) => this.uploadImage(imagePath),
			sendImage: async (chatId, imageKey) => this.sendImageToChat(chatId, imageKey),
			sendVoiceMessage: async (chatId, filePath) => this.sendVoiceToChat(chatId, filePath),
			postInThread: async (chatId, parentMessageId, text) => this.postInThread(chatId, parentMessageId, text),
		});
	}

	isRunning(channelId: string): boolean {
		return this.runningChannels.has(channelId);
	}

	setRunning(channelId: string, abort: () => void): void {
		this.runningChannels.set(channelId, { abort });
	}

	clearRunning(channelId: string): void {
		this.runningChannels.delete(channelId);
	}

	abortChannel(channelId: string): void {
		const running = this.runningChannels.get(channelId);
		if (running) {
			running.abort();
			this.runningChannels.delete(channelId);
		}
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	private buildTextCard(text: string): string {
		return JSON.stringify({
			schema: "2.0",
			config: { width_mode: "fill", update_multi: true },
			body: {
				elements: [{ tag: "div", text: { tag: "lark_md", content: text } }],
			},
		});
	}

	private async postMessage(channel: string, text: string): Promise<string> {
		const hookManager = getHookManager();

		// 发送前触发 MESSAGE_SEND hook
		if (hookManager.hasHooks(HOOK_NAMES.MESSAGE_SEND)) {
			await hookManager.emit(HOOK_NAMES.MESSAGE_SEND, {
				channelId: channel,
				text: text,
				timestamp: new Date(),
			});
		}

		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "interactive",
				content: this.buildTextCard(text),
			},
		});

		const messageId = result.data?.message_id || "";

		// 发送后触发 MESSAGE_SENT hook
		if (hookManager.hasHooks(HOOK_NAMES.MESSAGE_SENT)) {
			await hookManager.emit(HOOK_NAMES.MESSAGE_SENT, {
				channelId: channel,
				messageId: messageId,
				text: text,
				success: result.code === 0,
				error: result.code !== 0 ? result.msg : undefined,
				timestamp: new Date(),
			});
		}

		if (result.code !== 0) {
			throw new Error(`Failed to post message: ${result.msg}`);
		}

		return messageId;
	}

	private async postInThread(channel: string, parentMessageId: string, text: string): Promise<string> {
		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "text",
				content: JSON.stringify({ text }),
				root_id: parentMessageId,
			},
		} as any);

		if (result.code !== 0) {
			throw new Error(`Failed to post in thread: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	private async sendImageToChat(channel: string, imageKey: string): Promise<string> {
		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "image",
				content: JSON.stringify({ image_key: imageKey }),
			},
		});

		if (result.code !== 0) {
			throw new Error(`Failed to send image: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	private async uploadFileToChat(channel: string, filePath: string, title?: string): Promise<void> {
		const fileName = title || basename(filePath);
		const ext = filePath.toLowerCase().split(".").pop() || "";

		const imageExtensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "ico", "tiff", "heic"];

		if (imageExtensions.includes(ext)) {
			const imageKey = await this.uploadImage(filePath);
			await this.sendImageToChat(channel, imageKey);
			return;
		}

		const fileKey = await this.uploadFile(filePath);

		await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "file",
				content: JSON.stringify({ file_key: fileKey }),
			},
		});
	}

	private async sendVoiceToChat(channel: string, filePath: string): Promise<string> {
		const fileName = basename(filePath);
		const fileContent = readFileSync(filePath);

		const uploadResult = await (this.client.im.file as any).create({
			data: {
				file_type: "opus",
				file_name: fileName,
				file: fileContent,
			},
		});

		if (!uploadResult?.file_key) {
			throw new Error("Failed to upload audio file: no file_key returned");
		}

		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "audio",
				content: JSON.stringify({ file_key: uploadResult.file_key }),
			},
		});

		if (result.code !== 0) {
			throw new Error(`Failed to send voice message: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	private async startWebSocket(): Promise<void> {
		this.logger.info("Starting WebSocket mode");

		const eventDispatcher = new lark.EventDispatcher({}).register({
			"im.message.receive_v1": async (data: any) => {
				await this.handleMessageEvent(data);
			},
		});

		this.wsClient!.start({ eventDispatcher });
		this.logger.info("WebSocket client started");
	}

	private async startWebhook(port: number): Promise<void> {
		this.logger.info("Starting HTTP webhook mode", { port });

		this.app = express();
		this.app.use(express.json({ limit: "10mb" }));

		this.app.get("/health", (_req: Request, res: Response) => {
			res.json({ status: "ok" });
		});

		this.app.post("/webhook", async (req: Request, res: Response) => {
			await this.handleWebhook(req, res);
		});

		return new Promise((resolve, reject) => {
			this.app!.listen(port, () => {
				this.logger.info(`Server listening on port ${port}`);
				resolve();
			}).on("error", reject);
		});
	}

	private async handleWebhook(req: Request, res: Response): Promise<void> {
		const body = req.body;

		if (body.type === "url_verification") {
			res.json({ challenge: body.challenge });
			return;
		}

		const header = body.header;
		const event = body.event;

		if (!header || !event) {
			res.status(400).json({ error: "Invalid event format" });
			return;
		}

		if (header.event_type === "im.message.receive_v1") {
			await this.handleMessageEvent(event);
		}

		res.json({ code: 0, msg: "success" });
	}

	private async handleMessageEvent(event: any): Promise<void> {
		const message = event.message;
		if (!message) return;

		const chatId = message.chat_id;
		const sender = event.sender;

		// 跳过 bot 消息
		if (sender?.sender_type === "app") return;

		// 解析消息
		const userInfo = this.users.get(sender?.sender_id?.user_id || "");
		const universalMessage = parseFeishuMessage(event, userInfo);

		// 跳过旧消息
		if (this.startupTs && universalMessage.timestamp.getTime() < parseInt(this.startupTs)) {
			this.logger.debug(`Skipping old message: ${universalMessage.content.substring(0, 30)}`);
			return;
		}

		// 分发消息
		for (const handler of this.messageHandlers) {
			try {
				await handler(universalMessage);
			} catch (error) {
				this.logger.error("Message handler error", undefined, error instanceof Error ? error : new Error(String(error)));
			}
		}
	}

	private async fetchUsers(): Promise<void> {
		try {
			let pageToken: string | undefined;
			do {
				const result = await this.client.contact.user.list({
					params: { page_size: 100, page_token: pageToken },
				});

				if (result.code === 0 && result.data?.items) {
					for (const user of result.data.items) {
						if (user.user_id) {
							this.users.set(user.user_id, {
								id: user.user_id,
								userName: user.name || user.user_id,
								displayName: user.nickname || user.name || user.user_id,
							});
						}
					}
				}

				pageToken = result.data?.page_token;
			} while (pageToken);
		} catch (err) {
			this.logger.error("Failed to fetch users", undefined, err instanceof Error ? err : new Error(String(err)));
		}
	}

	private async fetchChannels(): Promise<void> {
		try {
			let pageToken: string | undefined;
			do {
				const result = await this.client.im.chat.list({
					params: { page_size: 100, page_token: pageToken },
				});

				if (result.code === 0 && result.data?.items) {
					for (const chat of result.data.items) {
						const chatId = (chat as any).chat_id;
						if (chatId) {
							this.channels.set(chatId, {
								id: chatId,
								name: chat.name || chatId,
							});
						}
					}
				}

				pageToken = result.data?.page_token;
			} while (pageToken);
		} catch (err) {
			this.logger.error("Failed to fetch channels", undefined, err instanceof Error ? err : new Error(String(err)));
		}
	}

	private getQueue(channelId: string): ChannelQueue {
		let queue = this.queues.get(channelId);
		if (!queue) {
			queue = new ChannelQueue();
			this.queues.set(channelId, queue);
		}
		return queue;
	}
}
