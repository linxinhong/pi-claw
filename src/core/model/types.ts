/**
 * Model Types
 *
 * 模型相关的类型定义
 */

// ============================================================================
// Common Types
// ============================================================================

/**
 * 模型输入类型
 */
export type ModelInputType = "text" | "image" | "audio";

/**
 * 模型成本配置
 */
export interface ModelCost {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
}

/**
 * OpenAI 兼容性配置
 */
export interface OpenAICompat {
	supportsDeveloperRole?: boolean;
}

/**
 * API 类型
 */
export type ApiType = "openai-completions" | "anthropic-messages" | "gemini";

// ============================================================================
// Models Config Types
// ============================================================================

/**
 * 模型定义
 */
export interface ModelDefinition {
	/** 模型 ID */
	id: string;
	/** 模型名称 */
	name?: string;
	/** wqname（内部标识） */
	wqname?: string;
	/** API 类型 */
	api?: ApiType;
	/** 是否支持推理 */
	reasoning?: boolean;
	/** 输入类型 */
	input: ModelInputType[];
	/** 成本配置 */
	cost: ModelCost;
	/** 上下文窗口大小 */
	contextWindow: number;
	/** 最大输出 token 数 */
	maxTokens: number;
	/** 自定义请求头 */
	headers?: Record<string, string>;
	/** OpenAI 兼容性配置 */
	compat?: OpenAICompat;
}

/**
 * 提供商配置
 */
export interface ProviderConfig {
	/** API 基础 URL */
	baseUrl?: string;
	/** API Key（支持直接值或 "$ENV_VAR" 格式） */
	apiKey?: string;
	/** API 类型 */
	api?: ApiType;
	/** 自定义请求头 */
	headers?: Record<string, string>;
	/** 是否添加认证头 */
	authHeader?: boolean;
	/** 模型列表 */
	models: ModelDefinition[];
}

/**
 * 模型配置文件
 */
export interface ModelsConfig {
	/** 提供商配置映射 */
	providers: Record<string, ProviderConfig>;
}
