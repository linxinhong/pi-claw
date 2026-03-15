# 飞书适配器改进笔记

> **创建时间**: 2026-03-14
> **目的**: 记录对 pi-claw 和 openclaw-lark 飞书消息处理差异的理解，以及改进方向

---

## 一、核心差异理解

### 1.1 设计理念不同

- **openclaw-lark**: 飞书专用插件，追求极致的飞书体验
- **pi-claw**: 多平台框架，飞书只是其中一个适配器

这导致了 openclaw-lark 在飞书特定功能上更深入，而 pi-claw 更注重通用性。

### 1.2 卡片处理方式

**openclaw-lark 的 CardKit 2.0**:
- 使用 `schema: '2.0'` 的流式卡片
- 可以只更新特定元素（`element_id`），实现打字机效果
- 有完整的状态机管理卡片生命周期
- 需要先创建卡片实体，再发送到会话

**pi-claw 的普通卡片**:
- 每次更新都是全量替换
- 通过节流（1秒）控制更新频率
- 状态管理简单，直接在 `FeishuPlatformContext` 中

### 1.3 消息保护机制

openclaw-lark 有 `UnavailableGuard`，这是一个很重要的保护机制：
- 当用户撤回/删除消息时，后续的卡片更新操作会失败
- 错误码 230011（撤回）和 231003（删除）
- 如果不处理，会导致日志刷屏和资源浪费

pi-claw 目前没有这个保护，需要添加。

### 1.4 思考内容解析

openclaw-lark 支持 AI 模型输出的思考标签：
- `<thinking>...</thinking>`
- `<antthinking>...</antthinking>`
- `Reasoning:\n...` 前缀

pi-claw 目前没有这个解析，导致思考内容可能混在回复中显示。

---

## 二、改进优先级

### P0 - 必须添加

#### 1. 消息不可用守卫

**问题**: 用户撤回消息后，AI 继续尝试更新卡片会报错

**解决方案**: 添加 `runWithMessageUnavailableGuard` 包装器

```typescript
// 位置: src/adapters/feishu/utils/unavailable-guard.ts
export async function runWithMessageUnavailableGuard({
  messageId,
  operation,
  fn,
}: {
  messageId: string;
  operation: string;
  fn: () => Promise<any>;
}): Promise<any> {
  try {
    return await fn();
  } catch (error: any) {
    if (error?.code === 230011 || error?.code === 231003) {
      // 消息已撤回或删除，静默终止
      console.debug(`Message ${messageId} unavailable (${operation})`);
      return null;
    }
    throw error;
  }
}
```

**使用位置**: `MessageSender.updateCard()` 和 `LarkClient` 相关方法

### P1 - 建议添加

#### 2. Thinking 标签解析

**问题**: AI 模型输出的思考内容没有正确分离显示

**解决方案**: 添加 `splitReasoningText` 函数

```typescript
// 位置: src/adapters/feishu/card/reasoning-parser.ts
export function splitReasoningText(text?: string): {
  reasoningText?: string;
  answerText?: string;
} {
  if (!text?.trim()) return {};

  // 支持的格式:
  // 1. <thinking>...</thinking>
  // 2. <antthinking>...</antthinking>
  // 3. Reasoning:\n...

  const thinkingMatch = text.match(/<(?:thinking|antthinking)>([\s\S]*?)<\/\1>/);
  if (thinkingMatch) {
    return {
      reasoningText: thinkingMatch[1].trim(),
      answerText: text.replace(/<(?:thinking|antthinking)>[\s\S]*?<\/\1>/, '').trim(),
    };
  }

  if (text.startsWith('Reasoning:\n')) {
    const lines = text.split('\n');
    return {
      reasoningText: lines.slice(1).join('\n'),
      answerText: '', // Reasoning 前缀格式通常全部是思考内容
    };
  }

  return { answerText: text };
}
```

#### 3. 错误码常量定义

**问题**: 错误码散落在代码各处，不易维护

**解决方案**: 统一定义

```typescript
// 位置: src/adapters/feishu/constants/errors.ts
export const LARK_ERROR = {
  // 权限相关
  APP_SCOPE_MISSING: 99991672,
  USER_SCOPE_INSUFFICIENT: 99991679,
  TOKEN_INVALID: 99991668,
  TOKEN_EXPIRED: 99991669,

  // 消息相关
  MESSAGE_RECALLED: 230011,
  MESSAGE_DELETED: 231003,

  // 速率限制
  RATE_LIMITED: 230020,
} as const;

export const MESSAGE_TERMINAL_CODES = new Set([
  LARK_ERROR.MESSAGE_RECALLED,
  LARK_ERROR.MESSAGE_DELETED,
]);
```

### P2 - 可选增强

#### 4. CardKit 2.0 支持

**收益**: 更好的流式体验（打字机效果）

**成本**:
- 需要引入 CardKit API 封装
- 状态机管理增加复杂度
- 可能需要飞书后台开通权限

**建议**: 当前节流机制已基本够用，除非有明确的用户体验要求，否则暂不引入

#### 5. 完整 OAuth Device Flow

**收益**: 完整的用户授权流程

**成本**:
- 需要存储用户 token
- 需要处理 token 过期刷新
- 实现复杂度高

**建议**: 根据实际授权需求评估，当前简单提示可能足够

---

## 三、实现计划

### 第一阶段：基础增强

1. 添加 `unavailable-guard.ts`
2. 添加 `reasoning-parser.ts`
3. 添加 `errors.ts` 常量
4. 集成到 `MessageSender` 和 `FeishuPlatformContext`

### 第二阶段：体验优化

1. 改进卡片 Footer 显示（状态标签）
2. 添加思考耗时统计
3. 优化错误卡片显示（红色标识）

### 第三阶段：评估 CardKit

1. 调研飞书 CardKit 2.0 的开通条件
2. 评估打字机效果的用户体验提升
3. 决定是否引入完整 CardKit 支持

---

## 四、关键文件

需要修改的文件：
- `src/adapters/feishu/messaging/outbound/sender.ts` - 添加消息保护
- `src/adapters/feishu/card/builder.ts` - 添加思考解析
- `src/adapters/feishu/context.ts` - 集成改进

需要新增的文件：
- `src/adapters/feishu/utils/unavailable-guard.ts`
- `src/adapters/feishu/card/reasoning-parser.ts`
- `src/adapters/feishu/constants/errors.ts`

---

## 五、参考资源

- openclaw-lark 源码: `/Users/linxinhong/projects/pi-mono-work/openclaw-lark`
- 飞书卡片开发文档: https://open.feishu.cn/document/client-docs/bot-v3/card-create
- CardKit 2.0 文档: https://open.feishu.cn/document/client-docs/bot-v3/card-kit

---

*最后更新: 2026-03-14*
