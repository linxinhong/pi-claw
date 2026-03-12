/**
 * MCP Transport Layer
 * 
 * 实现 MCP 传输层，支持 stdio 和 HTTP+SSE 两种传输方式
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type { 
  JsonRpcRequest, 
  JsonRpcResponse, 
  JsonRpcNotification,
  McpServerConfig 
} from "./types.js";

// ============================================================================
// Base Transport Interface
// ============================================================================

/** 传输层接口 */
export interface McpTransport {
  /** 连接服务器 */
  connect(): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;
  /** 发送请求 */
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  /** 发送通知 */
  notify(notification: JsonRpcNotification): void;
  /** 是否已连接 */
  isConnected(): boolean;
  /** 事件发射器 */
  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: () => void): void;
}

// ============================================================================
// STDIO Transport
// ============================================================================

/**
 * STDIO 传输实现
 * 
 * 通过子进程的标准输入输出进行通信
 */
export class StdioTransport implements McpTransport {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (reason: Error) => void;
  }>();
  private messageHandlers: Array<(message: JsonRpcResponse | JsonRpcNotification) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private buffer = "";
  private connected = false;

  constructor(private config: McpServerConfig) {
    if (!config.command) {
      throw new Error("STDIO transport requires 'command' in config");
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      const { command, args = [], env = {} } = this.config;

      // 合并环境变量
      const processEnv = {
        ...process.env,
        ...env,
      };

      this.process = spawn(command!, args, {
        env: processEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // 处理 stdout
      this.process.stdout?.on("data", (data: Buffer) => {
        this.handleData(data.toString());
      });

      // 处理 stderr（日志输出）
      this.process.stderr?.on("data", (data: Buffer) => {
        const logLine = data.toString().trim();
        if (logLine) {
          console.log(`[MCP Server ${this.config.name}] ${logLine}`);
        }
      });

      // 处理进程错误
      this.process.on("error", (error) => {
        this.emitError(error);
        reject(error);
      });

      // 处理进程退出
      this.process.on("exit", (code) => {
        this.connected = false;
        this.emitClose();
        
        // 拒绝所有待处理的请求
        for (const [id, { reject }] of this.pendingRequests) {
          reject(new Error(`Process exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      // 等待进程启动
      setTimeout(() => {
        if (this.process?.pid) {
          this.connected = true;
          resolve();
        }
      }, 500);
    });
  }

  async disconnect(): Promise<void> {
    if (!this.process) return;

    // 拒绝所有待处理的请求
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error("Transport disconnected"));
    }
    this.pendingRequests.clear();

    this.process.kill();
    this.process = null;
    this.connected = false;
  }

  send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Transport not connected"));
        return;
      }

      // 保存请求回调
      this.pendingRequests.set(request.id, { resolve, reject });

      // 发送请求（每行一个 JSON 对象）
      const message = JSON.stringify(request) + "\n";
      this.process.stdin.write(message, (error) => {
        if (error) {
          this.pendingRequests.delete(request.id);
          reject(error);
        }
      });

      // 设置超时
      const timeout = this.config.timeout || 60000;
      setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error(`Request timeout after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  notify(notification: JsonRpcNotification): void {
    if (!this.process?.stdin?.writable) {
      console.error("Cannot send notification: transport not connected");
      return;
    }

    const message = JSON.stringify(notification) + "\n";
    this.process.stdin.write(message);
  }

  isConnected(): boolean {
    return this.connected && this.process !== null && !this.process.killed;
  }

  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  private handleData(data: string): void {
    this.buffer += data;

    // 按行分割处理
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // 保留未完成的行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification;
        this.handleMessage(message);
      } catch (error) {
        console.error("[MCP] Failed to parse message:", trimmed);
      }
    }
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    // 检查是否是响应（有 id 且没有 method）
    if ("id" in message && !("method" in message)) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        pending.resolve(message as JsonRpcResponse);
      }
    }

    // 通知所有处理器
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        console.error("[MCP] Message handler error:", error);
      }
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {}
    }
  }

  private emitClose(): void {
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {}
    }
  }
}

// ============================================================================
// HTTP+SSE Transport
// ============================================================================

/**
 * HTTP+SSE 传输实现
 * 
 * 通过 HTTP POST 和 Server-Sent Events 进行通信
 */
export class HttpSseTransport implements McpTransport {
  private url: string;
  private headers: Record<string, string>;
  private eventSource: EventSource | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (reason: Error) => void;
  }>();
  private messageHandlers: Array<(message: JsonRpcResponse | JsonRpcNotification) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private connected = false;

  constructor(private config: McpServerConfig) {
    if (!config.url) {
      throw new Error("HTTP transport requires 'url' in config");
    }
    this.url = config.url;
    this.headers = config.headers || {};
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      // 建立 SSE 连接
      const sseUrl = new URL("/sse", this.url).toString();
      
      // 注意：Node.js 环境需要引入 eventsource 包
      // 这里假设在浏览器环境或已 polyfill
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        this.connected = true;
        resolve();
      };

      this.eventSource.onerror = (error) => {
        this.emitError(new Error("SSE connection failed"));
        reject(error);
      };

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as JsonRpcResponse | JsonRpcNotification;
          this.handleMessage(message);
        } catch (error) {
          console.error("[MCP] Failed to parse SSE message:", event.data);
        }
      };

      // EventSource 没有 onclose 事件，使用 onerror 检测连接关闭
      this.eventSource.addEventListener("close", () => {
        this.connected = false;
        this.emitClose();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;

    // 拒绝所有待处理的请求
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error("Transport disconnected"));
    }
    this.pendingRequests.clear();
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("Transport not connected"));
        return;
      }

      // 保存请求回调
      this.pendingRequests.set(request.id, { resolve, reject });

      // 发送 HTTP POST 请求
      const postUrl = new URL("/message", this.url).toString();
      
      fetch(postUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(request),
      }).catch((error) => {
        this.pendingRequests.delete(request.id);
        reject(error);
      });

      // 设置超时
      const timeout = this.config.timeout || 60000;
      setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error(`Request timeout after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  notify(notification: JsonRpcNotification): void {
    if (!this.connected) {
      console.error("Cannot send notification: transport not connected");
      return;
    }

    const postUrl = new URL("/message", this.url).toString();
    
    fetch(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(notification),
    }).catch((error) => {
      console.error("[MCP] Failed to send notification:", error);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    // 检查是否是响应
    if ("id" in message && !("method" in message)) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        pending.resolve(message as JsonRpcResponse);
      }
    }

    // 通知所有处理器
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        console.error("[MCP] Message handler error:", error);
      }
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {}
    }
  }

  private emitClose(): void {
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {}
    }
  }
}

// ============================================================================
// Transport Factory
// ============================================================================

/**
 * 创建传输层实例
 */
export function createTransport(config: McpServerConfig): McpTransport {
  switch (config.transport) {
    case "stdio":
      return new StdioTransport(config);
    case "http":
    case "sse":
      return new HttpSseTransport(config);
    default:
      throw new Error(`Unsupported transport type: ${config.transport}`);
  }
}
