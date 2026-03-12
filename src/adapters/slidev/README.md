# Slidev Adapter

PPT 演示 Adapter，集成 Slidev 幻灯片渲染和 AI 对话能力。基于 pi-claw 的 PlatformAdapter 架构实现。

## 特性

- 🎬 **Slidev 渲染** - 基于 `@slidev/client` 的高性能幻灯片渲染
- 🤖 **AI 对话** - 集成 `pi-ai` + `pi-agent`，支持智能演示辅助
- 🎤 **语音交互** - 支持语音对话（TTS/STT）
- 🛠️ **丰富工具** - 翻页、朗读、实时编辑等 AI 工具
- 💬 **悬浮对话框** - 美观的 Vue 聊天界面
- 📐 **符合架构** - 实现 PlatformAdapter 接口，可被 pi-claw 统一管理

## 快速开始

### 基础用法（浏览器环境）

```typescript
import { createSlidevAdapter } from "@linxinhong/pi-claw/adapters/slidev";

// 创建 Adapter
const adapter = createSlidevAdapter({
  container: document.getElementById("slidev-container")!,
  slidev: {
    source: `
# 欢迎使用 Slidev

这是第一页

---

# 第二页

- 要点 1
- 要点 2

---

# 谢谢
`,
  },
});

// 初始化并启动
await adapter.initialize({ platform: "slidev", enabled: true });
await adapter.start();

// 监听消息（用于集成 CoreAgent）
adapter.onMessage(async (message) => {
  // 使用 CoreAgent 处理消息
  const response = await coreAgent.processMessage(
    message,
    adapter.createPlatformContext(message.chat.id),
    { user: message.sender }
  );
  
  // 发送响应
  await adapter.sendMessage({
    channelId: message.chat.id,
    content: response,
  });
});
```

### 通过 Factory 创建（推荐）

```typescript
import { adapterRegistry } from "@linxinhong/pi-claw/core/adapter";

// 获取 Slidev Factory
const factory = adapterRegistry.get("slidev");

// 创建 Bot
const bot = await factory!.createBot({
  workspaceDir: "/path/to/workspace",
  slidev: {
    container: document.getElementById("slidev-container")!,
    slidev: {
      source: "# Hello Slidev",
    },
    ai: {
      model: "gpt-4",
      apiKey: "your-api-key",
    },
  },
});

// 启动
await bot.start();
```

### 完整配置

```typescript
const adapter = createSlidevAdapter({
  // 容器元素（必填）
  container: document.getElementById("slidev-container")!,
  
  // Slidev 配置（必填）
  slidev: {
    source: markdownContent,
    theme: "default",
    initialSlide: 1,
    loop: false,
  },
  
  // TTS 配置
  tts: {
    engine: "web-speech", // 或 "dashscope"
    voice: "zh-CN-XiaoxiaoNeural",
    rate: 1,
  },
  
  // STT 配置
  stt: {
    engine: "web-speech",
    language: "zh-CN",
    continuous: true,
  },
  
  // AI 配置
  ai: {
    model: "gpt-4",
    apiKey: "your-api-key",
    systemPrompt: "你是一个专业的演示助手...",
  },
  
  // 对话框配置
  chat: {
    position: "bottom-right",
    initialOpen: false,
    placeholder: "输入消息...",
  },
  
  // 事件回调
  events: {
    onStateChange: (event) => console.log("State:", event),
    onSlideChange: (slide) => console.log("Slide:", slide),
    onVoiceStart: () => console.log("Voice started"),
    onVoiceEnd: () => console.log("Voice ended"),
  },
});
```

## API

### SlidevAdapter 方法

| 方法 | 说明 |
|------|------|
| `initialize(config)` | 初始化适配器（PlatformAdapter 接口） |
| `start()` | 启动演示（PlatformAdapter 接口） |
| `stop()` | 停止演示（PlatformAdapter 接口） |
| `sendMessage(response)` | 发送消息到对话框（PlatformAdapter 接口） |
| `onMessage(handler)` | 订阅消息事件（PlatformAdapter 接口） |
| `createPlatformContext(chatId)` | 创建平台上下文（PlatformAdapter 接口） |
| `handleUserInput(content)` | 处理用户输入（Slidev 特有） |
| `next()` | 下一页（Slidev 特有） |
| `prev()` | 上一页（Slidev 特有） |
| `goto(slideNo)` | 跳转到指定页（Slidev 特有） |
| `startVoiceChat()` | 开始语音对话（Slidev 特有） |
| `stopVoiceChat()` | 停止语音对话（Slidev 特有） |

### 状态管理

```typescript
type PresentationState = 
  | "IDLE"      // 空闲，未开始
  | "PLAYING"   // 正在播放
  | "PAUSED"    // 已暂停
  | "CONVERSING"; // 对话中
```

状态转换：
```
IDLE -> PLAYING <-> PAUSED
        ↕
    CONVERSING
```

## AI 工具

AI 助手可以使用以下工具控制演示：

### 导航工具

- `slide_navigate` - 翻页（next/prev/goto/first/last）
- `slide_get_info` - 获取当前幻灯片信息
- `slide_get_outline` - 获取演示大纲

### TTS 工具

- `tts_speak` - 朗读指定文本
- `tts_speak_slide` - 朗读当前幻灯片
- `tts_stop` - 停止朗读

### 编辑工具

- `slide_update` - 更新幻灯片内容
- `slide_highlight` - 高亮指定元素
- `slide_add_note` - 添加演讲者备注

## 架构集成

### 与飞书 Adapter 的对比

| 特性 | 飞书 Adapter | Slidev Adapter |
|------|-------------|----------------|
| 平台类型 | 即时通讯平台 | 浏览器演示平台 |
| 输入方式 | WebSocket/Webhook | 悬浮对话框 |
| 输出方式 | 飞书消息 | 悬浮对话框 |
| 运行环境 | Node.js 服务端 | 浏览器端 |
| 渲染能力 | 卡片消息 | Slidev 幻灯片 |
| 消息队列 | ChannelQueue | 直接处理 |
| 存储 | FeishuStore | 内存/LocalStorage |

### 消息流程

```
用户输入 (FloatingChat)
    ↓
SlidevAdapter.handleUserInput()
    ↓
MessageHandler.toUniversalMessage()
    ↓
adapter.onMessage() 回调
    ↓
CoreAgent.processMessage()
    ↓
Agent 处理 + Tools 调用
    ↓
SlidevPlatformContext.sendText()
    ↓
FloatingChat 显示回复
```

## 自定义 TTS/STT 引擎

```typescript
import { createSlidevAdapter } from "@linxinhong/pi-claw/adapters/slidev";

// 自定义 TTS 引擎
const customTTS = {
  async speak(text: string, config?: any) {
    // 实现朗读逻辑
  },
  stop() { /* ... */ },
  pause() { /* ... */ },
  resume() { /* ... */ },
  isSpeaking() { return false; },
};

const adapter = createSlidevAdapter({
  container: document.getElementById("container")!,
  slidev: { source: "# Hello" },
  tts: {
    engine: "custom",
    customEngine: customTTS,
  },
});
```

## Vue 组件

### FloatingChat

悬浮聊天对话框组件，支持文本和语音输入。

```vue
<template>
  <FloatingChat
    position="bottom-right"
    placeholder="输入消息..."
    :initial-open="false"
    @send="handleSend"
    @voice-start="handleVoiceStart"
    @voice-stop="handleVoiceStop"
  />
</template>
```

### VoiceWave

语音波形动画组件。

```vue
<template>
  <VoiceWave :active="isListening" mode="input" />
</template>
```

## 依赖

- `@slidev/client` - Slidev 渲染
- `@mariozechner/pi-agent-core` - Agent 核心
- `@mariozechner/pi-ai` - AI 模型
- `vue` - UI 组件
- `@sinclair/typebox` - 工具参数校验

## 浏览器兼容性

- Chrome 90+
- Edge 90+
- Safari 14.1+
- Firefox 88+

> 注：TTS/STT 功能依赖 Web Speech API，部分浏览器可能需要用户授权。

## 文件结构

```
src/adapters/slidev/
├── README.md                 # 本文档
├── index.ts                  # 主入口（导出所有模块 + 自注册）
├── types.ts                  # 类型定义
├── adapter.ts                # SlidevAdapter 主类（实现 PlatformAdapter）
├── context.ts                # SlidevPlatformContext（实现 PlatformContext）
├── factory.ts                # AdapterFactory + 自注册
├── StateMachine.ts           # 状态机
├── SlideRenderer.ts          # Slidev 渲染器
├── TTSEngine.ts              # TTS 引擎
├── STTEngine.ts              # STT 引擎
├── tools/                    # AI 工具
│   ├── index.ts
│   ├── navigation.ts
│   ├── tts.ts
│   └── editor.ts
├── messaging/                # 消息处理
│   ├── index.ts
│   └── handler.ts
└── components/               # Vue 组件
    ├── index.ts
    ├── FloatingChat.vue
    └── VoiceWave.vue
```

## License

MIT
