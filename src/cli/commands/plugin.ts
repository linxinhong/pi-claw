/**
 * plugin 命令 - 插件管理
 */

import { Command } from "commander";
import { printTable, printInfo, COLORS } from "../utils/output.js";
import { loadConfig, WORKSPACE_DIR } from "../../utils/config.js";

// ============================================================================
// 已知插件列表
// ============================================================================

const KNOWN_PLUGINS = [
	{ id: "agent", name: "Agent", version: "1.0.0", platforms: "all" },
	{ id: "voice", name: "Voice", version: "1.0.0", platforms: "feishu" },
	{ id: "memory", name: "Memory", version: "1.0.0", platforms: "all" },
	{ id: "card", name: "Card", version: "1.0.0", platforms: "feishu" },
	{ id: "event", name: "Event", version: "1.0.0", platforms: "all" },
];

// ============================================================================
// 命令实现
// ============================================================================

export function registerPluginCommand(program: Command): void {
	const plugin = program.command("plugin").description("插件管理");

	// plugin ls
	plugin
		.command("ls")
		.description("查看已安装的插件情况")
		.action(() => {
			// 加载配置
			const config = loadConfig();
			const pluginsConfig = config.plugins || {};

			// 构建表格数据
			const headers = ["ID", "Name", "Version", "Status", "Platforms"];
			const rows: string[][] = [];

			for (const p of KNOWN_PLUGINS) {
				const pluginConfig = pluginsConfig[p.id];
				const enabled = pluginConfig?.enabled ?? false;
				const status = enabled ? `${COLORS.green}enabled${COLORS.reset}` : `${COLORS.dim}disabled${COLORS.reset}`;

				rows.push([p.id, p.name, `v${p.version}`, status, p.platforms]);
			}

			console.log(`\n${COLORS.bright}Registered Plugins${COLORS.reset}\n`);
			printTable(headers, rows);
			console.log();
		});
}
