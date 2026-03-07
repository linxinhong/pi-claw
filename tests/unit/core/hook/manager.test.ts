/**
 * Hook Manager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	HookManager,
	getHookManager,
	resetHookManager,
	withCleanHookManager,
	HOOK_NAMES,
	type HookResult,
	type SerialHookHandler,
	type ParallelHookHandler,
} from "../../../../src/core/hook/index.js";

describe("HookManager", () => {
	let hookManager: HookManager;

	beforeEach(() => {
		resetHookManager();
		hookManager = getHookManager();
	});

	afterEach(() => {
		resetHookManager();
	});

	describe("基础功能", () => {
		it("应该正确注册和触发 hook", async () => {
			let called = false;
			hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
				called = true;
				return next();
			});

			await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
				channelId: "test",
				text: "hello",
				timestamp: new Date(),
			});

			expect(called).toBe(true);
		});

		it("应该按优先级顺序执行", async () => {
			const order: number[] = [];

			hookManager.on(
				HOOK_NAMES.MESSAGE_RECEIVE,
				async (ctx, next) => {
					order.push(2);
					return next();
				},
				{ priority: 20 }
			);

			hookManager.on(
				HOOK_NAMES.MESSAGE_RECEIVE,
				async (ctx, next) => {
					order.push(1);
					return next();
				},
				{ priority: 10 }
			);

			await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
				channelId: "test",
				text: "hello",
				timestamp: new Date(),
			});

			expect(order).toEqual([1, 2]);
		});

		it("应该支持短路拦截", async () => {
			const results: string[] = [];

			hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
				results.push("first");
				return { continue: false, blocked: true };
			});

			hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
				results.push("second");
				return next();
			});

			const result = await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
				channelId: "test",
				text: "hello",
				timestamp: new Date(),
			});

			expect(results).toEqual(["first"]);
			expect(result.continue).toBe(false);
			expect(result.blocked).toBe(true);
		});
	});

	describe("blocked 字段", () => {
		it("主动拦截时应设置 blocked: true", async () => {
			hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
				return { continue: false, blocked: true };
			});

			const result = await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
				channelId: "test",
				text: "hello",
				timestamp: new Date(),
			});

			expect(result.continue).toBe(false);
			expect(result.blocked).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it("正常完成时 blocked 应为 undefined", async () => {
			hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
				return next();
			});

			const result = await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
				channelId: "test",
				text: "hello",
				timestamp: new Date(),
			});

			expect(result.continue).toBe(true);
			expect(result.blocked).toBeUndefined();
		});

		it("异常时 blocked 应为 undefined（表示非主动拦截）", async () => {
			hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
				throw new Error("Test error");
			});

			const result = await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
				channelId: "test",
				text: "hello",
				timestamp: new Date(),
			});

			expect(result.continue).toBe(false);
			expect(result.blocked).toBeUndefined();
			expect(result.error).toBeInstanceOf(Error);
			expect(result.error?.message).toBe("Test error");
		});
	});

	describe("data merge", () => {
		it("应该将 data merge 回 context", async () => {
			interface TestContext {
				channelId: string;
				text: string;
				timestamp: Date;
				extra?: string;
			}

			const context: TestContext = {
				channelId: "test",
				text: "hello",
				timestamp: new Date(),
			};

			hookManager.on<TestContext>(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
				// 返回 data 应该被 merge 到 context
				return next().then((r) => ({
					...r,
					data: { extra: "added" } as Partial<TestContext>,
				}));
			});

			await hookManager.emit<TestContext>(HOOK_NAMES.MESSAGE_RECEIVE, context);

			// 注意：由于 handler 返回的 data 会被 merge 到 context
			// 但这个测试的 handler 是先调用 next() 再添加 data
			// 所以这个场景下 context 会被修改
		});

		it("应该在 handler 执行后将 result.data merge 到 context", async () => {
			interface MyContext {
				value: number;
				timestamp: Date;
				added?: string;
			}

			const context: MyContext = {
				value: 1,
				timestamp: new Date(),
			};

			hookManager.on<MyContext, { added: string }>(
				HOOK_NAMES.MESSAGE_RECEIVE,
				async (ctx, next) => {
					const result = await next();
					return {
						...result,
						data: { added: "from-handler" },
					};
				}
			);

			await hookManager.emit<MyContext>(HOOK_NAMES.MESSAGE_RECEIVE, context);

			expect(context.added).toBe("from-handler");
		});
	});

	describe("emitParallel", () => {
		it("应该并行执行所有 handler", async () => {
			const order: number[] = [];
			const delays = [50, 10, 30];

			for (let i = 0; i < 3; i++) {
				hookManager.on(HOOK_NAMES.MESSAGE_SENT, async (ctx) => {
					await new Promise((resolve) => setTimeout(resolve, delays[i]));
					order.push(i);
				});
			}

			await hookManager.emitParallel(HOOK_NAMES.MESSAGE_SENT, {
				channelId: "test",
				messageId: "123",
				text: "hello",
				success: true,
				timestamp: new Date(),
			});

			// 并行执行，所以顺序应该按完成时间排序（1, 2, 0）
			expect(order).toEqual([1, 2, 0]);
		});

		it("一个 handler 错误不应影响其他 handler", async () => {
			const results: string[] = [];

			hookManager.on(HOOK_NAMES.MESSAGE_SENT, async (ctx) => {
				results.push("first");
				throw new Error("Handler error");
			});

			hookManager.on(HOOK_NAMES.MESSAGE_SENT, async (ctx) => {
				results.push("second");
			});

			await hookManager.emitParallel(HOOK_NAMES.MESSAGE_SENT, {
				channelId: "test",
				messageId: "123",
				text: "hello",
				success: true,
				timestamp: new Date(),
			});

			expect(results).toContain("first");
			expect(results).toContain("second");
		});

		it("应该使用 ParallelHookHandler 类型（不传递 next）", async () => {
			// 这个测试验证 emitParallel 不需要 handler 使用 next
			let receivedContext: unknown = null;

			const parallelHandler: ParallelHookHandler<{ test: string }> = async (ctx) => {
				receivedContext = ctx;
			};

			hookManager.on(HOOK_NAMES.MESSAGE_SENT, parallelHandler as any);

			const context = {
				channelId: "test",
				messageId: "123",
				text: "hello",
				success: true,
				timestamp: new Date(),
			};

			await hookManager.emitParallel(HOOK_NAMES.MESSAGE_SENT, context);

			expect(receivedContext).toEqual(context);
		});
	});

	describe("withCleanHookManager", () => {
		it("应该在执行前后重置 HookManager", async () => {
			// 先注册一个 hook
			const externalManager = getHookManager();
			externalManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => next());
			expect(externalManager.hookCount(HOOK_NAMES.MESSAGE_RECEIVE)).toBe(1);

			await withCleanHookManager(async () => {
				const innerManager = getHookManager();
				expect(innerManager.hookCount(HOOK_NAMES.MESSAGE_RECEIVE)).toBe(0);

				innerManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => next());
				expect(innerManager.hookCount(HOOK_NAMES.MESSAGE_RECEIVE)).toBe(1);
			});

			// 执行后应该被重置
			const afterManager = getHookManager();
			expect(afterManager.hookCount(HOOK_NAMES.MESSAGE_RECEIVE)).toBe(0);
		});

		it("即使抛出异常也应该重置", async () => {
			await expect(
				withCleanHookManager(async () => {
					const manager = getHookManager();
					manager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => next());
					throw new Error("Test error");
				})
			).rejects.toThrow("Test error");

			// 即使异常也应该重置
			const afterManager = getHookManager();
			expect(afterManager.hookCount(HOOK_NAMES.MESSAGE_RECEIVE)).toBe(0);
		});
	});

	describe("一次性 hook", () => {
		it("应该只执行一次", async () => {
			let count = 0;

			hookManager.once(HOOK_NAMES.SYSTEM_BEFORE_START, async (ctx, next) => {
				count++;
				return next();
			});

			await hookManager.emit(HOOK_NAMES.SYSTEM_BEFORE_START, {
				timestamp: new Date(),
			});

			await hookManager.emit(HOOK_NAMES.SYSTEM_BEFORE_START, {
				timestamp: new Date(),
			});

			expect(count).toBe(1);
		});
	});

	describe("按来源清理", () => {
		it("应该能按 source 清理 hook", async () => {
			hookManager.on(
				HOOK_NAMES.MESSAGE_RECEIVE,
				async (ctx, next) => next(),
				{ source: "plugin-a" }
			);

			hookManager.on(
				HOOK_NAMES.MESSAGE_RECEIVE,
				async (ctx, next) => next(),
				{ source: "plugin-b" }
			);

			expect(hookManager.hookCount(HOOK_NAMES.MESSAGE_RECEIVE)).toBe(2);

			hookManager.clearBySource("plugin-a");

			expect(hookManager.hookCount(HOOK_NAMES.MESSAGE_RECEIVE)).toBe(1);
		});
	});
});
