/**
 * Sub Agent Factory - 子 Agent 工厂
 *
 * 负责根据 agent_type 创建隔离的子 Agent 实例
 */

import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	AgentSession,
	convertToLlm,
	createExtensionRuntime,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import type { Executor } from "../../sandbox/index.js";
import type { ModelManager } from "../../model/manager.js";
import { AgentType, AGENT_TYPE_CONFIGS, type AgentTypeConfig } from "./types.js";
import * as log from "../../../utils/logger/index.js";

// ============================================================================
// Factory Config
// ============================================================================

/**
 * 子 Agent 工厂配置
 */
export interface SubAgentFactoryConfig {
	executor: Executor;
	modelManager: ModelManager;
	workspaceDir: string;
	channelDir: string;
	parentTools: AgentTool<any>[];
}

// ============================================================================
// Sub Agent Factory
// ============================================================================

/**
 * 子 Agent 工厂
 */
export class SubAgentFactory {
	private config: SubAgentFactoryConfig;

	constructor(config: SubAgentFactoryConfig) {
		this.config = config;
	}

	/**
	 * 创建子 Agent
	 */
	async createSubAgent(
		agentType: AgentType,
		taskDescription: string,
		additionalContext?: string,
	): Promise<{
		agent: Agent;
		session: AgentSession;
		tools: AgentTool<any>[];
	}> {
		const typeConfig = AGENT_TYPE_CONFIGS[agentType];

		// 1. 根据类型过滤工具
		const filteredTools = this.filterTools(typeConfig);

		if (filteredTools.length === 0) {
			throw new Error(`No tools available for agent type: ${agentType}`);
		}

		// 2. 获取模型
		const model = await this.config.modelManager.getModelInstance();

		// 3. 构建系统提示词
		const systemPrompt = this.buildSystemPrompt(typeConfig, taskDescription, additionalContext);

		// 4. 创建 ModelRegistry
		const modelRegistry = this.config.modelManager.getRegistry();

		// 5. 创建临时 SessionManager（内存模式，不持久化）
		const sessionManager = SessionManager.inMemory();

		// 6. 创建 SettingsManager
		const settingsManager = SettingsManager.inMemory({
			images: { autoResize: true },
			retry: { enabled: true, maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 5000 },
			theme: "dark",
			shellPath: process.env.SHELL || "/bin/bash",
		});

		// 7. 创建 Agent
		const agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: "off", // 子 Agent 默认关闭思考
				tools: filteredTools,
			},
			convertToLlm: convertToLlm,
			getApiKey: async () => this.getApiKeyForModel(model, modelRegistry),
		});

		// 8. 创建 ResourceLoader
		const resourceLoader = this.createResourceLoader(systemPrompt);

		// 9. 转换工具为 Record 格式
		const toolsRecord: Record<string, AgentTool> = {};
		for (const tool of filteredTools) {
			toolsRecord[tool.name] = tool;
		}

		// 10. 创建 AgentSession
		const session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: this.config.workspaceDir,
			modelRegistry,
			resourceLoader,
			baseToolsOverride: toolsRecord,
		});

		log.logInfo(`[Spawn] Created sub-agent: ${typeConfig.name} with ${filteredTools.length} tools`);

		return { agent, session, tools: filteredTools };
	}

	/**
	 * 根据类型配置过滤工具
	 */
	private filterTools(typeConfig: AgentTypeConfig): AgentTool<any>[] {
		const { parentTools } = this.config;

		// general 类型返回所有工具
		if (typeConfig.allowedTools.length === 0) {
			// 但仍然应用黑名单
			if (typeConfig.deniedTools && typeConfig.deniedTools.length > 0) {
				return parentTools.filter((tool) => !typeConfig.deniedTools!.includes(tool.name));
			}
			return [...parentTools];
		}

		// 白名单模式
		return parentTools.filter((tool) => {
			// 先检查黑名单
			if (typeConfig.deniedTools && typeConfig.deniedTools!.includes(tool.name)) {
				return false;
			}
			// 再检查白名单
			return typeConfig.allowedTools.includes(tool.name);
		});
	}

	/**
	 * 构建系统提示词
	 */
	private buildSystemPrompt(
		typeConfig: AgentTypeConfig,
		taskDescription: string,
		additionalContext?: string,
	): string {
		const parts: string[] = [];

		// 添加类型特定的前缀
		if (typeConfig.systemPromptPrefix) {
			parts.push(typeConfig.systemPromptPrefix);
		}

		// 添加任务描述
		parts.push(`\n## Your Task\n${taskDescription}`);

		// 添加上下文
		if (additionalContext) {
			parts.push(`\n## Additional Context\n${additionalContext}`);
		}

		// 添加工作目录信息
		parts.push(`\n## Working Directory\n${this.config.workspaceDir}`);

		// 添加工具限制说明
		if (typeConfig.allowedTools.length > 0) {
			parts.push(`\n## Available Tools\nYou only have access to these tools: ${typeConfig.allowedTools.join(", ")}`);
		}

		// 添加只读警告
		if (typeConfig.readOnly) {
			parts.push(`\n## Important\nThis is a READ-ONLY session. Do NOT attempt to modify any files.`);
		}

		// 添加输出格式要求
		parts.push(`\n## Output Format
Provide a clear, concise summary of your findings. Focus on the most relevant information.`);

		return parts.join("\n");
	}

	/**
	 * 获取 API Key
	 */
	private async getApiKeyForModel(model: Model<Api>, modelRegistry: ModelRegistry): Promise<string> {
		const key = await modelRegistry.getApiKey(model);
		if (key) return key;
		throw new Error(`No API key found for ${model.provider}`);
	}

	/**
	 * 创建 ResourceLoader
	 */
	private createResourceLoader(systemPrompt: string): ResourceLoader {
		let currentPrompt = systemPrompt;
		return {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => currentPrompt,
			getAppendSystemPrompt: () => [],
			extendResources: () => {},
			reload: async () => {},
		};
	}
}
