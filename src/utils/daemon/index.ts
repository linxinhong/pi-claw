/**
 * Daemon 管理入口
 */

import { platform } from "os";
import type { DaemonConfig, DaemonLauncher, DaemonStatus } from "./launcher.js";
import { LaunchdLauncher, launchdLauncher } from "./launchd.js";
import { SystemdLauncher, systemdLauncher } from "./systemd.js";

export type { DaemonLauncher, DaemonConfig, DaemonStatus } from "./launcher.js";
export { LaunchdLauncher, launchdLauncher } from "./launchd.js";
export { SystemdLauncher, systemdLauncher } from "./systemd.js";

/**
 * 获取当前平台的守护进程启动器
 */
export function getLauncher(): DaemonLauncher | null {
	const currentPlatform = platform();

	if (currentPlatform === "darwin") {
		return launchdLauncher;
	}

	if (currentPlatform === "linux") {
		return systemdLauncher;
	}

	return null;
}

/**
 * 检查是否支持守护进程
 */
export function isDaemonSupported(): boolean {
	const launcher = getLauncher();
	return launcher !== null && launcher.isSupported();
}
