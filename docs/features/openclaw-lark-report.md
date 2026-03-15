# OpenClark Lark/Feishu 插件消息回复逻辑分析报告

> **学习来源**: `/Users/linxinhong/projects/pi-mono-work/openclaw-lark`

---

## 1. Reply-to 功能实现

### 核心代码位置
- **绝对路径**: `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/messaging/outbound/send.ts`
- **相对路径**: `src/messaging/outbound/send.ts`
- **说明**: 消息发送的核心实现

### 实现逻辑
插件**确实支持 reply-to 功能**，通过 `replyToMessageId` 参数实现：

```typescript
// send.ts 第 76-158 行
export async function sendMessageFeishu(params: SendFeishuMessageParams): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId, mentions, accountId, replyInThread } = params;
  
  if (replyToMessageId) {
    // 规范化 message_id，处理合成 ID（如 "om_xxx:auth-complete"）
    const normalizedId = normalizeMessageId(replyToMessageId);
    const response = await runWithMessageUnavailableGuard({
      messageId: normalizedId,
      operation: 'im.message.reply(post)',
      fn: () =>
        client.im.message.reply({
          path: { message_id: normalizedId! },
          data: {
            content: contentPayload,
            msg_type: 'post',
            reply_in_thread: replyInThread,  // 支持在话题中回复
          },
        }),
    });
    return {
      messageId: response?.data?.message_id ?? '',
      chatId: response?.data?.chat_id ?? '',
    };
  }
  // ... 新消息发送逻辑
}
```

### 关键特性
1. **消息ID规范化**：`normalizeMessageId()` 处理合成ID（如 `"om_xxx:auth-complete"`）
2. **话题回复支持**：`replyInThread` 参数控制是否在话题中回复
3. **消息不可用保护**：`runWithMessageUnavailableGuard` 处理消息被撤回/删除的情况

---

## 2. 卡片 2.0 能力使用时机

### 核心代码位置
- **绝对路径**: 
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/card/builder.ts` - 卡片构建器
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/card/streaming-card-controller.ts` - 流式卡片控制器
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/card/reply-mode.ts` - 回复模式解析

### 卡片状态定义
```typescript
// builder.ts 第 54 行
export type CardState = 'thinking' | 'streaming' | 'complete' | 'confirm';
```

### 何时使用卡片 2.0

#### 2.1 回复模式决定
```typescript
// reply-mode.ts 第 28-45 行
export function resolveReplyMode(params: {
  feishuCfg: FeishuConfig | undefined;
  chatType?: 'p2p' | 'group';
}): ReplyModeValue {
  // streaming 布尔总开关：仅 true 时允许流式，未设置或 false 一律 static
  if (feishuCfg?.streaming !== true) return 'static';
  // ...
}
```

**使用卡片 2.0 的条件：**
- 配置 `streaming: true` 启用流式模式
- `replyMode` 为 `'streaming'` 或 `'auto'`（在私聊中自动选择流式）

#### 2.2 静态模式下的卡片使用
```typescript
// reply-mode.ts 第 77-87 行
export function shouldUseCard(text: string): boolean {
  // Fenced code blocks
  if (/```[\s\S]*?```/.test(text)) {
    return true;
  }
  // Markdown tables
  if (/\|.+
+\|[-:| ]+\|/.test(text)) {
    return true;
  }
  return false;
}
```

**静态模式下使用卡片的条件：**
- 消息包含代码块（```）
- 消息包含 Markdown 表格

### 卡片 2.0 初始状态
```typescript
// streaming-card-controller.ts 第 50-78 行
const STREAMING_THINKING_CARD = {
  schema: '2.0',  // 卡片 2.0 标识
  config: {
    streaming_mode: true,
    summary: { content: '思考中...' },
  },
  body: {
    elements: [
      {
        tag: 'markdown',
        content: '',
        element_id: STREAMING_ELEMENT_ID,  // 'streaming_content'
      },
      // ... 加载图标
    ],
  },
} as const;
```

---

## 3. 授权卡片发送时机

### 核心代码位置
- **绝对路径**:
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/tools/oauth-cards.ts` - 授权卡片构建
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/tools/oauth.ts` - OAuth 授权流程

### 授权卡片类型
1. **`buildAuthCard`** - 初始授权请求卡片
2. **`buildAuthSuccessCard`** - 授权成功卡片
3. **`buildAuthFailedCard`** - 授权失败/过期卡片
4. **`buildAuthIdentityMismatchCard`** - 身份不匹配卡片

### 何时发送授权卡片

#### 3.1 自动触发场景
```typescript
// oauth.ts 第 278-343 行
// 1. 检查用户是否已授权 + scope 覆盖
const existing = forceAuth ? null : await getStoredToken(appId, senderOpenId);
if (existing && tokenStatus(existing) !== 'expired') {
  // 如果请求了特定 scope，检查是否已覆盖
  if (effectiveScope) {
    const requestedScopes = effectiveScope.split(/\s+/).filter(Boolean);
    const grantedScopes = new Set((existing.scope ?? '').split(/\s+/).filter(Boolean));
    const missingScopes = requestedScopes.filter((s) => !grantedScopes.has(s));
    
    if (missingScopes.length > 0) {
      // scope 不足 → 继续走 Device Flow（发送授权卡片）
    }
  }
}
```

**触发条件：**
1. 用户未授权（无 UAT token）
2. Token 已过期
3. 所需 scope 超出已授权范围（增量授权）
4. `forceAuth=true` 强制重新授权

#### 3.2 授权流程中的卡片更新
```typescript
// oauth.ts 第 531-711 行
pollDeviceToken({...})
  .then(async (result) => {
    if (result.ok) {
      // 验证身份通过后，更新卡片为成功状态
      await updateCardKitCardForAuth({
        cfg,
        cardId,
        card: buildAuthSuccessCard(),
        sequence: ++seq,
        accountId,
      });
    } else {
      // 授权失败，更新卡片为失败状态
      await updateCardKitCardForAuth({
        cfg,
        cardId,
        card: buildAuthFailedCard(result.message),
        sequence: ++seq,
        accountId,
      });
    }
  });
```

#### 3.3 卡片发送参数
```typescript
// oauth.ts 第 439-451 行
const authCard = buildAuthCard({
  verificationUriComplete: deviceAuth.verificationUriComplete,
  expiresMin: Math.round(deviceAuth.expiresIn / 60),
  scope: filteredScope,
  isBatchAuth,
  totalAppScopes,
  alreadyGranted,
  batchInfo,
  filteredScopes: unavailableScopes.length > 0 ? unavailableScopes : undefined,
  appId,
  showBatchAuthHint,
});
```

---

## 4. 思考逻辑显示机制

### 核心代码位置
- **绝对路径**:
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/card/builder.ts` - 思考内容解析和卡片构建
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/card/streaming-card-controller.ts` - 流式思考显示

### 4.1 思考内容解析
```typescript
// builder.ts 第 83-106 行
export function splitReasoningText(text?: string): {
  reasoningText?: string;
  answerText?: string;
} {
  if (typeof text !== 'string' || !text.trim()) return {};
  const trimmed = text.trim();

  // Case 1: "Reasoning:\n..." prefix — the entire payload is reasoning
  if (trimmed.startsWith(REASONING_PREFIX) && trimmed.length > REASONING_PREFIX.length) {
    return { reasoningText: cleanReasoningPrefix(trimmed) };
  }

  // Case 2: XML thinking tags — extract content and strip from answer
  const taggedReasoning = extractThinkingContent(text);
  const strippedAnswer = stripReasoningTags(text);
  // ...
}
```

**支持的思考标签格式：**
- `<think>...</think>`
- `<thinking>...</thinking>`
- `<thought>...</thought>`
- `<antthinking>...</antthinking>`
- `Reasoning:
...` 前缀格式

### 4.2 流式思考显示
```typescript
// streaming-card-controller.ts 第 290-307 行
async onReasoningStream(payload: ReplyPayload): Promise<void> {
  if (!this.shouldProceed('onReasoningStream')) return;
  await this.ensureCardCreated();
  
  const rawText = payload.text ?? '';
  if (!rawText) return;

  if (!this.reasoning.reasoningStartTime) {
    this.reasoning.reasoningStartTime = Date.now();
  }
  this.reasoning.isReasoningPhase = true;
  const split = splitReasoningText(rawText);
  this.reasoning.accumulatedReasoningText = split.reasoningText ?? rawText;
  await this.throttledCardUpdate();
}
```

### 4.3 最终卡片中的思考展示
```typescript
// builder.ts 第 299-330 行
function buildCompleteCard(params: {...}): FeishuCard {
  // ...
  // Collapsible reasoning panel (before main content)
  if (reasoningText) {
    const durationLabel = reasoningElapsedMs ? formatReasoningDuration(reasoningElapsedMs) : 'Thought';
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: {
          tag: 'markdown',
          content: `💭 ${durationLabel}`,
        },
        // ...
      },
      elements: [
        {
          tag: 'markdown',
          content: reasoningText,
          text_size: 'notation',
        },
      ],
    });
  }
  // ...
}
```

**思考显示特点：**
1. **流式阶段**：显示 "💭 **Thinking...**" + 思考内容
2. **完成阶段**：使用可折叠面板（`collapsible_panel`）展示思考过程
3. **时间统计**：显示思考耗时（如 "Thought for 3.2s"）

---

## 5. 错误信息处理机制

### 核心代码位置
- **绝对路径**:
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/core/auth-errors.ts` - 错误类型定义
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/card/streaming-card-controller.ts` - 卡片错误处理
  - `/Users/linxinhong/projects/pi-mono-work/openclaw-lark/src/messaging/outbound/send.ts` - 消息发送错误处理

### 5.1 错误类型定义
```typescript
// auth-errors.ts 第 18-56 行
export const LARK_ERROR = {
  /** 应用 scope 不足（租户维度） */
  APP_SCOPE_MISSING: 99991672,
  /** 用户 token scope 不足 */
  USER_SCOPE_INSUFFICIENT: 99991679,
  /** access_token 无效 */
  TOKEN_INVALID: 99991668,
  /** access_token 已过期 */
  TOKEN_EXPIRED: 99991669,
  /** refresh_token 无效 */
  REFRESH_TOKEN_INVALID: 20003,
  /** refresh_token 已过期 */
  REFRESH_TOKEN_EXPIRED: 20004,
  /** 消息已被撤回 */
  MESSAGE_RECALLED: 230011,
  /** 消息已被删除 */
  MESSAGE_DELETED: 231003,
} as const;
```

### 5.2 消息不可用处理（撤回/删除）
```typescript
// auth-errors.ts 第 49-53 行
export const MESSAGE_TERMINAL_CODES: ReadonlySet<number> = new Set([
  LARK_ERROR.MESSAGE_RECALLED,
  LARK_ERROR.MESSAGE_DELETED,
]);
```

```typescript
// streaming-card-controller.ts 第 130-136 行
this.guard = new UnavailableGuard({
  replyToMessageId: deps.replyToMessageId,
  getCardMessageId: () => this.cardKit.cardMessageId,
  onTerminate: () => {
    this.transition('terminated', 'UnavailableGuard', 'unavailable');
  },
});
```

### 5.3 流式卡片错误处理
```typescript
// streaming-card-controller.ts 第 345-384 行
async onError(err: unknown, info: { kind: string }): Promise<void> {
  if (this.guard.terminate('onError', err)) return;
  log.error(`${info.kind} reply failed`, { error: String(err) });
  this.finalizeCard('onError', 'error');
  await this.flush.waitForFlush();

  if (this.cardCreationPromise) await this.cardCreationPromise;

  const errorEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
  if (this.cardKit.cardMessageId) {
    try {
      const errorText = this.text.accumulatedText
        ? `${this.text.accumulatedText}\n\n---\n**Error**: An error occurred while generating the response.`
        : '**Error**: An error occurred while generating the response.';
      const errorCard = buildCardContent('complete', {
        text: errorText,
        reasoningText: this.reasoning.accumulatedReasoningText || undefined,
        reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
        elapsedMs: this.elapsed(),
        isError: true,
        footer: this.deps.resolvedFooter,
      });
      // ... 更新卡片显示错误信息
    } catch {
      // Ignore update failures during error handling
    }
  }
}
```

### 5.4 错误处理特点
1. **消息不可用检测**：自动检测消息被撤回/删除，停止后续操作
2. **优雅降级**：CardKit 失败时回退到 IM API
3. **错误卡片展示**：在卡片中显示错误信息，保留已生成的内容
4. **静默处理**：错误处理过程中的失败被静默忽略，避免级联错误

---

## 6. 总结

| 功能 | 实现文件 | 关键机制 |
|------|----------|----------|
| Reply-to | `send.ts` | `replyToMessageId` + `client.im.message.reply()` |
| 卡片 2.0 | `builder.ts`, `streaming-card-controller.ts` | `schema: '2.0'` + CardKit API |
| 授权卡片 | `oauth-cards.ts`, `oauth.ts` | Device Flow + 轮询更新卡片状态 |
| 思考显示 | `builder.ts` | `splitReasoningText()` + 可折叠面板 |
| 错误处理 | `auth-errors.ts`, `streaming-card-controller.ts` | 错误码分类 + UnavailableGuard |
