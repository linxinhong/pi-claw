/**
 * Model Config Loader
 *
 * 模型配置加载器
 */

import { existsSync, readFileSync } from "fs";
import type { ModelsConfig, ProviderConfig } from "./types.js";

// ============================================================================
// Environment Variable Resolution
// ============================================================================

/**
 * 解析 API Key，支持环境变量引用
 * 格式: "$ENV_VAR_NAME" -> 从环境变量加载
 *       "sk-xxx" -> 直接使用
 * @param apiKey API Key 字符串
 * @returns 解析后的 API Key
 */
function resolveApiKey(apiKey: string | undefined): string | undefined {
	if (!apiKey) return undefined;

	// 检查是否是环境变量引用格式
	if (apiKey.startsWith("$")) {
		const envVarName = apiKey.substring(1);
		const envValue = process.env[envVarName];
		if (!envValue) {
			console.warn(`[ModelConfig] Environment variable not found: ${envVarName}`);
		}
		return envValue;
	}

	return apiKey;
}

/**
 * 解析 provider 配置中的环境变量
 * @param providerConfig 提供商配置
 * @returns 解析后的配置
 */
function resolveProviderConfig(providerConfig: ProviderConfig): ProviderConfig {
	const resolved: ProviderConfig = {
		...providerConfig,
		apiKey: resolveApiKey(providerConfig.apiKey),
	};

	// 解析 headers 中的环境变量
	if (providerConfig.headers) {
		resolved.headers = Object.fromEntries(
			Object.entries(providerConfig.headers).map(([k, v]) => [
				k,
				typeof v === "string" && v.startsWith("$")
					? process.env[v.substring(1)] || v
					: v,
			])
		);
	}

	return resolved;
}

/**
 * 解析配置中的所有环境变量
 * @param config 原始配置
 * @returns 解析后的配置
 */
function resolveConfigEnvVars(config: ModelsConfig): ModelsConfig {
	const resolved: ModelsConfig = {
		providers: {},
	};

	for (const [providerName, providerConfig] of Object.entries(config.providers)) {
		resolved.providers[providerName] = resolveProviderConfig(providerConfig);
	}

	return resolved;
}

// ============================================================================
// Config Loader
// ============================================================================

/**
 * 加载模型配置
 * @param configPath 配置文件路径
 * @returns 模型配置
 */
export function loadModelsConfig(configPath: string): ModelsConfig {
	if (!existsSync(configPath)) {
		throw new Error(`Models config not found: ${configPath}`);
	}

	const content = readFileSync(configPath, "utf-8");
	const rawConfig = JSON.parse(content) as ModelsConfig;

	// 验证 providers 存在
	if (!rawConfig.providers || Object.keys(rawConfig.providers).length === 0) {
		throw new Error("Invalid config: 'providers' must be a non-empty object");
	}

	// 解析环境变量
	const resolved = resolveConfigEnvVars(rawConfig);
	console.log(`[ModelConfig] Loaded config with ${Object.keys(resolved.providers).length} providers`);

	return resolved;
}
