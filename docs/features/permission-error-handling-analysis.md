# openclaw-lark 权限错误处理方式分析

## Context

用户想知道 openclaw-lark 项目是如何处理权限错误的，特别是如何避免权限死循环问题。

## openclaw-lark 的核心设计差异

### 1. 消息发送不调用 convertAtMentions

**openclaw-lark** (`src/messaging/outbound/send.ts`):
```typescript
// sendMessageFeishu 直接发送，不转换 @ 提及
export async function sendMessageFeishu(params: SendFeishuMessageParams): Promise<FeishuSendResult> {
  // ...
  const contentPayload = JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text: messageText }]],
    },
  });

  // 直接调用 API，没有 convertAtMentions
  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: { receive_id: target, msg_type: 'post', content: contentPayload },
  });
}
```

**pi-claw** (`src/adapters/feishu/context.ts`):
```typescript
async sendText(chatId: string, text: string): Promise<string> {
  // 问题：调用 convertAtMentions 需要 getChatMembers 权限
  const convertedText = await this.larkClient.convertAtMentions(chatId, text);
  return await this.messageSender.sendText(chatId, convertedText);
}
```

### 2. 权限错误处理方式

**openclaw-lark** (`src/messaging/inbound/dispatch-commands.ts`):
```typescript
export async function dispatchPermissionNotification(
  dc: DispatchContext,
  permissionError: PermissionError,
  replyToMessageId?: string,
): Promise<void> {
  // 关键：不发送卡片，而是作为系统消息让 agent 告诉用户
  const permissionNotifyBody = `[System: The bot encountered a Feishu API permission error.
    Please inform the user about this issue and provide the permission grant URL
    for the admin to authorize. Permission grant URL: ${grantUrl}]`;

  // 使用 createFeishuReplyDispatcher 发送消息
  // 这个 dispatcher 内部使用 sendMessageFeishu，不调用 convertAtMentions
  await dc.core.channel.reply.dispatchReplyFromConfig({...});
}
```

**pi-claw** (`src/adapters/feishu/utils/permission-error.ts`):
```typescript
export async function sendAuthCard(
  context: FeishuPlatformContext,
  permissionError: PermissionError,
): Promise<void> {
  // 问题：使用 sendCard，而 sendCard 内部调用 convertAtMentions
  await context.sendCard(context["chatId"], card);
}
```

### 3. @ 提及处理方式

**openclaw-lark**:
- 使用 `mentions` 参数显式指定提及对象
- `buildMentionedMessage(mentions, messageText)` 在发送前构建提及
- **不在发送时自动转换文本中的 `@用户名`**

**pi-claw**:
- 在 `sendText` 和 `sendCard` 中自动调用 `convertAtMentions`
- `convertAtMentions` 需要 `getChatMembers` 权限
- 这是权限死循环的根源

## 总结：openclaw-lark 如何避免权限死循环

1. **消息发送不依赖权限**: `sendMessageFeishu` 和 `sendCardFeishu` 直接调用 API，不调用 `convertAtMentions`

2. **权限错误由 agent 处理**: 不是系统发送卡片，而是将错误信息注入到 agent 的上下文中，让 agent 告诉用户

3. **提及处理是可选的**: 使用 `mentions` 参数显式指定，而不是自动转换文本

## 对比表

| 特性 | openclaw-lark | pi-claw |
|------|--------------|---------|
| sendText/sendCard 是否调用 convertAtMentions | ❌ 否 | ✅ 是 |
| 权限错误处理方式 | 让 agent 告诉用户 | 系统发送卡片 |
| @ 提及处理 | 显式 `mentions` 参数 | 自动转换文本 |
| 是否有权限死循环风险 | ❌ 无 | ✅ 有 |

## 我们的修复方案

我们采用了类似 openclaw-lark 的思路：添加 `sendReplyText` 方法，直接调用 `larkClient.replyText`，不经过 `convertAtMentions`。

```typescript
async sendReplyText(chatId: string, text: string, replyToMessageId?: string): Promise<string> {
  // 直接使用 larkClient 的方法，不调用 convertAtMentions
  if (replyToMessageId) {
    const result = await this.larkClient.replyText(replyToMessageId, text);
    return result.message_id ?? "";
  } else {
    const result = await this.larkClient.sendText(chatId, text);
    return result.message_id ?? "";
  }
}
```

注意：`larkClient.replyText` 和 `larkClient.sendText` 是底层方法，它们**不会**调用 `convertAtMentions`。

## 实现状态

已修复：`sendAuthCard` 现在使用 `sendReplyText` 而不是 `sendCard`，避免了权限死循环。

死循环流程：
```
handleError() → sendAuthCard() → sendCard() → convertAtMentions() → getChatMembers()
    ↑ 权限不足                                              ↓
    └──────────────────── 抛出权限错误 ←─────────────────────┘
```

修复后：
```
handleError() → sendAuthCard() → sendReplyText() → larkClient.replyText()
    ↑ 权限错误已处理                                        ↓
    └──────────────────── 返回成功 ←─────────────────────────┘
```
