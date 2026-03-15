# 飞书插件消息回复逻辑详解

## 一、Reply-To 功能的使用

### 1.1 核心实现位置

**关键文件：** `src/messaging/outbound/send.ts:108-126`

```typescript
if (replyToMessageId) {
  // 规范化 message_id，处理合成 ID（如 "om_xxx:auth-complete"）
  const normalizedId = normalizeMessageId(replyToMessageId);
  const response = await client.im.message.reply({
    path: { message_id: normalizedId },
    data: {
      content: contentPayload,
      msg_type: 'post',
      reply_in_thread: replyInThread,
    },
  });
}
```

### 1.2 使用场景

| 场景 | replyToMessageId | replyInThread |
|------|------------------|---------------|
| 普通消息回复 | 用户消息 ID | false |
| 话题内回复 | 话题根消息 ID | true |
| 授权卡片 | 触发授权的消息 ID | 根据是否有 threadId |
| 流式卡片 | 用户消息 ID | 根据是否有 threadId |

### 1.3 特殊处理

- **合成消息 ID**：支持 `om_xxx:auth-complete` 格式，用于授权完成后通知 AI 继续执行
- **消息规范化**：`normalizeMessageId()` 函数处理各种 ID 格式

---

## 二、卡片 2.0 (Card 2.0) 的使用时机

### 2.1 版本识别

**关键文件：** `src/card/builder.ts:473-481`

```typescript
export function toCardKit2(card: FeishuCard): Record<string, unknown> {
  return {
    schema: '2.0',  // Card 2.0 标识
    config: card.config,
    body: { elements: card.elements },  // 使用 body.elements 而非顶层 elements
    ...
  };
}
```

### 2.2 使用时机

**关键文件：** `src/card/reply-dispatcher.ts:50-58`

```typescript
// 回复模式解析
const effectiveReplyMode = resolveReplyMode({ feishuCfg, chatType });
const replyMode = expandAutoMode({
  mode: effectiveReplyMode,
  streaming: feishuCfg?.streaming,
  chatType,
});
const useStreamingCards = replyMode === 'streaming';
```

| 模式 | 场景 | 卡片类型 |
|------|------|----------|
| streaming | 私聊（auto 默认） | CardKit 2.0 流式卡片 |
| streaming | 配置显式指定 | CardKit 2.0 流式卡片 |
| static | 群聊（auto 默认） | 静态卡片/文本 |
| static | 代码块/表格内容 | Markdown 卡片 |

### 2.3 卡片状态流转

**关键文件：** `src/card/streaming-card-controller.ts`

```
idle → creating → streaming → completed
                  ↘ aborted
                  ↘ terminated (消息被撤回/删除)
                  ↘ creation_failed (降级到静态模式)
```

### 2.4 CardKit 流式卡片流程

```typescript
// 1. 创建卡片实体
const cardId = await createCardEntity({ cfg, card: STREAMING_THINKING_CARD, accountId });

// 2. 发送卡片到会话
await sendCardByCardId({ cfg, to: chatId, cardId, replyToMessageId });

// 3. 流式更新内容（打字机效果）
await streamCardContent({ cfg, cardId, elementId: STREAMING_ELEMENT_ID, content });

// 4. 关闭流式模式并更新最终卡片
await setCardStreamingMode({ cfg, cardId, streamingMode: false });
await updateCardKitCard({ cfg, cardId, card: finalCard });
```

---

## 三、授权卡片的发送条件

### 3.1 授权错误类型

**关键文件：** `src/core/tool-client.ts` + `src/tools/auto-auth.ts`

| 错误类型 | 触发条件 | 处理方式 |
|----------|----------|----------|
| `UserAuthRequiredError` | 用户未授权，app scope 已验证 | 发起 OAuth Device Flow |
| `UserScopeInsufficientError` | 用户 token scope 不足（99991679） | 发起 OAuth Device Flow |
| `AppScopeMissingError` | 应用缺少必要权限 | 发送应用权限引导卡片 |

### 3.2 授权流程（Device Flow）

**关键文件：** `src/tools/oauth.ts` + `src/tools/oauth-cards.ts`

```
1. requestDeviceAuthorization() 获取设备码
      ↓
2. buildAuthCard() 构建授权卡片
      ↓
3. sendCardByCardId() 发送卡片
      ↓
4. pollDeviceToken() 轮询等待授权
      ↓
5. verifyTokenIdentity() 验证身份
      ↓
6. saveUserToken() 保存 token
      ↓
7. updateCardKitCard() 更新卡片为成功状态
      ↓
8. 发送合成消息通知 AI 继续执行
```

### 3.3 授权卡片类型

**关键文件：** `src/tools/oauth-cards.ts`

```typescript
// 用户授权请求卡片
buildAuthCard({
  verificationUriComplete,  // 授权链接
  expiresMin,               // 过期时间
  scope,                    // 所需权限
  isBatchAuth,             // 是否批量授权
});

// 授权成功卡片
buildAuthSuccessCard();

// 授权失败卡片（过期）
buildAuthFailedCard(reason);

// 身份不匹配卡片
buildAuthIdentityMismatchCard();
```

### 3.4 防抖与合并机制

**关键文件：** `src/tools/auto-auth.ts:129-243`

```typescript
// 防抖缓冲区设计（两阶段）
// collecting（收集阶段）：50ms 防抖窗口，合并 scope
// executing（执行阶段）：flushFn 正在运行，后续请求复用同一结果

const AUTH_DEBOUNCE_MS = 50;         // 应用授权防抖
const AUTH_USER_DEBOUNCE_MS = 150;   // 用户授权防抖（更长，确保应用权限卡片先发出）
const AUTH_UPDATE_DEBOUNCE_MS = 500; // Scope 更新防抖
const AUTH_COOLDOWN_MS = 30_000;     // 冷却期，防止重复卡片
```

---

## 四、思考逻辑（Thinking）的显示

### 4.1 思考内容识别

**关键文件：** `src/card/builder.ts:72-161`

```typescript
// 支持两种格式
// 1. "Reasoning:\n_italic line_\n..." 前缀格式
// 2. <thinking>...</thinking> / <antthinking>...</antthinking> XML 标签格式

export function splitReasoningText(text?: string): {
  reasoningText?: string;
  answerText?: string;
}
```

### 4.2 流式思考显示

**关键文件：** `src/card/streaming-card-controller.ts:290-307`

```typescript
async onReasoningStream(payload: ReplyPayload) {
  // 思考阶段：显示 💭 **Thinking...** + 思考内容
  this.reasoning.isReasoningPhase = true;
  this.reasoning.accumulatedReasoningText = split.reasoningText;
  await this.throttledCardUpdate();
}
```

### 4.3 完成时思考显示

**关键文件：** `src/card/builder.ts:299-330`

```typescript
// 使用 collapsible_panel 折叠面板
if (reasoningText) {
  elements.push({
    tag: 'collapsible_panel',
    expanded: false,  // 默认收起
    header: {
      title: { tag: 'markdown', content: `💭 Thought for ${duration}` },
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined' },
    },
    elements: [
      { tag: 'markdown', content: reasoningText, text_size: 'notation' },
    ],
  });
}
```

---

## 五、错误信息处理

### 5.1 错误类型体系

**关键文件：** `src/core/auth-errors.ts`

```typescript
// 授权相关错误
class NeedAuthorizationError extends Error {}
class AppScopeMissingError extends Error {}
class UserAuthRequiredError extends Error {}
class UserScopeInsufficientError extends Error {}
```

### 5.2 错误卡片显示

**关键文件：** `src/card/streaming-card-controller.ts:345-383`

```typescript
async onError(err: unknown, info: { kind: string }) {
  // 构建错误卡片
  const errorText = this.text.accumulatedText
    ? `${this.text.accumulatedText}\n\n---\n**Error**: An error occurred.`
    : '**Error**: An error occurred.';

  const errorCard = buildCardContent('complete', {
    text: errorText,
    isError: true,  // Footer 显示红色"出错"
    footer: this.deps.resolvedFooter,
  });

  await this.closeStreamingAndUpdate(cardId, errorCard);
}
```

### 5.3 消息不可用守卫

**关键文件：** `src/card/unavailable-guard.ts` + `src/core/message-unavailable.ts`

```typescript
// 检测消息撤回/删除状态
// 错误码：230011（撤回）、231003（删除）

export function runWithMessageUnavailableGuard({
  messageId,
  operation,
  fn,
}) {
  // 缓存 30 分钟，避免重复检测
  // 终止后续操作，避免报错刷屏
}
```

### 5.4 Footer 状态显示

**关键文件：** `src/card/builder.ts:354-373`

```typescript
// Footer meta-info
if (footer?.status) {
  if (isError) {
    parts.push('出错');  // 红色显示
  } else if (isAborted) {
    parts.push('已停止');
  } else {
    parts.push('已完成');
  }
}

if (footer?.elapsed && elapsedMs != null) {
  parts.push(`耗时 ${formatElapsed(elapsedMs)}`);
}
```

---

## 六、关键文件路径总结

```
src/
├── card/
│   ├── reply-dispatcher.ts        # 回复分发器工厂
│   ├── streaming-card-controller.ts # 流式卡片控制器
│   ├── builder.ts                 # 卡片构建器
│   ├── cardkit.ts                 # CardKit API 封装
│   └── unavailable-guard.ts       # 消息不可用守卫
│
├── messaging/
│   ├── inbound/
│   │   ├── handler.ts             # 消息处理入口
│   │   └── dispatch.ts            # 消息分发
│   └── outbound/
│       ├── send.ts                # 消息发送
│       └── deliver.ts             # 消息投递
│
├── tools/
│   ├── oauth.ts                   # OAuth 工具
│   ├── oauth-cards.ts             # 授权卡片构建
│   └── auto-auth.ts               # 自动授权处理
│
└── core/
    ├── auth-errors.ts             # 授权错误定义
    ├── api-error.ts               # API 错误处理
    └── message-unavailable.ts     # 消息不可用处理
```

---

*文档生成时间：2026-03-14*
