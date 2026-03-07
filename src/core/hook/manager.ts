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
} from "./types.js";

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

		// 快速路径：无 handler 直接返回
		if (!hooks || hooks.length === 0) {
			return { continue: true, data: undefined as TResult };
		}

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
					return await entry.handler(context, next);
				} catch (error) {
					return {
						continue: false,
						error: error instanceof Error ? error : new Error(String(error)),
						data: undefined as TResult,
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

		return result;
	}

	/**
	 * 并行触发 hook（事件通知模式）
	 *
	 * 所有 handler 并行执行，不等待前一个完成
	 * 适用于通知类 hook，不需要拦截能力
	 *
	 * @param name Hook 名称
	 * @param context 上下文
	 */
	async emitParallel<TContext>(name: HookName, context: TContext): Promise<void> {
		const hooks = this.hooks.get(name);

		// 快速路径：无 handler 直接返回
		if (!hooks || hooks.length === 0) {
			return;
		}

		// 收集需要移除的一次性 hook
		const toRemove: string[] = [];

		// 并行执行所有 handler
		const promises = hooks.map(async (entry) => {
			if (entry.meta.once) {
				toRemove.push(entry.meta.id);
			}

			try {
				// 并行模式：不使用 next，直接执行
				await entry.handler(context, async () => ({ continue: true }));
			} catch (error) {
				// 记录错误但不中断其他 handler
				console.error(`[HookManager] Handler error for ${name}:`, error);
			}
		});

		await Promise.all(promises);

		// 移除一次性 hook
		for (const id of toRemove) {
			this.off(name, id);
		}
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

		// 快速路径：无 handler 直接返回
		if (!hooks || hooks.length === 0) {
			return { continue: true };
		}

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
						return syncResult;
					}
				}
			} catch (error) {
				// 记录错误但不中断
				console.error(`[HookManager] Sync handler error for ${name}:`, error);
			}
		}

		// 移除一次性 hook
		for (const id of toRemove) {
			this.off(name, id);
		}

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
