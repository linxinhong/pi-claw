# Pi-Claw 飞书卡片设计增强实施计划

> 基于 openclaw-lark 项目深入学习后的完整实施计划

---

## 一、现状分析（深入对比）

### 1.1 pi-claw 已有能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 基础卡片系统 | ✅ | CardBuilder + CardStateManager |
| 流式响应 | ✅ | updateStreaming + 1秒节流 |
| 时间线展示 | ✅ | TimelineEvent[] + collapsible_panel |
| 思考内容解析器 | ✅ | reasoning-parser.ts 已实现 |
| 消息不可用守卫 | ✅ | message-unavailable.ts 已实现 |
| 错误码常量 | ✅ | errors.ts 已定义 |
| 引用回复 | ✅ | quoteMessageId 支持 |

### 1.2 openclaw-lark 核心优势（学习重点）

| 能力 | openclaw-lark 实现 | 可借鉴程度 |
|------|-------------------|-----------|
| **CardKit 2.0** | schema 2.0 + cardElement.content() 打字机效果 | 高（需评估）|
| **FlushController** | 独立刷新控制器，支持 mutex + reflush | 高（推荐引入）|
| **UnavailableGuard** | 类封装，集成到 StreamingCardController | 中（已存在，需集成）|
| **思考内容分离** | streaming 阶段显示 💭 Thinking...，完成时 collapsible_panel | 高（推荐引入）|
| **Footer 状态** | 出错/已停止/已完成 + 耗时 | 高（推荐引入）|
| **错误卡片** | 保留已生成内容 + 红色错误标识 | 高（推荐引入）|
| **Markdown 优化** | optimizeMarkdownStyle - 标题降级、表格间距 | 中（可选）|
| **状态机** | CardPhase: idle→creating→streaming→completed | 中（可选）|

---

## 二、关键学习收获（from openclaw-lark）

### 2.1 CardKit 2.0 流程（打字机效果）

```
1. createCardEntity({ card: STREAMING_THINKING_CARD })
   → 返回 cardId
   
2. sendCardByCardId({ cardId, to, replyToMessageId })
   → 发送卡片消息，返回 messageId
   
3. streamCardContent({ cardId, elementId, content, sequence })
   → 打字机效果更新特定元素
   
4. setCardStreamingMode({ cardId, streamingMode: false })
   → 关闭流式模式
   
5. updateCardKitCard({ cardId, card: finalCard, sequence })
   → 更新最终卡片
```

**STREAMING_THINKING_CARD 结构**：
```typescript
{
  schema: '2.0',
  config: { streaming_mode: true, summary: { content: '思考中...' } },
  body: {
    elements: [
      { tag: 'markdown', content: '', element_id: 'streaming_content' },
      { tag: 'markdown', content: ' ', icon: { ...loading_icon } },
    ],
  },
}
```

### 2.2 FlushController 设计（强烈推荐引入）

```typescript
class FlushController {
  private flushInProgress = false;
  private needsReflush = false;
  private pendingFlushTimer: Timeout | null = null;
  
  // 核心能力：
  // 1. mutex-guarded flushing - 防止并发更新
  // 2. reflush-on-conflict - 冲突时自动重刷
  // 3. throttledUpdate - 节流控制
  // 4. waitForFlush - 等待刷新完成
}
```

**节流常量**：
- `CARDKIT_MS: 100` - CardKit 流式更新（低延迟）
- `PATCH_MS: 1500` - IM API patch（严格限流）
- `LONG_GAP_THRESHOLD_MS: 2000` - 长空闲检测
- `BATCH_AFTER_GAP_MS: 300` - 批量延迟

### 2.3 思考内容显示设计

**流式阶段**（reasoning phase）：
```typescript
if (reasoningText && !answerText) {
  // 纯思考内容
  elements.push({
    tag: 'markdown',
    content: `💭 **Thinking...**\n\n${reasoningText}`,
    text_size: 'notation',
  });
}
```

**完成阶段**：
```typescript
if (reasoningText) {
  elements.push({
    tag: 'collapsible_panel',
    expanded: false,
    header: {
      title: { tag: 'markdown', content: `💭 Thought for 3.2s` },
    },
    elements: [{ tag: 'markdown', content: reasoningText, text_size: 'notation' }],
  });
}
```

### 2.4 Footer 设计

```typescript
const parts: string[] = [];

if (footer?.status) {
  if (isError) parts.push('出错');
  else if (isAborted) parts.push('已停止');
  else parts.push('已完成');
}

if (footer?.elapsed && elapsedMs != null) {
  parts.push(`耗时 ${formatElapsed(elapsedMs)}`);
}

// 红色错误标识
const content = isError ? `<font color='red'>${text}</font>` : text;
```

### 2.5 错误处理设计

**onError 回调**：
```typescript
async onError(err: unknown, info: { kind: string }): Promise<void> {
  // 1. 终止 guard
  if (this.guard.terminate('onError', err)) return;
  
  // 2. 等待刷新完成
  await this.flush.waitForFlush();
  
  // 3. 构建错误卡片（保留已生成内容）
  const errorText = this.text.accumulatedText
    ? `${this.text.accumulatedText}\n\n---\n**Error**: An error occurred...`
    : '**Error**: An error occurred...';
    
  const errorCard = buildCardContent('complete', {
    text: errorText,
    reasoningText: this.reasoning.accumulatedReasoningText,
    isError: true,
  });
  
  // 4. 更新卡片
  await this.closeStreamingAndUpdate(cardId, errorCard, 'onError');
}
```

---

## 三、实施计划（修订版）

### Phase 1: 基础能力集成（2-3 天）

#### 1.1 集成 MessageUnavailableGuard

**目标**：在 LarkClient 关键方法中集成守卫

**修改文件**：
- `src/adapters/feishu/client/lark-client.ts`
  - `updateCard()` - 包装守卫
  - `updateMessage()` - 包装守卫
  - `deleteMessage()` - 包装守卫

**实现方式**：
```typescript
import { runWithMessageUnavailableGuard } from "../utils/message-unavailable.js";

async updateCard(messageId: string, card: any): Promise<void> {
  await runWithMessageUnavailableGuard({
    messageId,
    operation: "im.message.patch",
    fn: async () => {
      const response = await this.client.im.v1.message.patch({...});
      if (response.code !== 0) throw new Error(...);
    },
  });
}
```

#### 1.2 集成思考内容解析到卡片构建器

**目标**：在 buildCompleteCard 中添加思考内容折叠面板

**修改文件**：`src/adapters/feishu/card/builder.ts`

**新增方法**：
```typescript
/**
 * 构建思考内容折叠面板
 */
private buildReasoningPanel(content: string, elapsedMs?: number): CardElement {
  const title = elapsedMs 
    ? `💭 Thought for ${this.formatElapsed(elapsedMs)}`
    : '💭 Thought';
    
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: {
      title: { tag: "markdown", content: title },
      icon: { tag: "standard_icon", token: "down-small-ccm_outlined" },
    },
    border: { color: "grey", corner_radius: "5px" },
    elements: [{
      tag: "markdown",
      content: content,
      text_size: "notation",
    }],
  };
}
```

**修改 buildCompleteCard**：
```typescript
buildCompleteCard(content: string, options?: {
  elapsed?: number;
  toolCalls?: ToolCallInfo[];
  timeline?: TimelineEvent[];
  thinkingContent?: string;  // 新增
  reasoningElapsedMs?: number;  // 新增
  expanded?: boolean;
}): Card {
  const elements: CardElement[] = [];
  
  // 1. 先添加思考内容折叠面板（如果有）
  if (options?.thinkingContent) {
    elements.push(this.buildReasoningPanel(
      options.thinkingContent,
      options.reasoningElapsedMs
    ));
  }
  
  // 2. 添加主要内容
  elements.push({
    tag: "div",
    text: { tag: "lark_md", content: this.formatContent(content) },
  });
  
  // 3. 添加时间线
  if (options?.timeline?.length) {
    elements.push(this.buildTimelinePanel(options.timeline, options.expanded ?? false));
  }
  
  // 4. 添加 Footer
  if (options?.elapsed !== undefined) {
    elements.push({
      tag: "markdown",
      content: `⏱️ 耗时: ${this.formatElapsed(options.elapsed)}`,
      text_size: "notation",
    });
  }
  
  return { schema: "2.0", config: this.defaultConfig, body: { elements } };
}
```

#### 1.3 在 Context 中集成思考解析

**修改文件**：`src/adapters/feishu/context.ts`

**修改 finishThinking**：
```typescript
import { splitReasoningText } from "./card/reasoning-parser.js";

async finishThinking(content: string, stopReason?: string): Promise<void> {
  // 解析思考内容
  const { reasoningText, answerText } = splitReasoningText(content);
  const finalContent = answerText || content;
  
  // 计算思考耗时
  const reasoningElapsedMs = this.reasoningStartTime 
    ? Date.now() - this.reasoningStartTime 
    : undefined;
  
  // 构建最终卡片（包含思考内容）
  const finalCard = this.cardBuilder.buildCompleteCard(finalContent, {
    elapsed: this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined,
    timeline: this.getTimeline(),
    thinkingContent: reasoningText,  // 传递思考内容
    reasoningElapsedMs,  // 传递思考耗时
    expanded: false,
  });
  
  // 更新卡片...
}
```

---

### Phase 2: 体验增强（2-3 天）

#### 2.1 增强 Footer 状态显示

**目标**：添加状态标签（已完成/出错/已停止）

**修改文件**：`src/adapters/feishu/card/builder.ts`

**新增接口和方法**：
```typescript
interface FooterOptions {
  elapsed?: number;
  status?: "complete" | "error" | "aborted";
  isError?: boolean;
}

private buildFooter(options: FooterOptions): CardElement {
  const parts: string[] = [];
  
  // 状态标签
  if (options.isError) {
    parts.push("<font color='red'>出错</font>");
  } else if (options.status === "aborted") {
    parts.push("已停止");
  } else {
    parts.push("已完成");
  }
  
  // 耗时
  if (options.elapsed !== undefined) {
    parts.push(`耗时 ${this.formatElapsed(options.elapsed)}`);
  }
  
  return {
    tag: "markdown",
    content: parts.join(" · "),
    text_size: "notation",
  };
}
```

#### 2.2 增强错误卡片

**目标**：错误时保留已生成内容，添加红色错误标识

**修改 buildErrorCard**：
```typescript
buildErrorCard(error: string, partialContent?: string): Card {
  const content = partialContent 
    ? `${partialContent}\n\n---\n<font color='red'>❌ **发生错误**</font>\n${error}`
    : `<font color='red'>❌ **发生错误**</font>\n\n${error}`;
  
  return {
    schema: "2.0",
    config: this.defaultConfig,
    body: {
      elements: [{
        tag: "div",
        text: { tag: "lark_md", content },
      }],
    },
  };
}
```

#### 2.3 错误处理增强

**修改文件**：`src/adapters/feishu/context.ts`

**在 finishThinking 中增强错误处理**：
```typescript
async finishThinking(content: string, stopReason?: string): Promise<void> {
  try {
    // ... 正常逻辑
  } catch (error: any) {
    // 构建错误卡片（保留已生成内容）
    const partialContent = this.thinkingContent || this.pendingContent;
    const errorCard = this.cardBuilder.buildErrorCard(
      String(error?.message || error),
      partialContent
    );
    
    // 更新卡片为错误状态
    if (this.cardIds.toolCardId) {
      await this.messageSender.updateCard(this.cardIds.toolCardId, errorCard);
    }
    
    // 重新抛出，让上层处理
    throw error;
  }
}
```

---

### Phase 3: FlushController 引入（可选，2-3 天）

如果需要更好的节流控制，可以引入 FlushController：

**新增文件**：`src/adapters/feishu/card/flush-controller.ts`

```typescript
export class FlushController {
  private flushInProgress = false;
  private needsReflush = false;
  private pendingFlushTimer: NodeJS.Timeout | null = null;
  private lastUpdateTime = 0;
  private isCompleted = false;
  private cardMessageReady = false;

  constructor(private readonly doFlush: () => Promise<void>) {}

  complete(): void { this.isCompleted = true; }
  
  cancelPendingFlush(): void {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer);
      this.pendingFlushTimer = null;
    }
  }

  waitForFlush(): Promise<void> {
    if (!this.flushInProgress) return Promise.resolve();
    return new Promise(resolve => this.flushResolvers.push(resolve));
  }

  async flush(): Promise<void> {
    // mutex-guarded flushing with reflush-on-conflict
  }

  async throttledUpdate(throttleMs: number): Promise<void> {
    // 节流控制
  }
}
```

---

### Phase 4: 测试与优化（2 天）

#### 4.1 单元测试

**新增/修改测试**：
- `tests/unit/adapters/feishu/card/builder.test.ts`
- `tests/unit/adapters/feishu/card/reasoning-parser.test.ts`
- `tests/unit/adapters/feishu/utils/message-unavailable.test.ts`

#### 4.2 集成测试场景

1. 用户撤回消息后，AI 卡片更新不报错
2. AI 输出 `<thinking>` 标签时，思考内容正确显示在折叠面板
3. 错误发生时，卡片显示红色错误标识并保留已有内容
4. Footer 状态标签正确显示

#### 4.3 性能优化

- 检查 reasoning-parser 正则性能
- 优化 message-unavailable 缓存清理

---

## 四、文件变更清单

### 修改文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/adapters/feishu/card/builder.ts` | 修改 | 添加思考面板、Footer 状态、错误卡片增强 |
| `src/adapters/feishu/client/lark-client.ts` | 修改 | 集成 MessageUnavailableGuard |
| `src/adapters/feishu/context.ts` | 修改 | 集成思考解析、错误处理增强 |
| `src/adapters/feishu/card/index.ts` | 修改 | 导出 reasoning-parser |

### 可选新增（FlushController）

| 文件 | 说明 |
|------|------|
| `src/adapters/feishu/card/flush-controller.ts` | 独立刷新控制器 |
| `src/adapters/feishu/card/controller.ts` | 流式卡片控制器（可选）|

---

## 五、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 思考解析影响性能 | 低 | 仅在 finish 时解析，流式不解析 |
| MessageUnavailableGuard 误杀 | 低 | 仅针对 230011/231003 错误码 |
| 卡片格式变化 | 中 | 保持向后兼容，渐进式更新 |
| FlushController 引入复杂度 | 中 | Phase 3 可选，评估后再决定 |

---

## 六、验收标准

### 功能验收

- [ ] 用户撤回消息后，AI 卡片更新不报错
- [ ] AI 输出 `<thinking>` 标签时，思考内容显示在折叠面板
- [ ] 错误发生时，卡片显示红色错误标识并保留已有内容
- [ ] Footer 显示状态标签（已完成/出错）和耗时
- [ ] 卡片响应速度和稳定性不下降

### 代码验收

- [ ] 所有错误码使用 LARK_ERROR 常量
- [ ] 新增代码有单元测试覆盖
- [ ] 现有测试全部通过
- [ ] TypeScript 类型检查通过

---

## 七、后续可选方向

### Phase 5: CardKit 2.0 打字机效果（需用户决策）

如果用户需要打字机效果的流式卡片：

**需要实现**：
1. CardKit API 封装层（createCardEntity, streamCardContent, updateCardKitCard）
2. 支持 CardKit 的 LarkClient 扩展
3. 状态机管理的 StreamingCardController

**预估工作量**：5-7 天

**前提条件**：
- 飞书应用开通 CardKit 权限
- 评估打字机效果的用户体验提升

---

## 八、参考资源

- openclaw-lark 源码：`/Users/linxinhong/projects/pi-mono-work/openclaw-lark`
- 关键文件：
  - `src/card/builder.ts` - 卡片构建
  - `src/card/streaming-card-controller.ts` - 流式控制器
  - `src/card/flush-controller.ts` - 刷新控制器
  - `src/card/cardkit.ts` - CardKit API 封装
  - `src/core/message-unavailable.ts` - 消息不可用守卫
- 飞书卡片文档：https://open.feishu.cn/document/client-docs/bot-v3/card-create
