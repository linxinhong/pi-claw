/**
 * Permission Error Handling
 *
 * 飞书权限错误检测和授权卡片发送
 */

import type { FeishuPlatformContext } from "../context.js";

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

// ============================================================================
// Error Detection
// ============================================================================

/**
 * 从错误对象中提取权限错误
 * @param err 错误对象
 * @returns PermissionError 或 null
 */
export function extractPermissionError(err: unknown): PermissionError | null {
	if (!err || typeof err !== "object") {
		return null;
	}

	let error = err as any;
	
	// 处理嵌套数组格式（如 [[axiosError, feishuError]]）
	if (Array.isArray(error)) {
		// 展平所有层级
		const flattened = error.flat(Infinity);
		
		// 首先查找包含 code === 99991672 的对象
		for (const item of flattened) {
			if (item && typeof item === "object" && item.code === 99991672 && item.msg) {
				error = item;
				break;
			}
		}
		
		// 如果没找到，再查找包含 response?.data?.code === 99991672 的对象
		if (error?.code !== 99991672) {
			for (const item of flattened) {
				if (item?.response?.data?.code === 99991672) {
					error = item.response.data;
					break;
				}
			}
		}
	}
	
	// 检查是否是飞书 API 错误
	const code = error?.code;
	const msg = error?.msg;

	// 飞书权限错误码
	if (code !== 99991672) {
		return null;
	}

	if (!msg || typeof msg !== "string") {
		return null;
	}

	// 提取授权 URL
	const grantUrl = extractPermissionGrantUrl(msg);
	if (!grantUrl) {
		return null;
	}

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
// Auth Card
// ============================================================================

/**
 * 发送权限授权卡片
 * @param context 飞书平台上下文
 * @param permissionError 权限错误信息
 */
export async function sendAuthCard(
	context: FeishuPlatformContext,
	permissionError: PermissionError,
): Promise<void> {
	const { grantUrl, scopes } = permissionError;
	
	// 构建授权卡片
	const card = buildAuthCard(grantUrl, scopes);
	
	// 发送卡片
	await context.sendCard(context["chatId"], card);
}

/**
 * 构建授权卡片
 */
function buildAuthCard(grantUrl: string, scopes: string[]): any {
	const scopeText = scopes.slice(0, 3).join(", ");
	const moreScopes = scopes.length > 3 ? ` 等 ${scopes.length} 个权限` : "";
	
	return {
		schema: "2.0",
		config: {
			width_mode: "fill",
		},
		body: {
			elements: [
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content: "⚠️ **需要授权**",
					},
				},
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content: `应用需要以下权限才能继续操作：\n\`${scopeText}${moreScopes}\``,
					},
				},
				{
					tag: "action",
					actions: [
						{
							tag: "button",
							text: {
								tag: "plain_text",
								content: "点击授权",
							},
							type: "primary",
							url: grantUrl,
							multi_url: {
								default: {
									url: grantUrl,
									android_url: grantUrl,
									ios_url: grantUrl,
									pc_url: grantUrl,
								},
							},
						},
					],
				},
				{
					tag: "div",
					text: {
						tag: "lark_md",
						content: "_提示：授权完成后，请重新发送您的请求_",
					},
					margin: "8px 0 0 0",
				},
			],
		},
	};
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
