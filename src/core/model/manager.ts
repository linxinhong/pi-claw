/**
 * Model Manager
 *
 * 模型管理器 - 负责模型注册、配置管理和动态切换
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { join } from "path";
import { AGENT_DIR } from "../../utils/config.js";
import { loadModelConfig, getModelApiKey } from "./config.js";
import type { ModelConfig, ModelsConfig } from "./types.js";
import * as log from "../../utils/logger/index.js";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";

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
	private perChannelModels: Map<string, string>; // 频道特定的模型选择
	private modelRegistry: ModelRegistry;
	private authStorage: AuthStorage;

	constructor(configPath?: string) {
		const path = configPath || join(AGENT_DIR, "models.json");
		this.config = loadModelConfig(path);
		this.currentModelId = this.config.default;
		this.perChannelModels = new Map();

		// 创建 AuthStorage 和 ModelRegistry
		this.authStorage = AuthStorage.create();
		this.modelRegistry = new ModelRegistry(this.authStorage, path);

		// 注册自定义提供商
		this.registerCustomProviders();
	}

	/**
	 * 注册自定义提供商到 ModelRegistry
	 */
	private registerCustomProviders(): void {
		// 收集所有需要注册的提供商
		const providersToRegister = new Map<string, { baseUrl?: string; apiKey?: string; models: any[] }>();

		for (const [modelId, modelConfig] of Object.entries(this.config.models)) {
			const providerName = modelConfig.provider;

			// 准备模型配置
			const modelDef = {
				id: modelConfig.model,
				name: modelConfig.name,
				api: "openai" as const, // 使用 OpenAI 兼容 API
				reasoning: false,
				input: ["text", "image"] as ("text" | "image")[],
				cost: {
					input: 0.001,
					output: 0.002,
					cacheRead: 0.0001,
					cacheWrite: 0.0001,
				},
				contextWindow: 128000,
				maxTokens: 4000,
			};

			if (!providersToRegister.has(providerName)) {
				providersToRegister.set(providerName, {
					baseUrl: modelConfig.baseUrl,
					apiKey: modelConfig.apiKey || modelConfig.apiKeyEnv,
					models: [modelDef],
				});
			} else {
				const provider = providersToRegister.get(providerName)!;
				provider.models.push(modelDef);
			}
		}

		// 注册所有提供商
		for (const [providerName, providerConfig] of providersToRegister) {
			try {
				this.modelRegistry.registerProvider(providerName, providerConfig);
				log.logInfo(`[ModelManager] Registered provider: ${providerName}`);
			} catch (error) {
				log.logWarning(`[ModelManager] Failed to register provider ${providerName}:`, error);
			}
		}
	}

	/**
	 * 获取所有模型配置
	 */
	getAllModels(): Record<string, ModelConfig> {
		return this.config.models;
	}

	/**
	 * 获取指定模型配置
	 */
	getModelConfig(modelId: string): ModelConfig | undefined {
		return this.config.models[modelId];
	}

	/**
	 * 获取当前模型配置
	 */
	getCurrentModelConfig(): ModelConfig {
		const config = this.config.models[this.currentModelId];
		if (!config) {
			log.logWarning(`[ModelManager] Current model ${this.currentModelId} not found, using default`);
			this.currentModelId = this.config.default;
			return this.config.models[this.config.default];
		}
		return config;
	}

	/**
	 * 切换全局模型
	 */
	switchModel(modelId: string): boolean {
		if (!this.config.models[modelId]) {
			log.logWarning(`[ModelManager] Model not found: ${modelId}`);
			return false;
		}

		const previousModel = this.currentModelId;
		this.currentModelId = modelId;

		log.logInfo(`[ModelManager] Switched from ${previousModel} to ${modelId}`);
		return true;
	}

	/**
	 * 切换频道模型
	 */
	switchChannelModel(channelId: string, modelId: string): boolean {
		if (!this.config.models[modelId]) {
			log.logWarning(`[ModelManager] Model not found: ${modelId}`);
			return false;
		}

		this.perChannelModels.set(channelId, modelId);
		log.logInfo(`[ModelManager] Channel ${channelId} switched to ${modelId}`);
		return true;
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
		const config = this.config.models[modelId];

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
					const modelName = this.config.models[modelId]?.name || modelId;
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
				if (this.config.models[modelId]) {
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
		return Object.values(this.config.models).map((model) => ({
			id: model.id,
			name: model.name,
			provider: model.provider,
			current: model.id === this.currentModelId,
		}));
	}
}
