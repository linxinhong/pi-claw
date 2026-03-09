/**
 * Feishu Adapter 工厂
 */

import { adapterRegistry } from "../../core/adapter/registry.js";
import type { AdapterFactory, Bot, BotConfig } from "../../core/adapter/types.js";
import { UnifiedBot } from "../../core/unified-bot.js";
import { FeishuAdapter } from "./adapter.js";
import { FeishuStore } from "./store.js"
import type { FeishuAdapterConfig } from "./types.js";

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Feishu Bot
 */
export async function createFeishuBot(config: BotConfig): Promise<Bot> {
	const feishuConfig = config.config as FeishuAdapterConfig;
	const adapter = new FeishuAdapter();
	const workingDir = config.workspaceDir || ""
	await adapter.initialize({
		platform: "feishu",
		enabled: true,
		...feishuConfig,
		workingDir,
	})

	const bot = new UnifiedBot({
		adapter,
		store: new FeishuStore(workingDir),
		workingDir,
		pluginManager: config.pluginManager,
	})

    return bot
}

// ============================================================================
// 自注册
// ============================================================================

/**
 * 自注册到 adapter registry
 */
const factory: AdapterFactory = {
	meta: {
        id: "feishu",
        name: "Feishu Adapter",
        version: "1.0.0",
        description: "Feishu/Lark platform adapter for pi-claw",
    },

    async createBot(config: BotConfig): Promise<Bot> {
        return createFeishuBot(config)
    },
}

// 注册
adapterRegistry.register(factory)
