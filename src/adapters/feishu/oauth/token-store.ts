/**
 * UAT (User Access Token) Persistent Storage
 *
 * 使用操作系统原生凭据服务跨平台安全存储 OAuth token 数据
 * 使 token 在进程重启后仍然有效
 *
 * 平台后端:
 *   macOS   – Keychain Access via `security` CLI
 *   Linux   – AES-256-GCM encrypted files (XDG_DATA_HOME)
 *   Windows – AES-256-GCM encrypted files (%LOCALAPPDATA%)
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { Logger } from "../../../utils/logger/index.js";

const execFile = promisify(execFileCb);

// ============================================================================
// Constants
// ============================================================================

const KEYCHAIN_SERVICE = "pi-claw-feishu-uat";

/** 在 access_token 到期前多久主动刷新 */
const REFRESH_AHEAD_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Types
// ============================================================================

/**
 * 存储的 User Access Token
 */
export interface StoredToken {
	userOpenId: string;
	appId: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	refreshExpiresAt: number;
	scope: string;
	grantedAt: number;
}

// ============================================================================
// Helpers
// ============================================================================

function accountKey(appId: string, userOpenId: string): string {
	return `${appId}:${userOpenId}`;
}

/**
 * 遮蔽 token 以便安全日志记录：只显示最后 4 个字符
 */
export function maskToken(token: string): string {
	if (token.length <= 8) return "****";
	return `****${token.slice(-4)}`;
}

// ============================================================================
// macOS Backend – Keychain Access via `security` CLI
// ============================================================================

const darwinBackend = {
	async get(service: string, account: string): Promise<string | null> {
		try {
			const { stdout } = await execFile("security", [
				"find-generic-password",
				"-s",
				service,
				"-a",
				account,
				"-w",
			]);
			return stdout.trim() || null;
		} catch {
			return null;
		}
	},

	async set(service: string, account: string, data: string): Promise<void> {
		// 先删除 - `add-generic-password` 在条目已存在时会失败
		try {
			await execFile("security", ["delete-generic-password", "-s", service, "-a", account]);
		} catch {
			// 未找到 - 正常
		}
		await execFile("security", ["add-generic-password", "-s", service, "-a", account, "-w", data]);
	},

	async remove(service: string, account: string): Promise<void> {
		try {
			await execFile("security", ["delete-generic-password", "-s", service, "-a", account]);
		} catch {
			// 已经不存在 - 正常
		}
	},
};

// ============================================================================
// Linux Backend – AES-256-GCM encrypted files (XDG Base Directory)
// ============================================================================

const LINUX_UAT_DIR = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "pi-claw-feishu-uat");
const LINUX_MASTER_KEY_PATH = join(LINUX_UAT_DIR, "master.key");
const MASTER_KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM recommended
const TAG_BYTES = 16; // GCM auth tag

function linuxSafeFileName(account: string): string {
	return account.replace(/[^a-zA-Z0-9._-]/g, "_") + ".enc";
}

async function ensureLinuxCredDir(): Promise<void> {
	await mkdir(LINUX_UAT_DIR, { recursive: true, mode: 0o700 });
}

async function getLinuxMasterKey(logger?: Logger): Promise<Buffer> {
	try {
		const key = await readFile(LINUX_MASTER_KEY_PATH);
		if (key.length === MASTER_KEY_BYTES) return key;
		logger?.warn("token-store: master key has unexpected length, regenerating");
	} catch (err: any) {
		if (err?.code !== "ENOENT") {
			logger?.warn(`token-store: failed to read master key: ${err?.message ?? err}`);
		}
	}
	await ensureLinuxCredDir();
	const key = randomBytes(MASTER_KEY_BYTES);
	await writeFile(LINUX_MASTER_KEY_PATH, key, { mode: 0o600 });
	await chmod(LINUX_MASTER_KEY_PATH, 0o600);
	logger?.info("token-store: generated new master key for encrypted file storage");
	return key;
}

function encryptData(plaintext: string, key: Buffer): Buffer {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function decryptData(data: Buffer, key: Buffer): string | null {
	if (data.length < IV_BYTES + TAG_BYTES) return null;
	try {
		const iv = data.subarray(0, IV_BYTES);
		const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
		const enc = data.subarray(IV_BYTES + TAG_BYTES);
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
	} catch {
		return null;
	}
}

const linuxBackend = {
	async get(_service: string, account: string, logger?: Logger): Promise<string | null> {
		try {
			const key = await getLinuxMasterKey(logger);
			const data = await readFile(join(LINUX_UAT_DIR, linuxSafeFileName(account)));
			return decryptData(data, key);
		} catch {
			return null;
		}
	},

	async set(_service: string, account: string, data: string, logger?: Logger): Promise<void> {
		const key = await getLinuxMasterKey(logger);
		await ensureLinuxCredDir();
		const filePath = join(LINUX_UAT_DIR, linuxSafeFileName(account));
		const encrypted = encryptData(data, key);
		await writeFile(filePath, encrypted, { mode: 0o600 });
		await chmod(filePath, 0o600);
	},

	async remove(_service: string, account: string): Promise<void> {
		try {
			await unlink(join(LINUX_UAT_DIR, linuxSafeFileName(account)));
		} catch {
			// 已经不存在 - 正常
		}
	},
};

// ============================================================================
// Windows Backend – AES-256-GCM encrypted files
// ============================================================================

const WIN32_UAT_DIR = join(
	process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? homedir(), "AppData", "Local"),
	KEYCHAIN_SERVICE
);
const WIN32_MASTER_KEY_PATH = join(WIN32_UAT_DIR, "master.key");

function win32SafeFileName(account: string): string {
	return account.replace(/[^a-zA-Z0-9._-]/g, "_") + ".enc";
}

async function ensureWin32CredDir(): Promise<void> {
	await mkdir(WIN32_UAT_DIR, { recursive: true });
}

async function getWin32MasterKey(logger?: Logger): Promise<Buffer> {
	try {
		const key = await readFile(WIN32_MASTER_KEY_PATH);
		if (key.length === MASTER_KEY_BYTES) return key;
		logger?.warn("token-store: win32 master key has unexpected length, regenerating");
	} catch (err: any) {
		if (err?.code !== "ENOENT") {
			logger?.warn(`token-store: failed to read win32 master key: ${err?.message ?? err}`);
		}
	}
	await ensureWin32CredDir();
	const key = randomBytes(MASTER_KEY_BYTES);
	await writeFile(WIN32_MASTER_KEY_PATH, key);
	logger?.info("token-store: generated new master key for win32 encrypted file storage");
	return key;
}

const win32Backend = {
	async get(_service: string, account: string, logger?: Logger): Promise<string | null> {
		try {
			const key = await getWin32MasterKey(logger);
			const data = await readFile(join(WIN32_UAT_DIR, win32SafeFileName(account)));
			return decryptData(data, key);
		} catch {
			return null;
		}
	},

	async set(_service: string, account: string, data: string, logger?: Logger): Promise<void> {
		const key = await getWin32MasterKey(logger);
		await ensureWin32CredDir();
		const filePath = join(WIN32_UAT_DIR, win32SafeFileName(account));
		const encrypted = encryptData(data, key);
		await writeFile(filePath, encrypted);
	},

	async remove(_service: string, account: string): Promise<void> {
		try {
			await unlink(join(WIN32_UAT_DIR, win32SafeFileName(account)));
		} catch {
			// 已经不存在 - 正常
		}
	},
};

// ============================================================================
// Platform Selection
// ============================================================================

interface CredentialBackend {
	get(service: string, account: string, logger?: Logger): Promise<string | null>;
	set(service: string, account: string, data: string, logger?: Logger): Promise<void>;
	remove(service: string, account: string): Promise<void>;
}

function createBackend(logger?: Logger): CredentialBackend {
	switch (process.platform) {
		case "darwin":
			return darwinBackend;
		case "linux":
			return {
				get: (s, a) => linuxBackend.get(s, a, logger),
				set: (s, a, d) => linuxBackend.set(s, a, d, logger),
				remove: (s, a) => linuxBackend.remove(s, a),
			};
		case "win32":
			return {
				get: (s, a) => win32Backend.get(s, a, logger),
				set: (s, a, d) => win32Backend.set(s, a, d, logger),
				remove: (s, a) => win32Backend.remove(s, a),
			};
		default:
			logger?.warn(`token-store: unsupported platform "${process.platform}", falling back to macOS backend`);
			return darwinBackend;
	}
}

// ============================================================================
// Public API
// ============================================================================

let _backend: CredentialBackend | null = null;

function getBackend(logger?: Logger): CredentialBackend {
	if (!_backend) {
		_backend = createBackend(logger);
	}
	return _backend;
}

/**
 * 读取指定 (appId, userOpenId) 对应的存储 UAT
 * 不存在或无法解析时返回 null
 */
export async function getStoredToken(
	appId: string,
	userOpenId: string,
	logger?: Logger
): Promise<StoredToken | null> {
	try {
		const json = await getBackend(logger).get(KEYCHAIN_SERVICE, accountKey(appId, userOpenId), logger);
		if (!json) return null;
		return JSON.parse(json);
	} catch {
		return null;
	}
}

/**
 * 使用平台凭据存储持久化 UAT
 * 覆盖同一 (appId, userOpenId) 的现有条目
 */
export async function setStoredToken(token: StoredToken, logger?: Logger): Promise<void> {
	const key = accountKey(token.appId, token.userOpenId);
	const payload = JSON.stringify(token);
	await getBackend(logger).set(KEYCHAIN_SERVICE, key, payload, logger);
	logger?.info(`token-store: saved UAT for ${token.userOpenId} (at:${maskToken(token.accessToken)})`);
}

/**
 * 从凭据存储中删除存储的 UAT
 */
export async function removeStoredToken(appId: string, userOpenId: string, logger?: Logger): Promise<void> {
	await getBackend(logger).remove(KEYCHAIN_SERVICE, accountKey(appId, userOpenId));
	logger?.info(`token-store: removed UAT for ${userOpenId}`);
}

// ============================================================================
// Token Validity Check
// ============================================================================

/**
 * 确定存储 token 的新鲜度
 *
 * - "valid"         – access_token 仍然有效（距过期 > 5 分钟）
 * - "needs_refresh" – access_token 已过期/即将过期但 refresh_token 仍有效
 * - "expired"       – 两个 token 都已过期；需要重新授权
 */
export function tokenStatus(token: StoredToken): "valid" | "needs_refresh" | "expired" {
	const now = Date.now();
	if (now < token.expiresAt - REFRESH_AHEAD_MS) {
		return "valid";
	}
	if (now < token.refreshExpiresAt) {
		return "needs_refresh";
	}
	return "expired";
}
