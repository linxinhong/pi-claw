/**
 * Permission Error Detection
 *
 * 权限错误检测 - 从飞书 API 错误中提取权限信息
 */

// ============================================================================
// Types
// ============================================================================

/**
 * 权限错误信息
 */
export interface PermissionError {
	/** 飞书错误码 */
	code: number;
	/** 错误消息 */
	message: string;
	/** 权限授权链接 */
	grantUrl: string;
	/** 需要的权限范围 */
	scopes: string;
}

// ============================================================================
// Permission URL Extraction
// ============================================================================

/**
 * 获取权限优先级（用于排序）
 * - read: 1 (最高)
 * - write: 2
 * - other: 3 (最低)
 */
function getPermissionPriority(scope: string): number {
	const lowerScope = scope.toLowerCase();
	const hasRead = lowerScope.includes("read");
	const hasWrite = lowerScope.includes("write");
	if (hasRead && !hasWrite) return 1;
	if (hasWrite && !hasRead) return 2;
	return 3;
}

/**
 * 提取最高优先级的权限范围
 */
function extractHighestPriorityScope(scopeList: string): string {
	return (
		scopeList
			.split(",")
			.sort((a, b) => getPermissionPriority(a) - getPermissionPriority(b))[0] ?? ""
	);
}

/**
 * 从飞书错误消息中提取权限授权 URL
 */
function extractPermissionGrantUrl(msg: string): string {
	const urlMatch = msg.match(/https:\/\/[^\s]+\/app\/[^\s]+/);
	if (!urlMatch?.[0]) {
		return "";
	}
	try {
		const url = new URL(urlMatch[0]);
		const scopeListParam = url.searchParams.get("q") ?? "";
		const firstScope = extractHighestPriorityScope(scopeListParam);
		if (firstScope) {
			url.searchParams.set("q", firstScope);
		}
		return url.href;
	} catch {
		return urlMatch[0];
	}
}

/**
 * 从飞书错误消息中提取权限范围
 */
function extractPermissionScopes(msg: string): string {
	const scopeMatch = msg.match(/\[([^\]]+)\]/);
	return scopeMatch?.[1] ?? "unknown";
}

// ============================================================================
// Permission Error Extraction
// ============================================================================

/**
 * 从飞书 API 错误中提取权限错误信息
 *
 * @param err - Axios 错误对象
 * @returns 权限错误信息，如果不是权限错误则返回 null
 */
export function extractPermissionError(err: unknown): PermissionError | null {
	if (!err || typeof err !== "object") {
		return null;
	}

	const axiosErr = err as any;
	const data = axiosErr.response?.data;
	if (!data || typeof data !== "object") {
		return null;
	}

	const feishuErr = data;
	// 飞书权限错误码
	if (feishuErr.code !== 99991672) {
		return null;
	}

	const msg = feishuErr.msg ?? "";
	const grantUrl = extractPermissionGrantUrl(msg);
	if (!grantUrl) {
		return null;
	}

	return {
		code: feishuErr.code,
		message: msg,
		grantUrl,
		scopes: extractPermissionScopes(msg),
	};
}

// ============================================================================
// Cooldown Tracking
// ============================================================================

/** 权限错误通知冷却时间（5 分钟） */
export const PERMISSION_ERROR_COOLDOWN_MS = 5 * 60 * 1000;

/** 权限错误通知时间记录 */
export const permissionErrorNotifiedAt = new Map<string, number>();

/**
 * 检查是否应该发送权限错误通知（考虑冷却时间）
 */
export function shouldNotifyPermissionError(key: string): boolean {
	const now = Date.now();
	const lastNotified = permissionErrorNotifiedAt.get(key);
	if (lastNotified && now - lastNotified < PERMISSION_ERROR_COOLDOWN_MS) {
		return false;
	}
	permissionErrorNotifiedAt.set(key, now);
	return true;
}
