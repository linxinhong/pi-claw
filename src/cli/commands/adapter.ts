/**
 * adapter 命令 - 适配器管理
 */

import { Command } from "commander";
import { printTable, printInfo, COLORS } from "../utils/output.js";

// ============================================================================
// 已知适配器列表
// ============================================================================

const KNOWN_ADAPTERS = [
	{ id: "feishu", name: "Feishu", version: "1.0.0", type: "messaging" },
];

// ============================================================================
// 命令实现
// ============================================================================

export function registerAdapterCommand(program: Command): void {
	const adapter = program.command("adapter").description("适配器管理");

	// adapter ls
	adapter
		.command("ls")
		.description("查看各个 adapter 状态")
		.action(async () => {
			// 尝试动态加载适配器信息
			let adapters = [...KNOWN_ADAPTERS];

			try {
				const { feishuAdapterFactory } = await import("../../adapters/feishu/index.js");
				if (feishuAdapterFactory?.meta) {
					const meta = feishuAdapterFactory.meta;
					adapters = adapters.map((a) =>
						a.id === "feishu" ? { ...a, name: meta.name, version: meta.version } : a
					);
				}
			} catch {
				// 忽略错误，使用默认值
			}

			// 构建表格数据
			const headers = ["ID", "Name", "Version", "Type", "Status"];
			const rows: string[][] = [];

			for (const meta of adapters) {
				const status = `${COLORS.green}available${COLORS.reset}`;
				rows.push([meta.id, meta.name, `v${meta.version}`, meta.type, status]);
			}

			console.log(`\n${COLORS.bright}Available Adapters${COLORS.reset}\n`);
			printTable(headers, rows);
			console.log();
		});
}
