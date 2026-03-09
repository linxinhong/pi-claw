/**
 * Message Deduplicator - 消息去重器
 *
 * 使用 LRU 缓存实现消息去重，处理 WebSocket 重连时的消息重放
 */

import type { DedupConfig } from "../types.js";

// ============================================================================
// Types
// ============================================================================

interface DedupEntry {
	/** 添加时间戳 */
	addedAt: number;
}

// ============================================================================
// Message Dedup
// ============================================================================

/**
 * 消息去重器
 *
 * 基于 TTL 的 LRU 缓存实现
 */
export class MessageDedup {
	private cache: Map<string, DedupEntry> = new Map();
	private maxSize: number;
	private ttl: number;

	constructor(config: DedupConfig = {}) {
		this.maxSize = config.maxSize || 10000;
		this.ttl = config.ttl || 60000; // 默认 1 分钟
	}

	/**
	 * 检查消息是否已处理
	 * @param messageId 消息 ID
	 * @returns 是否已存在
	 */
	has(messageId: string): boolean {
		const entry = this.cache.get(messageId);
		if (!entry) {
			return false;
		}

		// 检查是否过期
		if (Date.now() - entry.addedAt > this.ttl) {
			this.cache.delete(messageId);
			return false;
		}

		return true;
	}

	/**
	 * 添加消息到去重器
	 * @param messageId 消息 ID
	 */
	add(messageId: string): void {
		// 如果达到最大容量，清理过期条目
		if (this.cache.size >= this.maxSize) {
			this.cleanup();
		}

		// 如果仍然超过容量，删除最旧的条目
		if (this.cache.size >= this.maxSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(messageId, {
			addedAt: Date.now(),
		});
	}

	/**
	 * 清理过期条目
	 */
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.addedAt > this.ttl) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * 清空所有条目
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * 获取当前条目数
	 */
	get size(): number {
		return this.cache.size;
	}
}
