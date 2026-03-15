# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令


```bash
# 开发
claw "cd ~/pi-claw && pnpm run dev"          # 开发模式 (tsx watch)
claw "cd ~/pi-claw && pnpm run build"        # 构建 (生成 dist/)
claw "cd ~/pi-claw && pnpm start"            # 生产模式运行
claw "cd ~/pi-claw && pnpm run typecheck"    # 类型检查

# 测试
pnpm test             # 运行所有测试 (vitest)
pnpm test:run         # 单次运行
pnpm test:unit        # 只运行单元测试
pnpm test -- path/to/file.test.ts  # 运行单个测试文件

# Workspace
claw "cd ~/pi-claw && pnpm run init"         # 初始化 workspace (~/.pi-claw)
claw "cd ~/pi-claw && pnpm run lock/unlock"  # 锁定/解锁核心配置文件
```

## 架构概述

### 核心流程

```
main.ts
  ↓ loadAdapters()      # 自动发现 src/adapters/*/
  ↓ adapterRegistry.get(platform)
  ↓ factory.createBot(config)
  ↓ bot.start()
     ↓
PlatformAdapter (如 FeishuAdapter)
  ↓ 消息接收 → FeishuPlatformContext
  ↓ CoreAgent.process()
  ↓ 工具调用 → PlatformContext.handleError()
```

### 关键组件

| 目录 | 职责 |
|------|------|
| `src/core/adapter/` | Adapter 注册和工厂模式 |
| `src/core/hook/` | Hook 系统（中间件模式，优先级控制） |
| `src/core/plugin/` | 插件管理器 |
| `src/core/platform/` | PlatformContext 接口定义 |
| `src/adapters/feishu/` | 飞书适配器实现 |
| `src/adapters/tui/` | TUI 适配器 |
| `src/adapters/slidev/` | Slidev 演示适配器 |

### Hook 系统

插件通过 Hook 系统介入生命周期：

- `system:before-start` / `system:ready` / `system:shutdown` - 系统生命周期
- `message:receive` / `message:send` - 消息处理
- `agent:turn-start` / `agent:turn-end` / `agent:thinking` - Agent 处理
- `tool:call` / `tool:called` - 工具调用
- `session:create` / `session:destroy` - 会话管理

详见 `src/core/hook/types.ts` 的 `HOOK_NAMES`。

### Feishu 适配器关键文件

- `context.ts` - FeishuPlatformContext，实现 PlatformContext 接口
- `adapter.ts` - FeishuAdapter，处理消息收发
- `utils/permission-error.ts` - 权限错误处理（extractPermissionError, sendAuthCard）
- `messaging/inbound/` - 消息解析
- `card/` - 卡片消息构建

### 插件开发

```typescript
// src/plugins/my-plugin/index.ts
export const myPlugin: Plugin = {
  meta: { id: "my-plugin", name: "My Plugin", version: "1.0.0" },
  async init(context: PluginInitContext) { },
  async getTools(context: PluginContext) { return [...]; },
  async onEvent(event, context) { },
};
```

通过 `context.capabilities.hasCapability()` 检查平台能力。

## 部署

当用户说"部署到 claw"时：
1. git add & commit
2. git push
3. claw "cd ~/pi-claw && git pull && pnpm build"

## 日志查看

```bash
# 服务器日志位置
~/.pi-claw/logs/
├── pi-claw.log      # 主日志
├── debug.log        # Debug 插件日志
└── pi-claw.error.log

# 常用命令
claw "cat ~/.pi-claw/logs/pi-claw.log | tail -100"
claw "cat ~/.pi-claw/logs/debug.log | tail -100"
```

## 配置

- 主配置: `~/.pi-claw/config.json`
- 启动文件: `~/.pi-claw/boot/` (soul.md, identity.md, tools.md, profile.md)
- 记忆: `~/.pi-claw/memory/memory.md`
- 频道数据: `~/.pi-claw/channels/{chatId}/`

# 绝不执行
- 不在本地运行
- 不使用pm2 进行管理
- 不管服务器的 pi-feishu 或 pi-mono 或 .pi 相关的内容
