/**
 * Sandbox 类型定义
 */

export type SandboxConfig = { type: "host" } | { type: "docker"; container: string };

export interface Executor {
	/**
	 * 执行 bash 命令
	 */
	exec(command: string, options?: ExecOptions): Promise<ExecResult>;

	/**
	 * 获取工作区路径前缀
	 * Host: 返回实际路径
	 * Docker: 返回 /workspace
	 */
	getWorkspacePath(hostPath: string): string;
}

export interface ExecOptions {
	/** Timeout in milliseconds (default: no timeout) */
	timeout?: number;
	signal?: AbortSignal;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}
