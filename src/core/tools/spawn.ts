/**
 * Spawn Tool - 派发子 Agent
 *
 * 允许主 Agent 派发子任务给独立的子 Agent 执行
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Executor } from "../sandbox/index.js";
import type { ModelManager } from "../model/manager.js";

const SpawnToolSchema = Type.Object({
	task: Type.String({ description: "Task description for the sub-agent to execute" }),
	label: Type.String({ description: "Short label shown to user" }),
	isolation: Type.Optional(Type.Union([Type.Literal("session"), Type.Literal("inline")], { description: "Isolation mode: 'session' for isolated context, 'inline' for shared context (default: inline)" })),
	timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 60000)" })),
});

type SpawnToolParams = Static<typeof SpawnToolSchema>;

/**
 * Spawn 工具配置
 */
export interface SpawnToolConfig {
	executor: Executor;
	modelManager: ModelManager;
	workspaceDir: string;
}

/**
 * 执行子任务的简化实现
 *
 * 注意：这是一个简化版本，实际使用时需要完整的 Agent 运行时支持
 */
async function executeSubTask(
	task: string,
	config: SpawnToolConfig,
	timeout: number,
): Promise<{ success: boolean; result: string }> {
	// 使用 bash 执行简单任务（简化实现）
	// 在完整实现中，这里会创建一个新的 Agent 实例来处理任务
	try {
		// 创建任务文件
		const taskFile = `/tmp/subtask-${Date.now()}.txt`;
		await config.executor.exec(`cat > "${taskFile}" << 'EOF'\n${task}\nEOF`);

		// 简单的任务执行：使用 echo 模拟响应
		// 实际实现中，这里会调用 Agent API
		const result = await config.executor.exec(`echo "Sub-task received: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}"`, { timeout });

		// 清理
		await config.executor.exec(`rm -f "${taskFile}"`);

		return {
			success: result.code === 0,
			result: result.stdout || result.stderr,
		};
	} catch (error: any) {
		return {
			success: false,
			result: error.message,
		};
	}
}

export function createSpawnTool(config: SpawnToolConfig): AgentTool<typeof SpawnToolSchema> {
	return {
		name: "spawn",
		label: "Spawn",
		description: "Spawn a sub-agent to execute a task. Useful for parallel execution or isolated task processing.",
		parameters: SpawnToolSchema,
		execute: async (_toolCallId, params: SpawnToolParams, _signal, _onUpdate) => {
			const { task, isolation = "inline", timeout = 60000 } = params;

			if (!task || task.trim().length === 0) {
				return {
					content: [{ type: "text", text: "Task description is required" }],
					details: { error: "empty_task" },
				};
			}

			try {
				const startTime = Date.now();

				// 执行子任务
				const { success, result } = await executeSubTask(task, config, timeout);

				const duration = Date.now() - startTime;

				if (!success) {
					return {
						content: [{ type: "text", text: `Sub-agent failed: ${result}` }],
						details: { success: false, duration, isolation, error: result },
					};
				}

				return {
					content: [{ type: "text", text: `Sub-agent completed:\n\n${result}` }],
					details: { success: true, duration, isolation },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error spawning sub-agent: ${error.message}` }],
					details: { error: error.message },
				};
			}
		},
	};
}
