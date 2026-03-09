# pi-claw 插件开发指南

本文档介绍如何为 pi-claw 平台开发新的平台适配器插件，支持飞书、QQ、钉钉等平台的接入。

## 目录

1. [概述](#1-概述)
2. [核心接口详解](#2-核心接口详解)
3. [快速开始](#3-快速开始)
4. [实现指南](#4-实现指南)
5. [平台工具扩展](#5-平台工具扩展)
6. [配置与注册](#6-配置与注册)
7. [最佳实践](#7-最佳实践)
8. [完整示例](#8-完整示例)

---

## 1. 概述

### 架构设计理念

pi-claw 采用**分层架构**设计，将平台无关的核心逻辑与平台特定的实现分离：

```
┌─────────────────────────────────────────────────────────┐
│                    UnifiedBot                           │
│              (统一机器人入口，平台无关)                    │
├─────────────────────────────────────────────────────────┤
│                     CoreAgent                           │
│              (核心 AI 代理，处理消息)                      │
├─────────────────────────────────────────────────────────┤
│                  PlatformAdapter                        │
│           (平台适配器接口，消息转换)                        │
├──────────────┬──────────────┬───────────────────────────┤
│ FeishuAdapter│  TUIAdapter  │  YourAdapter (待开发)      │
│   (飞书)     │   (终端)     │   (QQ/钉钉/...)           │
└──────────────┴──────────────┴───────────────────────────┘
```

### 核心概念

| 概念 | 说明 |
|------|------|
| **PlatformAdapter** | 平台适配器接口，处理平台特定的消息转换和通信 |
| **PlatformContext** | 平台上下文接口，为 Agent 提供平台能力（发送消息、上传文件等） |
| **AdapterFactory** | 工厂接口，负责创建 Bot 实例 |
| **UniversalMessage** | 统一消息格式，实现平台无关性 |
| **UniversalResponse** | 统一响应格式，Agent 输出的标准格式 |
| **PlatformStore** | 平台存储接口，处理附件下载和消息日志 |

### 消息流转图

```
用户消息                    Agent 处理                    Bot 响应
    │                           │                           │
    ▼                           ▼                           ▼
┌─────────┐  解析   ┌─────────────────┐  转换   ┌─────────────────┐
│ 平台消息 │ ─────▶ │ UniversalMessage│ ─────▶ │   CoreAgent     │
│(飞书/QQ)│        │  (统一格式)      │        │   (AI 处理)      │
└─────────┘        └─────────────────┘        └─────────────────┘
                                                    │
                                                    ▼
                                            ┌─────────────────┐
                                            │UniversalResponse│
                                            │   (统一格式)     │
                                            └─────────────────┘
                                                    │
                           ┌────────────────────────┴────────────────────────┐
                           │                                                 │
                           ▼                                                 ▼
                    ┌─────────────┐                                   ┌─────────────┐
                    │PlatformContext│                                  │PlatformContext│
                    │  .sendText() │                                  │  .sendCard() │
                    └─────────────┘                                   └─────────────┘
```

---

## 2. 核心接口详解

### 2.1 PlatformAdapter 接口

`PlatformAdapter` 是所有平台适配器必须实现的核心接口，定义在 `src/core/platform/adapter.ts`：

```typescript
export interface PlatformAdapter {
  /** 平台标识（如 "feishu", "tui", "qq"） */
  readonly platform: string;

  // ========== 生命周期 ==========

  /** 初始化适配器 */
  initialize(config: PlatformConfig): Promise<void>;

  /** 启动适配器（连接 WebSocket、注册 Webhook 等） */
  start(): Promise<void>;

  /** 停止适配器 */
  stop(): Promise<void>;

  // ========== 消息操作 ==========

  /** 发送消息 */
  sendMessage(response: UniversalResponse): Promise<void>;

  /** 更新消息 */
  updateMessage(messageId: string, response: UniversalResponse): Promise<void>;

  /** 删除消息 */
  deleteMessage(messageId: string): Promise<void>;

  // ========== 文件操作 ==========

  /** 上传文件，返回文件标识 */
  uploadFile(filePath: string): Promise<string>;

  /** 上传图片，返回图片标识 */
  uploadImage(imagePath: string): Promise<string>;

  // ========== 信息查询 ==========

  /** 获取用户信息 */
  getUserInfo(userId: string): Promise<UserInfo | undefined>;

  /** 获取所有用户 */
  getAllUsers(): Promise<UserInfo[]>;

  /** 获取频道信息 */
  getChannelInfo(channelId: string): Promise<ChannelInfo | undefined>;

  /** 获取所有频道 */
  getAllChannels(): Promise<ChannelInfo[]>;

  // ========== 事件订阅 ==========

  /** 订阅消息事件 */
  onMessage(handler: (message: UniversalMessage) => void): void;

  // ========== 上下文创建 ==========

  /** 创建平台上下文（用于 Agent） */
  createPlatformContext(chatId: string): PlatformContext;

  // ========== 运行状态管理 ==========

  /** 检查频道是否正在运行 */
  isRunning(channelId: string): boolean;

  /** 设置频道运行状态 */
  setRunning(channelId: string, abort: () => void): void;

  /** 清除频道运行状态 */
  clearRunning(channelId: string): void;

  /** 中止频道运行 */
  abortChannel(channelId: string): void;

  // ========== 可选方法 ==========

  /** 获取 adapter 默认模型（可选） */
  getDefaultModel?(): string | undefined;
}
```

### 2.2 PlatformContext 接口

`PlatformContext` 为 Agent 提供平台能力，定义在 `src/core/platform/context.ts`：

```typescript
export interface PlatformContext {
  /** 平台类型 */
  readonly platform: string;

  // ========== 消息发送 ==========

  /** 发送文本消息 */
  sendText(chatId: string, text: string): Promise<string>;

  /** 更新消息 */
  updateMessage(messageId: string, content: string): Promise<void>;

  /** 删除消息 */
  deleteMessage(messageId: string): Promise<void>;

  // ========== 文件/图片 ==========

  /** 上传文件 */
  uploadFile(filePath: string, chatId: string): Promise<void>;

  /** 上传图片 */
  uploadImage(imagePath: string): Promise<string>;

  /** 发送图片 */
  sendImage(chatId: string, imageKey: string): Promise<string>;

  // ========== 语音消息 ==========

  /** 发送语音消息 */
  sendVoiceMessage(chatId: string, filePath: string): Promise<string>;

  // ========== 线程回复 ==========

  /** 在线程中回复 */
  postInThread(chatId: string, parentMessageId: string, text: string): Promise<string>;

  // ========== 可选方法 ==========

  /** 设置打字状态（可选） */
  setTyping?(chatId: string, isTyping: boolean): Promise<void>;

  /** 获取平台特定功能（可选） */
  getPlatformFeature?<T = any>(feature: string): T;

  /** 获取平台特定工具（可选） */
  getTools?(context: {
    chatId: string;
    workspaceDir: string;
    channelDir: string;
  }): PlatformTool[] | Promise<PlatformTool[]>;
}
```

### 2.3 AdapterFactory 接口

`AdapterFactory` 负责创建 Bot 实例，定义在 `src/core/adapter/types.ts`：

```typescript
export interface AdapterFactory {
  /** Adapter 元数据 */
  readonly meta: AdapterMeta;

  /** 创建 Bot 实例 */
  createBot(config: BotConfig): Promise<Bot>;

  /** 验证配置（可选） */
  validateConfig?(config: any): boolean;

  /** 获取默认配置（可选） */
  getDefaultConfig?(): Partial<BotConfig>;
}

export interface AdapterMeta {
  /** 唯一标识符（如 "feishu", "qq"） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 描述 */
  description?: string;
}

export interface Bot {
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
}
```

### 2.4 消息类型

#### UniversalMessage

统一的消息格式，定义在 `src/core/platform/message.ts`：

```typescript
export interface UniversalMessage {
  /** 消息 ID */
  id: string;
  /** 平台类型 */
  platform: "feishu" | "wechat" | "weibo";
  /** 消息类型 */
  type: "text" | "image" | "file" | "audio" | "video";
  /** 消息内容 */
  content: string;
  /** 发送者信息 */
  sender: Sender;
  /** 聊天信息 */
  chat: Chat;
  /** 附件列表 */
  attachments?: Attachment[];
  /** 时间戳 */
  timestamp: Date;
  /** 提及的用户 ID 列表 */
  mentions?: string[];
}

export interface Sender {
  id: string;
  name: string;
  displayName?: string;
  avatar?: string;
}

export interface Chat {
  id: string;
  type: "private" | "group" | "channel";
  name?: string;
}
```

#### UniversalResponse

统一的响应格式：

```typescript
export interface UniversalResponse {
  /** 响应类型 */
  type: "text" | "image" | "card" | "audio";
  /** 响应内容 */
  content: string | CardContent;
  /** 回复的消息 ID（用于更新消息） */
  messageId?: string;
  /** 图片键（用于发送图片） */
  imageKey?: string;
  /** 文件路径（用于发送文件） */
  filePath?: string;
}
```

### 2.5 PlatformStore 接口

存储接口，定义在 `src/core/store/types.ts`：

```typescript
export interface PlatformStore {
  /** 处理附件 */
  processAttachments(
    channelId: string,
    files: AttachmentInput[],
    timestamp: string
  ): Attachment[] | Promise<Attachment[]>;

  /** 立即下载附件（可选） */
  downloadAttachmentNow?(
    file: AttachmentInput,
    channelId: string,
    timestamp: string
  ): Promise<Attachment | null>;

  /** 记录消息 */
  logMessage(channelId: string, message: LoggedMessage): Promise<boolean>;

  /** 记录 Bot 响应 */
  logBotResponse(channelId: string, text: string, ts: string): Promise<void>;

  /** 获取最后一条消息的时间戳 */
  getLastTimestamp(channelId: string): string | null;
}
```

---

## 3. 快速开始

### 目录结构规范

一个完整的 adapter 插件目录结构如下：

```
src/adapters/your-platform/
├── index.ts           # 模块入口，导出所有公共 API
├── adapter.ts         # PlatformAdapter 实现
├── context.ts         # PlatformContext 实现
├── factory.ts         # AdapterFactory 实现
├── store.ts           # PlatformStore 实现（可选，可继承 BaseStore）
├── message-parser.ts  # 平台消息解析器（可选）
├── types.ts           # 类型定义
└── tools/             # 平台工具（可选）
    ├── index.ts
    └── ...
```

### 最小化实现模板

创建一个最小可运行的 adapter，只需要实现 4 个核心文件：

#### 1. adapter.ts - 适配器实现

```typescript
// src/adapters/my-platform/adapter.ts
import type {
  PlatformAdapter,
  PlatformConfig,
  UniversalMessage,
  UniversalResponse,
  UserInfo,
  ChannelInfo,
} from "../../core/platform/adapter.js";
import type { PlatformContext } from "../../core/platform/context.js";
import { MyPlatformContext } from "./context.js";

export interface MyAdapterConfig extends PlatformConfig {
  workingDir: string;
  // 添加你的平台特定配置
  token?: string;
}

export class MyAdapter implements PlatformAdapter {
  readonly platform = "my-platform";

  private config: MyAdapterConfig;
  private messageHandlers: Array<(message: UniversalMessage) => void> = [];
  private runningChannels = new Map<string, { abort: () => void }>();

  constructor(config: MyAdapterConfig) {
    this.config = config;
  }

  async initialize(config: PlatformConfig): Promise<void> {
    // 初始化平台连接
  }

  async start(): Promise<void> {
    // 启动平台连接（WebSocket、Webhook 等）
  }

  async stop(): Promise<void> {
    // 停止平台连接
  }

  async sendMessage(response: UniversalResponse): Promise<void> {
    // 发送消息到平台
  }

  async updateMessage(messageId: string, response: UniversalResponse): Promise<void> {
    // 更新已发送的消息
  }

  async deleteMessage(messageId: string): Promise<void> {
    // 删除消息
  }

  async uploadFile(filePath: string): Promise<string> {
    throw new Error("Not implemented");
  }

  async uploadImage(imagePath: string): Promise<string> {
    throw new Error("Not implemented");
  }

  async getUserInfo(userId: string): Promise<UserInfo | undefined> {
    return { id: userId, userName: userId, displayName: userId };
  }

  async getAllUsers(): Promise<UserInfo[]> {
    return [];
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
    return { id: channelId, name: channelId };
  }

  async getAllChannels(): Promise<ChannelInfo[]> {
    return [];
  }

  onMessage(handler: (message: UniversalMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  createPlatformContext(chatId: string): PlatformContext {
    return new MyPlatformContext(chatId, this.config);
  }

  isRunning(channelId: string): boolean {
    return this.runningChannels.has(channelId);
  }

  setRunning(channelId: string, abort: () => void): void {
    this.runningChannels.set(channelId, { abort });
  }

  clearRunning(channelId: string): void {
    this.runningChannels.delete(channelId);
  }

  abortChannel(channelId: string): void {
    const running = this.runningChannels.get(channelId);
    if (running) {
      running.abort();
      this.runningChannels.delete(channelId);
    }
  }

  // 内部方法：触发消息处理器
  protected emitMessage(message: UniversalMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }
}
```

#### 2. context.ts - 平台上下文实现

```typescript
// src/adapters/my-platform/context.ts
import type { PlatformContext } from "../../core/platform/context.js";
import type { MyAdapterConfig } from "./adapter.js";

export class MyPlatformContext implements PlatformContext {
  readonly platform = "my-platform";

  constructor(
    private chatId: string,
    private config: MyAdapterConfig
  ) {}

  async sendText(chatId: string, text: string): Promise<string> {
    // 发送文本消息到平台
    console.log(`[MyPlatform] Sending: ${text}`);
    return `msg-${Date.now()}`;
  }

  async updateMessage(messageId: string, content: string): Promise<void> {
    // 更新消息
  }

  async deleteMessage(messageId: string): Promise<void> {
    // 删除消息
  }

  async uploadFile(filePath: string, chatId: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async uploadImage(imagePath: string): Promise<string> {
    throw new Error("Not implemented");
  }

  async sendImage(chatId: string, imageKey: string): Promise<string> {
    return `[Image: ${imageKey}]`;
  }

  async sendVoiceMessage(chatId: string, filePath: string): Promise<string> {
    return `[Voice: ${filePath}]`;
  }

  async postInThread(chatId: string, parentMessageId: string, text: string): Promise<string> {
    return this.sendText(chatId, text);
  }
}
```

#### 3. factory.ts - 工厂实现

```typescript
// src/adapters/my-platform/factory.ts
import type { AdapterFactory, BotConfig, Bot } from "../../core/adapter/index.js";
import { UnifiedBot } from "../../core/unified-bot.js";
import { PluginManager } from "../../core/plugin/manager.js";
import { MyAdapter, type MyAdapterConfig } from "./adapter.js";
import { BaseStore } from "../../core/store/index.js";

export interface MyBotConfig extends BotConfig {
  token?: string;
}

export const myAdapterFactory: AdapterFactory = {
  meta: {
    id: "my-platform",
    name: "My Platform",
    version: "1.0.0",
    description: "My platform adapter",
  },

  async createBot(config: MyBotConfig): Promise<Bot> {
    // 1. 创建适配器
    const adapter = new MyAdapter({
      platform: "my-platform",
      enabled: true,
      workingDir: config.workspaceDir,
      token: config.token,
    });

    await adapter.initialize({ platform: "my-platform", enabled: true });

    // 2. 创建存储（使用 BaseStore）
    const store = new BaseStore({ workspaceDir: config.workspaceDir });

    // 3. 创建插件管理器
    const pluginManager = new PluginManager({
      workspaceDir: config.workspaceDir,
      pluginsConfig: config.plugins || {},
    });

    pluginManager.setPlatform("my-platform");
    await pluginManager.initialize({ platform: "my-platform" });

    // 4. 创建统一机器人
    return new UnifiedBot({
      adapter,
      workingDir: config.workspaceDir,
      store,
      pluginManager,
      port: config.port,
      defaultModel: config.model,
    });
  },

  validateConfig(config: any): boolean {
    return !!(config && config.workspaceDir);
  },

  getDefaultConfig(): Partial<MyBotConfig> {
    return {
      plugins: {
        agent: { enabled: true },
        memory: { enabled: true, maxHistoryMessages: 10 },
      },
    };
  },
};
```

#### 4. index.ts - 模块入口

```typescript
// src/adapters/my-platform/index.ts
export { MyAdapter, type MyAdapterConfig } from "./adapter.js";
export { MyPlatformContext } from "./context.js";
export { myAdapterFactory, type MyBotConfig } from "./factory.js";
```

---

## 4. 实现指南

### 4.1 入站消息处理

入站消息处理是将平台原生消息转换为 `UniversalMessage` 的过程。

```typescript
// adapter.ts 中的消息处理示例
class MyAdapter implements PlatformAdapter {
  // ...

  // 当平台收到消息时调用
  private handlePlatformMessage(rawMessage: any): void {
    // 1. 解析平台消息为 UniversalMessage
    const message: UniversalMessage = {
      id: rawMessage.id || `msg-${Date.now()}`,
      platform: "my-platform",
      type: this.parseMessageType(rawMessage),
      content: this.extractContent(rawMessage),
      sender: {
        id: rawMessage.senderId,
        name: rawMessage.senderName,
        displayName: rawMessage.senderDisplayName,
        avatar: rawMessage.senderAvatar,
      },
      chat: {
        id: rawMessage.chatId,
        type: this.parseChatType(rawMessage),
        name: rawMessage.chatName,
      },
      timestamp: new Date(rawMessage.timestamp || Date.now()),
      attachments: this.parseAttachments(rawMessage),
      mentions: rawMessage.mentions,
    };

    // 2. 触发消息处理器
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        console.error("[MyAdapter] Message handler error:", error);
      }
    }
  }

  private parseMessageType(raw: any): "text" | "image" | "file" | "audio" | "video" {
    switch (raw.type) {
      case "text": return "text";
      case "image": return "image";
      case "file": return "file";
      case "audio": return "audio";
      case "video": return "video";
      default: return "text";
    }
  }

  private extractContent(raw: any): string {
    if (raw.text) return raw.text;
    if (raw.content) return raw.content;
    return "";
  }

  private parseChatType(raw: any): "private" | "group" | "channel" {
    if (raw.isPrivate) return "private";
    if (raw.isGroup) return "group";
    return "channel";
  }

  private parseAttachments(raw: any): Attachment[] {
    if (!raw.files || !Array.isArray(raw.files)) return [];

    return raw.files.map((file: any) => ({
      name: file.name,
      originalId: file.id,
      localPath: "", // 下载后填充
      type: this.parseFileType(file.type),
    }));
  }
}
```

### 4.2 出站消息处理

出站消息处理是将 `UniversalResponse` 转换为平台 API 调用的过程。

```typescript
// adapter.ts 中的发送消息实现
class MyAdapter implements PlatformAdapter {
  // ...

  async sendMessage(response: UniversalResponse): Promise<void> {
    switch (response.type) {
      case "text":
        await this.sendTextMessage(response.content as string);
        break;
      case "image":
        await this.sendImageMessage(response.imageKey!);
        break;
      case "card":
        await this.sendCardMessage(response.content);
        break;
      default:
        await this.sendTextMessage(JSON.stringify(response.content));
    }
  }

  private async sendTextMessage(text: string): Promise<void> {
    // 调用平台 API 发送文本
    // await this.client.sendMessage({ type: "text", content: text });
  }

  private async sendImageMessage(imageKey: string): Promise<void> {
    // 调用平台 API 发送图片
  }

  private async sendCardMessage(content: any): Promise<void> {
    // 调用平台 API 发送卡片（如果平台支持）
  }
}
```

### 4.3 创建 PlatformContext

`PlatformContext` 是 Agent 与平台交互的桥梁，通常作为 `PlatformAdapter` 的内部类实现：

```typescript
// context.ts
export class MyPlatformContext implements PlatformContext {
  readonly platform = "my-platform";

  private statusMessageId: string | null = null;

  constructor(
    private chatId: string,
    private adapter: MyAdapter  // 引用 adapter 以访问平台 API
  ) {}

  async sendText(chatId: string, text: string): Promise<string> {
    // 特殊处理：工具状态消息
    if (text.startsWith("_ -> ") || text.startsWith("_Error:")) {
      // 可以在这里实现进度显示逻辑
      return this.statusMessageId || "";
    }

    // 正常发送消息
    const messageId = await this.adapter.sendTextToPlatform(chatId, text);
    return messageId;
  }

  async updateMessage(messageId: string, content: string): Promise<void> {
    await this.adapter.updateMessageOnPlatform(messageId, content);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.adapter.deleteMessageFromPlatform(messageId);
  }

  // 平台特定功能
  getPlatformFeature<T = any>(feature: string): T {
    switch (feature) {
      case "customFeature":
        return this.customFeature as T;
      default:
        throw new Error(`Unknown feature: ${feature}`);
    }
  }
}
```

### 4.4 运行状态管理

运行状态管理用于防止同一频道同时处理多个消息：

```typescript
class MyAdapter implements PlatformAdapter {
  private runningChannels = new Map<string, { abort: () => void }>();

  isRunning(channelId: string): boolean {
    return this.runningChannels.has(channelId);
  }

  setRunning(channelId: string, abort: () => void): void {
    this.runningChannels.set(channelId, { abort });
  }

  clearRunning(channelId: string): void {
    this.runningChannels.delete(channelId);
  }

  abortChannel(channelId: string): void {
    const running = this.runningChannels.get(channelId);
    if (running) {
      running.abort();
      this.runningChannels.delete(channelId);
    }
  }
}
```

---

## 5. 平台工具扩展

### 工具命名规范

平台工具遵循 `{platform}_{category}_{action}` 的命名规范：

```
feishu_task_list      - 飞书任务列表
feishu_calendar_create - 飞书创建日历事件
qq_group_kick         - QQ 群踢人
dingtalk_message_send - 钉钉发送消息
```

### PlatformTool 类型

```typescript
import type { AgentTool } from "@mariozechner/pi-agent-core";

export interface PlatformToolMeta {
  platform: string;    // 平台标识
  category: string;    // 分类：task, calendar, drive, etc.
  localName: string;   // 操作名：list, create, delete, etc.
}

export type PlatformTool = AgentTool<any> & {
  platformMeta: PlatformToolMeta;
};
```

### 实现 getTools 方法

在 `PlatformContext` 中实现 `getTools` 方法：

```typescript
// context.ts
export class MyPlatformContext implements PlatformContext {
  async getTools(context: {
    chatId: string;
    workspaceDir: string;
    channelDir: string;
  }): Promise<PlatformTool[]> {
    return [
      {
        name: "my_platform_user_info",
        description: "获取用户信息",
        parameters: {
          type: "object",
          properties: {
            userId: { type: "string", description: "用户 ID" },
          },
          required: ["userId"],
        },
        execute: async (args: { userId: string }) => {
          // 调用平台 API 获取用户信息
          return { userId: args.userId, name: "User" };
        },
        platformMeta: {
          platform: "my-platform",
          category: "user",
          localName: "info",
        },
      },
    ];
  }
}
```

---

## 6. 配置与注册

### 配置 Schema

在 `config.json` 中添加平台配置：

```json
{
  "platform": "my-platform",
  "model": "claude-3-sonnet",
  "plugins": {
    "agent": { "enabled": true },
    "memory": { "enabled": true }
  },
  "my-platform": {
    "token": "your-token",
    "webhookPort": 3000
  }
}
```

### 注册到 adapterRegistry

在应用启动时注册你的 adapter：

```typescript
// src/adapters/index.ts 或入口文件
import { adapterRegistry } from "../core/adapter/registry.js";
import { myAdapterFactory } from "./my-platform/index.js";

// 注册 adapter
adapterRegistry.register(myAdapterFactory);

// 获取已注册的 adapter
const factory = adapterRegistry.get("my-platform");
if (factory) {
  const bot = await factory.createBot(config);
  await bot.start();
}
```

---

## 7. 最佳实践

### 错误处理

```typescript
// 使用 try-catch 包装平台 API 调用
async sendMessage(response: UniversalResponse): Promise<void> {
  try {
    await this.platformApi.send(response);
  } catch (error) {
    this.logger.error("Failed to send message", undefined, error as Error);
    throw error; // 重新抛出让上层处理
  }
}
```

### 日志规范

```typescript
import { PiLogger } from "../../utils/logger/index.js";

class MyAdapter implements PlatformAdapter {
  private logger: Logger;

  constructor(config: MyAdapterConfig) {
    this.logger = config.logger || new PiLogger("my-platform:adapter");
  }

  async start(): Promise<void> {
    this.logger.info("Starting adapter", { config: this.config });
    // ...
    this.logger.debug("WebSocket connected");
  }
}
```

### 消息去重

```typescript
class MyAdapter implements PlatformAdapter {
  private processedMessages = new Set<string>();

  private handlePlatformMessage(raw: any): void {
    // 防止重复处理
    if (this.processedMessages.has(raw.id)) {
      return;
    }
    this.processedMessages.add(raw.id);

    // 限制集合大小
    if (this.processedMessages.size > 1000) {
      const first = this.processedMessages.values().next().value;
      this.processedMessages.delete(first);
    }

    // 处理消息...
  }
}
```

### 频道队列

使用队列确保同一频道的消息按顺序处理：

```typescript
class ChannelQueue {
  private queue: (() => Promise<void>)[] = [];
  private processing = false;

  enqueue(work: () => Promise<void>): void {
    this.queue.push(work);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const work = this.queue.shift()!;
    try {
      await work();
    } catch (err) {
      console.error("[Queue] Error:", err);
    }
    this.processing = false;
    this.processNext();
  }
}

class MyAdapter implements PlatformAdapter {
  private queues = new Map<string, ChannelQueue>();

  private getQueue(channelId: string): ChannelQueue {
    if (!this.queues.has(channelId)) {
      this.queues.set(channelId, new ChannelQueue());
    }
    return this.queues.get(channelId)!;
  }
}
```

---

## 8. 完整示例

### TUI Adapter（简化版）

TUI Adapter 是一个最小化的实现，适合作为参考：

```typescript
// src/adapters/tui/adapter.ts
import { randomUUID } from "crypto";
import type { PlatformAdapter, PlatformConfig, UniversalMessage, UniversalResponse, UserInfo, ChannelInfo } from "../../core/platform/adapter.js";
import type { PlatformContext } from "../../core/platform/context.js";
import { TUIPlatformContext } from "./context.js";

export interface TUIAdapterConfig {
  workingDir: string;
  tui: PiClawTUI;
  model?: string;
  logger?: Logger;
}

export class TUIAdapter implements PlatformAdapter {
  readonly platform = "tui";

  private config: TUIAdapterConfig;
  private logger?: Logger;
  private messageHandlers: Array<(message: UniversalMessage) => void> = [];
  private runningChannels = new Map<string, { abort: () => void }>();
  private defaultModel: string | undefined;
  private messageCounter = 0;

  constructor(config: TUIAdapterConfig) {
    this.config = config;
    this.logger = config.logger;
    this.defaultModel = config.model;
  }

  async initialize(_config: PlatformConfig): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async sendMessage(response: UniversalResponse): Promise<void> {
    const content = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
    this.config.tui.addChatMessage({
      id: randomUUID(),
      role: "assistant",
      content,
      timestamp: new Date(),
      channelId: "default",
    });
  }

  async updateMessage() {}
  async deleteMessage() {}
  async uploadFile() { throw new Error("Not supported"); }
  async uploadImage() { throw new Error("Not supported"); }

  async getUserInfo(userId: string): Promise<UserInfo | undefined> {
    return { id: userId, userName: userId, displayName: userId };
  }

  async getAllUsers(): Promise<UserInfo[]> {
    return [
      { id: "user", userName: "User", displayName: "User" },
      { id: "assistant", userName: "Assistant", displayName: "Assistant" },
    ];
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo | undefined> {
    return { id: channelId, name: "TUI Channel" };
  }

  async getAllChannels(): Promise<ChannelInfo[]> {
    return [{ id: "default", name: "TUI Channel" }];
  }

  onMessage(handler: (message: UniversalMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  createPlatformContext(chatId: string): PlatformContext {
    return new TUIPlatformContext(chatId, {
      onSendText: (channelId, text) => {
        this.config.tui.addChatMessage({
          id: randomUUID(),
          role: "assistant",
          content: text,
          timestamp: new Date(),
          channelId,
        });
      },
    });
  }

  isRunning(channelId: string): boolean { return this.runningChannels.has(channelId); }
  setRunning(channelId: string, abort: () => void): void { this.runningChannels.set(channelId, { abort }); }
  clearRunning(channelId: string): void { this.runningChannels.delete(channelId); }
  abortChannel(channelId: string): void {
    const running = this.runningChannels.get(channelId);
    if (running) { running.abort(); this.runningChannels.delete(channelId); }
  }
  getDefaultModel(): string | undefined { return this.defaultModel; }

  // TUI 特有方法：处理用户输入
  handleUserInput(content: string, channelId: string): void {
    const message: UniversalMessage = {
      id: `tui-${Date.now()}-${++this.messageCounter}`,
      platform: "feishu",
      type: "text",
      chat: { id: channelId, type: "private" },
      content,
      sender: { id: "user", name: "User" },
      timestamp: new Date(),
      attachments: [],
    };

    for (const handler of this.messageHandlers) {
      try { handler(message); } catch (error) {
        this.logger?.error("Handler error", undefined, error as Error);
      }
    }
  }
}
```

### Feishu Adapter（完整版）

飞书 Adapter 是一个功能完整的实现，包含 WebSocket、卡片、工具等功能。关键部分已在本文档中展示，完整代码请参考 `git show cfbc09b:src/adapters/feishu/` 下的文件。

主要特点：
- 支持 WebSocket 长连接和 Webhook 两种模式
- 完整的消息解析（文本、图片、文件等）
- 卡片消息支持（进度显示、状态更新）
- 平台工具集成（任务、日历、文档等）
- 频道队列确保消息顺序
- Hook 系统集成

---

## 附录

### 相关文件路径

| 文件 | 说明 |
|------|------|
| `src/core/platform/adapter.ts` | PlatformAdapter 接口定义 |
| `src/core/platform/context.ts` | PlatformContext 接口定义 |
| `src/core/platform/message.ts` | UniversalMessage/Response 类型 |
| `src/core/platform/tools/types.ts` | PlatformTool 类型定义 |
| `src/core/adapter/types.ts` | AdapterFactory 接口定义 |
| `src/core/adapter/registry.ts` | adapterRegistry 注册表 |
| `src/core/store/types.ts` | PlatformStore 接口定义 |
| `src/core/unified-bot.ts` | UnifiedBot 实现 |
| `src/adapters/tui/` | TUI Adapter 参考实现 |
| `src/adapters/feishu/` | Feishu Adapter 参考实现（历史提交） |

### 常见问题

**Q: 如何测试我的 adapter？**

A: 创建一个简单的测试脚本：

```typescript
import { MyAdapter } from "./adapter.js";

const adapter = new MyAdapter({
  platform: "my-platform",
  enabled: true,
  workingDir: "./test-workspace",
});

adapter.onMessage((message) => {
  console.log("Received:", message);
});

await adapter.start();
console.log("Adapter started");
```

**Q: 如何支持多账号？**

A: 在 factory 中支持数组配置，为每个账号创建独立的 adapter 实例。

**Q: 如何添加平台特定的配置？**

A: 扩展 `PlatformConfig` 接口，在 `BotConfig` 中添加平台字段。
