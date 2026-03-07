# Hook 系统

pi-claw 的 Hook 系统是一个统一的事件处理机制，支持中间件模式、优先级控制、短路拦截等特性。

## 目录

- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [API 参考](#api-参考)
- [Hook 名称列表](#hook-名称列表)
- [最佳实践](#最佳实践)
- [测试指南](#测试指南)

## 快速开始

```typescript
import { getHookManager, HOOK_NAMES } from "@linxinhong/pi-claw";

const hookManager = getHookManager();

// 注册一个消息接收 hook
hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (context, next) => {
  console.log(`收到消息: ${context.text}`);
  return next(); // 继续执行下一个 handler
});

// 触发 hook
await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
  channelId: "channel-123",
  text: "你好",
  timestamp: new Date(),
});
```

## 核心概念

### 两种 Handler 类型

#### SerialHookHandler（串行模式）

用于需要控制执行链的场景，支持 `next()` 调用和短路拦截。

```typescript
type SerialHookHandler<TContext, TResult> = (
  context: TContext,
  next: () => Promise<HookResult<TResult>>
) => Promise<HookResult<TResult>>;
```

**特点：**
- 支持中间件链式调用
- 可以短路拦截（返回 `continue: false`）
- 可以修改 context（通过 `result.data`）
- 按优先级顺序执行

#### ParallelHookHandler（并行模式）

用于通知类场景，所有 handler 并行执行，不支持拦截。

```typescript
type ParallelHookHandler<TContext> = (
  context: TContext
) => Promise<void>;
```

**特点：**
- 所有 handler 并行执行
- 不支持 `next()` 调用
- 不能拦截执行
- 适用于事件通知

### HookResult 结构

```typescript
interface HookResult<T = unknown> {
  /** 是否继续执行后续 handler */
  continue: boolean;

  /** 修改后的数据（会被 merge 回 context） */
  data?: T;

  /** 错误信息 */
  error?: Error;

  /**
   * 是否为主动拦截
   * - true: handler 主动拦截请求
   * - undefined: 正常完成或异常
   */
  blocked?: boolean;
}
```

### blocked 字段说明

`blocked` 字段用于区分**主动拦截**和**异常情况**：

| 场景 | continue | blocked | error |
|------|----------|---------|-------|
| 正常完成 | true | undefined | undefined |
| 主动拦截 | false | true | undefined |
| 发生异常 | false | undefined | Error |

**使用示例：**

```typescript
// 权限检查 - 主动拦截
hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
  if (!ctx.userId) {
    return {
      continue: false,
      blocked: true,  // 标记为主动拦截
    };
  }
  return next();
});

// 处理结果
const result = await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, context);

if (result.blocked) {
  console.log("请求被主动拦截");
} else if (result.error) {
  console.log("发生异常:", result.error.message);
}
```

### data 字段与 context 修改

当 handler 返回 `data` 时，会自动 merge 回原始 context：

```typescript
interface MyContext {
  channelId: string;
  text: string;
  processed?: boolean;
}

hookManager.on<MyContext>(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
  const result = await next();
  return {
    ...result,
    data: { processed: true },  // 会被 merge 到 ctx
  };
});

const context: MyContext = { channelId: "x", text: "hello" };
await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, context);

console.log(context.processed);  // true
```

## API 参考

### HookManager

#### 注册方法

##### on()

注册一个 hook handler。

```typescript
on<TContext, TResult>(
  name: HookName,
  handler: SerialHookHandler<TContext, TResult>,
  options?: HookOptions
): () => void
```

**参数：**
- `name`: Hook 名称
- `handler`: 处理函数
- `options`: 配置选项

**HookOptions:**
```typescript
interface HookOptions {
  /** 优先级（数字越小越先执行，默认 10） */
  priority?: number;

  /** 是否只执行一次 */
  once?: boolean;

  /** 来源标识（用于批量清理） */
  source?: string;
}
```

**返回值：** 取消注册的函数

```typescript
const unsubscribe = hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, handler);

// 取消注册
unsubscribe();
```

##### once()

注册一次性 hook，执行后自动移除。

```typescript
once<TContext, TResult>(
  name: HookName,
  handler: SerialHookHandler<TContext, TResult>,
  options?: Omit<HookOptions, "once">
): () => void
```

#### 触发方法

##### emit()

串行触发 hook（中间件模式）。

```typescript
async emit<TContext, TResult>(
  name: HookName,
  context: TContext
): Promise<HookResult<TResult>>
```

##### emitParallel()

并行触发 hook（通知模式）。

```typescript
async emitParallel<TContext>(
  name: HookName,
  context: TContext
): Promise<void>
```

##### emitSync()

同步触发 hook（高频场景优化）。

```typescript
emitSync<TContext>(
  name: HookName,
  context: TContext
): HookResult
```

#### 查询方法

##### hasHooks()

检查是否有注册的 handler。

```typescript
hasHooks(name: HookName): boolean
```

##### hookCount()

获取 handler 数量。

```typescript
hookCount(name: HookName): number
```

#### 清理方法

##### off()

取消指定 ID 的 hook。

```typescript
off(name: HookName, id: string): void
```

##### clear()

清除指定名称的所有 hook。

```typescript
clear(name: HookName): void
```

##### clearBySource()

清除指定来源的所有 hook。

```typescript
clearBySource(source: string): void
```

##### clearAll()

清除所有 hook。

```typescript
clearAll(): void
```

### 全局函数

##### getHookManager()

获取全局 HookManager 单例。

```typescript
function getHookManager(): HookManager
```

##### resetHookManager()

重置全局 HookManager（用于测试）。

```typescript
function resetHookManager(): void
```

##### withCleanHookManager()

在干净的 HookManager 环境中执行测试。

```typescript
async function withCleanHookManager<T>(
  fn: () => Promise<T>
): Promise<T>
```

## Hook 名称列表

### 系统生命周期

| Hook 名称 | 常量 | 触发时机 |
|-----------|------|---------|
| `system:before-start` | `SYSTEM_BEFORE_START` | Bot 创建前 |
| `system:ready` | `SYSTEM_READY` | 所有 Bot 启动后 |
| `system:shutdown` | `SYSTEM_SHUTDOWN` | 系统关闭时 |

**Context 类型：** `SystemHookContext`

```typescript
interface SystemHookContext {
  timestamp: Date;
  version?: string;
  config?: Record<string, unknown>;
}
```

### 插件生命周期

| Hook 名称 | 常量 | 触发时机 |
|-----------|------|---------|
| `plugin:load` | `PLUGIN_LOAD` | 插件加载时 |
| `plugin:unload` | `PLUGIN_UNLOAD` | 插件卸载时 |

**Context 类型：** `PluginHookContext`

```typescript
interface PluginHookContext {
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  timestamp: Date;
}
```

### 适配器生命周期

| Hook 名称 | 常量 | 触发时机 |
|-----------|------|---------|
| `adapter:connect` | `ADAPTER_CONNECT` | 适配器连接时 |
| `adapter:disconnect` | `ADAPTER_DISCONNECT` | 适配器断开时 |

**Context 类型：** `AdapterHookContext`

```typescript
interface AdapterHookContext {
  platform: string;
  timestamp: Date;
}
```

### 消息生命周期

| Hook 名称 | 常量 | 触发时机 |
|-----------|------|---------|
| `message:receive` | `MESSAGE_RECEIVE` | 收到消息时 |
| `message:send` | `MESSAGE_SEND` | 发送消息前 |
| `message:sent` | `MESSAGE_SENT` | 发送消息后 |

**Context 类型：**

```typescript
interface MessageHookContext {
  channelId: string;
  messageId?: string;
  text: string;
  userId?: string;
  userName?: string;
  timestamp: Date;
}

interface MessageSentContext extends MessageHookContext {
  messageId: string;
  success: boolean;
  error?: string;
}
```

### 会话生命周期

| Hook 名称 | 常量 | 触发时机 |
|-----------|------|---------|
| `session:create` | `SESSION_CREATE` | 会话创建时 |
| `session:destroy` | `SESSION_DESTROY` | 会话销毁时 |

**Context 类型：** `SessionHookContext`

```typescript
interface SessionHookContext {
  channelId: string;
  sessionId: string;
  timestamp: Date;
}
```

### 事件调度

| Hook 名称 | 常量 | 触发时机 |
|-----------|------|---------|
| `event:trigger` | `EVENT_TRIGGER` | 事件触发前 |
| `event:triggered` | `EVENT_TRIGGERED` | 事件触发后 |

**Context 类型：**

```typescript
interface EventTriggerContext {
  eventType: "immediate" | "one-shot" | "periodic";
  channelId: string;
  text: string;
  eventId?: string;
  timestamp: Date;
}

interface EventTriggeredContext extends EventTriggerContext {
  success: boolean;
  error?: string;
  duration: number;
}
```

### 工具调用

| Hook 名称 | 常量 | 触发时机 |
|-----------|------|---------|
| `tool:call` | `TOOL_CALL` | 工具调用前 |
| `tool:called` | `TOOL_CALLED` | 工具调用后 |

**Context 类型：**

```typescript
interface ToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  channelId: string;
  timestamp: Date;
}

interface ToolCalledContext extends ToolCallContext {
  result: unknown;
  success: boolean;
  error?: string;
  duration: number;
}
```

## 最佳实践

### 1. 选择正确的触发方法

```typescript
// 需要拦截能力 → emit
const result = await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, context);
if (!result.continue) {
  // 处理拦截
}

// 仅通知 → emitParallel
await hookManager.emitParallel(HOOK_NAMES.MESSAGE_SENT, context);

// 高频场景 → emitSync
const result = hookManager.emitSync(HOOK_NAMES.MESSAGE_RECEIVE, context);
```

### 2. 使用 source 标识批量清理

```typescript
// 插件注册时使用 source
hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, handler, { source: "my-plugin" });

// 插件卸载时批量清理
hookManager.clearBySource("my-plugin");
```

### 3. 优先级控制

```typescript
// 高优先级（先执行）
hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, authCheck, { priority: 1 });

// 普通优先级
hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, processMessage, { priority: 10 });

// 低优先级（后执行）
hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, logMessage, { priority: 100 });
```

### 4. 惰性触发优化

```typescript
// 先检查是否有 handler，避免空 emit 的开销
if (hookManager.hasHooks(HOOK_NAMES.MESSAGE_RECEIVE)) {
  await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, context);
}
```

### 5. 正确区分拦截和异常

```typescript
hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
  // 权限检查失败 → 主动拦截
  if (!hasPermission(ctx.userId)) {
    return { continue: false, blocked: true };
  }

  // 正常处理
  try {
    return await next();
  } catch (error) {
    // 异常情况（不要手动设置 blocked）
    throw error;
  }
});
```

## 测试指南

### 使用 withCleanHookManager

```typescript
import { withCleanHookManager, getHookManager, HOOK_NAMES } from "@linxinhong/pi-claw";

describe("My Plugin", () => {
  it("should handle message", async () => {
    await withCleanHookManager(async () => {
      const hookManager = getHookManager();

      let received = false;
      hookManager.on(HOOK_NAMES.MESSAGE_RECEIVE, async (ctx, next) => {
        received = true;
        return next();
      });

      await hookManager.emit(HOOK_NAMES.MESSAGE_RECEIVE, {
        channelId: "test",
        text: "hello",
        timestamp: new Date(),
      });

      expect(received).toBe(true);
    });
    // withCleanHookManager 结束后自动重置
  });
});
```

### 手动重置

```typescript
import { getHookManager, resetHookManager, HOOK_NAMES } from "@linxinhong/pi-claw";

describe("My Plugin", () => {
  beforeEach(() => {
    resetHookManager();
  });

  afterEach(() => {
    resetHookManager();
  });

  it("should work", async () => {
    const hookManager = getHookManager();
    // ... 测试代码
  });
});
```

## 迁移指南

### 从旧版 SYSTEM_STARTUP 迁移

`SYSTEM_STARTUP` 已弃用，请根据需求选择：

```typescript
// 旧代码（已弃用）
hookManager.on(HOOK_NAMES.SYSTEM_STARTUP, async (ctx, next) => {
  // 在 bot 创建前执行
  return next();
});

// 新代码 - Bot 创建前
hookManager.on(HOOK_NAMES.SYSTEM_BEFORE_START, async (ctx, next) => {
  // 配置检查、资源准备等
  return next();
});

// 新代码 - 所有 Bot 启动后
hookManager.on(HOOK_NAMES.SYSTEM_READY, async (ctx, next) => {
  // 开始处理业务逻辑
  return next();
});
```

### 从旧版 HookHandler 迁移

```typescript
// 旧代码（仍然兼容）
import { HookHandler } from "@linxinhong/pi-claw";

// 新代码 - 明确类型
import { SerialHookHandler, ParallelHookHandler } from "@linxinhong/pi-claw";

// 串行模式（支持 next 和拦截）
const serialHandler: SerialHookHandler<MessageHookContext> = async (ctx, next) => {
  return next();
};

// 并行模式（仅通知）
const parallelHandler: ParallelHookHandler<MessageSentContext> = async (ctx) => {
  console.log("消息已发送");
};
```
