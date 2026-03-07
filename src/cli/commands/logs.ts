/**
 * logs 命令 - 查看日志
 *
 * 支持查看主日志和分类日志：
 * - pi-claw logs           # 查看主日志（所有模块）
 * - pi-claw logs feishu    # 只看 feishu 日志
 * - pi-claw logs -f agent  # 实时跟踪 agent 日志
 * - pi-claw logs -e        # 查看错误日志
 */

import { Command } from "commander";
import { createReadStream, existsSync, statSync, readdirSync } from "fs";
import { join, basename } from "path";
import { createInterface } from "readline";
import { homedir } from "os";
import { printError, printInfo } from "../utils/output.js";
import { DEFAULT_LOG_DIR, MAIN_LOG_FILE, ERROR_LOG_FILE } from "../../utils/logger/index.js";

// 日志文件路径
const LOGS_DIR = DEFAULT_LOG_DIR;
const MAIN_LOG = join(LOGS_DIR, MAIN_LOG_FILE);
const ERROR_LOG = join(LOGS_DIR, ERROR_LOG_FILE);

// ============================================================================
// 颜色支持
// ============================================================================

const COLORS = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
};

// 检测是否支持颜色
const supportsColor = process.stdout.isTTY && process.env.NO_COLOR !== "1" && process.env.TERM !== "dumb";

/**
 * 为日志行添加颜色
 * 日志格式: [timestamp] [category] [LEVEL] message
 */
function colorizeLogLine(line: string): string {
	if (!supportsColor) return line;

	// 匹配日志级别: [INFO], [WARN], [ERROR], [DEBUG]
	const levelMatch = line.match(/\[(INFO|WARN|ERROR|DEBUG)\]/i);
	if (!levelMatch) return line;

	const level = levelMatch[1].toUpperCase();
	let coloredLevel: string;

	switch (level) {
		case "ERROR":
			coloredLevel = `${COLORS.red}[ERROR]${COLORS.reset}`;
			break;
		case "WARN":
			coloredLevel = `${COLORS.yellow}[WARN]${COLORS.reset}`;
			break;
		case "INFO":
			coloredLevel = `${COLORS.green}[INFO]${COLORS.reset}`;
			break;
		case "DEBUG":
			coloredLevel = `${COLORS.dim}[DEBUG]${COLORS.reset}`;
			break;
		default:
			return line;
	}

	// 替换日志级别部分
	return line.replace(/\[(INFO|WARN|ERROR|DEBUG)\]/i, coloredLevel);
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取分类日志文件路径
 * 分类规则：
 * - 主 adapter: `{platform}.log` (如 `feishu.log`)
 * - 插件: `plugin-{pluginId}.log`
 * - 核心模块: `{module}.log` (如 `agent.log`)
 */
function getCategoryLogFile(category: string): string {
	// 处理 plugin:xxx 格式
	if (category.startsWith("plugin:")) {
		const pluginId = category.substring(7);
		return join(LOGS_DIR, `plugin-${pluginId}.log`);
	}

	// 默认：直接使用分类名
	return join(LOGS_DIR, `${category}.log`);
}

/**
 * 获取所有可用的日志分类
 */
function getAvailableCategories(): string[] {
	if (!existsSync(LOGS_DIR)) {
		return [];
	}

	const files = readdirSync(LOGS_DIR);
	const categories: string[] = [];

	for (const file of files) {
		// 跳过主日志和错误日志
		if (file === MAIN_LOG_FILE || file === ERROR_LOG_FILE) {
			continue;
		}

		// 只处理 .log 文件
		if (!file.endsWith(".log")) {
			continue;
		}

		// 提取分类名
		let category = file.replace(".log", "");

		// 处理 plugin-xxx 格式
		if (category.startsWith("plugin-")) {
			category = `plugin:${category.substring(7)}`;
		}

		categories.push(category);
	}

	return categories;
}

/**
 * 读取文件最后 N 行
 */
async function readLastLines(filePath: string, lines: number): Promise<string[]> {
	if (!existsSync(filePath)) {
		return [];
	}

	return new Promise((resolve, reject) => {
		const result: string[] = [];
		const stream = createReadStream(filePath, { encoding: "utf-8" });
		const rl = createInterface({
			input: stream,
			crlfDelay: Infinity,
		});

		rl.on("line", (line) => {
			result.push(line);
			if (result.length > lines) {
				result.shift();
			}
		});

		rl.on("close", () => {
			resolve(result);
		});

		rl.on("error", (err) => {
			reject(err);
		});
	});
}

/**
 * 输出带颜色的日志行
 */
function printLogLine(line: string): void {
	console.log(colorizeLogLine(line));
}

/**
 * 实时跟踪日志
 */
async function tailFile(filePath: string): Promise<void> {
	if (!existsSync(filePath)) {
		printError(`Log file not found: ${filePath}`);
		process.exit(1);
	}

	// 先显示最后几行
	const lastLines = await readLastLines(filePath, 20);
	for (const line of lastLines) {
		printLogLine(line);
	}

	// 使用 tail -f 并为每行添加颜色
	const { spawn } = await import("child_process");
	const child = spawn("tail", ["-f", filePath]);

	child.stdout.on("data", (data) => {
		const lines = data.toString().split("\n").filter((l: string) => l);
		for (const line of lines) {
			printLogLine(line);
		}
	});

	child.stderr.on("data", (data) => {
		console.error(data.toString());
	});

	child.on("error", (err) => {
		printError(`Failed to tail file: ${err.message}`);
		process.exit(1);
	});

	// 处理 Ctrl+C
	process.on("SIGINT", () => {
		child.kill();
		process.exit(0);
	});
}

// ============================================================================
// 命令实现
// ============================================================================

export function registerLogsCommand(program: Command): void {
	program
		.command("logs [category]")
		.description("查看日志")
		.option("-f, --follow", "实时跟踪日志")
		.option("-n, --lines <number>", "显示最后 N 行", "50")
		.option("-e, --error", "显示错误日志")
		.option("-l, --list", "列出所有可用的日志分类")
		.action(async (category: string | undefined, options) => {
			const lines = parseInt(options.lines, 10);
			const follow = options.follow || false;
			const errorLog = options.error || false;
			const listCategories = options.list || false;

			// 列出所有分类
			if (listCategories) {
				const categories = getAvailableCategories();
				if (categories.length === 0) {
					printInfo("No log files found.");
					printInfo(`Logs directory: ${LOGS_DIR}`);
					return;
				}

				printInfo("Available log categories:");
				console.log(`  main      - Main log (all modules)`);
				console.log(`  error     - Error log`);
				for (const cat of categories) {
					console.log(`  ${cat.padEnd(10)} - ${cat.startsWith("plugin:") ? "Plugin" : "Module"} log`);
				}
				console.log();
				return;
			}

			// 确定日志文件
			let logFile: string;
			let logName: string;

			if (errorLog) {
				logFile = ERROR_LOG;
				logName = "error log";
			} else if (category) {
				// 分类日志
				if (category === "main") {
					logFile = MAIN_LOG;
					logName = "main log";
				} else if (category === "error") {
					logFile = ERROR_LOG;
					logName = "error log";
				} else {
					logFile = getCategoryLogFile(category);
					logName = `${category} log`;

					if (!existsSync(logFile)) {
						printError(`Log file not found for category: ${category}`);
						printInfo(`Log file path: ${logFile}`);
						printInfo("Use --list to see available categories.");
						return;
					}
				}
			} else {
				// 默认：主日志
				logFile = MAIN_LOG;
				logName = "main log";
			}

			if (!existsSync(logFile)) {
				printInfo(`Log file not found: ${logFile}`);
				printInfo("Service may not be running or no logs have been generated yet.");
				return;
			}

			if (follow) {
				// 实时跟踪
				printInfo(`Following ${logName} (Ctrl+C to stop)...\n`);
				await tailFile(logFile);
			} else {
				// 显示最后 N 行
				const lastLines = await readLastLines(logFile, lines);

				if (lastLines.length === 0) {
					printInfo(`${logName} is empty.`);
					return;
				}

				console.log(`\nLast ${lastLines.length} lines from ${logName}:\n`);
				for (const line of lastLines) {
					printLogLine(line);
				}
				console.log();
			}
		});
}
