# feishu-openclaw-plugin 架构设计方案文档

## 一、项目概述

### 1.1 基本信息
- **包名**: `@larksuiteoapi/feishu-openclaw-plugin`
- **版本**: 2026.3.8-beta.0
- **维护方**: 飞书开放平台团队
- **技术栈**: Node.js v22+、TypeScript、ES Modules
- **核心依赖**: `@larksuiteoapi/node-sdk` (飞书官方 SDK)

### 1.2 项目定位
feishu-openclaw-plugin 是飞书官方为 OpenClaw AI 框架开发的频道插件，实现了 OpenClaw 与飞书/Lark 的深度集成，让 AI Agent 能够直接操作飞书的消息、文档、表格、日历、任务等各种能力。

---

## 二、整体架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OpenClaw Framework                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    feishu-openclaw-plugin                    │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │   │
│  │  │   Channel   │  │    Tools    │  │       Skills        │  │   │
│  │  │   Plugin    │  │   Registry  │  │     (SKILL.md)      │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │   │
│  │         │                │                     │              │   │
│  │  ┌──────▼────────────────▼─────────────────────▼──────────┐  │   │
│  │  │                     Core Services                       │  │   │
│  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ │  │   │
│  │  │  │ LarkClient│ │ Accounts  │ │ToolClient │ │TokenStore│ │  │   │
│  │  │  └───────────┘ └───────────┘ └───────────┘ └─────────┘ │  │   │
│  │  └─────────────────────────────────────────────────────────┘  │   │
│  │                                                               │   │
│  │  ┌─────────────────────────────────────────────────────────┐  │   │
│  │  │                  Messaging Pipeline                      │  │   │
│  │  │  ┌────────┐   ┌────────┐   ┌────────┐   ┌────────────┐ │  │   │
│  │  │  │ Inbound│ → │ Parse  │ → │  Gate  │ → │  Dispatch  │ │  │   │
│  │  │  └────────┘   └────────┘   └────────┘   └────────────┘ │  │   │
│  │  │  ┌────────┐   ┌────────┐   ┌────────┐                  │  │   │
│  │  │  │Outbound│ ← │ Convert│ ← │  Card  │                  │  │   │
│  │  │  └────────┘   └────────┘   └────────┘                  │  │   │
│  │  └─────────────────────────────────────────────────────────┘  │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │     Lark Open API / SDK      │
                    │  ┌────────┐  ┌────────────┐  │
                    │  │   IM   │  │   Drive    │  │
                    │  ├────────┤  ├────────────┤  │
                    │  │ Bitable│  │  Calendar  │  │
                    │  ├────────┤  ├────────────┤  │
                    │  │  Task  │  │   Wiki     │  │
                    │  └────────┘  └────────────┘  │
                    └──────────────────────────────┘
```

### 2.2 核心模块划分

| 模块 | 目录 | 职责 |
|------|------|------|
| 频道插件 | `/src/channel/` | 与 OpenClaw 框架集成，注册频道和工具 |
| 核心服务 | `/src/core/` | 客户端管理、账户管理、Token 存储 |
| 消息管道 | `/src/messaging/` | 入站/出站消息处理、类型转换 |
| 卡片系统 | `/src/card/` | 交互式卡片构建和状态管理 |
| AI 工具 | `/src/tools/` | 飞书 API 工具封装，供 AI 调用 |
| 命令系统 | `/src/commands/` | CLI 和聊天命令 |
| 工作区集成 | `/src/workspace/` | 任务追踪、数据汇聚 |
| 技能定义 | `/skills/` | AI 操作飞书功能的指南文档 |

---

## 三、核心功能模块

### 3.1 频道插件 (Channel Plugin)

**核心文件**: `/src/channel/plugin.js`

#### 3.1.1 插件注册接口

```typescript
interface ChannelPlugin {
  id: string;                          // 插件标识: "feishu"
  meta: {                              // 元信息
    label: string;                     // 显示名称
    docsPath: string;                  // 文档路径
  };
  configSchema: JSONSchema;            // 配置 Schema
  config: {                            // 配置适配器
    listAccountIds: () => string[];
    resolveAccount: (id: string) => Account;
    defaultAccountId: () => string;
  };
  messaging: {                         // 消息路由
    normalizeTarget: (target) => Target;
    targetResolver: {
      looksLikeId: (id) => boolean;
      hint: string;
    };
  };
  outbound: OutboundAdapter;           // 出站适配器
  gateway: {                           // 网关启动
    startAccount: (ctx) => Promise<void>;
  };
  actions: MessageActions;             // 消息动作
  directory: DirectoryService;         // 目录服务
}
```

#### 3.1.2 多账户支持

- 支持单一插件实例管理多个飞书应用
- 账户级配置可覆盖顶层配置
- 配置层级：`channels.feishu` → `channels.feishu.accounts[accountId]`

### 3.2 消息处理管道

**核心文件**: `/src/messaging/inbound/handler.js`

#### 3.2.1 入站消息处理流程

```
原始事件
    │
    ▼
┌─────────────────┐
│  1. 账户解析     │  getLarkAccount(cfg, accountId)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. 事件解析     │  parseMessageEvent() → MessageContext
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. 发送者丰富   │  resolveSenderInfo()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. 策略门控     │  checkMessageGate()
│   ├─ DM 策略    │  dmPolicy: open/pairing/allowlist/disabled
│   ├─ 群组策略   │  groupPolicy: open/allowlist/disabled
│   └─ @提及检查  │  requireMention
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  5. 用户名预取   │  prefetchUserNames()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  6. 内容解析     │  并行执行
│   ├─ 媒体解析   │  resolveMedia()
│   └─ 引用解析   │  resolveQuotedContent()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  7. 分发到Agent │  dispatchToAgent()
└─────────────────┘
```

#### 3.2.2 消息类型转换器

支持 20+ 种飞书消息类型：

| 类型 | 转换器文件 | 说明 |
|------|------------|------|
| text | text.js | 纯文本 |
| post | post.js | 富文本/文章 |
| image | image.js | 图片 |
| file | file.js | 文件 |
| audio | audio.js | 音频 |
| video | video.js | 视频 |
| interactive | interactive.js | 交互式卡片 |
| sticker | sticker.js | 表情 |
| location | location.js | 位置 |
| vote | vote.js | 投票 |
| merge-forward | merge-forward.js | 合并转发 |
| share | share.js | 分享 |
| todo | todo.js | 待办 |
| calendar | calendar.js | 日程邀请 |
| hongbao | hongbao.js | 红包 |
| video-chat | video-chat.js | 视频聊天 |
| system | system.js | 系统消息 |

#### 3.2.3 出站消息发送

```typescript
// 主要发送函数
sendTextLark(ctx, target, text, opts)      // 发送文本
sendMediaLark(ctx, target, media, opts)    // 发送媒体
sendCardLark(ctx, target, card, opts)      // 发送卡片
sendMessageFeishu(ctx, target, message)    // 通用发送（自动选择类型）

// 特殊功能
- 流式响应卡片（实时更新 AI 状态）
- 回复引用（replyToMessageId, replyInThread）
- 消息重试机制
- 卡片动态更新
```

### 3.3 交互式卡片系统

**核心文件**: `/src/card/builder.js`

#### 3.3.1 卡片状态机

| 状态 | 描述 | 显示内容 |
|------|------|----------|
| `thinking` | AI 思考中 | "思考中..." 动画 |
| `streaming` | 流式输出中 | 部分文本 + 工具调用状态 |
| `complete` | 完成 | 完整结果 + 工具汇总 + 页脚 |
| `confirm` | 确认操作 | 操作描述 + 确认/拒绝按钮 |

#### 3.3.2 卡片特性

- **思考过程显示**: 提取 `<thinking>` 标签内容，折叠面板展示
- **页脚元信息**: 状态/耗时显示（可配置）
- **Markdown 优化**: 自动转换为飞书兼容格式

### 3.4 LarkClient 管理

**核心文件**: `/src/core/lark-client.js`

```typescript
class LarkClient {
  // 工厂方法
  static fromCfg(cfg, accountId): LarkClient;
  static fromAccount(account): LarkClient;
  static fromCredentials(credentials): LarkClient;

  // 核心属性
  sdk: Client;              // 飞书 SDK 客户端
  botOpenId: string;        // Bot 身份
  botName: string;          // Bot 名称
  messageDedup: MessageDedup;  // 消息去重器

  // 生命周期
  async startWS(opts): void;  // 启动 WebSocket
  disconnect(): void;         // 断开但保留缓存
  dispose(): void;            // 断开并移除缓存
}
```

### 3.5 用户身份工具调用

**核心文件**: `/src/core/tool-client.js`

#### 3.5.1 工作流程

```
AI 调用工具
    │
    ▼
┌─────────────────────┐
│  ToolClient.invoke  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     否
│  用户已授权？        ├────────┐
└──────────┬──────────┘        │
           │ 是                │
           ▼                   ▼
┌─────────────────────┐  ┌─────────────────┐
│  调用飞书 API        │  │  触发授权流程    │
│  (使用 User Token)  │  │  Device Flow    │
└─────────────────────┘  └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  发送授权卡片    │
                         │  (二维码/链接)   │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  用户完成授权    │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  保存 Token     │
                         │  触发重试       │
                         └─────────────────┘
```

---

## 四、AI 工具体系

### 4.1 工具分类总览

| 分类 | 工具数 | 功能描述 |
|------|--------|----------|
| **bitable** | 5 | 多维表格管理（App/Table/Field/Record/View） |
| **calendar** | 4 | 日历/事件/参与者/忙闲查询 |
| **task** | 4 | 任务/任务列表/子任务/评论 |
| **chat** | 2 | 群组信息/成员管理 |
| **im** | 4 | 消息/资源/用户名/格式化 |
| **drive** | 2 | 文件/文档评论/媒体 |
| **wiki** | 3 | 知识库空间/节点 |
| **search** | 1 | 文档搜索 |
| **sheets** | 2 | 电子表格 |
| **doc (MCP)** | 3 | 文档获取/创建/更新 |
| **oauth** | 3 | 授权管理 |

### 4.2 工具详细列表

#### 4.2.1 多维表格工具 (bitable)

| 工具名 | 功能 |
|--------|------|
| `feishu_list_bitable_apps` | 列出多维表格 App |
| `feishu_list_bitable_tables` | 列出数据表 |
| `feishu_list_bitable_fields` | 列出字段 |
| `feishu_list_bitable_records` | 列出记录 |
| `feishu_list_bitable_views` | 列出视图 |

#### 4.2.2 日历工具 (calendar)

| 工具名 | 功能 |
|--------|------|
| `feishu_list_calendars` | 列出日历 |
| `feishu_list_calendar_events` | 列出日程事件 |
| `feishu_get_calendar_freebusy` | 查询忙闲状态 |
| `feishu_list_calendar_event_attendees` | 列出参与者 |

#### 4.2.3 任务工具 (task)

| 工具名 | 功能 |
|--------|------|
| `feishu_list_task_lists` | 列出任务列表 |
| `feishu_list_tasks` | 列出任务 |
| `feishu_list_task_subtasks` | 列出子任务 |
| `feishu_list_task_comments` | 列出任务评论 |

#### 4.2.4 文档工具 (MCP)

| 工具名 | 功能 |
|--------|------|
| `feishu_fetch_doc` | 获取云文档内容 |
| `feishu_create_doc` | 从 Markdown 创建云文档 |
| `feishu_update_doc` | 更新云文档内容 |

### 4.3 技能定义 (Skills)

位于 `/skills/` 目录，为 AI 提供操作指南：

| 技能 | 文件 | 用途 |
|------|------|------|
| feishu-bitable | SKILL.md | 多维表格操作指南 |
| feishu-calendar | SKILL.md | 日历管理指南 |
| feishu-create-doc | SKILL.md | 创建文档指南 |
| feishu-fetch-doc | SKILL.md | 获取文档指南 |
| feishu-update-doc | SKILL.md | 更新文档指南 |
| feishu-im-read | SKILL.md | 消息读取指南 |
| feishu-task | SKILL.md | 任务管理指南 |
| feishu-channel-rules | SKILL.md | 频道规则说明 |
| feishu-troubleshoot | SKILL.md | 故障排查指南 |

---

## 五、配置系统

### 5.1 配置结构

```yaml
channels:
  feishu:
    enabled: true

    # 应用凭证
    appId: "cli_xxx"
    appSecret: "xxx"

    # 连接配置
    domain: "feishu"                    # feishu | lark | 自定义
    connectionMode: "websocket"         # websocket | webhook

    # 策略配置
    dmPolicy: "open"                    # open | pairing | allowlist | disabled
    groupPolicy: "open"                 # open | allowlist | disabled
    requireMention: true                # 群聊是否需要 @

    # 响应配置
    replyMode: "streaming"              # auto | static | streaming
    historyLimit: 50                    # 历史消息限制
    textChunkLimit: 4000                # 文本分块限制
    mediaMaxMb: 20                      # 媒体文件大小限制

    # 显示配置
    reactionNotifications: "own"        # off | own | all
    footer:
      status: true                      # 显示状态
      elapsed: true                     # 显示耗时

    # 工具开关
    tools:
      doc: true
      bitable: true
      calendar: true
      task: true

    # 群组级配置
    groups:
      "*":                              # 默认策略
        requireMention: true
      "oc_xxx":                         # 特定群组
        requireMention: false
        systemPrompt: "你是..."

    # 多账户
    accounts:
      "account1":
        enabled: true
        appId: "cli_yyy"
        appSecret: "yyy"
```

### 5.2 策略说明

| 策略 | 值 | 说明 |
|------|-----|------|
| dmPolicy | `open` | 所有人可私聊 |
| | `pairing` | 需要先配对 |
| | `allowlist` | 仅白名单用户 |
| | `disabled` | 禁用私聊 |
| groupPolicy | `open` | 所有群可响应 |
| | `allowlist` | 仅白名单群 |
| | `disabled` | 禁用群聊 |
| replyMode | `auto` | 自动选择 |
| | `static` | 静态回复 |
| | `streaming` | 流式卡片 |

---

## 六、会话管理

### 6.1 聊天队列

**核心文件**: `/src/channel/chat-queue.js`

- 每个聊天串行处理消息
- 队列键：`accountId:chatId:threadId`
- 支持中止信号传递

### 6.2 消息去重

**核心文件**: `/src/messaging/inbound/dedup.js`

- 基于 TTL 的 LRU 缓存
- 处理 WebSocket 重连时的消息重放

### 6.3 历史记录

- 每个聊天维护历史消息窗口
- 默认限制 50 条
- 支持线程级别隔离

---

## 七、诊断系统

### 7.1 CLI 命令

```bash
# 运行诊断
openclaw feishu-diagnose

# 追踪消息
openclaw feishu-diagnose --trace <msgId>

# 分析追踪日志
openclaw feishu-diagnose --trace <msgId> --analyze
```

### 7.2 聊天命令

| 命令 | 功能 |
|------|------|
| `/feishu start` | 显示版本信息 |
| `/feishu doctor` | 运行诊断 |
| `/feishu auth` | 批量用户授权 |

### 7.3 诊断项

- 配置检查
- 账户状态
- Bot 身份探查
- WebSocket 连接状态
- 权限状态

---

## 八、导出接口

### 8.1 核心导出

```typescript
// 频道插件
export { feishuPlugin } from "./src/channel/plugin.js";

// 消息发送
export {
  sendMessageFeishu,
  sendCardFeishu,
  updateCardFeishu,
  editMessageFeishu,
  getMessageFeishu
};
export {
  uploadImageLark,
  uploadFileLark,
  sendImageLark,
  sendFileLark,
  sendAudioLark,
  sendTextLark,
  sendCardLark,
  sendMediaLark
};

// 消息处理
export {
  mentionedBot,
  nonBotMentions,
  extractMessageBody,
  formatMentionForText,
  parseMessageEvent,
  checkMessageGate,
  isMessageExpired,
  handleFeishuReaction
};

// 交互功能
export {
  addReactionFeishu,
  removeReactionFeishu,
  listReactionsFeishu,
  FeishuEmoji
};
export {
  forwardMessageFeishu,
  updateChatFeishu,
  addChatMembersFeishu,
  removeChatMembersFeishu,
  listChatMembersFeishu
};

// 监控
export { monitorFeishuProvider } from "./src/channel/monitor.js";
export { probeFeishu } from "./src/channel/probe.js";
```

### 8.2 类型导出

```typescript
export type {
  MessageContext,
  RawMessage,
  RawSender,
  FeishuMessageContext,
  FeishuMessageEvent,
  FeishuReactionCreatedEvent,
  FeishuSendResult,
  FeishuMediaInfo,
  MentionInfo
};
```

---

## 九、依赖关系

### 9.1 生产依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| @larksuiteoapi/node-sdk | ^1.59.0 | 飞书官方 SDK |
| @sinclair/typebox | 0.34.48 | JSON Schema 类型定义 |
| image-size | ^2.0.2 | 图片尺寸检测 |
| zod | ^4.3.6 | 运行时类型校验 |

---

## 十、关键特性总结

### 10.1 核心能力

1. **双向消息通信**
   - 私聊和群聊
   - 话题回复
   - 流式响应卡片
   - 表情反应

2. **用户身份操作**
   - OAuth 2.0 Device Flow
   - 自动授权流程
   - Token 自动刷新

3. **多模态消息**
   - 文本、图片、文件、音频、视频
   - 富文本、交互式卡片
   - 表情、投票

4. **飞书生态集成**
   - 多维表格、云文档、日历
   - 任务、知识库、云盘、搜索

### 10.2 技术亮点

| 特性 | 说明 |
|------|------|
| 多账户架构 | 单一插件管理多个飞书应用 |
| 串行化处理 | 按聊天队列串行处理，避免冲突 |
| 消息去重 | WebSocket 重连场景去重 |
| 权限自动管理 | 自动触发用户授权流程 |
| 流式响应 | 实时更新 AI 响应状态 |
| 思考过程支持 | 显示 AI 推理过程 |
| 诊断系统 | 完整的诊断和追踪工具 |

---

## 十一、文件路径索引

### 核心入口
- `index.js` - 插件主入口
- `index.d.ts` - TypeScript 类型定义

### 频道核心
- `src/channel/plugin.js` - 频道插件实现
- `src/channel/monitor.js` - WebSocket 监控
- `src/channel/config-adapter.js` - 配置适配
- `src/channel/directory.js` - 目录服务

### 核心服务
- `src/core/lark-client.js` - Lark SDK 客户端
- `src/core/accounts.js` - 多账户管理
- `src/core/tool-client.js` - 工具客户端
- `src/core/token-store.js` - Token 存储
- `src/core/uat-client.js` - UAT 客户端
- `src/core/device-flow.js` - Device Flow

### 消息处理
- `src/messaging/inbound/handler.js` - 入站处理
- `src/messaging/inbound/parse.js` - 事件解析
- `src/messaging/inbound/gate.js` - 策略门控
- `src/messaging/outbound/outbound.js` - 出站适配器

### 卡片系统
- `src/card/builder.js` - 卡片构建器
- `src/card/cardkit.js` - CardKit 集成
- `src/card/reply-dispatcher.js` - 回复分发

### 工具注册
- `src/tools/oapi/index.js` - OAPI 工具
- `src/tools/mcp/doc/index.js` - MCP 文档工具
- `src/tools/oauth.js` - OAuth 工具
- `src/tools/auto-auth.js` - 自动授权

---

## 十二、扩展点

1. **自定义消息转换器**: 在 `src/messaging/converters/` 添加新转换器
2. **自定义工具**: 在 `src/tools/oapi/` 添加新工具
3. **自定义技能**: 在 `skills/` 添加 SKILL.md
4. **自定义卡片**: 扩展 `src/card/builder.js`
