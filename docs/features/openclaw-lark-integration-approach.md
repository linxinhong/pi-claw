# Pi-Claw 集成 OpenClaw-Lark 插件思路记录

> 记录者: Kimi Code CLI  
> 时间: 2026-03-14  
> 背景: 用户希望直接使用官方 openclaw-lark 插件，避免重复开发飞书消息处理能力

---

## 核心问题

如何在 pi-claw 架构中直接使用 `@larksuite/openclaw-lark` 官方插件？

### 架构差异分析

| 组件 | pi-claw | OpenClaw |
|------|---------|----------|
| 平台抽象 | `PlatformAdapter` | `ChannelPlugin` |
| 配置系统 | 自定义 JSON | `ClawdbotConfig` |
| 运行时 | `UnifiedBot` + `CoreAgent` | `PluginRuntime` |
| 消息发送 | `PlatformContext` 方法 | `ChannelOutboundAdapter` |
| 插件接口 | 自有接口 | `OpenClawPluginApi` |

---

## 解决方案思路

### 方案一: OpenClaw 兼容层（推荐）

创建一个适配层，模拟 OpenClaw 的核心 API，让 openclaw-lark 插件可以在 pi-claw 环境中正常运行。

```
┌─────────────────────────────────────────────────────────────────┐
│                         pi-claw                                  │
│  ┌─────────────────┐      ┌─────────────────────────────────┐  │
│  │   UnifiedBot    │──────▶  OpenClawCompatibilityLayer     │  │
│  │                 │      │  (适配器核心)                    │  │
│  └─────────────────┘      └─────────────────────────────────┘  │
│           │                              │                      │
│           ▼                              ▼                      │
│  ┌─────────────────┐      ┌─────────────────────────────────┐  │
│  │  FeishuAdapter  │      │   openclaw-lark (官方插件)       │  │
│  │  (简化为代理)    │◀─────│   - StreamingCardController     │  │
│  └─────────────────┘      │   - CardKit API                 │  │
│                           │   - OAuth Device Flow           │  │
│                           │   - MessageUnavailableGuard     │  │
│                           └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### 需要实现的核心适配模块

1. **ConfigAdapter** - 将 pi-claw 配置转换为 `ClawdbotConfig`
2. **RuntimeAdapter** - 实现 `PluginRuntime` 接口
3. **PluginApiAdapter** - 实现 `OpenClawPluginApi` 接口
4. **OutboundAdapter** - 桥接 `ChannelOutboundAdapter` 到 pi-claw 消息系统
5. **MessageConverter** - 消息格式双向转换

#### 关键类型映射

```typescript
// pi-claw → OpenClaw
{
  "appId": "cli_xxx",
  "appSecret": "xxx", 
  "domain": "feishu"
}
↓
{
  "channels": {
    "feishu": {
      "accounts": {
        "default": {
          "appId": "cli_xxx",
          "appSecret": "xxx",
          "brand": "feishu"
        }
      }
    }
  }
}
```

#### 消息流设计

**入站消息流:**
```
WebSocket (openclaw-lark 网关)
    ↓
FeishuPlugin.gateway.startAccount()
    ↓
消息转换器 (MessageContext → UniversalMessage)
    ↓
UnifiedBot.handleMessage()
```

**出站消息流:**
```
CoreAgent 响应
    ↓
PlatformContext.sendText/card
    ↓
ChannelOutboundAdapter 桥接
    ↓
openclaw-lark 发送函数
    ↓
飞书 API
```

### 方案二: 代码复用

不引入 openclaw-lark 插件，而是将其核心代码提取并移植到 pi-claw。

**优点:**
- 无额外运行时依赖
- 完全控制代码
- 无兼容性问题

**缺点:**
- 需要手动同步官方更新
- 代码维护负担
- 可能遗漏功能

### 方案三: 功能子集

只引入最需要的功能（如 StreamingCardController），其他保持现有实现。

**优点:**
- 工作量小
- 风险低
- 渐进式增强

**缺点:**
- 无法享受完整功能
- 可能需要多次集成工作

---

## 推荐方案

**方案一（OpenClaw 兼容层）** 是长期可持续的选择：

1. **完整性** - 复用官方插件的全部功能
2. **可维护** - 通过 npm 更新获得官方改进
3. **低侵入** - 对 pi-claw 现有架构改动最小
4. **可回退** - 保留原有实现作为备份

---

## 实施路径

### Phase 1: 基础设施 (2-3天)
- 创建适配层目录结构
- 实现类型定义和配置适配
- 实现运行时适配
- 安装依赖并验证基础集成

### Phase 2: 消息流入站 (3-4天)
- 集成 openclaw-lark 的 WebSocket 网关
- 实现消息转换器
- 连接 UnifiedBot 消息处理

### Phase 3: 消息流出站 (3-4天)
- 实现 ChannelOutboundAdapter 桥接
- 支持文本、卡片、媒体消息
- 支持 reply-to 和 thread 回复

### Phase 4: 流式响应 (2-3天)
- 复用 StreamingCardController
- 桥接 pi-claw 流式输出到 CardKit API
- 支持思考内容显示

### Phase 5: 高级功能 (2-3天)
- OAuth Device Flow 集成
- 工具暴露给 CoreAgent
- MessageUnavailableGuard 集成

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| API 不兼容 | 高 | 完整适配层，覆盖所有必要接口 |
| 调试困难 | 中 | 详细日志，开发模式检测 |
| 启动变慢 | 中 | 懒加载，缓存编译模块 |
| 官方更新 | 中 | 锁定版本，定期升级测试 |

---

## 关键依赖

```json
{
  "dependencies": {
    "@larksuite/openclaw-lark": "^2026.3.12",
    "@larksuiteoapi/node-sdk": "^1.59.0"
  }
}
```

---

## 决策建议

如果需要 **快速获得成熟的飞书消息处理能力**，推荐实施 **方案一**。

如果 **时间和资源有限**，可以先实施 **方案三**（功能子集），只引入 StreamingCardController 等核心功能。

如果 **希望完全控制代码**，选择 **方案二**，但需要投入持续维护成本。

---

## 补充思考

### 为什么不直接替换 FeishuAdapter？

pi-claw 的 `PlatformAdapter` 接口是核心抽象，保持它的独立性很重要：
1. 支持未来可能的其他平台（微信、Discord 等）
2. 与 CoreAgent 的集成逻辑保持不变
3. 可以灵活切换原生实现和 openclaw-lark 实现

### 配置如何兼容？

建议新增配置选项 `feishu.adapter`，让用户选择：
```json
{
  "feishu": {
    "adapter": "openclaw",  // "native" | "openclaw"
    // ... 其他配置
  }
}
```

这样可以在新旧实现间平滑切换。

---

*此文档记录了集成 openclaw-lark 插件到 pi-claw 的完整思路，供后续参考。*
