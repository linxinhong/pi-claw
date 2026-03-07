/**
 * Model Manager
 *
 * 模型管理器 - 负责模型注册、配置管理和动态切换
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { join } from "path";
import { AGENT_DIR } from "../../utils/config.js";
import { loadModelsConfig } from "./config.js";
import type { ModelsConfig, ModelDefinition, ProviderConfig } from "./types.js";
import * as log from "../../utils/logger/index.js";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";

// ============================================================================
// Legacy Type (for backward compatibility in return values)
// ============================================================================

/**
 * 模型能力声明
 */
interface ModelCapabilities {
	vision?: boolean;
	tools?: boolean;
	streaming?: boolean;
}

/**
 * 模型配置（兼容旧格式返回值）
 */
export interface ModelConfig {
	/** 模型标识 */
	id: string;
	/** 模型名称 */
	name: string;
	/** 提供商 */
	provider: string;
	/** API 基础 URL */
	baseUrl?: string;
	/** API Key */
	apiKey?: string;
	/** 模型 ID（用于 API 调用） */
	model: string;
	/** 能力声明 */
	capabilities?: ModelCapabilities;
}

// ============================================================================
// Model Manager
// ============================================================================

/**
 * 模型管理器
 *
 * 管理多个大模型配置，支持动态切换
 */
export class ModelManager {
	private config: ModelsConfig;
	private currentModelId: string;
	private currentProviderId: string;
	private perChannelModels: Map<string, string>;
	private modelRegistry: ModelRegistry;
	private authStorage: AuthStorage;

	constructor(configPath?: string) {
		const path = configPath || join(AGENT_DIR, "models.json");
		this.config = loadModelsConfig(path);

		// 使用第一个 provider 的第一个 model 作为默认
		const firstProvider = Object.keys(this.config.providers)[0];
		this.currentProviderId = firstProvider;
		this.currentModelId = this.config.providers[firstProvider]?.models[0]?.id || "";

		this.perChannelModels = new Map();
		this.authStorage = AuthStorage.create();
		this.modelRegistry = new ModelRegistry(this.authStorage, path);

		this.registerProviders();
	}

	/**
	 * 注册所有提供商到 ModelRegistry
	 */
	private registerProviders(): void {
		for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
			try {
				const models = this.convertModels(providerConfig);

				this.modelRegistry.registerProvider(providerName, {
					baseUrl: providerConfig.baseUrl,
					apiKey: providerConfig.apiKey,
					api: (providerConfig.api || "openai") as "openai",
					headers: providerConfig.headers,
					models,
				});

				log.logInfo(`[ModelManager] Registered provider: ${providerName} with ${models.length} models`);
			} catch (error) {
				log.logWarning(`[ModelManager] Failed to register provider ${providerName}:`, error);
			}
		}
	}

	/**
	 * 转换模型配置为 ModelRegistry 格式
	 */
	private convertModels(providerConfig: ProviderConfig) {
		return providerConfig.models.map((model) => ({
			id: model.id,
			name: model.name || model.id,
			api: (model.api || providerConfig.api || "openai") as "openai",
			reasoning: model.reasoning ?? false,
			// 过滤掉 "audio" 类型，只保留 "text" 和 "image"
			input: model.input.filter((t): t is "text" | "image" => t === "text" || t === "image"),
			cost: {
				input: model.cost.input,
				output: model.cost.output,
				cacheRead: model.cost.cacheRead ?? 0,
				cacheWrite: model.cost.cacheWrite ?? 0,
			},
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			compat: model.compat,
		}));
	}

	/**
	 * 将新格式模型转换为兼容的 ModelConfig
	 */
	private toModelConfig(model: ModelDefinition, providerName: string, providerConfig: ProviderConfig): ModelConfig {
		return {
			id: model.id,
			name: model.name || model.id,
			provider: providerName,
			baseUrl: providerConfig.baseUrl,
			apiKey: providerConfig.apiKey,
			model: model.id,
			capabilities: {
				vision: model.input.includes("image"),
				tools: true,
				streaming: true,
			},
		};
	}

	/**
	 * 获取所有模型配置
	 */
	getAllModels(): Record<string, ModelConfig> {
		const result: Record<string, ModelConfig> = {};
		for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
			for (const model of providerConfig.models) {
				result[model.id] = this.toModelConfig(model, providerName, providerConfig);
			}
		}
		return result;
	}

	/**
	 * 获取指定模型配置
	 */
	getModelConfig(modelId: string): ModelConfig | undefined {
		for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
			const model = providerConfig.models.find((m) => m.id === modelId);
			if (model) {
				return this.toModelConfig(model, providerName, providerConfig);
			}
		}
		return undefined;
	}

	/**
	 * 获取当前模型配置
	 */
	getCurrentModelConfig(): ModelConfig {
		const config = this.getModelConfig(this.currentModelId);
		if (!config) {
			throw new Error(`Current model ${this.currentModelId} not found`);
		}
		return config;
	}

	/**
	 * 切换全局模型
	 * 支持格式：
	 * - "modelId" - 直接使用模型 ID
	 * - "provider/modelId" - 指定提供商和模型
	 */
	switchModel(modelSpec: string): boolean {
		const { provider, modelId } = this.parseModelSpec(modelSpec);

		const config = this.findModelConfig(provider, modelId);
		if (!config) {
			log.logWarning(`[ModelManager] Model not found: ${modelSpec}`);
			return false;
		}

		const previousModel = this.currentModelId;
		this.currentModelId = config.id;
		if (provider) {
			this.currentProviderId = provider;
		}

		log.logInfo(`[ModelManager] Switched from ${previousModel} to ${config.id} (provider: ${config.provider})`);
		return true;
	}

	/**
	 * 切换频道模型
	 */
	switchChannelModel(channelId: string, modelSpec: string): boolean {
		const { provider, modelId } = this.parseModelSpec(modelSpec);

		const config = this.findModelConfig(provider, modelId);
		if (!config) {
			log.logWarning(`[ModelManager] Model not found: ${modelSpec}`);
			return false;
		}

		this.perChannelModels.set(channelId, config.id);
		log.logInfo(`[ModelManager] Channel ${channelId} switched to ${config.id}`);
		return true;
	}

	/**
	 * 解析模型规范
	 * @param modelSpec 模型规范（如 "qwen", "dashscope/qwen-plus"）
	 */
	private parseModelSpec(modelSpec: string): { provider?: string; modelId: string } {
		const slashIndex = modelSpec.indexOf("/");
		if (slashIndex !== -1) {
			return {
				provider: modelSpec.substring(0, slashIndex),
				modelId: modelSpec.substring(slashIndex + 1),
			};
		}
		return { modelId: modelSpec };
	}

	/**
	 * 查找模型配置
	 */
	private findModelConfig(provider?: string, modelId?: string): ModelConfig | undefined {
		if (provider && modelId) {
			const providerConfig = this.config.providers[provider];
			if (providerConfig) {
				const model = providerConfig.models.find((m) => m.id === modelId);
				if (model) {
					return this.toModelConfig(model, provider, providerConfig);
				}
			}
		}

		// 只提供 modelId，遍历所有 provider 查找
		if (modelId) {
			for (const [provName, provConfig] of Object.entries(this.config.providers)) {
				const model = provConfig.models.find((m) => m.id === modelId);
				if (model) {
					return this.toModelConfig(model, provName, provConfig);
				}
			}
		}

		return undefined;
	}

	/**
	 * 获取频道模型 ID
	 */
	getChannelModelId(channelId: string): string {
		return this.perChannelModels.get(channelId) || this.currentModelId;
	}

	/**
	 * 重置频道模型（使用全局模型）
	 */
	resetChannelModel(channelId: string): void {
		this.perChannelModels.delete(channelId);
		log.logInfo(`[ModelManager] Channel ${channelId} reset to global model`);
	}

	/**
	 * 获取模型实例（用于 Agent）
	 */
	async getModelInstance(channelId?: string): Promise<Model<Api>> {
		const modelId = channelId ? this.getChannelModelId(channelId) : this.currentModelId;
		const config = this.getModelConfig(modelId);

		if (!config) {
			throw new Error(`Model not found: ${modelId}`);
		}

		// 从 ModelRegistry 查找模型
		const model = this.modelRegistry.find(config.provider, config.model);

		if (!model) {
			throw new Error(`Model instance not found: ${config.provider}/${config.model}`);
		}

		log.logInfo(`[ModelManager] Got model instance: ${config.provider}/${config.model}`);
		return model;
	}

	/**
	 * 获取 ModelRegistry（用于外部访问）
	 */
	getRegistry(): ModelRegistry {
		return this.modelRegistry;
	}

	/**
	 * 处理模型切换命令
	 * 支持的命令格式：
	 * - "切换模型 qwen"
	 * - "switch model glm"
	 * - "/model kimi"
	 * @param text 命令文本
	 * @param channelId 频道 ID（可选，如果指定则为频道切换）
	 * @returns 是否成功处理命令
	 */
	handleModelCommand(text: string, channelId?: string): boolean {
		const trimmedText = text.trim().toLowerCase();

		// 匹配命令格式
		const patterns = [
			/^切换模型\s+(\w+)$/,
			/^switch\s+model\s+(\w+)$/i,
			/^\/model\s+(\w+)$/,
		];

		for (const pattern of patterns) {
			const match = trimmedText.match(pattern);
			if (match) {
				const modelId = match[1].toLowerCase();
				const success = channelId
					? this.switchChannelModel(channelId, modelId)
					: this.switchModel(modelId);

				if (success) {
					const modelConfig = this.getModelConfig(modelId);
					const modelName = modelConfig?.name || modelId;
					const scope = channelId ? `频道` : "全局";
					log.logInfo(`[ModelManager] ${scope}模型已切换到: ${modelName}`);
				}

				return success;
			}
		}

		return false;
	}

	/**
	 * 保存频道模型配置到文件
	 */
	saveChannelModel(channelId: string, modelId: string, configPath: string): void {
		try {
			const fs = require("fs");
			let config: Record<string, string> = {};

			if (fs.existsSync(configPath)) {
				const content = fs.readFileSync(configPath, "utf-8");
				config = JSON.parse(content);
			}

			config[channelId] = modelId;
			fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		} catch (error) {
			log.logWarning(`[ModelManager] Failed to save channel model config: ${error}`);
		}
	}

	/**
	 * 从文件加载频道模型配置
	 */
	loadChannelModels(configPath: string): void {
		try {
			const fs = require("fs");
			if (!fs.existsSync(configPath)) {
				return;
			}

			const content = fs.readFileSync(configPath, "utf-8");
			const config: Record<string, string> = JSON.parse(content);

			for (const [channelId, modelId] of Object.entries(config)) {
				if (this.getModelConfig(modelId)) {
					this.perChannelModels.set(channelId, modelId);
				}
			}

			log.logInfo(`[ModelManager] Loaded ${Object.keys(config).length} channel model preferences`);
		} catch (error) {
			log.logWarning(`[ModelManager] Failed to load channel model config: ${error}`);
		}
	}

	/**
	 * 列出所有可用模型
	 */
	listModels(): Array<{ id: string; name: string; provider: string; current: boolean }> {
		const allModels = this.getAllModels();
		return Object.values(allModels).map((model) => ({
			id: model.id,
			name: model.name,
			provider: model.provider,
			current: model.id === this.currentModelId,
		}));
	}
}
