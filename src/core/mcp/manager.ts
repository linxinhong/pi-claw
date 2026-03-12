/**
 * MCP Manager
 * 
 * 管理多个 MCP 客户端，提供统一的工具发现和调用接口
 */

import type { 
  McpClientConfig, 
  McpServerConfig, 
  McpTool,
  McpAgentTool,
  McpServerState 
} from "./types.js";
import { McpClient, createMcpClient } from "./client.js";
import * as log from "../../utils/logger/index.js";

// ============================================================================
// MCP Manager
// ============================================================================

export class McpManager {
  private clients = new Map<string, McpClient>();
  private config: McpClientConfig;
  private clientInfo: { name: string; version: string };
  private toolCache = new Map<string, McpTool>(); // toolUri -> McpTool
  private initialized = false;

  constructor(config: McpClientConfig) {
    this.config = config;
    this.clientInfo = config.clientInfo || {
      name: "pi-claw",
      version: "1.0.0",
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * 初始化所有 MCP 服务器连接
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.logInfo("[MCP Manager] Initializing...");

    const enabledServers = this.config.servers.filter(
      (s) => s.enabled !== false
    );

    log.logInfo(`[MCP Manager] Found ${enabledServers.length} enabled MCP servers`);

    // 并行连接所有服务器
    const connectPromises = enabledServers.map(async (serverConfig) => {
      try {
        await this.connectServer(serverConfig);
      } catch (error) {
        log.logError(
          `[MCP Manager] Failed to connect server ${serverConfig.name}:`,
          error
        );
      }
    });

    await Promise.all(connectPromises);

    this.initialized = true;
    
    const connectedCount = this.getConnectedServers().length;
    log.logInfo(
      `[MCP Manager] Initialization complete. ${connectedCount}/${enabledServers.length} servers connected.`
    );
  }

  /**
   * 关闭所有连接
   */
  async shutdown(): Promise<void> {
    log.logInfo("[MCP Manager] Shutting down...");

    const disconnectPromises = Array.from(this.clients.values()).map(
      async (client) => {
        try {
          await client.disconnect();
        } catch (error) {
          log.logError("[MCP Manager] Error disconnecting client:", error);
        }
      }
    );

    await Promise.all(disconnectPromises);
    this.clients.clear();
    this.toolCache.clear();
    this.initialized = false;

    log.logInfo("[MCP Manager] Shutdown complete");
  }

  /**
   * 重新初始化（刷新配置后）
   */
  async reinitialize(config?: McpClientConfig): Promise<void> {
    await this.shutdown();
    
    if (config) {
      this.config = config;
    }
    
    await this.initialize();
  }

  // ============================================================================
  // Server Management
  // ============================================================================

  /**
   * 连接单个服务器
   */
  async connectServer(config: McpServerConfig): Promise<McpClient> {
    // 如果已存在，先断开
    if (this.clients.has(config.name)) {
      const existing = this.clients.get(config.name)!;
      await existing.disconnect();
      this.clients.delete(config.name);
    }

    log.logInfo(`[MCP Manager] Connecting to server: ${config.name}`);

    const client = createMcpClient(config, this.clientInfo);
    await client.connect();

    this.clients.set(config.name, client);
    
    // 更新工具缓存
    this.updateToolCache(client, config.name);

    return client;
  }

  /**
   * 断开单个服务器
   */
  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`Server ${name} not found`);
    }

    await client.disconnect();
    this.clients.delete(name);
    
    // 清除相关工具缓存
    this.clearToolCacheForServer(name);
  }

  /**
   * 重新连接服务器
   */
  async reconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`Server ${name} not found`);
    }

    await client.reconnect();
    this.updateToolCache(client, name);
  }

  /**
   * 获取客户端
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  /**
   * 获取所有客户端
   */
  getAllClients(): Map<string, McpClient> {
    return new Map(this.clients);
  }

  /**
   * 获取已连接的服务器列表
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, client]) => client.isConnected())
      .map(([name]) => name);
  }

  /**
   * 获取所有服务器状态
   */
  getAllServerStates(): McpServerState[] {
    return Array.from(this.clients.values()).map((client) => client.getState());
  }

  // ============================================================================
  // Tool Management
  // ============================================================================

  /**
   * 获取所有可用工具
   */
  async getAllTools(): Promise<McpAgentTool[]> {
    const tools: McpAgentTool[] = [];

    for (const [serverName, client] of this.clients) {
      if (!client.isConnected()) continue;

      const state = client.getState();
      
      for (const tool of state.tools) {
        const agentTool = this.convertToAgentTool(tool, serverName);
        tools.push(agentTool);
      }
    }

    return tools;
  }

  /**
   * 获取特定服务器的工具
   */
  async getServerTools(serverName: string): Promise<McpAgentTool[]> {
    const client = this.clients.get(serverName);
    if (!client || !client.isConnected()) {
      return [];
    }

    const state = client.getState();
    return state.tools.map((tool) => this.convertToAgentTool(tool, serverName));
  }

  /**
   * 通过 URI 查找工具
   */
  findToolByUri(toolUri: string): McpTool | undefined {
    return this.toolCache.get(toolUri);
  }

  /**
   * 调用工具
   */
  async callTool(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<string> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    if (!client.isConnected()) {
      throw new Error(`MCP server '${serverName}' is not connected`);
    }

    const result = await client.callTool(toolName, args);

    // 转换结果为字符串
    return this.formatToolResult(result);
  }

  /**
   * 通过工具 URI 调用工具
   */
  async callToolByUri(
    toolUri: string,
    args?: Record<string, unknown>
  ): Promise<string> {
    // 解析 toolUri: mcp://serverName/toolName
    const match = toolUri.match(/^mcp:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid tool URI: ${toolUri}`);
    }

    const [, serverName, toolName] = match;
    return this.callTool(serverName, toolName, args);
  }

  // ============================================================================
  // Resource & Prompt Access
  // ============================================================================

  /**
   * 获取所有资源
   */
  getAllResources(): { server: string; resources: McpServerState["resources"] }[] {
    const result: { server: string; resources: McpServerState["resources"] }[] = [];

    for (const [serverName, client] of this.clients) {
      if (!client.isConnected()) continue;
      const state = client.getState();
      result.push({ server: serverName, resources: state.resources });
    }

    return result;
  }

  /**
   * 读取资源
   */
  async readResource(serverName: string, uri: string): Promise<unknown> {
    const client = this.clients.get(serverName);
    if (!client || !client.isConnected()) {
      throw new Error(`Server ${serverName} not connected`);
    }

    const result = await client.readResource(uri);
    return result;
  }

  /**
   * 获取所有 Prompts
   */
  getAllPrompts(): { server: string; prompts: McpServerState["prompts"] }[] {
    const result: { server: string; prompts: McpServerState["prompts"] }[] = [];

    for (const [serverName, client] of this.clients) {
      if (!client.isConnected()) continue;
      const state = client.getState();
      result.push({ server: serverName, prompts: state.prompts });
    }

    return result;
  }

  /**
   * 获取 Prompt
   */
  async getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<string> {
    const client = this.clients.get(serverName);
    if (!client || !client.isConnected()) {
      throw new Error(`Server ${serverName} not connected`);
    }

    const result = await client.getPrompt(promptName, args);
    
    // 将 prompt 消息格式化为字符串
    return result.messages
      .map((m) => `${m.role}: ${this.formatContent(m.content)}`)
      .join("\n");
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 更新工具缓存
   */
  private updateToolCache(client: McpClient, serverName: string): void {
    const state = client.getState();
    
    for (const tool of state.tools) {
      const toolUri = `mcp://${serverName}/${tool.name}`;
      this.toolCache.set(toolUri, tool);
    }
  }

  /**
   * 清除特定服务器的工具缓存
   */
  private clearToolCacheForServer(serverName: string): void {
    const prefix = `mcp://${serverName}/`;
    for (const [uri] of this.toolCache) {
      if (uri.startsWith(prefix)) {
        this.toolCache.delete(uri);
      }
    }
  }

  /**
   * 将 MCP 工具转换为 AgentTool
   */
  private convertToAgentTool(tool: McpTool, serverName: string): McpAgentTool {
    const toolUri = `mcp://${serverName}/${tool.name}`;

    return {
      name: `mcp_${serverName}_${tool.name}`,
      label: tool.name,
      description: this.buildToolDescription(tool, serverName),
      parameters: tool.inputSchema as Record<string, unknown>,
      execute: async (toolCallId: string, params: Record<string, unknown>) => {
        const result = await this.callTool(serverName, tool.name, params);
        return {
          content: [{ type: "text", text: result }],
          details: result,
        };
      },
      mcpMeta: {
        serverName,
        originalName: tool.name,
        toolUri,
      },
    };
  }

  /**
   * 构建工具描述
   */
  private buildToolDescription(tool: McpTool, serverName: string): string {
    const parts: string[] = [];
    
    if (tool.description) {
      parts.push(tool.description);
    }
    
    parts.push(`\n[MCP Server: ${serverName}]`);
    
    return parts.join("\n");
  }

  /**
   * 格式化工具调用结果
   */
  private formatToolResult(result: { content: unknown[] }): string {
    if (!result.content || result.content.length === 0) {
      return "(No output)";
    }

    const parts: string[] = [];

    for (const item of result.content) {
      if (typeof item === "object" && item !== null) {
        const content = item as { type: string; text?: string; data?: string };
        
        switch (content.type) {
          case "text":
            if (content.text) parts.push(content.text);
            break;
          case "image":
            parts.push("[Image content]");
            break;
          case "resource":
            parts.push("[Resource content]");
            break;
          default:
            parts.push(JSON.stringify(content));
        }
      }
    }

    return parts.join("\n");
  }

  /**
   * 格式化内容
   */
  private formatContent(content: unknown): string {
    if (typeof content === "object" && content !== null) {
      const c = content as { type: string; text?: string };
      if (c.type === "text" && c.text) {
        return c.text;
      }
    }
    return JSON.stringify(content);
  }
}

// ============================================================================
// Manager Factory
// ============================================================================

/**
 * 创建 MCP 管理器
 */
export function createMcpManager(config: McpClientConfig): McpManager {
  return new McpManager(config);
}
