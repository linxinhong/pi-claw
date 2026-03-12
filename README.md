# pi-claw

多平台机器人插件化架构。

## 快速开始

### 1. 初始化 Workspace

```bash
# 使用默认目录 (~/.pi-claw)
pnpm run init

# 或指定目录
./scripts/init-workspace.sh /path/to/workspace

# 或使用 TypeScript 版本（支持更多选项）
npx tsx scripts/init-workspace.ts /path/to/workspace --dry-run
npx tsx scripts/init-workspace.ts /path/to/workspace --force
```

### 2. 配置

创建配置文件 `~/.pi-claw/config.json`：

```json
{
  "appId": "cli_xxx",
  "appSecret": "xxx",
  "model": "bailian/qwen3.5-plus",
  "workingDir": "~/.pi-claw",
  "port": 3000,
  "useWebSocket": true,
  "plugins": {
    "voice": {
      "enabled": true,
      "defaultVoice": "Cherry"
    },
    "card": {
      "enabled": true
    }
  }
}
```

> **注意**：也可以通过环境变量配置（优先级低于配置文件）：

### 3. 启动

```bash
# 开发模式
pnpm run dev

# 构建 + 生产模式
pnpm run build && pnpm start
```

## 目录结构

```
src/
├── main.ts                 # 入口
├── core/                   # 核心模块
│   ├── agent/              # 核心 Agent
│   │   ├── core-agent.ts   # CoreAgent 实现
│   │   ├── context.ts      # Agent 上下文
│   │   └── index.ts
│   │
│   ├── model/              # 模型管理
│   │   ├── manager.ts      # ModelManager
│   │   └── index.ts
│   │
│   ├── platform/           # 平台抽象
│   │   ├── adapter.ts      # PlatformAdapter 接口
│   │   └── index.ts
│   │
│   ├── services/           # 核心服务
│   │   ├── memory/         # Memory 服务
│   │   │   ├── store.ts     # MemoryStore
│   │   │   ├── tools.ts     # Memory 工具
│   │   │   └── index.ts
│   │   │
│   │   └── event/          # Event 服务
│   │       ├── types.ts     # 事件类型定义
│   │       ├── watcher.ts   # EventsWatcher
│   │       └── index.ts
│   │
│   ├── tools/              # 基础工具
│   │   ├── bash.ts
│   │   ├── read.ts
│   │   ├── write.ts
│   │   └── edit.ts
│   │
│   ├── sandbox/            # 沙箱执行
│   │   ├── config.ts
│   │   ├── executor.ts
│   │   └── index.ts
│   │
│   ├── plugin-manager.ts   # 插件管理器（内含 EventBus）
│   ├── store.ts            # 存储
│   ├── unified-bot.ts      # 统一机器人
│   └── index.ts
│
├── adapters/               # 平台适配器
│   └── feishu/             # 飞书适配器
│       ├── adapter.ts      # FeishuAdapter
│       ├── message-parser.ts
│       ├── card/           # 卡片消息（飞书专用）
│       └── index.ts
│
├── plugins/                # 扩展插件
│   ├── context.ts          # 插件上下文构建
│   ├── types.ts            # 插件类型定义
│   ├── voice/              # 语音插件
│   └── index.ts
│
└── utils/
    ├── log.ts
    └── config.ts
```

## Workspace 结构

初始化后的 workspace 目录：

```
~/.pi-claw/
├── config.json                 # 主配置
├── SYSTEM.md                   # 系统日志
│
├── boot/                       # 启动配置
│   ├── soul.md                 # 🔒 核心身份 (600)
│   ├── identity.md             # 🔒 身份定义 (600)
│   ├── tools.md                # 🔒 工具指南 (600)
│   └── profile.md              # 用户配置 (可编辑)
│
├── memory/                     # 记忆存储
│   └── memory.md               # 长期记忆
│
├── skills/                     # 技能目录
│   └── my-skill/
│       └── SKILL.md
│
├── events/                     # 事件调度
│   └── reminder.json
│
└── channels/                   # 频道数据
    └── oc_xxx/
        ├── log.jsonl
        ├── MEMORY.md
        ├── attachments/
        └── scratch/
```

## 配置锁定

核心配置文件设置为只读（600 权限），防止被 Agent 修改：

```bash
# 查看状态
pnpm run config:status

# 解锁（允许编辑）
pnpm run unlock

# 锁定（保护配置）
pnpm run lock
```

锁定文件：
- `boot/soul.md` - 核心身份和行为边界
- `boot/identity.md` - 身份定义和交互风格
- `boot/tools.md` - 工具使用最佳实践

## 核心服务

| 服务 | 功能 | 工具 |
|------|------|------|
| agent | 核心对话 | bash, read, write, edit |
| memory | 记忆 | memory_save, memory_recall, memory_append_daily, memory_forget |
| event | 调度 | 文件监听 + cron 支持 |
| voice | 语音 | tts, voice, transcribe (插件) |
| **mcp** | **MCP 客户端** | **连接外部 MCP 服务器** |

## MCP 支持 (Beta)

pi-claw 支持通过 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 接入外部工具和数据源：

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
      },
      {
        "name": "github",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
      }
    ]
  }
}
```

接入的 MCP 工具会自动转换为 `mcp_{serverName}_{toolName}` 格式，例如：
- `mcp_filesystem_read_file`
- `mcp_github_search_repositories`

详见 [MCP 集成指南](./docs/mcp-integration.md)。

## 架构说明

### 核心服务 vs 插件

**核心服务**（直接集成）：
- **Agent** - 核心对话能力，集成到 CoreAgent
- **Memory** - 记忆存储，集成到 CoreAgent
- **Event** - 事件调度，集成到 UnifiedBot
- **Sandbox** - 沙箱执行，集成到 CoreAgent

**插件**（可热插拔）：
- **Voice** - 语音 TTS/ASR
- **Card** - 飞书卡片消息

### 设计原则

1. **核心精简** - 核心服务直接集成，减少包装层
2. **插件隔离** - 可选功能作为插件，支持热插拔
3. **平台抽象** - PlatformAdapter 支持多平台
4. **依赖注入** - 通过 Context 对象向插件提供必要的 API
5. **事件驱动** - 插件通过订阅事件来响应消息和状态变化

## 配置说明

### 配置文件 (优先)

主配置文件 `~/.pi-claw/config.json`：

```json
{
  "appId": "cli_xxx",
  "appSecret": "xxx",
  "model": "bailian/qwen3.5-plus",
  "workingDir": "~/.pi-claw",
  "port": 3000,
  "useWebSocket": true,
  "plugins": {
    "voice": {
      "enabled": true,
      "defaultVoice": "Cherry"
    },
    "card": {
      "enabled": true
    }
  }
}
```

### 环境变量 (备选)

如果没有配置文件，也可以使用环境变量：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
export FEISHU_MODEL="bailian/qwen3.5-plus"
export FEISHU_PORT="3000"
export FEISHU_USE_WEBSOCKET="true"
```

> **注意**：配置文件优先级高于环境变量。

## NPM Scripts

```bash
# 初始化
pnpm run init              # 初始化 workspace
pnpm run init:ts           # TypeScript 版本

# 配置锁定
pnpm run lock              # 锁定配置文件
pnpm run unlock            # 解锁配置文件
pnpm run config:status     # 查看配置状态

# 开发
pnpm run dev               # 开发模式
pnpm run build             # 构建
pnpm start                 # 启动
pnpm run typecheck         # 类型检查

# 测试
pnpm test                  # 运行测试
```

## 开发自定义插件

```typescript
import type { FeishuPlugin, FeishuPluginContext, PluginInitContext } from "@linxinhong/pi-claw";

export const myPlugin: FeishuPlugin = {
  meta: {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    description: "A custom plugin",
  },

  async init(context: PluginInitContext): Promise<void> {
    console.log("Plugin initialized with config:", context.config);
  },

  async getTools(context: FeishuPluginContext): Promise<any[]> {
    return [
      {
        name: "my_tool",
        description: "A custom tool",
        parameters: { ... },
        execute: async (args) => { ... },
      },
    ];
  },

  async onEvent(event, context): Promise<void> {
    if (event.type === "message") {
      // 处理消息
    }
  },
};
```

## 优势

1. **核心集成** - Memory/Event 等核心服务直接集成，减少包装开销
2. **插件扩展** - 可选功能通过插件添加，支持热插拔
3. **平台抽象** - 支持多平台适配
4. **可配置** - 插件可单独启用/禁用
5. **易测试** - 完整的测试覆盖（68 个测试用例）
6. **安全** - 核心配置只读保护
