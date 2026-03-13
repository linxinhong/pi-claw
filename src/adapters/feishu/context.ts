/**
 * Feishu Platform Context
 *
 * 飞书平台上下文实现
 */

import type { PlatformContext } from "../../core/platform/context.js";
import type { PlatformTool } from "../../core/platform/tools/types.js";
import type { LarkClient } from "./client/index.js";
import type { FeishuStore } from "./store.js";
import type { MessageSender } from "./messaging/outbound/sender.js";
import type { PiLogger } from "../../utils/logger/index.js";
import type { ToolCallInfo, MultiCardIds, TimelineEvent } from "./types.js";
import { CardBuilder } from "./card/builder.js";
import { extractPermissionError, shouldNotifyPermissionError, sendAuthCard } from "./utils/permission-error.js";

// ============================================================================
// Types
// ============================================================================

export interface FeishuPlatformContextOptions {
	chatId: string;
	larkClient: LarkClient;
	messageSender: MessageSender;
	store: FeishuStore;
	logger?: PiLogger;
	quoteMessageId?: string;
}

// ============================================================================
// Feishu Platform Context
// ============================================================================

/**
 * 飞书平台上下文
 *
 * 实现 PlatformContext 接口，提供飞书特定的能力
 */
export class FeishuPlatformContext implements PlatformContext {
	readonly platform = "feishu" as const;

	private chatId: string;
	private larkClient: LarkClient;
	private messageSender: MessageSender;
	private store: FeishuStore;
	private logger?: PiLogger;
	private cardBuilder: CardBuilder;

	// 多卡片 ID 管理
	private cardIds: MultiCardIds = {
		statusCardId: null,
		thinkingCardId: null,
		toolCardId: null,
	};

	// 当前状态卡片（兼容旧接口）
	private currentCardMessageId: string | null = null;
	private currentCardStatus: "thinking" | "streaming" | "complete" | null = null;

	// 思考中卡片状态
	private thinkingStartTime: number | null = null;
	private hideThinking: boolean = false; // 默认显示思考

	// 思考内容（流式累积）
	private thinkingContent: string = "";

	// 累积的工具调用信息
	private toolCalls: ToolCallInfo[] = [];

	// 处理流程时间线
	private timeline: TimelineEvent[] = [];

	// 当前 turn 轮次
	private currentTurn: number = 0;

	// 工具卡片创建锁（防止并发创建多张卡片）
	private toolCardCreating: boolean = false;

	// 工具卡片更新防抖
	private toolCardUpdateTimer?: NodeJS.Timeout;
	private readonly TOOL_CARD_DEBOUNCE_MS = 500; // 防抖时间

	// 流式卡片更新缓存（避免内容无变化时重复更新）
	private lastStreamingContent: string = "";
	private lastStreamingTimelineHash: string = "";

	// 响应是否已发送标志
	private _responseSent: boolean = false;

	// 引用的消息 ID（用于引用回复原消息）
	private quoteMessageId: string | null = null;

	// 节流相关
	private lastCardUpdateTime: number = 0;
	private pendingFlushTimer: NodeJS.Timeout | null = null;
	private pendingContent: string = ""; // 累积的内容
	private readonly THROTTLE_MS = 1000; // 节流时间
	private readonly BATCH_AFTER_GAP_MS = 300; // 长时间空闲后的批量延迟
	private readonly LONG_GAP_THRESHOLD_MS = 2000; // 长时间空闲阈值

	constructor(options: FeishuPlatformContextOptions) {
		this.chatId = options.chatId;
		this.larkClient = options.larkClient;
		this.messageSender = options.messageSender;
		this.store = options.store;
		this.logger = options.logger;
		this.cardBuilder = new CardBuilder();
		
		// 设置引用消息 ID（如果提供）
		if (options.quoteMessageId) {
			this.quoteMessageId = options.quoteMessageId;
		}
	}

	/**
	 * 设置是否隐藏思考过程
	 */
	setHideThinking(hide: boolean): void {
		this.hideThinking = hide;
	}

	/**
	 * 检查是否隐藏思考过程
	 */
	isThinkingHidden(): boolean {
		return this.hideThinking;
	}

	// ========================================================================
	// PlatformContext Implementation
	// ========================================================================

	async sendText(chatId: string, text: string): Promise<string> {
		// 转换 @用户名 为飞书格式
		try {
			const convertedText = await this.larkClient.convertAtMentions(chatId, text);
			return await this.messageSender.sendText(chatId, convertedText);
		} catch (error: any) {
			// 检查是否是权限错误 (code 99991672)
			const errorCode = error?.code ?? error?.response?.data?.code;
			if (errorCode === 99991672) {
				this.logger?.warn("Permission error in sendText, re-throwing for auth card", { chatId, errorMsg: error?.message });
				throw error;
			}
			// 其他错误，降级为直接发送原文本（不转换 @提及）
			this.logger?.warn("Failed to convert @ mentions, sending original text", { chatId, error: String(error) });
			return await this.messageSender.sendText(chatId, text);
		}
	}

	async updateMessage(messageId: string, content: string): Promise<void> {
		await this.messageSender.update(messageId, {
			type: "text",
			content,
		});
	}

	async deleteMessage(messageId: string): Promise<void> {
		await this.larkClient.deleteMessage(messageId);
	}

	async uploadFile(filePath: string, chatId: string): Promise<void> {
		const fileKey = await this.larkClient.uploadFile(filePath);
		await this.messageSender.sendFile(chatId, fileKey);
	}

	async uploadImage(imagePath: string): Promise<string> {
		return await this.larkClient.uploadImage(imagePath);
	}

	async sendImage(chatId: string, imageKey: string): Promise<string> {
		return await this.messageSender.sendImage(chatId, imageKey);
	}

	async sendVoiceMessage(chatId: string, filePath: string, duration?: number): Promise<string> {
		// 飞书语音消息需要 OGG/Opus 格式
		// 1. 如果没有提供时长，自动检测
		if (duration === undefined) {
			duration = await this.detectAudioDuration(filePath);
		}
		
		// 2. 如果不是 opus 格式，需要转换
		const isOpus = filePath.toLowerCase().endsWith(".opus");
		let finalPath = filePath;
		let fileType = "opus";
		
		if (!isOpus) {
			// 使用 ffmpeg 转换为 opus 格式
			const { exec } = await import("child_process");
			const { promisify } = await import("util");
			const { tmpdir } = await import("os");
			const { join, basename, extname } = await import("path");
			const { existsSync, unlinkSync } = await import("fs");
			
			const execAsync = promisify(exec);
			const baseName = basename(filePath, extname(filePath));
			const opusPath = join(tmpdir(), `${baseName}-${Date.now()}.opus`);
			
			try {
				await execAsync(`ffmpeg -i "${filePath}" -c:a libopus -b:a 24k "${opusPath}" -y`);
				finalPath = opusPath;
				// 清理临时文件
				if (existsSync(filePath) && filePath.startsWith(tmpdir())) {
					try { unlinkSync(filePath); } catch {}
				}
			} catch (error) {
				console.error(`[FeishuContext] Failed to convert audio to opus: ${error}`);
				// 转换失败，尝试直接用原文件
				fileType = filePath.toLowerCase().endsWith(".mp3") ? "mp3" : 
				           filePath.toLowerCase().endsWith(".wav") ? "wav" : "opus";
			}
		}
		
		// 3. 上传音频文件
		const fileKey = await this.larkClient.uploadFile(finalPath, fileType, duration);
		// 4. 发送语音消息（使用 audio 类型，显示为可播放气泡）
		return await this.messageSender.sendAudio(chatId, fileKey, duration);
	}

	/**
	 * 检测音频时长
	 */
	private async detectAudioDuration(filePath: string): Promise<number | undefined> {
		const { parseAudioDuration } = await import("./utils/audio-utils.js");
		return await parseAudioDuration(filePath);
	}

	async postInThread(chatId: string, parentMessageId: string, text: string): Promise<string> {
		return await this.messageSender.replyInThread(chatId, parentMessageId, text);
	}

	// ========================================================================
	// Feishu Specific Methods
	// ========================================================================

	/**
	 * 发送卡片消息
	 */
	async sendCard(chatId: string, card: any): Promise<string> {
		// 转换卡片内容中的 @用户名
		try {
			if (card?.body?.elements) {
				for (const element of card.body.elements) {
					if (element.text?.content) {
						element.text.content = await this.larkClient.convertAtMentions(chatId, element.text.content);
					}
					if (element.content) {
						element.content = await this.larkClient.convertAtMentions(chatId, element.content);
					}
				}
			}
		} catch (error: any) {
			// 检查是否是权限错误 (code 99991672)
			const errorCode = error?.code ?? error?.response?.data?.code;
			if (errorCode === 99991672) {
				this.logger?.warn("Permission error in sendCard, re-throwing for auth card", { chatId, errorMsg: error?.message });
				throw error;
			}
			// 其他错误，继续发送不转换的卡片
			this.logger?.warn("Failed to convert @ mentions in card, sending original", { chatId, error: String(error) });
		}
		return await this.messageSender.sendCard(chatId, card);
	}

	/**
	 * 更新卡片消息
	 */
	async updateCard(messageId: string, card: any): Promise<void> {
		await this.messageSender.updateCard(messageId, card);
	}

	/**
	 * 节流卡片更新
	 * - 如果距离上次更新超过 THROTTLE_MS，立即更新
	 * - 如果在节流窗口内，安排延迟更新
	 * - 如果长时间空闲后（>2秒），先延迟 300ms 批量更新
	 * - 捕获 230020 速率限制错误并静默跳过
	 */
	private async throttledCardUpdate(): Promise<void> {
		const now = Date.now();
		const timeSinceLastUpdate = now - this.lastCardUpdateTime;

		// 清除之前的待处理定时器
		if (this.pendingFlushTimer) {
			clearTimeout(this.pendingFlushTimer);
			this.pendingFlushTimer = null;
		}

		// 检查是否是长时间空闲后的更新（可能是批量事件的开始）
		if (timeSinceLastUpdate > this.LONG_GAP_THRESHOLD_MS) {
			// 延迟一小段时间，让批量事件累积
			this.pendingFlushTimer = setTimeout(async () => {
				this.pendingFlushTimer = null;
				await this.doFlushCardUpdate();
			}, this.BATCH_AFTER_GAP_MS);
			return;
		}

		// 如果距离上次更新超过节流时间，立即更新
		if (timeSinceLastUpdate >= this.THROTTLE_MS) {
			await this.doFlushCardUpdate();
			return;
		}

		// 在节流窗口内，安排延迟更新
		const delay = this.THROTTLE_MS - timeSinceLastUpdate;
		this.pendingFlushTimer = setTimeout(async () => {
			this.pendingFlushTimer = null;
			await this.doFlushCardUpdate();
		}, delay);
	}

	/**
	 * 执行实际的卡片更新
	 */
	private async doFlushCardUpdate(): Promise<void> {
		if (!this.pendingContent) return;

		const content = this.pendingContent;
		const timeline = this.getTimeline();

		// 调试日志
		console.log("[DEBUG] doFlushCardUpdate:", {
			contentLength: content?.length || 0,
			timelineCount: timeline?.length || 0,
			timeline: timeline,
		});

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildStreamingCard(content, { timeline });
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.lastCardUpdateTime = Date.now();
				this.currentCardStatus = "streaming";
				return;
			} catch (error: any) {
				// 检查是否是速率限制错误 (230020)
				const errorMsg = String(error?.message || error);
				if (errorMsg.includes("230020") || error?.code === 230020) {
					// 静默跳过，等待下次更新
					this.logger?.debug("Card update rate limited, skipping");
					return;
				}
				this.logger?.error("Failed to update card", undefined, error as Error);
				// 不清除 currentCardMessageId，保留以便下次重试
			}
		}

		// 没有卡片，创建新卡片
		try {
			if (!this.thinkingStartTime) {
				this.thinkingStartTime = Date.now();
			}
			const card = this.cardBuilder.buildStreamingCard(content, { timeline });
			const messageId = await this.messageSender.sendCard(this.chatId, card, this.quoteMessageId || undefined);
			this.currentCardMessageId = messageId;
			this.lastCardUpdateTime = Date.now();
			this.currentCardStatus = "streaming";
		} catch (error: any) {
			// 检查是否是速率限制错误
			const errorMsg = String(error?.message || error);
			if (errorMsg.includes("230020") || error?.code === 230020) {
				this.logger?.debug("Card send rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to send card", undefined, error as Error);
		}
	}

	/**
	 * 清理节流相关的定时器和状态
	 */
	cleanupThrottle(): void {
		if (this.pendingFlushTimer) {
			clearTimeout(this.pendingFlushTimer);
			this.pendingFlushTimer = null;
		}
	}

	/**
	 * 显示思考中状态
	 */
	async showThinking(): Promise<string> {
		const card = this.cardBuilder.buildThinkingCard();
		const messageId = await this.messageSender.sendCard(this.chatId, card, this.quoteMessageId || undefined);
		this.currentCardMessageId = messageId;
		this.currentCardStatus = "thinking";
		return messageId;
	}

	/**
	 * 更新流式输出内容
	 */
	async updateStreaming(content: string): Promise<void> {
		const timeline = this.getTimeline();

		// 计算 timeline 的简单哈希（用于快速比较）
		const timelineHash = this.computeTimelineHash(timeline);

		// 检查内容是否有实质性变化
		if (content === this.lastStreamingContent && timelineHash === this.lastStreamingTimelineHash) {
			this.logger?.debug("Streaming content unchanged, skipping card update");
			return;
		}

		// 调试日志
		console.log("[DEBUG] updateStreaming:", {
			contentLength: content?.length || 0,
			timelineCount: timeline?.length || 0,
		});

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildStreamingCard(content, { timeline });
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.currentCardStatus = "streaming";
				// 更新缓存
				this.lastStreamingContent = content;
				this.lastStreamingTimelineHash = timelineHash;
				return;
			} catch (error: any) {
				// 检查是否是速率限制错误 (230020)
				const errorMsg = String(error?.message || error);
				if (errorMsg.includes("230020") || error?.code === 230020) {
					// 静默跳过，等待下次更新
					this.logger?.debug("Streaming card update rate limited, skipping");
					return;
				}
				// 更新失败，记录错误，但不清除 currentCardMessageId
				this.logger?.error("Failed to update card", undefined, error as Error);
				// 继续尝试创建新卡片
			}
		}

		// 创建新卡片
		try {
			const card = this.cardBuilder.buildStreamingCard(content, { timeline });
			const messageId = await this.messageSender.sendCard(this.chatId, card, this.quoteMessageId || undefined);
			this.currentCardMessageId = messageId;
			this.currentCardStatus = "streaming";
			// 更新缓存
			this.lastStreamingContent = content;
			this.lastStreamingTimelineHash = timelineHash;
		} catch (error: any) {
			// 检查是否是速率限制错误
			const errorMsg = String(error?.message || error);
			const isRateLimit = errorMsg.includes("230020") || error?.code === 230020;
			if (isRateLimit) {
				this.logger?.debug("Streaming card send rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to send card", undefined, error as Error);
			// 发送失败，降级为文本消息（不是频率限制时才降级）
			await this.messageSender.sendText(this.chatId, content, this.quoteMessageId || undefined);
		}
	}

	/**
	 * 完成状态，显示最终结果
	 */
	async finishStatus(content: string): Promise<void> {
		// 清理节流定时器
		this.cleanupThrottle();

		// 计算耗时
		const elapsed = this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined;

		// 获取时间线
		const timeline = this.getTimeline();

		// 如果已有卡片，尝试更新
		if (this.currentCardMessageId) {
			try {
				const card = this.cardBuilder.buildCompleteCard(content, {
					elapsed,
					toolCalls: this.toolCalls,
					timeline,
				});
				await this.messageSender.updateCard(this.currentCardMessageId, card);
				this.currentCardStatus = "complete";
				this.currentCardMessageId = null;
				this.thinkingStartTime = null;
				this.toolCalls = []; // 清空工具调用
				this.timeline = []; // 清空时间线
				this.pendingContent = ""; // 清空累积内容
				this.lastStreamingContent = ""; // 清空流式缓存
				this.lastStreamingTimelineHash = ""; // 清空时间线哈希缓存
				return;
			} catch (error) {
				// 检查是否是权限错误，如果是则重新抛出
				const errorCode = (error as any)?.code ?? (error as any)?.response?.data?.code;
				if (errorCode === 99991672) {
					this.logger?.warn("Permission error in finishStatus, re-throwing");
					throw error;
				}
				this.logger?.error("Failed to update final card", undefined, error as Error);
				// 更新失败，继续发送文本
			}
		}

		// 没有卡片或更新失败，发送文本
		await this.messageSender.sendText(this.chatId, content, this.quoteMessageId || undefined);
		this.currentCardMessageId = null;
		this.thinkingStartTime = null;
		this.toolCalls = [];
		this.timeline = []; // 清空时间线
		this.pendingContent = ""; // 清空累积内容
		this.lastStreamingContent = ""; // 清空流式缓存
		this.lastStreamingTimelineHash = ""; // 清空时间线哈希缓存
	}

	// ========================================================================
	// 思考中卡片（CoreAgent 兼容接口）
	// ========================================================================

	/**
	 * 开始思考（发送工具卡片）
	 * 只创建一张工具卡片（包含 timeline）
	 * @param quoteMessageId 可选的引用消息 ID，用于引用回复原消息
	 */
	async startThinking(quoteMessageId?: string): Promise<void> {
		const now = Date.now();
		this.thinkingStartTime = now;

		// 保存引用消息 ID
		this.quoteMessageId = quoteMessageId || null;

		// 重置状态
		this.hideThinking = false; // 允许显示思考内容
		this.thinkingContent = "";
		this.toolCalls = [];
		this.timeline = []; // 清空时间线
		this.currentTurn = 0; // 重置 turn 轮次
		this.toolCardCreating = false; // 重置工具卡片创建锁
		this.cardIds = {
			statusCardId: null,
			thinkingCardId: null,
			toolCardId: null,
		};

		// 只创建一张工具卡片（初始为空），传递 quoteMessageId 引用原消息
		const initialCard = this.cardBuilder.buildToolCallsCard([], []);
		const messageId = await this.messageSender.sendCard(this.chatId, initialCard, this.quoteMessageId || undefined);
		this.cardIds.toolCardId = messageId;

		// 更新状态
		this.currentCardStatus = "thinking";
	}

	/**
	 * 更新思考内容
	 * @param content 思考内容
	 */
	async updateThinking(content: string): Promise<void> {
		// 只有当内容有变化且非空才处理
		if (!content || content === this.thinkingContent) {
			return;
		}

		// 检查内容是否有实质性变化（至少新增10个字符或完全不同的内容）
		const contentChanged = content.length > this.thinkingContent.length + 10 || 
		                       !content.startsWith(this.thinkingContent);
		
		// 更新思考内容
		this.thinkingContent = content;
		
		// 只有当内容有实质性变化时才添加到时间线
		if (contentChanged) {
			this.addThinkingToTimeline(content);
		}

		// 如果隐藏思考过程，不更新卡片内容
		if (this.hideThinking) {
			return;
		}

		// 使用防抖更新工具卡片
		if (this.cardIds.toolCardId) {
			// 清除之前的定时器
			if (this.toolCardUpdateTimer) {
				clearTimeout(this.toolCardUpdateTimer);
			}
			
			// 设置新的防抖定时器
			this.toolCardUpdateTimer = setTimeout(async () => {
				try {
					const timeline = this.getTimeline();
					// 思考过程中展开折叠面板
					const toolCard = this.cardBuilder.buildToolCallsCard(this.toolCalls, timeline, true);
					await this.messageSender.updateCard(this.cardIds.toolCardId!, toolCard);
				} catch (error: any) {
					const errorMsg = String(error?.message || error);
					if (!errorMsg.includes("230020") && error?.code !== 230020) {
						this.logger?.error("Failed to update tool card with thinking", undefined, error as Error);
					}
				}
			}, this.TOOL_CARD_DEBOUNCE_MS);
		}
	}

	/**
	 * 完成思考，显示最终回复
	 * @param content 最终回复内容
	 * @param stopReason 停止原因（"stop" 或 "end_turn" 表示最终回复，其他值表示中间 turn）
	 */
	async finishThinking(content: string, stopReason?: string): Promise<void> {
		// 清理节流定时器
		this.cleanupThrottle();

		// 计算耗时
		const elapsed = this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined;

		// 获取时间线
		const timeline = this.getTimeline();

		// 判断是否是最终回复
		const isFinalResponse = stopReason === "stop" || stopReason === "end_turn";

		// 如果有工具卡片，更新为完成状态（包含最终回复和时间线）
		// 注意：只要 toolCardId 存在就更新卡片，不需要判断 toolCalls.length > 0
		if (this.cardIds.toolCardId) {
			try {
				// 使用 buildCompleteCard 将最终回复和时间线整合到一个卡片中
				const finalCard = this.cardBuilder.buildCompleteCard(content, {
					elapsed,
					toolCalls: this.toolCalls,
					timeline,
					expanded: false,  // 完成时折叠
				});
				// 转换卡片内容中的 @用户名
				if (finalCard?.body?.elements) {
					for (const element of finalCard.body.elements) {
						if (element.text?.content) {
							element.text.content = await this.larkClient.convertAtMentions(this.chatId, element.text.content);
						}
						if (element.content) {
							element.content = await this.larkClient.convertAtMentions(this.chatId, element.content);
						}
					}
				}
				await this.messageSender.updateCard(this.cardIds.toolCardId, finalCard);
				// 标记响应已发送，防止 unified-bot 重复发送
				this._responseSent = true;
			} catch (error: any) {
				const errorMsg = String(error?.message || error);
				const isRateLimit = errorMsg.includes("230020") || error?.code === 230020;
				const errorCode = error?.code ?? error?.response?.data?.code;
				
				// 检查是否是权限错误 (code 99991672) - 需要重新抛出以显示授权卡片
				if (errorCode === 99991672) {
					this.logger?.warn("Permission error in finishStreaming, re-throwing for auth card", { errorMsg });
					throw error;
				}
				
				if (!isRateLimit) {
					this.logger?.error("Failed to update final card", undefined, error as Error);
				}
				// 更新失败，降级发送文本（仅在最终回复且不是频率限制时）
				if (!isRateLimit && isFinalResponse && content) {
					await this.messageSender.sendText(this.chatId, content, this.quoteMessageId || undefined);
					// 标记响应已发送，防止重复发送
					this._responseSent = true;
				}
			}
		} else if (isFinalResponse && content) {
			// 没有卡片时才发送文本消息
			await this.messageSender.sendText(this.chatId, content, this.quoteMessageId || undefined);
			// 标记响应已发送，防止重复发送
			this._responseSent = true;
		}

		// 只有在最终回复时才清理状态
		if (isFinalResponse) {
			this.currentCardStatus = "complete";
			this.thinkingStartTime = null;
			this.toolCalls = [];
			this.timeline = []; // 清空时间线
			this.currentTurn = 0; // 重置 turn 轮次
			this.thinkingContent = "";
			this.pendingContent = "";
			this._responseSent = true;

			// 重置卡片 ID
			this.cardIds = {
				statusCardId: null,
				thinkingCardId: null,
				toolCardId: null,
			};
		}
	}

	/**
	 * 更新工具执行状态（在卡片上显示）
	 * @param statusText 状态文本，如 "-> 工具名" 或 "-> OK 工具名"
	 */
	async updateToolStatus(statusText: string): Promise<void> {
		// 兼容旧接口：解析状态文本
		// 格式可能是 "-> 工具名" 或 "-> OK 工具名" 或 "-> X 工具名"
		const match = statusText.match(/^->\s*(OK|X)?\s*(.+)$/);
		if (match) {
			const [, status, toolName] = match;
			if (status === "OK") {
				// 工具成功完成
				await this.endToolCall(toolName, true);
			} else if (status === "X") {
				// 工具失败
				await this.endToolCall(toolName, false);
			} else {
				// 工具开始
				await this.startToolCall(toolName);
			}
		}
	}

	/**
	 * 开始工具调用（创建/更新工具卡片）
	 */
	async startToolCall(toolName: string, args?: Record<string, any>): Promise<void> {
		this.toolCalls.push({
			name: toolName,
			args: args,
			status: "running",
		});

		// 添加到时间线
		this.addToolCallToTimeline(toolName, args, "running");

		// 更新或创建工具卡片
		await this.updateOrCreateToolCard();
	}

	/**
	 * 更新或创建工具卡片
	 * 使用防抖机制合并快速连续的更新请求
	 */
	private async updateOrCreateToolCard(): Promise<void> {
		if (this.toolCalls.length === 0) return;

		// 清除之前的待处理定时器
		if (this.toolCardUpdateTimer) {
			clearTimeout(this.toolCardUpdateTimer);
		}

		// 延迟更新，合并快速连续的调用
		return new Promise((resolve) => {
			this.toolCardUpdateTimer = setTimeout(async () => {
				this.toolCardUpdateTimer = undefined;
				await this.doUpdateOrCreateToolCard();
				resolve();
			}, this.TOOL_CARD_DEBOUNCE_MS);
		});
	}

	/**
	 * 实际执行工具卡片更新
	 */
	private async doUpdateOrCreateToolCard(): Promise<void> {
		if (this.toolCalls.length === 0) return;

		try {
			// 获取时间线并传入工具卡片
			const timeline = this.getTimeline();
			this.logger?.debug("[doUpdateOrCreateToolCard]", {
				toolCallsCount: this.toolCalls.length,
				timelineCount: timeline?.length || 0,
				timeline: timeline,
			});
			// 思考过程中展开折叠面板
			const toolCard = this.cardBuilder.buildToolCallsCard(this.toolCalls, timeline, true);

			if (this.cardIds.toolCardId) {
				// 更新现有卡片
				await this.messageSender.updateCard(this.cardIds.toolCardId, toolCard);
			} else if (!this.toolCardCreating) {
				// 创建新卡片（加锁防止并发）
				this.toolCardCreating = true;
				try {
					const messageId = await this.messageSender.sendCard(this.chatId, toolCard, this.quoteMessageId || undefined);
					this.cardIds.toolCardId = messageId;
				} finally {
					this.toolCardCreating = false;
				}
			}
			// 如果正在创建中，跳过本次更新（下一次调用会更新）
		} catch (error: any) {
			// 检查是否是速率限制错误 (230020)
			const errorMsg = String(error?.message || error);
			if (errorMsg.includes("230020") || error?.code === 230020) {
				this.logger?.debug("Tool card update rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to update tool card", undefined, error as Error);
		}
	}

	/**
	 * 结束工具调用（更新工具卡片）
	 */
	async endToolCall(toolName: string, success: boolean, result?: string): Promise<void> {
		// 找到最近一个同名的 running 状态工具
		const toolCall = [...this.toolCalls].reverse().find(tc => tc.name === toolName && tc.status === "running");
		if (toolCall) {
			toolCall.status = success ? "success" : "error";
			toolCall.result = result;
		}

		// 更新时间线中对应的工具状态
		this.updateToolCallInTimeline(toolName, success ? "success" : "error");

		// 更新工具卡片
		await this.updateOrCreateToolCard();
	}

	/**
	 * 构建工具调用内容
	 */
	private buildToolCallsContent(): string {
		if (this.toolCalls.length === 0) {
			return "";
		}

		const lines = this.toolCalls.map(tc => {
			const statusIcon = tc.status === "success" ? "✅" :
			                   tc.status === "error" ? "❌" :
			                   tc.status === "running" ? "🔄" : "⏳";

			// 格式化参数
			const argsStr = tc.args ? this.formatToolArgs(tc.args) : "";
			const argsDisplay = argsStr ? `: ${argsStr}` : "";

			return `${statusIcon} \`${tc.name}\`${argsDisplay}`;
		});

		return `⚡ **工具调用**\n${lines.join("\n")}`;
	}

	// ========================================================================
	// Timeline Methods
	// ========================================================================

	/**
	 * 开始新的 turn 轮次
	 */
	startNewTurn(): void {
		this.currentTurn++;
	}

	/**
	 * 获取当前 turn 轮次
	 */
	getCurrentTurn(): number {
		return this.currentTurn;
	}

	/**
	 * 添加思考内容到时间线
	 * @param content 思考内容
	 */
	addThinkingToTimeline(content: string): void {
		// addThinkingToTimeline 调试日志已禁用
		// 截断思考内容（最多显示 50 个字符）
		const truncated = content.length > 50 ? content.slice(0, 50) + "..." : content;

		const currentTurn = this.currentTurn || 1;
		
		// 查找当前 turn 是否已有 thinking 条目
		const existingIndex = this.timeline.findIndex(
			event => event.type === "thinking" && event.turn === currentTurn
		);
		
		if (existingIndex >= 0) {
			// 更新现有条目
			this.timeline[existingIndex].content = truncated;
		} else {
			// 添加新条目
			this.timeline.push({
				type: "thinking",
				turn: currentTurn,
				content: truncated,
			});
		}
		// Timeline after add 调试日志已禁用
	}

	/**
	 * 添加工具调用到时间线
	 */
	private addToolCallToTimeline(toolName: string, args?: Record<string, any>, status?: "pending" | "running" | "success" | "error"): void {
		const argsStr = args ? this.formatToolArgs(args) : "";
		const label = args?.label; // 提取 label

		// 如果有 label，先添加一个描述性的 thinking 条目
		if (label) {
			this.timeline.push({
				type: "thinking",
				turn: this.currentTurn || 1,
				content: label,
			});
		}

		this.timeline.push({
			type: "toolcall",
			turn: this.currentTurn || 1,
			content: toolName,
			label: label,
			args: argsStr || undefined,
			status: status || "running",
		});
	}

	/**
	 * 更新时间线中工具调用的状态
	 */
	private updateToolCallInTimeline(toolName: string, status: "success" | "error"): void {
		// 从后往前找到最近的同名工具
		for (let i = this.timeline.length - 1; i >= 0; i--) {
			const event = this.timeline[i];
			if (event.type === "toolcall" && event.content === toolName && event.status === "running") {
				event.status = status;
				break;
			}
		}
	}

	/**
	 * 获取时间线
	 */
	getTimeline(): TimelineEvent[] {
		return [...this.timeline];
	}

	/**
	 * 清空时间线
	 */
	clearTimeline(): void {
		this.timeline = [];
	}

	// ========================================================================
	// Helper Methods
	// ========================================================================

	/**
	 * 更新工具卡片
	 */
	private async updateToolCard(): Promise<void> {
		if (!this.cardIds.toolCardId || this.toolCalls.length === 0) return;

		try {
			const timeline = this.getTimeline();
			const toolCard = this.cardBuilder.buildToolCallsCard(this.toolCalls, timeline);
			await this.messageSender.updateCard(this.cardIds.toolCardId, toolCard);
		} catch (error: any) {
			// 检查是否是速率限制错误 (230020)
			const errorMsg = String(error?.message || error);
			if (errorMsg.includes("230020") || error?.code === 230020) {
				this.logger?.debug("Tool card update rate limited, skipping");
				return;
			}
			this.logger?.error("Failed to update tool card", undefined, error as Error);
		}
	}

	/**
	 * 格式化工具参数（简化显示）
	 */
	private formatToolArgs(args: Record<string, any>): string {
		const keys = Object.keys(args).filter(k => !k.startsWith("_"));
		if (keys.length === 0) return "";

		// 对于 bash 工具，显示命令
		if (args.command) {
			const cmd = String(args.command);
			return cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd;
		}

		// 对于 read 工具，显示文件路径
		if (args.file_path) {
			const path = String(args.file_path);
			return path.split("/").pop() || path;
		}

		// 其他工具，显示第一个参数的值
		const firstKey = keys[0];
		const value = String(args[firstKey]);
		return value.length > 50 ? value.substring(0, 50) + "..." : value;
	}

	/**
	 * 计算时间线哈希（用于快速比较变化）
	 */
	private computeTimelineHash(timeline: TimelineEvent[]): string {
		if (timeline.length === 0) return "";
		return timeline.map(e => `${e.turn}:${e.type}:${e.content?.slice(0, 20)}:${e.status || ""}`).join("|");
	}

	/**
	 * 添加表情反应
	 */
	async addReaction(messageId: string, emoji: string): Promise<void> {
		await this.larkClient.addReaction(messageId, emoji);
	}

	/**
	 * 删除表情反应
	 */
	async removeReaction(messageId: string, emoji: string, reactionId: string): Promise<void> {
		await this.larkClient.removeReaction(messageId, emoji, reactionId);
	}

	/**
	 * 获取平台特定功能
	 */
	getPlatformFeature?<T = any>(feature: string): T {
		switch (feature) {
			case "sendCard":
				return this.sendCard.bind(this) as T;

			case "updateCard":
				return this.updateCard.bind(this) as T;

			case "showThinking":
				return this.showThinking.bind(this) as T;

			case "updateStreaming":
				return this.updateStreaming.bind(this) as T;

			case "finishStatus":
				return this.finishStatus.bind(this) as T;

			case "startThinking":
				return this.startThinking.bind(this) as T;

			case "updateThinking":
				return this.updateThinking.bind(this) as T;

			case "finishThinking":
				return this.finishThinking.bind(this) as T;

			case "isThinkingHidden":
				return this.isThinkingHidden.bind(this) as T;

			case "addReaction":
				return this.addReaction.bind(this) as T;

			case "cardBuilder":
				return this.cardBuilder as T;

			default:
				throw new Error(`Unknown platform feature: ${feature}`);
		}
	}

	/**
	 * 获取平台工具
	 */
	async getTools(context: {
		chatId: string;
		workspaceDir: string;
		channelDir: string;
	}): Promise<PlatformTool[]> {
		// 导入飞书特定工具
		const { createSendFileTool, createSendImageTool, createSendVoiceTool } = await import("./tools/index.js");

		return [
			// 文件、图片和语音发送工具
			createSendFileTool(this),
			createSendImageTool(this),
			createSendVoiceTool(this),
			// TTS/STT 工具由 voice 插件提供
		];
	}

	// ========================================================================
	// PlatformContext Optional Methods
	// ========================================================================

	/**
	 * 检查响应是否已发送
	 */
	isResponseSent(): boolean {
		return this._responseSent;
	}

	/**
	 * 完成响应（更新状态卡片为最终状态）
	 */
	async finalizeResponse(content: string): Promise<void> {
		await this.finishStatus(content);
		this._responseSent = true;
	}

	// ========================================================================
	// Permission Error Handling
	// ========================================================================

	/**
	 * 处理错误（包括权限错误）
	 * @param error 错误对象
	 * @returns 如果错误已处理（如发送授权卡片）返回 true，否则返回 false
	 */
	async handleError(error: unknown): Promise<boolean> {
		console.log("[DEBUG] handleError called with:", (error as any)?.code || (error as any)?.message);
		
		// 尝试提取权限错误
		const permissionError = extractPermissionError(error);
		if (!permissionError) {
			console.log("[DEBUG] Not a permission error, skipping");
			return false;
		}
		
		console.log("[DEBUG] Permission error detected:", permissionError.code, permissionError.scopes);

		// 检查冷却时间
		const appId = this.larkClient["config"]?.appId || "unknown";
		console.log("[DEBUG] Checking cooldown for app:", appId);
		
		if (!shouldNotifyPermissionError(appId)) {
			console.log("[DEBUG] Skipping auth card due to cooldown");
			this.logger?.debug("Skipping auth card due to cooldown", { appId });
			return true;
		}
		
		console.log("[DEBUG] Sending auth card...");

		// 发送授权卡片
		try {
			await sendAuthCard(this, permissionError);
			this.logger?.info("Auth card sent", { 
				code: permissionError.code, 
				scopes: permissionError.scopes,
			});
			console.log("[DEBUG] Auth card sent successfully");
			return true;
		} catch (sendError) {
			this.logger?.error("Failed to send auth card", undefined, sendError as Error);
			console.log("[DEBUG] Failed to send auth card:", sendError);
			return false;
		}
	}
}
