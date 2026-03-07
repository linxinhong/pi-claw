/**
 * Hook Manager
 *
 * 统一的 Hook 管理器，支持中间件模式、优先级控制、短路拦截
 */

import type {
	HookHandler,
	HookMeta,
	HookName,
	HookOptions,
	HookResult,
	ParallelHookHandler,
	SerialHookHandler,
} from "./types.js";
import { PiLogger } from "../../utils/logger/logger.js";

// ============================================================================
// Internal Types
// ============================================================================

interface HookEntry {
	meta: HookMeta;
	handler: HookHandler<any, any>;
}

// ============================================================================
// Hook Manager
// ============================================================================

/**
 * Hook 管理器
 *
 * 特性：
 * - 支持中间件模式（通过 next() 控制执行链）
 * - 支持优先级排序（数字越小越先执行）
 * - 支持短路拦截（返回 continue: false）
 * - 支持一次性 hook（执行后自动移除）
 * - 支持按来源批量清理
 */
export class HookManager {
	private hooks = new Map<HookName, HookEntry[]>();
	private idCounter = 0;
	private logger = new PiLogger("hook");

	/**
	 * 格式化 context 为日志友好的字符串
	 */
	private formatContextForLog(name: HookName, context: unknown): string {
		if (!context || typeof context !== "object") {
			return "";
		}

		const ctx = context as Record<string, unknown>;
		const parts: string[] = [];

		// 根据 hook 类型提取关键信息
		switch (name) {
			case "system:before-start":
			case "system:ready":
			case "system:shutdown":
				if (ctx.version) parts.push(`version=${ctx.version}`);
				break;

			case "plugin:load":
			case "plugin:unload":
				if (ctx.pluginId) parts.push(`pluginId=${ctx.pluginId}`);
				if (ctx.pluginName) parts.push(`pluginName=${ctx.pluginName}`);
				break;

			case "adapter:connect":
			case "adapter:disconnect":
				if (ctx.platform) parts.push(`platform=${ctx.platform}`);
				break;

			case "message:receive":
			case "message:send":
			case "message:sent":
				if (ctx.channelId) parts.push(`channelId=${ctx.channelId}`);
				if (ctx.messageId) parts.push(`messageId=${ctx.messageId}`);
				if (ctx.userId) parts.push(`userId=${ctx.userId}`);
				if (ctx.success !== undefined) parts.push(`success=${ctx.success}`);
				break;

			case "session:create":
			case "session:destroy":
				if (ctx.channelId) parts.push(`channelId=${ctx.channelId}`);
				if (ctx.sessionId) parts.push(`sessionId=${ctx.sessionId}`);
				break;

			case "event:trigger":
			case "event:triggered":
				if (ctx.eventType) parts.push(`eventType=${ctx.eventType}`);
				if (ctx.channelId) parts.push(`channelId=${ctx.channelId}`);
				if (ctx.eventId) parts.push(`eventId=${ctx.eventId}`);
				if (ctx.success !== undefined) parts.push(`success=${ctx.success}`);
				if (ctx.duration !== undefined) parts.push(`duration=${ctx.duration}ms`);
				break;

			case "tool:call":
			case "tool:called":
				if (ctx.toolName) parts.push(`toolName=${ctx.toolName}`);
				if (ctx.channelId) parts.push(`channelId=${ctx.channelId}`);
				if (ctx.success !== undefined) parts.push(`success=${ctx.success}`);
				if (ctx.duration !== undefined) parts.push(`duration=${ctx.duration}ms`);
				break;
		}

		return parts.length > 0 ? `(${parts.join(", ")})` : "";
	}

	// ============================================================================
	// Registration Methods
	// ============================================================================

	/**
	 * 注册 hook
	 *
	 * @param name Hook 名称
	 * @param handler 处理函数
	 * @param options 注册选项
	 * @returns 取消注册的函数
	 */
	on<TContext, TResult = void>(
		name: HookName,
		handler: HookHandler<TContext, TResult>,
		options: HookOptions = {}
	): () => void {
		const id = `hook_${++this.idCounter}`;
		const entry: HookEntry = {
			meta: {
				id,
				priority: options.priority ?? 10,
				once: options.once ?? false,
				source: options.source,
			},
			handler,
		};

		const hooks = this.hooks.get(name) || [];
		hooks.push(entry);

		// 按优先级排序（数字越小越先执行）
		hooks.sort((a, b) => a.meta.priority - b.meta.priority);

		this.hooks.set(name, hooks);

		// 返回取消函数
		return () => this.off(name, id);
	}

	/**
	 * 注册一次性 hook
	 *
	 * @param name Hook 名称
	 * @param handler 处理函数
	 * @param options 注册选项
	 * @returns 取消注册的函数
	 */
	once<TContext, TResult = void>(
		name: HookName,
		handler: HookHandler<TContext, TResult>,
		options: Omit<HookOptions, "once"> = {}
	): () => void {
		return this.on(name, handler, { ...options, once: true });
	}

	/**
	 * 取消注册 hook
	 *
	 * @param name Hook 名称
	 * @param id Hook ID
	 */
	off(name: HookName, id: string): void {
		const hooks = this.hooks.get(name);
		if (!hooks) return;

		const index = hooks.findIndex((h) => h.meta.id === id);
		if (index !== -1) {
			hooks.splice(index, 1);
		}

		if (hooks.length === 0) {
			this.hooks.delete(name);
		}
	}

	// ============================================================================
	// Query Methods
	// ============================================================================

	/**
	 * 检查是否有指定名称的 hook
	 *
	 * 用于惰性触发优化，避免空 emit 的开销
	 *
	 * @param name Hook 名称
	 * @returns 是否有注册的 handler
	 */
	hasHooks(name: HookName): boolean {
		const hooks = this.hooks.get(name);
		return hooks !== undefined && hooks.length > 0;
	}

	/**
	 * 获取指定 hook 的 handler 数量
	 */
	hookCount(name: HookName): number {
		return this.hooks.get(name)?.length || 0;
	}

	// ============================================================================
	// Emit Methods
	// ============================================================================

	/**
	 * 触发 hook（中间件链式调用）
	 *
	 * 按优先级顺序执行 handler，支持短路拦截
	 *
	 * @param name Hook 名称
	 * @param context 上下文
	 * @returns 最终结果
	 */
	async emit<TContext, TResult = void>(
		name: HookName,
		context: TContext
	): Promise<HookResult<TResult>> {
		const hooks = this.hooks.get(name);
		const contextStr = this.formatContextForLog(name, context);

		// 快速路径：无 handler 直接返回
		if (!hooks || hooks.length === 0) {
			this.logger.debug(`[Hook] ${name} ${contextStr} (no handlers)`);
			return { continue: true, data: undefined as TResult };
		}

		// 记录触发日志
		const startTime = Date.now();
		this.logger.info(`[Hook] Triggering ${name} ${contextStr}`);

		// 收集需要移除的一次性 hook
		const toRemove: string[] = [];

		// 创建执行链
		let index = 0;
		const createNext = (): (() => Promise<HookResult<TResult>>) => {
			const currentIndex = index++;

			if (currentIndex >= hooks.length) {
				// 链尾：返回继续
				return async () => ({ continue: true, data: undefined as TResult });
			}

			const entry = hooks[currentIndex];

			return async () => {
				// 标记一次性 hook 待移除
				if (entry.meta.once) {
					toRemove.push(entry.meta.id);
				}

				// 创建下一个 next 函数
				const next = createNext();

				// 执行当前 handler
				try {
					const result = await entry.handler(context, next);

					// 将 data merge 回 context（如果 context 是对象）
					if (result.data && typeof context === "object" && context !== null) {
						Object.assign(context as object, result.data);
					}

					return result;
				} catch (error) {
					// 异常时返回错误结果（blocked 为 undefined 表示非主动拦截）
					return {
						continue: false,
						error: error instanceof Error ? error : new Error(String(error)),
						data: undefined as TResult,
						// blocked 不设置，表示这是异常而非主动拦截
					};
				}
			};
		};

		// 开始执行链
		const firstNext = createNext();
		const result = await firstNext();

		// 移除一次性 hook
		for (const id of toRemove) {
			this.off(name, id);
		}

		// 记录完成日志
		const duration = Date.now() - startTime;
		this.logger.info(`[Hook] ${name} completed (continue=${result.continue}, duration=${duration}ms)`);

		return result;
	}

	/**
	 * 并行触发 hook（事件通知模式）
	 *
	 * 所有 handler 并行执行，不等待前一个完成
	 * 适用于通知类 hook，不需要拦截能力
	 *
	 * 注意：此方法使用 ParallelHookHandler 类型，handler 不支持 next()
	 *
	 * @param name Hook 名称
	 * @param context 上下文
	 */
	async emitParallel<TContext>(
		name: HookName,
		context: TContext
	): Promise<void> {
		const hooks = this.hooks.get(name);
		const contextStr = this.formatContextForLog(name, context);

		// 快速路径：无 handler 直接返回
		if (!hooks || hooks.length === 0) {
			this.logger.debug(`[Hook] ${name} ${contextStr} (no handlers, parallel)`);
			return;
		}

		// 记录触发日志
		const startTime = Date.now();
		this.logger.info(`[Hook] Triggering ${name} ${contextStr} (parallel, handlers=${hooks.length})`);

		// 收集需要移除的一次性 hook
		const toRemove: string[] = [];

		// 并行执行所有 handler
		const promises = hooks.map(async (entry) => {
			if (entry.meta.once) {
				toRemove.push(entry.meta.id);
			}

			try {
				// 并行模式：直接调用 handler，不传递 next
				// 使用类型断言将 SerialHookHandler 转换为 ParallelHookHandler 兼容形式
				const parallelHandler = entry.handler as unknown as ParallelHookHandler<TContext>;
				await parallelHandler(context);
			} catch (error) {
				// 记录错误但不中断其他 handler
				this.logger.error(`[Hook] Handler error for ${name}`, undefined, error instanceof Error ? error : new Error(String(error)));
			}
		});

		await Promise.all(promises);

		// 移除一次性 hook
		for (const id of toRemove) {
			this.off(name, id);
		}

		// 记录完成日志
		const duration = Date.now() - startTime;
		this.logger.info(`[Hook] ${name} completed (parallel, duration=${duration}ms)`);
	}

	/**
	 * 同步触发 hook（高频场景优化）
	 *
	 * 同步执行所有 handler，不创建 Promise
	 * 适用于高频场景，但 handler 必须是同步的
	 *
	 * 注意：如果 handler 是异步的，此方法不会等待其完成
	 *
	 * @param name Hook 名称
	 * @param context 上下文
	 * @returns 是否继续执行
	 */
	emitSync<TContext>(name: HookName, context: TContext): HookResult {
		const hooks = this.hooks.get(name);
		const contextStr = this.formatContextForLog(name, context);

		// 快速路径：无 handler 直接返回
		if (!hooks || hooks.length === 0) {
			this.logger.debug(`[Hook] ${name} ${contextStr} (no handlers, sync)`);
			return { continue: true };
		}

		// 记录触发日志
		const startTime = Date.now();
		this.logger.info(`[Hook] Triggering ${name} ${contextStr} (sync, handlers=${hooks.length})`);

		// 收集需要移除的一次性 hook
		const toRemove: string[] = [];

		// 同步执行所有 handler
		for (const entry of hooks) {
			if (entry.meta.once) {
				toRemove.push(entry.meta.id);
			}

			try {
				// 同步调用，忽略返回的 Promise
				const result = entry.handler(context, async () => ({ continue: true }));

				// 如果 handler 返回的是 Promise，我们无法同步等待
				// 但对于纯同步 handler，这里会得到正确的结果
				if (result instanceof Promise) {
					// 异步 handler，无法同步处理，跳过结果检查
					continue;
				}

				// 同步结果检查
				const syncResult = result as HookResult;
				if (syncResult && typeof syncResult === "object" && "continue" in syncResult) {
					if (!syncResult.continue) {
						// 短路：先移除一次性 hook，再返回
						for (const id of toRemove) {
							this.off(name, id);
						}
						const duration = Date.now() - startTime;
						this.logger.info(`[Hook] ${name} completed (sync, continue=false, duration=${duration}ms)`);
						return syncResult;
					}
				}
			} catch (error) {
				// 记录错误但不中断
				this.logger.error(`[Hook] Sync handler error for ${name}`, undefined, error instanceof Error ? error : new Error(String(error)));
			}
		}

		// 移除一次性 hook
		for (const id of toRemove) {
			this.off(name, id);
		}

		// 记录完成日志
		const duration = Date.now() - startTime;
		this.logger.info(`[Hook] ${name} completed (sync, duration=${duration}ms)`);

		return { continue: true };
	}

	// ============================================================================
	// Cleanup Methods
	// ============================================================================

	/**
	 * 清除指定来源的所有 hook
	 *
	 * @param source 来源标识
	 */
	clearBySource(source: string): void {
		for (const [name, hooks] of this.hooks) {
			const filtered = hooks.filter((h) => h.meta.source !== source);

			if (filtered.length === 0) {
				this.hooks.delete(name);
			} else if (filtered.length !== hooks.length) {
				this.hooks.set(name, filtered);
			}
		}
	}

	/**
	 * 清除指定名称的所有 hook
	 *
	 * @param name Hook 名称
	 */
	clear(name: HookName): void {
		this.hooks.delete(name);
	}

	/**
	 * 清除所有 hook
	 */
	clearAll(): void {
		this.hooks.clear();
	}

	// ============================================================================
	// Debug Methods
	// ============================================================================

	/**
	 * 获取所有 hook 的调试信息
	 */
	debug(): Record<string, { id: string; priority: number; source?: string }[]> {
		const result: Record<string, { id: string; priority: number; source?: string }[]> = {};

		for (const [name, hooks] of this.hooks) {
			result[name] = hooks.map((h) => ({
				id: h.meta.id,
				priority: h.meta.priority,
				source: h.meta.source,
			}));
		}

		return result;
	}
}

// ============================================================================
// Global Instance
// ============================================================================

let globalHookManager: HookManager | null = null;

/**
 * 获取全局 HookManager 实例
 */
export function getHookManager(): HookManager {
	if (!globalHookManager) {
		globalHookManager = new HookManager();
	}
	return globalHookManager;
}

/**
 * 重置全局 HookManager（用于测试）
 */
export function resetHookManager(): void {
	if (globalHookManager) {
		globalHookManager.clearAll();
		globalHookManager = null;
	}
}

/**
 * 测试辅助函数：在干净的 HookManager 环境中执行测试
 *
 * 自动重置 HookManager 前后的状态，确保测试隔离
 *
 * @example
 * ```typescript
 * await withCleanHookManager(async () => {
 *   const hookManager = getHookManager();
 *   hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
 *     // 测试代码
 *   });
 *   // ... 运行测试
 * });
 * ```
 */
export async function withCleanHookManager<T>(
	fn: () => Promise<T>
): Promise<T> {
	resetHookManager();
	try {
		return await fn();
	} finally {
		resetHookManager();
	}
}
