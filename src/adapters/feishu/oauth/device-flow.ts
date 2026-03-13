/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) for Feishu/Lark
 *
 * 两步流程：
 * 1. requestDeviceAuthorization - 获取 device_code + user_code
 * 2. pollDeviceToken - 轮询 token 端点直到用户授权、拒绝或过期
 */

import type { Logger } from "../../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

/** Lark 品牌 */
export type LarkBrand = "feishu" | "lark" | string;

/** 设备授权响应 */
export interface DeviceAuthResponse {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	expiresIn: number;
	interval: number;
}

/** 设备流程 Token 数据 */
export interface DeviceFlowTokenData {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	refreshExpiresIn: number;
	scope: string;
}

/** 设备流程错误类型 */
export type DeviceFlowError =
	| "authorization_pending"
	| "slow_down"
	| "access_denied"
	| "expired_token";

/** 设备流程结果 */
export type DeviceFlowResult =
	| {
			ok: true;
			token: DeviceFlowTokenData;
	  }
	| {
			ok: false;
			error: DeviceFlowError;
			message: string;
	  };

// ============================================================================
// Endpoint Resolution
// ============================================================================

/**
 * 根据配置的品牌解析 OAuth 端点 URL
 */
export function resolveOAuthEndpoints(brand: LarkBrand): {
	deviceAuthorization: string;
	token: string;
} {
	if (!brand || brand === "feishu") {
		return {
			deviceAuthorization: "https://accounts.feishu.cn/oauth/v1/device_authorization",
			token: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
		};
	}
	if (brand === "lark") {
		return {
			deviceAuthorization: "https://accounts.larksuite.com/oauth/v1/device_authorization",
			token: "https://open.larksuite.com/open-apis/authen/v2/oauth/token",
		};
	}
	// 自定义域名 - 按约定推导路径
	const base = brand.replace(/\/+$/, "");
	let accountsBase = base;
	try {
		const parsed = new URL(base);
		if (parsed.hostname.startsWith("open.")) {
			accountsBase = `${parsed.protocol}//${parsed.hostname.replace(/^open\./, "accounts.")}`;
		}
	} catch {
		/* fallback to base */
	}
	return {
		deviceAuthorization: `${accountsBase}/oauth/v1/device_authorization`,
		token: `${base}/open-apis/authen/v2/oauth/token`,
	};
}

// ============================================================================
// Step 1 - Device Authorization Request
// ============================================================================

/**
 * 从飞书 OAuth 服务器请求设备授权码
 *
 * 使用 Confidential Client 认证（HTTP Basic with appId:appSecret）
 * 自动追加 offline_access scope 以获取 refresh_token
 */
export async function requestDeviceAuthorization(params: {
	appId: string;
	appSecret: string;
	brand?: LarkBrand;
	scope?: string;
	logger?: Logger;
}): Promise<DeviceAuthResponse> {
	const { appId, appSecret, brand = "feishu", logger } = params;
	const endpoints = resolveOAuthEndpoints(brand);

	// 确保始终请求 offline_access
	let scope = params.scope ?? "";
	if (!scope.includes("offline_access")) {
		scope = scope ? `${scope} offline_access` : "offline_access";
	}

	const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
	const body = new URLSearchParams();
	body.set("client_id", appId);
	body.set("scope", scope);

	logger?.debug(`device-flow: requesting device authorization (scope="${scope}")`);

	const resp = await fetch(endpoints.deviceAuthorization, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${basicAuth}`,
		},
		body: body.toString(),
	});

	const text = await resp.text();
	logger?.debug(`device-flow: response status=${resp.status}`);

	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`Device authorization failed: HTTP ${resp.status} – ${text.slice(0, 200)}`);
	}

	if (!resp.ok || data.error) {
		const msg = data.error_description ?? data.error ?? "Unknown error";
		throw new Error(`Device authorization failed: ${msg}`);
	}

	const expiresIn = data.expires_in ?? 240;
	const interval = data.interval ?? 5;

	logger?.info(
		`device-flow: device_code obtained, expires_in=${expiresIn}s (${Math.round(expiresIn / 60)}min), interval=${interval}s`
	);

	return {
		deviceCode: data.device_code,
		userCode: data.user_code,
		verificationUri: data.verification_uri,
		verificationUriComplete: data.verification_uri_complete ?? data.verification_uri,
		expiresIn,
		interval,
	};
}

// ============================================================================
// Step 2 - Poll Token Endpoint
// ============================================================================

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true }
		);
	});
}

/**
 * 轮询 token 端点直到用户授权、拒绝或过期
 *
 * 处理:
 * - authorization_pending: 继续轮询
 * - slow_down: 增加 5 秒间隔
 * - access_denied, expired_token: 终止错误
 *
 * 可通过 AbortSignal 从外部取消轮询
 */
export async function pollDeviceToken(params: {
	appId: string;
	appSecret: string;
	brand?: LarkBrand;
	deviceCode: string;
	interval: number;
	expiresIn: number;
	signal?: AbortSignal;
	logger?: Logger;
}): Promise<DeviceFlowResult> {
	const { appId, appSecret, brand = "feishu", deviceCode, expiresIn, signal, logger } = params;
	let interval = params.interval;
	const endpoints = resolveOAuthEndpoints(brand);
	const deadline = Date.now() + expiresIn * 1000;

	while (Date.now() < deadline) {
		if (signal?.aborted) {
			return { ok: false, error: "expired_token", message: "Polling was cancelled" };
		}

		await sleep(interval * 1000, signal);

		let data: any;
		try {
			const resp = await fetch(endpoints.token, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: deviceCode,
					client_id: appId,
					client_secret: appSecret,
				}).toString(),
			});
			data = await resp.json();
		} catch (err) {
			logger?.warn(`device-flow: poll network error: ${err}`);
			continue;
		}

		const error = data.error;
		if (!error && data.access_token) {
			logger?.info("device-flow: token obtained successfully");

			const refreshToken = data.refresh_token ?? "";
			const expiresIn = data.expires_in ?? 7200;
			let refreshExpiresIn = data.refresh_token_expires_in ?? 604800;

			if (!refreshToken) {
				logger?.warn("device-flow: no refresh_token in response, token will not be refreshable");
				refreshExpiresIn = expiresIn;
			}

			return {
				ok: true,
				token: {
					accessToken: data.access_token,
					refreshToken,
					expiresIn,
					refreshExpiresIn,
					scope: data.scope ?? "",
				},
			};
		}

		if (error === "authorization_pending") {
			logger?.debug("device-flow: authorization_pending, retrying...");
			continue;
		}

		if (error === "slow_down") {
			interval += 5;
			logger?.info(`device-flow: slow_down, interval increased to ${interval}s`);
			continue;
		}

		if (error === "access_denied") {
			logger?.info("device-flow: user denied authorization");
			return { ok: false, error: "access_denied", message: "用户拒绝了授权" };
		}

		if (error === "expired_token" || error === "invalid_grant") {
			logger?.info(`device-flow: device code expired/invalid (error=${error})`);
			return { ok: false, error: "expired_token", message: "授权码已过期，请重新发起" };
		}

		// 未知错误 - 视为终止
		const desc = data.error_description ?? error ?? "Unknown error";
		logger?.warn(`device-flow: unexpected error: error=${error}, desc=${desc}`);
		return { ok: false, error: "expired_token", message: desc };
	}

	return { ok: false, error: "expired_token", message: "授权超时，请重新发起" };
}
