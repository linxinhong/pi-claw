/**
 * Daemon Launcher - 跨平台守护进程接口
 */

// ============================================================================
// 类型
// ============================================================================

export interface DaemonConfig {
	name: string;
	displayName: string;
	description: string;
	execPath: string;
	args: string[];
	workingDir: string;
	env?: Record<string, string>;
	autoStart?: boolean;
	restart?: boolean;
}

export interface DaemonStatus {
	installed: boolean;
	running?: boolean;
	enabled?: boolean;
	pid?: number;
}

// ============================================================================
// Launcher 接口
// ============================================================================

/**
 * 守护进程启动器接口
 */
export interface DaemonLauncher {
	/**
	 * 平台名称
	 */
	readonly platform: string;

	/**
	 * 检查是否支持当前平台
	 */
	isSupported(): boolean;

	/**
	 * 安装守护进程
	 */
	install(config: DaemonConfig): Promise<{ success: boolean; error?: string }>;

	/**
	 * 卸载守护进程
	 */
	uninstall(name: string): Promise<{ success: boolean; error?: string }>;

	/**
	 * 启动守护进程
	 */
	start(name: string): Promise<{ success: boolean; error?: string }>;

	/**
	 * 停止守护进程
	 */
	stop(name: string): Promise<{ success: boolean; error?: string }>;

	/**
	 * 获取状态
	 */
	status(name: string): Promise<DaemonStatus>;

	/**
	 * 检查是否已安装
	 */
	isInstalled(name: string): boolean;
}
