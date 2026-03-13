/**
 * Auto Auth Manager
 *
 * 自动授权管理器 - 处理权限错误并自动发起 OAuth 授权流程
 *
 * 核心功能：
 * - 防抖缓冲区：合并同一消息的多个授权请求
 * - 冷却时间：防止重复发送授权卡片
 * - OAuth Device Flow：发起用户授权
 * - 授权后重试：发送合成消息触发 AI 重试
 */

import type { Logger } from "../../../utils/logger/index.js";
import { extractPermissionError, shouldNotifyPermissionError } from "../utils/permission-error.js";
import { requestDeviceAuthorization, pollDeviceToken, type LarkBrand } from "./device-flow.js";
import { getStoredToken, setStoredToken, tokenStatus } from "./token-store.js";
import { buildOAuthCard, buildAuthSuccessCard, buildAuthFailedCard } from "./auth-cards.js";

// ============================================================================
// Types
// ============================================================================

/** 授权上下文 */
export interface AuthContext {
	/** App ID */
	appId: string;
	/** App Secret */
	appSecret: string;
	/** 品牌 */
	brand?: LarkBrand;
	/** 用户 Open ID */
	senderOpenId: string;
	/** 会话 ID */
	chatId: string;
	/** 消息 ID */
	messageId: string;
	/** 线程 ID（可选） */
	threadId?: string;
	/** 日志器 */
	logger?: Logger;
}

/** 发送卡片函数类型 */
export type SendCardFunction = (card: any, context: AuthContext) => Promise<string>;

/** 更新卡片函数类型 */
export type UpdateCardFunction = (cardId: string, card: any) => Promise<void>;

/** 发送合成消息函数类型 */
export type SendSyntheticMessageFunction = (context: AuthContext, text: string) => Promise<void>;

/** 授权批次 */
interface AuthBatch {
	phase: "collecting" | "executing";
	scopes: Set<string>;
	waiters: Array<{ resolve: (result: AuthResult) => void; reject: (err: Error) => void }>;
	timer: NodeJS.Timeout | null;
	resultPromise: Promise<AuthResult> | null;
	updateTimer: NodeJS.Timeout | null;
	isUpdating: boolean;
	pendingReupdate: boolean;
	flushFn: ((scopes: string[]) => Promise<AuthResult>) | null;
	context: AuthContext;
	sendCard: SendCardFunction;
	updateCard: UpdateCardFunction;
	sendSyntheticMessage: SendSyntheticMessageFunction | undefined;
}

/** 授权结果 */
export interface AuthResult {
	success: boolean;
	message: string;
	authorized?: boolean;
	scope?: string;
}

/** 活跃的 OAuth 流程 */
interface PendingFlow {
	controller: AbortController;
	cardId: string;
	sequence: number;
	messageId: string;
	superseded: boolean;
	scope: string;
}

// ============================================================================
// Constants
// ============================================================================

/** 防抖窗口（毫秒） */
const AUTH_DEBOUNCE_MS = 50;

/** Scope 更新防抖窗口（毫秒） */
const AUTH_UPDATE_DEBOUNCE_MS = 500;

/** 冷却期（毫秒） */
const AUTH_COOLDOWN_MS = 30_000;

// ============================================================================
// Debounce Buffer
// ============================================================================

const authBatches = new Map<string, AuthBatch>();
const pendingFlows = new Map<string, PendingFlow>();

/**
 * 将授权请求入队到防抖缓冲区
 */
function enqueueAuthRequest(
	bufferKey: string,
	scopes: string[],
	context: AuthContext,
	sendCard: SendCardFunction,
	updateCard: UpdateCardFunction,
	sendSyntheticMessage: SendSyntheticMessageFunction | undefined,
	flushFn: (mergedScopes: string[]) => Promise<AuthResult>,
	debounceMs: number = AUTH_DEBOUNCE_MS
): Promise<AuthResult> {
	const existing = authBatches.get(bufferKey);

	if (existing) {
		// 追加 scope
		for (const s of scopes) existing.scopes.add(s);

		if (existing.phase === "executing") {
			// flushFn 已在执行，复用结果 + 触发延迟刷新
			context.logger?.debug(`auto-auth: auth in-flight, piggyback → key=${bufferKey}`);

			if (existing.updateTimer) clearTimeout(existing.updateTimer);
			existing.updateTimer = setTimeout(async () => {
				existing.updateTimer = null;
				if (existing.isUpdating) {
					existing.pendingReupdate = true;
					return;
				}
				existing.isUpdating = true;
				try {
					const mergedScopes = [...existing.scopes];
					await existing.flushFn?.(mergedScopes);
				} catch (err) {
					context.logger?.warn(`auto-auth: scope update failed: ${err}`);
				} finally {
					existing.isUpdating = false;
					if (existing.pendingReupdate) {
						existing.pendingReupdate = false;
						try {
							await existing.flushFn?.([...existing.scopes]);
						} catch (err) {
							context.logger?.warn(`auto-auth: scope reupdate failed: ${err}`);
						}
					}
				}
			}, AUTH_UPDATE_DEBOUNCE_MS);

			return existing.resultPromise!;
		}

		// collecting 阶段：正常合并
		context.logger?.debug(`auto-auth: debounce merge → key=${bufferKey}`);
		return new Promise((resolve, reject) => {
			existing.waiters.push({ resolve, reject });
		});
	}

	// 创建新缓冲区
	const entry: AuthBatch = {
		phase: "collecting",
		scopes: new Set(scopes),
		waiters: [],
		timer: null,
		resultPromise: null,
		updateTimer: null,
		isUpdating: false,
		pendingReupdate: false,
		flushFn: null,
		context,
		sendCard,
		updateCard,
		sendSyntheticMessage,
	};

	const promise = new Promise<AuthResult>((resolve, reject) => {
		entry.waiters.push({ resolve, reject });
	});

	entry.timer = setTimeout(async () => {
		entry.phase = "executing";
		entry.timer = null;
		entry.flushFn = flushFn;
		const mergedScopes = [...entry.scopes];

		context.logger?.info(
			`auto-auth: debounce flush → key=${bufferKey}, ` +
				`waiters=${entry.waiters.length}, scopes=[${mergedScopes.join(", ")}]`
		);

		entry.resultPromise = flushFn(mergedScopes);
		try {
			const result = await entry.resultPromise;
			for (const w of entry.waiters) w.resolve(result);
		} catch (err) {
			for (const w of entry.waiters) w.reject(err as Error);
		} finally {
			setTimeout(() => authBatches.delete(bufferKey), AUTH_COOLDOWN_MS);
		}
	}, debounceMs);

	authBatches.set(bufferKey, entry);
	return promise;
}

// ============================================================================
// OAuth Execution
// ============================================================================

/**
 * 执行 OAuth 授权流程
 */
async function executeOAuth(
	scopes: string[],
	context: AuthContext,
	sendCard: SendCardFunction,
	updateCard: UpdateCardFunction,
	sendSyntheticMessage: SendSyntheticMessageFunction | undefined
): Promise<AuthResult> {
	const { appId, appSecret, brand, senderOpenId, chatId, messageId, threadId, logger } = context;
	const scope = scopes.join(" ");

	// 1. 检查现有 token
	const existing = await getStoredToken(appId, senderOpenId, logger);
	if (existing && tokenStatus(existing) !== "expired") {
		if (scope) {
			const requestedScopes = scope.split(/\s+/).filter(Boolean);
			const grantedScopes = new Set((existing.scope ?? "").split(/\s+/).filter(Boolean));
			const missingScopes = requestedScopes.filter((s) => !grantedScopes.has(s));

			if (missingScopes.length === 0) {
				return {
					success: true,
					message: "用户已授权，scope 已覆盖",
					authorized: true,
					scope: existing.scope,
				};
			}
		} else {
			return {
				success: true,
				message: "用户已授权，无需重复授权",
				authorized: true,
				scope: existing.scope,
			};
		}
	}

	// 2. 取消旧的流程（如果存在）
	const flowKey = `${appId}:${senderOpenId}`;
	if (pendingFlows.has(flowKey)) {
		const oldFlow = pendingFlows.get(flowKey)!;
		if (oldFlow.messageId === messageId) {
			oldFlow.superseded = true;
			oldFlow.controller.abort();
			pendingFlows.delete(flowKey);
		} else {
			oldFlow.superseded = true;
			oldFlow.controller.abort();
			try {
				await updateCard(oldFlow.cardId, buildAuthFailedCard("新的授权请求已发起"));
			} catch (e) {
				logger?.warn(`auto-auth: failed to update old card: ${e}`);
			}
			pendingFlows.delete(flowKey);
		}
	}

	// 3. 请求设备授权
	let deviceAuth;
	try {
		deviceAuth = await requestDeviceAuthorization({
			appId,
			appSecret,
			brand,
			scope,
			logger,
		});
	} catch (err) {
		logger?.error(`auto-auth: device authorization failed: ${err}`);
		return {
			success: false,
			message: `设备授权失败: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// 4. 构建并发送授权卡片
	const authCard = buildOAuthCard({
		verificationUriComplete: deviceAuth.verificationUriComplete,
		expiresMin: Math.round(deviceAuth.expiresIn / 60),
		scope,
	});

	let cardId: string;
	try {
		cardId = await sendCard(authCard, context);
	} catch (err) {
		logger?.error(`auto-auth: failed to send auth card: ${err}`);
		return {
			success: false,
			message: `发送授权卡片失败: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// 5. 启动后台轮询
	const abortController = new AbortController();
	const currentFlow: PendingFlow = {
		controller: abortController,
		cardId,
		sequence: 1,
		messageId,
		superseded: false,
		scope,
	};
	pendingFlows.set(flowKey, currentFlow);

	pollDeviceToken({
		appId,
		appSecret,
		brand,
		deviceCode: deviceAuth.deviceCode,
		interval: deviceAuth.interval,
		expiresIn: deviceAuth.expiresIn,
		signal: abortController.signal,
		logger,
	})
		.then(async (result) => {
			if (currentFlow.superseded) {
				logger?.debug(`auto-auth: flow superseded, skipping card update`);
				return;
			}

			if (result.ok) {
				// 保存 token
				const now = Date.now();
				const storedToken = {
					userOpenId: senderOpenId,
					appId,
					accessToken: result.token.accessToken,
					refreshToken: result.token.refreshToken,
					expiresAt: now + result.token.expiresIn * 1000,
					refreshExpiresAt: now + result.token.refreshExpiresIn * 1000,
					scope: result.token.scope,
					grantedAt: now,
				};
				await setStoredToken(storedToken, logger);

				// 更新卡片为成功
				try {
					await updateCard(cardId, buildAuthSuccessCard());
				} catch (e) {
					logger?.warn(`auto-auth: failed to update card to success: ${e}`);
				}

				pendingFlows.delete(flowKey);

				// 发送合成消息触发 AI 重试
				if (sendSyntheticMessage) {
					try {
						await sendSyntheticMessage(context, "我已完成飞书账号授权，请继续执行之前的操作。");
						logger?.info("auto-auth: synthetic message sent after successful auth");
					} catch (e) {
						logger?.warn(`auto-auth: failed to send synthetic message: ${e}`);
					}
				}
			} else {
				// 更新卡片为失败
				try {
					await updateCard(cardId, buildAuthFailedCard(result.message));
				} catch (e) {
					logger?.warn(`auto-auth: failed to update card to failure: ${e}`);
				}
				pendingFlows.delete(flowKey);
			}
		})
		.catch((err) => {
			logger?.error(`auto-auth: polling error: ${err}`);
		});

	return {
		success: true,
		message: "已发送授权请求卡片，请用户在卡片中点击链接完成授权",
		authorized: false,
		scope,
	};
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * 处理权限错误并发起自动授权
 *
 * @param error - API 错误
 * @param context - 授权上下文
 * @param sendCard - 发送卡片函数
 * @param updateCard - 更新卡片函数
 * @param sendSyntheticMessage - 发送合成消息函数（可选）
 * @returns 是否处理了权限错误
 */
export async function handlePermissionErrorWithAutoAuth(
	error: unknown,
	context: AuthContext,
	sendCard: SendCardFunction,
	updateCard: UpdateCardFunction,
	sendSyntheticMessage?: SendSyntheticMessageFunction
): Promise<boolean> {
	// 1. 检测权限错误
	const permError = extractPermissionError(error);
	if (!permError) return false;

	const { logger, appId, senderOpenId, messageId } = context;

	// 2. 检查冷却时间
	const cooldownKey = `${appId}:${senderOpenId}:${messageId}`;
	if (!shouldNotifyPermissionError(cooldownKey)) {
		logger?.debug("auto-auth: permission error notification on cooldown");
		return true;
	}

	logger?.info(`auto-auth: permission error detected, scopes=[${permError.scopes}]`);

	// 3. 提取 scope
	const scopes = permError.scopes.split(",").map((s) => s.trim()).filter(Boolean);

	// 4. 入队到防抖缓冲区
	const bufferKey = `user:${appId}:${senderOpenId}:${messageId}`;

	try {
		await enqueueAuthRequest(
			bufferKey,
			scopes,
			context,
			sendCard,
			updateCard,
			sendSyntheticMessage,
			(mergedScopes) =>
				executeOAuth(mergedScopes, context, sendCard, updateCard, sendSyntheticMessage)
		);
		return true;
	} catch (err) {
		logger?.error(`auto-auth: failed to handle permission error: ${err}`);
		return false;
	}
}

/**
 * 检查用户是否已授权
 */
export async function isUserAuthorized(
	appId: string,
	userOpenId: string,
	requiredScope?: string,
	logger?: Logger
): Promise<boolean> {
	const token = await getStoredToken(appId, userOpenId, logger);
	if (!token) return false;

	const status = tokenStatus(token);
	if (status === "expired") return false;

	if (requiredScope) {
		const requiredScopes = requiredScope.split(/\s+/).filter(Boolean);
		const grantedScopes = new Set((token.scope ?? "").split(/\s+/).filter(Boolean));
		return requiredScopes.every((s) => grantedScopes.has(s));
	}

	return true;
}

/**
 * 获取用户的 access token
 */
export async function getUserAccessToken(
	appId: string,
	userOpenId: string,
	logger?: Logger
): Promise<string | null> {
	const token = await getStoredToken(appId, userOpenId, logger);
	if (!token || tokenStatus(token) === "expired") return null;
	return token.accessToken;
}

/**
 * 撤销用户授权
 */
export async function revokeUserAuth(
	appId: string,
	userOpenId: string,
	logger?: Logger
): Promise<void> {
	const { removeStoredToken } = await import("./token-store.js");
	await removeStoredToken(appId, userOpenId, logger);
	logger?.info(`auto-auth: revoked auth for ${userOpenId}`);
}
