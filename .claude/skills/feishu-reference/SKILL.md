# 飞书参考代码查阅

当需要参考飞书实现时，可以查阅本地的 `feishu-openclaw-plugin` 代码。

## 参考代码位置

```
~/projects/pi-mono-work/feishu-openclaw-plugin
```

## 关键文件映射

| 功能 | pi-claw 路径 | 参考代码路径 |
|------|-------------|-------------|
| 消息发送 | `src/adapters/feishu/client/lark-client.ts` | `src/messaging/outbound/deliver.js` |
| 消息接收 | `src/adapters/feishu/messaging/inbound/` | `src/messaging/inbound/` |
| 卡片构建 | `src/adapters/feishu/card/builder.ts` | `src/card/` |
| 消息引用 | `src/adapters/feishu/client/lark-client.ts` | `src/messaging/outbound/deliver.js` |
| 上下文处理 | `src/adapters/feishu/context.ts` | `src/channel/plugin.js` |

## 关键实现差异

### 1. 消息引用功能

**参考实现**（`feishu-openclaw-plugin`）：
```javascript
// 使用 reply API 实现引用
await client.im.v1.message.reply({
    path: { message_id: messageId },
    data: { 
        content, 
        msg_type: "interactive",
        reply_in_thread: replyInThread 
    },
});
```

**旧实现**（pi-claw）：
```typescript
// 错误的 quote_message_id 参数方式
data.quote_message_id = quoteMessageId;
```

### 2. 卡片消息发送

**参考实现**：
```javascript
// deliver.js 中的 sendImMessage 统一处理
data: { content, msg_type: "interactive", reply_in_thread: replyInThread }
```

### 3. 消息解析流程

**参考实现**（`src/messaging/inbound/`）：
1. `handler.js` - 事件处理入口
2. `enrich.js` - 内容增强（获取引用消息）
3. `dispatch.js` - 消息分发

## 常用查询命令

```bash
# 查找引用相关实现
grep -rn "reply" ~/projects/pi-mono-work/feishu-openclaw-plugin/src/messaging/outbound/ --include="*.js"

# 查找卡片发送实现
grep -rn "sendCard\|interactive" ~/projects/pi-mono-work/feishu-openclaw-plugin/src/messaging/outbound/ --include="*.js"

# 查看消息接收流程
cat ~/projects/pi-mono-work/feishu-openclaw-plugin/src/messaging/inbound/handler.js
```

## 设计差异

| 特性 | feishu-openclaw-plugin | pi-claw |
|------|----------------------|---------|
| 架构 | Channel Plugin 架构 | Adapter 架构 |
| SDK | openclaw/plugin-sdk | 直接调用 node-sdk |
| 消息处理 | 统一的 send action | 分离的 sendText/sendCard |
| 引用实现 | reply API | 已修复为 reply API |
| 卡片更新 | patch API | patch API |

## 注意事项

1. **引用功能**：必须使用 `client.im.v1.message.reply` API，不能使用 `quote_message_id` 参数
2. **话题回复**：`reply_in_thread: true` 可以让回复显示在话题中
3. **卡片检测**：参考代码有自动检测卡片 JSON 并路由的逻辑
4. **错误处理**：参考代码有详细的错误分类和处理
