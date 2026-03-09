/**
 * Channel Queue
 *
 * 频道消息队列，确保同一频道消息串行处理
 */

import type { PiLogger } from "../../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

type QueueTask = () => Promise<void>;

interface QueueItem {
	task: QueueTask;
	resolve: () => void;
	reject: (error: Error) => void;
}

// ============================================================================
// Channel Queue
// ============================================================================

/**
 * 频道消息队列
 *
 * 确保同一频道的消息串行处理，避免并发冲突
 */
export class ChannelQueue {
	private queues: Map<string, QueueItem[]> = new Map();
	private processing: Map<string, boolean> = new Map();
	private logger?: PiLogger;

	constructor(options?: { logger?: PiLogger }) {
		this.logger = options?.logger;
	}

	/**
	 * 将任务加入队列
	 */
	async enqueue(channelId: string, task: QueueTask): Promise<void> {
		return new Promise((resolve, reject) => {
			// 获取或创建队列
			if (!this.queues.has(channelId)) {
				this.queues.set(channelId, []);
			}

			const queue = this.queues.get(channelId)!;
			queue.push({ task, resolve, reject });

			// 如果没有在处理，开始处理
			if (!this.processing.get(channelId)) {
				this.process(channelId);
			}
		});
	}

	/**
	 * 处理队列中的任务
	 */
	private async process(channelId: string): Promise<void> {
		const queue = this.queues.get(channelId);
		if (!queue || queue.length === 0) {
			this.processing.set(channelId, false);
			return;
		}

		this.processing.set(channelId, true);

		// 取出第一个任务
		const item = queue.shift()!;

		try {
			await item.task();
			item.resolve();
		} catch (error) {
			this.logger?.error(`Queue task error for channel ${channelId}`, undefined, error as Error);
			item.reject(error as Error);
		}

		// 继续处理下一个任务
		if (queue.length > 0) {
			// 使用 setImmediate 避免栈溢出
			setImmediate(() => {
				this.process(channelId);
			});
		} else {
			this.processing.set(channelId, false);
		}
	}

	/**
	 * 获取队列长度
	 */
	getLength(channelId: string): number {
		return this.queues.get(channelId)?.length || 0;
	}

	/**
	 * 检查是否正在处理
	 */
	isProcessing(channelId: string): boolean {
		return this.processing.get(channelId) || false;
	}

	/**
	 * 清空指定频道的队列
	 */
	clearChannel(channelId: string): void {
		const queue = this.queues.get(channelId);
		if (queue) {
			// 拒绝所有等待中的任务
			for (const item of queue) {
				item.reject(new Error("Queue cleared"));
			}
			this.queues.delete(channelId);
		}
		this.processing.delete(channelId);
	}

	/**
	 * 清空所有队列
	 */
	clear(): void {
		for (const [channelId] of this.queues) {
			this.clearChannel(channelId);
		}
	}

	/**
	 * 获取所有队列的频道 ID
	 */
	getChannelIds(): string[] {
		return Array.from(this.queues.keys());
	}
}
