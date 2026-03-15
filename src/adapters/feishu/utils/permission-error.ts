/**
 * Permission Error Handling
 *
 * 飞书权限错误检测和授权卡片发送
 * 参考: openclaw-lark/src/tools/oauth-cards.ts
 */

import type { FeishuPlatformContext } from "../context.js";
import { extractLarkApiCode, extractLarkErrorMessage } from "../constants/errors.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 权限错误信息
 */
export interface PermissionError {
	/** 错误码 */
	code: number;
	/** 错误消息 */
	message: string;
	/** 授权 URL */
	grantUrl: string;
	/** 需要的权限列表 */
	scopes: string[];
}

/**
 * 授权卡片构建参数
 */
export interface AuthCardParams {
	/** 授权 URL */
	grantUrl: string;
	/** 需要的权限列表 */
	scopes: string[];
	/** 过期时间（分钟），默认 5 分钟 */
	expiresMin?: number;
}

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * 将 URL 转换为飞书应用内打开的 URL
 * 参考: openclaw-lark/src/tools/oauth-cards.ts toInAppWebUrl
 */
export function toInAppWebUrl(targetUrl: string): string {
	const encoded = encodeURIComponent(targetUrl);
	const lkMeta = encodeURIComponent(
		JSON.stringify({
			"page-meta": {
				showNavBar: "false",
				showBottomNavBar: "false",
			},
		}),
	);
	return (
		"https://applink.feishu.cn/client/web_url/open" +
		`?mode=sidebar-semi&max_width=800&reload=false&url=${encoded}&lk_meta=${lkMeta}`
	);
}

// ============================================================================
// Error Detection
// ============================================================================

/**
 * 从错误对象中提取权限错误
 *
 * 支持多种错误格式：
 * 1. 数组格式: [[axiosError, feishuError]] - SDK 内部打印格式
 * 2. SDK 合并格式: { code, msg } - SDK 直接挂载
 * 3. AxiosError 格式: { response: { data: { code, msg } } } - HTTP 错误
 *
 * @param err 错误对象
 * @returns PermissionError 或 null
 */
export function extractPermissionError(err: unknown): PermissionError | null {
	// 调试日志：帮助排查错误格式问题
	console.log("[DEBUG] extractPermissionError input type:", typeof err);
	console.log("[DEBUG] extractPermissionError is array:", Array.isArray(err));
	console.log("[DEBUG] extractPermissionError has response.data:", !!(err as any)?.response?.data);

	if (!err || typeof err !== "object") {
		console.log("[DEBUG] extractPermissionError: invalid input, returning null");
		return null;
	}

	const error = err as Record<string, unknown>;

	// 策略 1: 处理嵌套数组格式（如 [[axiosError, feishuError]]）
	// 这是 SDK 内部打印的格式，通常在 console.error 中看到
	if (Array.isArray(error)) {
		const result = extractFromArray(error);
		if (result) {
			console.log("[DEBUG] extractPermissionError: found in array format");
			return result;
		}
	}

	// 策略 2: 使用统一的错误提取函数
	// 支持: error.code, error.response.data.code, error.data.code
	const code = extractLarkApiCode(error);
	console.log("[DEBUG] extractPermissionError extracted code:", code);

	if (code !== 99991672) {
		console.log("[DEBUG] extractPermissionError: code is not 99991672, returning null");
		return null;
	}

	// 提取错误消息
	const msg = extractLarkErrorMessage(error);
	console.log("[DEBUG] extractPermissionError extracted msg:", msg?.substring(0, 100));

	if (!msg || typeof msg !== "string") {
		console.log("[DEBUG] extractPermissionError: no message found, returning null");
		return null;
	}

	// 提取授权 URL
	const grantUrl = extractPermissionGrantUrl(msg);
	if (!grantUrl) {
		console.log("[DEBUG] extractPermissionError: no grant URL in message, returning null");
		return null;
	}

	console.log("[DEBUG] extractPermissionError: successfully extracted permission error");
	// 提取权限列表
	const scopes = extractPermissionScopes(msg);

	return {
		code: 99991672,
		message: msg,
		grantUrl,
		scopes,
	};
}

/**
 * 从数组格式中提取权限错误
 */
function extractFromArray(arr: unknown[]): PermissionError | null {
	// 展平所有层级
	const flattened = arr.flat(Infinity);

	// 首先查找包含 code === 99991672 的对象
	for (const item of flattened) {
		if (item && typeof item === "object") {
			const obj = item as Record<string, unknown>;
			if (obj.code === 99991672 && typeof obj.msg === "string") {
				const grantUrl = extractPermissionGrantUrl(obj.msg as string);
				if (grantUrl) {
					return {
						code: 99991672,
						message: obj.msg as string,
						grantUrl,
						scopes: extractPermissionScopes(obj.msg as string),
					};
				}
			}
		}
	}

	// 查找包含 response?.data?.code === 99991672 的对象
	for (const item of flattened) {
		if (item && typeof item === "object") {
			const data = (item as Record<string, unknown>)?.response as Record<string, unknown> | undefined;
			if (data?.data && typeof data.data === "object") {
				const responseData = data.data as Record<string, unknown>;
				if (responseData.code === 99991672 && typeof responseData.msg === "string") {
					const grantUrl = extractPermissionGrantUrl(responseData.msg as string);
					if (grantUrl) {
						return {
							code: 99991672,
							message: responseData.msg as string,
							grantUrl,
							scopes: extractPermissionScopes(responseData.msg as string),
						};
					}
				}
			}
		}
	}

	return null;
}

/**
 * 从错误消息中提取授权 URL
 */
function extractPermissionGrantUrl(msg: string): string {
	// 匹配飞书授权 URL
	const urlMatch = msg.match(/https:\/\/open\.feishu\.cn\/app\/[^\s]+/);
	if (!urlMatch?.[0]) {
		return "";
	}

	try {
		const url = new URL(urlMatch[0]);
		const scopeListParam = url.searchParams.get("q") ?? "";
		
		// 提取最高优先级的权限（read > write > other）
		const scopes = scopeListParam.split(",").filter(s => s.trim());
		if (scopes.length > 0) {
			// 按优先级排序
			const sortedScopes = scopes.sort((a, b) => {
				return getPermissionPriority(a) - getPermissionPriority(b);
			});
			// 只保留最高优先级的一个，简化授权流程
			url.searchParams.set("q", sortedScopes[0]);
		}
		
		return url.href;
	} catch {
		return urlMatch[0];
	}
}

/**
 * 从错误消息中提取权限列表
 */
function extractPermissionScopes(msg: string): string[] {
	// 匹配方括号中的权限列表
	const scopeMatch = msg.match(/\[([^\]]+)\]/);
	if (!scopeMatch?.[1]) {
		return [];
	}
	
	return scopeMatch[1].split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * 获取权限优先级（用于排序）
 * - read: 1 (最高)
 * - write: 2
 * - other: 3
 */
function getPermissionPriority(scope: string): number {
	const lowerScope = scope.toLowerCase();
	const hasRead = lowerScope.includes("read");
	const hasWrite = lowerScope.includes("write");
	
	if (hasRead && !hasWrite) return 1;
	if (hasWrite && !hasRead) return 2;
	return 3;
}

// ============================================================================
// Cooldown Tracking
// ============================================================================

/** 权限错误通知冷却时间（5分钟） */
const PERMISSION_ERROR_COOLDOWN_MS = 5 * 60 * 1000;

/** 记录上次通知时间 */
const permissionErrorNotifiedAt = new Map<string, number>();

/**
 * 检查是否应该发送权限错误通知（带冷却）
 * @param appId 应用 ID
 * @returns 是否应该发送
 */
export function shouldNotifyPermissionError(appId: string): boolean {
	const now = Date.now();
	const lastNotified = permissionErrorNotifiedAt.get(appId) ?? 0;
	
	if (now - lastNotified > PERMISSION_ERROR_COOLDOWN_MS) {
		permissionErrorNotifiedAt.set(appId, now);
		return true;
	}
	
	return false;
}

/**
 * 清除权限错误通知记录
 * @param appId 应用 ID（可选，不提供则清除所有）
 */
export function clearPermissionErrorCooldown(appId?: string): void {
	if (appId) {
		permissionErrorNotifiedAt.delete(appId);
	} else {
		permissionErrorNotifiedAt.clear();
	}
}

// ============================================================================
// Auth Card Builders
// ============================================================================

/**
 * 格式化权限描述
 */
function formatScopeDescription(scopes: string[]): string {
	if (scopes.length === 0) {
		return "授权后，应用将能够以您的身份执行相关操作。";
	}

	const desc = "授权后，应用将能够以您的身份执行相关操作。";

	// 如果超过 5 个 scope，只显示前 3 个
	if (scopes.length > 5) {
		const previewScopes = scopes.slice(0, 3).map((s) => `- ${s}`).join("\n");
		return `${desc}\n\n**所需权限**：\n${previewScopes}\n- ... (共 ${scopes.length} 个)`;
	}

	const scopeList = scopes.map((s) => `- ${s}`).join("\n");
	return `${desc}\n\n**所需权限**：\n${scopeList}`;
}

/**
 * 构建授权请求卡片
 * 参考: openclaw-lark/src/tools/oauth-cards.ts buildAuthCard
 */
export function buildAuthCard(params: AuthCardParams): Record<string, unknown> {
	const { grantUrl, scopes, expiresMin = 5 } = params;
	const inAppUrl = toInAppWebUrl(grantUrl);
	const multiUrl = {
		url: inAppUrl,
		pc_url: inAppUrl,
		android_url: inAppUrl,
		ios_url: inAppUrl,
	};

	const scopeDesc = formatScopeDescription(scopes);

	return {
		schema: "2.0",
		config: {
			wide_screen_mode: false,
			style: {
				color: {
					"light-yellow-bg": {
						light_mode: "rgba(255, 214, 102, 0.12)",
						dark_mode: "rgba(255, 214, 102, 0.08)",
					},
				},
			},
		},
		header: {
			title: {
				tag: "plain_text",
				content: "需要您的授权才能继续",
			},
			subtitle: {
				tag: "plain_text",
				content: "",
			},
			template: "blue",
			padding: "12px 12px 12px 12px",
			icon: {
				tag: "standard_icon",
				token: "lock-chat_filled",
			},
		},
		body: {
			elements: [
				// 授权说明
				{
					tag: "markdown",
					content: scopeDesc,
					text_size: "normal",
				},
				// 授权按钮
				{
					tag: "column_set",
					flex_mode: "none",
					horizontal_align: "right",
					columns: [
						{
							tag: "column",
							width: "auto",
							elements: [
								{
									tag: "button",
									text: { tag: "plain_text", content: "前往授权" },
									type: "primary",
									size: "medium",
									multi_url: multiUrl,
								},
							],
						},
					],
				},
				// 失效时间提醒
				{
					tag: "markdown",
					content: `<font color='grey'>授权链接将在 ${expiresMin} 分钟后失效，届时需重新发起</font>`,
					text_size: "notation",
				},
				// 提示信息
				{
					tag: "markdown",
					content: "<font color='grey'>授权完成后，请重新发送您的请求</font>",
					text_size: "notation",
				},
			],
		},
	};
}

/**
 * 构建授权成功卡片
 */
export function buildAuthSuccessCard(): Record<string, unknown> {
	return {
		schema: "2.0",
		config: {
			wide_screen_mode: false,
			style: {
				color: {
					"light-green-bg": {
						light_mode: "rgba(52, 199, 89, 0.12)",
						dark_mode: "rgba(52, 199, 89, 0.08)",
					},
				},
			},
		},
		header: {
			title: {
				tag: "plain_text",
				content: "授权成功",
			},
			subtitle: {
				tag: "plain_text",
				content: "",
			},
			template: "green",
			padding: "12px 12px 12px 12px",
			icon: {
				tag: "standard_icon",
				token: "yes_filled",
			},
		},
		body: {
			elements: [
				{
					tag: "markdown",
					content:
						"您的飞书账号已成功授权，正在为您继续执行操作。\n\n" +
						"<font color='grey'>如需撤销授权，可随时告诉我。</font>",
				},
			],
		},
	};
}

/**
 * 构建授权失败卡片
 */
export function buildAuthFailedCard(reason: string): Record<string, unknown> {
	return {
		schema: "2.0",
		config: {
			wide_screen_mode: false,
			style: {
				color: {
					"light-grey-bg": {
						light_mode: "rgba(142, 142, 147, 0.12)",
						dark_mode: "rgba(142, 142, 147, 0.08)",
					},
				},
			},
		},
		header: {
			title: {
				tag: "plain_text",
				content: "授权未完成",
			},
			subtitle: {
				tag: "plain_text",
				content: "",
			},
			template: "yellow",
			padding: "12px 12px 12px 12px",
			icon: {
				tag: "standard_icon",
				token: "warning_filled",
			},
		},
		body: {
			elements: [
				{
					tag: "markdown",
					content: reason || "授权链接已过期，请重新发起授权。",
				},
			],
		},
	};
}

// ============================================================================
// Auth Card Sending
// ============================================================================

/**
 * 发送权限授权提示卡片（避免权限死循环）
 *
 * 注意：这里使用 sendReplyCard 而不是 sendCard，因为 sendCard 内部会调用 convertAtMentions，
 * 而 convertAtMentions 需要 getChatMembers 权限，会导致死循环：
 *
 * handleError() → sendAuthCard() → sendCard() → convertAtMentions() → getChatMembers()
 *     ↑ 权限不足                                              ↓
 *     └──────────────────── 抛出权限错误 ←─────────────────────┘
 *
 * 解决方案：使用 sendReplyCard 直接发送卡片，不调用 convertAtMentions
 *
 * 参考：openclaw-lark 的 sendCardByCardId 直接调用飞书 API，不调用 convertAtMentions
 *
 * @param context 飞书平台上下文
 * @param permissionError 权限错误信息
 */
export async function sendAuthCard(
	context: FeishuPlatformContext,
	permissionError: PermissionError,
): Promise<void> {
	const { grantUrl, scopes } = permissionError;
	const chatId = context["chatId"];
	const replyToMessageId = context["quoteMessageId"] ?? undefined;

	// 构建授权卡片
	const card = buildAuthCard({
		grantUrl,
		scopes,
		expiresMin: 5,
	});

	// 使用 sendReplyCard 发送卡片，避免权限死循环
	await context.sendReplyCard(chatId, card, replyToMessageId);
}

/**
 * 发送授权成功卡片
 */
export async function sendAuthSuccessCard(context: FeishuPlatformContext): Promise<void> {
	const card = buildAuthSuccessCard();
	await context.sendCard(context["chatId"], card);
}

/**
 * 发送授权失败卡片
 */
export async function sendAuthFailedCard(
	context: FeishuPlatformContext,
	reason: string,
): Promise<void> {
	const card = buildAuthFailedCard(reason);
	await context.sendCard(context["chatId"], card);
}

/**
 * 处理权限错误并发送授权卡片
 * @param context 飞书平台上下文
 * @param error 错误对象
 * @param appId 应用 ID
 * @returns 是否是权限错误（已处理返回 true）
 */
export async function handlePermissionError(
	context: FeishuPlatformContext,
	error: unknown,
	appId: string,
): Promise<boolean> {
	// 提取权限错误
	const permissionError = extractPermissionError(error);
	if (!permissionError) {
		return false;
	}

	// 检查冷却时间
	if (!shouldNotifyPermissionError(appId)) {
		console.log("[Permission] Skipping auth card due to cooldown");
		return true;
	}

	// 发送授权卡片
	try {
		await sendAuthCard(context, permissionError);
		console.log("[Permission] Auth card sent successfully");
	} catch (sendError) {
		console.error("[Permission] Failed to send auth card:", sendError);
	}

	return true;
}
