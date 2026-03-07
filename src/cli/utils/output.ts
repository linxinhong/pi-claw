/**
 * CLI 输出格式化工具
 */

// ============================================================================
// 颜色常量
// ============================================================================

export const COLORS = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	underline: "\x1b[4m",

	black: "\x1b[30m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",

	bgBlack: "\x1b[40m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgBlue: "\x1b[44m",
	bgMagenta: "\x1b[45m",
	bgCyan: "\x1b[46m",
	bgWhite: "\x1b[47m",
};

// ============================================================================
// 输出函数
// ============================================================================

/**
 * 打印标题
 */
export function printTitle(title: string): void {
	console.log(`\n${COLORS.bright}${COLORS.cyan}${title}${COLORS.reset}\n`);
}

/**
 * 打印副标题
 */
export function printSubtitle(subtitle: string): void {
	console.log(`${COLORS.bright}${COLORS.white}${subtitle}${COLORS.reset}`);
}

/**
 * 打印成功消息
 */
export function printSuccess(message: string): void {
	console.log(`${COLORS.green}✓${COLORS.reset} ${message}`);
}

/**
 * 打印错误消息
 */
export function printError(message: string): void {
	console.error(`${COLORS.red}✗${COLORS.reset} ${message}`);
}

/**
 * 打印警告消息
 */
export function printWarning(message: string): void {
	console.log(`${COLORS.yellow}!${COLORS.reset} ${message}`);
}

/**
 * 打印信息消息
 */
export function printInfo(message: string): void {
	console.log(`${COLORS.blue}ℹ${COLORS.reset} ${message}`);
}

/**
 * 打印键值对
 */
export function printKeyValue(key: string, value: string | number | boolean | undefined): void {
	const formattedValue = value === undefined ? `${COLORS.dim}undefined${COLORS.reset}` : String(value);
	console.log(`  ${COLORS.dim}${key}:${COLORS.reset} ${formattedValue}`);
}

/**
 * 打印表格
 */
export function printTable(headers: string[], rows: (string | number | boolean)[][]): void {
	// 计算列宽
	const widths = headers.map((h, i) => {
		const maxWidth = Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length));
		return maxWidth;
	});

	// 打印表头
	const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join("  ");
	console.log(`${COLORS.bright}${headerLine}${COLORS.reset}`);

	// 打印分隔线
	const separatorLine = widths.map((w) => "─".repeat(w)).join("  ");
	console.log(`${COLORS.dim}${separatorLine}${COLORS.reset}`);

	// 打印行
	for (const row of rows) {
		const line = row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join("  ");
		console.log(line);
	}
}

/**
 * 打印 JSON
 */
export function printJSON(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

/**
 * 打印分隔线
 */
export function printSeparator(char: string = "─", length: number = 50): void {
	console.log(`${COLORS.dim}${char.repeat(length)}${COLORS.reset}`);
}

/**
 * 打印空行
 */
export function printEmpty(): void {
	console.log();
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	while (bytes >= 1024 && i < units.length - 1) {
		bytes /= 1024;
		i++;
	}
	return `${bytes.toFixed(1)} ${units[i]}`;
}

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
	return `${(ms / 3600000).toFixed(1)}h`;
}
