/**
 * MCP Client
 * 
 * MCP 客户端实现，用于连接和管理 MCP 服务器
 */

import type { 
  McpServerConfig, 
  McpServerState,
  McpTool,
  McpResource,
  McpPrompt,
  InitializeRequest,
  InitializeResult,
  ListToolsResult,
  ListResourcesResult,
  ListPromptsResult,
  CallToolRequest,
  McpToolResult,
  McpGetPromptResult,
  ClientCapabilities,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";
import { MCP_ERROR_CODES } from "./types.js";
import { createTransport, type McpTransport } from "./transport.js";
import * as log from "../../utils/logger/index.js";

// ============================================================================
// MCP Client
// ============================================================================

export class McpClient {
  private transport: McpTransport;
  private state: McpServerState;
  private requestId = 0;
  private initialized = false;
  private clientInfo: { name: string; version: string };

  constructor(
    private config: McpServerConfig,
    clientInfo?: { name: string; version: string }
  ) {
    this.clientInfo = clientInfo || {
      name: "pi-claw-mcp-client",
      version: "1.0.0",
    };

    this.transport = createTransport(config);
    this.state = {
      config,
      status: "disconnected",
      tools: [],
      resources: [],
      prompts: [],
    };

    // 监听消息
    this.transport.onMessage((message) => {
      this.handleMessage(message);
    });

    // 监听错误
    this.transport.onError((error) => {
      log.logError(`[MCP Client ${config.name}] Transport error:`, error);
      this.state.status = "error";
      this.state.error = error.message;
    });

    // 监听关闭
    this.transport.onClose(() => {
      log.logInfo(`[MCP Client ${config.name}] Connection closed`);
      this.state.status = "disconnected";
      this.initialized = false;
    });
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<void> {
    if (this.state.status === "connected") {
      log.logInfo(`[MCP Client ${this.config.name}] Already connected`);
      return;
    }

    this.state.status = "connecting";
    log.logInfo(`[MCP Client ${this.config.name}] Connecting...`);

    try {
      // 建立传输连接
      await this.transport.connect();

      // 初始化协议
      await this.initialize();

      // 获取服务器能力
      await this.fetchCapabilities();

      this.state.status = "connected";
      log.logInfo(`[MCP Client ${this.config.name}] Connected successfully`);
    } catch (error) {
      this.state.status = "error";
      this.state.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.initialized) {
      try {
        // 发送关闭通知
        this.transport.notify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
      } catch {
        // 忽略关闭时的错误
      }
    }

    await this.transport.disconnect();
    this.state.status = "disconnected";
    this.initialized = false;
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.transport.isConnected() && this.initialized;
  }

  /**
   * 获取当前状态
   */
  getState(): McpServerState {
    return { ...this.state };
  }

  // ============================================================================
  // Protocol Methods
  // ============================================================================

  /**
   * 初始化协议
   */
  private async initialize(): Promise<void> {
    const request: InitializeRequest = {
      protocolVersion: "2024-11-05",
      capabilities: {
        roots: {
          listChanged: true,
        },
        sampling: {},
      },
      clientInfo: this.clientInfo,
    };

    const response = await this.sendRequest<InitializeResult>(
      "initialize",
      request
    );

    this.state.serverInfo = response.serverInfo;
    this.state.capabilities = response.capabilities;
    this.initialized = true;

    // 发送初始化完成通知
    this.transport.notify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    log.logInfo(
      `[MCP Client ${this.config.name}] Initialized with server: ${response.serverInfo.name}@${response.serverInfo.version}`
    );
  }

  /**
   * 获取服务器能力（工具、资源、Prompts）
   */
  private async fetchCapabilities(): Promise<void> {
    const promises: Promise<unknown>[] = [];

    // 获取工具列表
    if (this.state.capabilities?.tools) {
      promises.push(this.fetchTools());
    }

    // 获取资源列表
    if (this.state.capabilities?.resources) {
      promises.push(this.fetchResources());
    }

    // 获取 Prompt 列表
    if (this.state.capabilities?.prompts) {
      promises.push(this.fetchPrompts());
    }

    await Promise.all(promises);
  }

  /**
   * 获取工具列表
   */
  async fetchTools(): Promise<McpTool[]> {
    try {
      const result = await this.sendRequest<ListToolsResult>("tools/list", {});
      this.state.tools = result.tools || [];
      
      log.logInfo(
        `[MCP Client ${this.config.name}] Discovered ${this.state.tools.length} tools`
      );
      
      return this.state.tools;
    } catch (error) {
      log.logError(
        `[MCP Client ${this.config.name}] Failed to fetch tools:`,
        error
      );
      return [];
    }
  }

  /**
   * 获取资源列表
   */
  async fetchResources(): Promise<McpResource[]> {
    try {
      const result = await this.sendRequest<ListResourcesResult>("resources/list", {});
      this.state.resources = result.resources || [];
      
      log.logInfo(
        `[MCP Client ${this.config.name}] Discovered ${this.state.resources.length} resources`
      );
      
      return this.state.resources;
    } catch (error) {
      log.logError(
        `[MCP Client ${this.config.name}] Failed to fetch resources:`,
        error
      );
      return [];
    }
  }

  /**
   * 获取 Prompt 列表
   */
  async fetchPrompts(): Promise<McpPrompt[]> {
    try {
      const result = await this.sendRequest<ListPromptsResult>("prompts/list", {});
      this.state.prompts = result.prompts || [];
      
      log.logInfo(
        `[MCP Client ${this.config.name}] Discovered ${this.state.prompts.length} prompts`
      );
      
      return this.state.prompts;
    } catch (error) {
      log.logError(
        `[MCP Client ${this.config.name}] Failed to fetch prompts:`,
        error
      );
      return [];
    }
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.isConnected()) {
      throw new Error("Client not connected");
    }

    const request: CallToolRequest = { name, arguments: args };
    
    log.logInfo(
      `[MCP Client ${this.config.name}] Calling tool: ${name}`,
      args
    );

    const result = await this.sendRequest<McpToolResult>("tools/call", request);
    
    if (result.isError) {
      const errorText = result.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("\n");
      throw new Error(`Tool execution failed: ${errorText}`);
    }

    return result;
  }

  /**
   * 获取 Prompt
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<McpGetPromptResult> {
    if (!this.isConnected()) {
      throw new Error("Client not connected");
    }

    return this.sendRequest<McpGetPromptResult>("prompts/get", {
      name,
      arguments: args,
    });
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<{ contents: unknown[] }> {
    if (!this.isConnected()) {
      throw new Error("Client not connected");
    }

    return this.sendRequest<{ contents: unknown[] }>("resources/read", {
      uri,
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 发送请求
   */
  private async sendRequest<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.requestId;
    
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const response = await this.transport.send(request);

    if (response.error) {
      throw new Error(
        `RPC Error ${response.error.code}: ${response.error.message}`
      );
    }

    return response.result as T;
  }

  /**
   * 处理消息
   */
  private handleMessage(message: unknown): void {
    // 处理服务器通知
    if (this.isNotification(message)) {
      this.handleNotification(message);
    }
  }

  /**
   * 检查是否为通知
   */
  private isNotification(message: unknown): message is { method: string; params?: unknown } {
    return (
      typeof message === "object" &&
      message !== null &&
      "method" in message &&
      !("id" in message)
    );
  }

  /**
   * 处理通知
   */
  private handleNotification(notification: { method: string; params?: unknown }): void {
    switch (notification.method) {
      case "notifications/tools/list_changed":
        log.logInfo(`[MCP Client ${this.config.name}] Tools list changed, refreshing...`);
        this.fetchTools().catch(() => {});
        break;
      
      case "notifications/resources/list_changed":
        log.logInfo(`[MCP Client ${this.config.name}] Resources list changed, refreshing...`);
        this.fetchResources().catch(() => {});
        break;
      
      case "notifications/prompts/list_changed":
        log.logInfo(`[MCP Client ${this.config.name}] Prompts list changed, refreshing...`);
        this.fetchPrompts().catch(() => {});
        break;
      
      case "notifications/message":
        log.logInfo(`[MCP Client ${this.config.name}] Server message:`, notification.params);
        break;
      
      default:
        log.logInfo(`[MCP Client ${this.config.name}] Unknown notification: ${notification.method}`);
    }
  }
}

// ============================================================================
// Client Factory
// ============================================================================

/**
 * 创建 MCP 客户端
 */
export function createMcpClient(
  config: McpServerConfig,
  clientInfo?: { name: string; version: string }
): McpClient {
  return new McpClient(config, clientInfo);
}
