/**
 * Model Switcher
 *
 * 模型切换逻辑 - 处理模型切换命令和持久化
 */

import type { ModelManager } from "../model/manager.js";
import * as log from "../../utils/logger/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * 模型切换命令结果
 */
export interface ModelSwitchResult {
	/** 是否成功 */
	success: boolean;
	/** 切换后的模型名称 */
	modelName?: string;
	/** 错误消息 */
	error?: string;
	/** 响应消息（用于发送给用户） */
	response: string;
}

// ============================================================================
// Model Switcher
// ============================================================================

/**
 * 处理模型切换命令
 * @param text 用户输入的文本
 * @param modelManager 模型管理器
 * @param channelId 频道 ID
 * @param channelDir 频道目录
 * @returns 切换结果
 */
export function handleModelSwitchCommand(
	text: string,
	modelManager: ModelManager,
	channelId: string,
	channelDir: string,
): ModelSwitchResult {
	const trimmedText = text.trim();

	// 匹配命令格式
	const patterns = [
		{ regex: /^切换模型\s+(\w+)$/, isChannel: true },
		{ regex: /^switch\s+model\s+(\w+)$/i, isChannel: true },
		{ regex: /^\/model\s+(\w+)$/, isChannel: true },
		{ regex: /^列出模型|^list\s+models$/i, isChannel: false },
	];

	for (const pattern of patterns) {
		const match = trimmedText.match(pattern.regex);
		if (match) {
			if (pattern.regex.toString().includes("list")) {
				// 列出模型命令
				return listModels(modelManager);
			}

			// 切换模型命令
			const modelId = match[1].toLowerCase();
			return switchToModel(modelId, modelManager, channelId, channelDir, pattern.isChannel);
		}
	}

	return { success: false, response: "" };
}

/**
 * 切换到指定模型
 */
function switchToModel(
	modelId: string,
	modelManager: ModelManager,
	channelId: string,
	channelDir: string,
	isChannelSwitch: boolean,
): ModelSwitchResult {
	const models = modelManager.getAllModels();
	const model = models[modelId];

	if (!model) {
		const availableModels = Object.keys(models).join(", ");
		return {
			success: false,
			error: `Model not found: ${modelId}`,
			response: `模型 "${modelId}" 不存在。\n\n可用模型: ${availableModels}`,
		};
	}

	const success = isChannelSwitch
		? modelManager.switchChannelModel(channelId, modelId)
		: modelManager.switchModel(modelId);

	if (!success) {
		return {
			success: false,
			error: "Failed to switch model",
			response: `切换模型失败: ${modelId}`,
		};
	}

	// 保存到频道配置
	if (isChannelSwitch) {
		const { join } = require("path");
		const configPath = join(channelDir, "model-config.json");
		modelManager.saveChannelModel(channelId, modelId, configPath);
	}

	const scope = isChannelSwitch ? "当前频道" : "全局";
	return {
		success: true,
		modelName: model.name,
		response: `✅ ${scope}模型已切换到 **${model.name}** (${model.provider}/${model.model})`,
	};
}

/**
 * 列出所有可用模型
 */
function listModels(modelManager: ModelManager): ModelSwitchResult {
	const models = modelManager.listModels();

	if (models.length === 0) {
		return {
			success: true,
			response: "_暂无可用模型_",
		};
	}

	const lines = ["**可用模型：**\n"];
	for (const model of models) {
		const current = model.current ? " ✅ (当前)" : "";
		lines.push(`- **${model.id}**: ${model.name} (${model.provider})${current}`);
	}

	return {
		success: true,
		response: lines.join("\n"),
	};
}
