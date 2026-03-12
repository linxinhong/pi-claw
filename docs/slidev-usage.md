# Slidev Adapter 使用指南

本文档介绍如何使用 pi-claw 的 Slidev Adapter 进行 PPT 演示。

## 目录

- [快速开始](#快速开始)
- [使用方式](#使用方式)
- [配置说明](#配置说明)
- [API 参考](#api-参考)
- [AI 工具](#ai-工具)
- [浏览器兼容性](#浏览器兼容性)
- [故障排除](#故障排除)

## 快速开始

### 1. Express 服务器方式（推荐）

修改 `~/.pi-claw/config.json`：

```json
{
  "port": 3000,
  "slidev": {
    "enabled": true,
    "source": "# 欢迎使用 Slidev\n\n---\n\n# 第二页\n\n- 要点 1\n- 要点 2\n\n---\n\n# 谢谢",
    "theme": "default",
    "initialSlide": 1,
    "loop": false,
    "tts": {
      "engine": "web-speech",
      "rate": 1
    },
    "stt": {
      "engine": "web-speech",
      "language": "zh-CN",
      "continuous": true
    }
  }
}
```

启动服务：

```bash
pnpm start
```

访问 `http://localhost:3000/slidev` 即可使用。

### 2. 浏览器环境方式

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Presentation</title>
  <script type="module">
    import { createSlidevAdapter } from "@linxinhong/pi-claw/adapters/slidev";

    const adapter = createSlidevAdapter({
      container: document.getElementById("slidev-container"),
      slidev: {
        source: `# 标题\n\n---\n\n# 第二页`,
      },
    });

    await adapter.initialize({ platform: "slidev", enabled: true });
    await adapter.start();
  </script>
</head>
<body>
  <div id="slidev-container"></div>
</body>
</html>
```

## 使用方式

### 方式一：Express 服务器集成

适合需要服务端托管演示场景，复用 pi-claw 的 HTTP 服务器。

```typescript
import { adapterRegistry } from "@linxinhong/pi-claw/core/adapter";
import express from "express";

const app = express();

// 获取 Slidev Factory
const factory = adapterRegistry.get("slidev");

// 创建服务器路由
await factory!.createServer(app, {
  workspaceDir: "/path/to/workspace",
  slidev: {
    source: "# Hello Slidev",
    theme: "default",
  },
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000/slidev");
});
```

**提供的 API 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/slidev/status` | GET | 获取演示状态 |
| `/api/slidev/slide` | GET | 获取当前幻灯片 |
| `/api/slidev/outline` | GET | 获取演示大纲 |
| `/api/slidev/navigate` | POST | 翻页控制 `{action: "next"\|"prev"\|"goto", slideNo?: number}` |
| `/api/slidev/message` | POST | 发送消息到 AI `{content: string}` |
| `/api/slidev/voice` | POST | 语音控制 `{action: "start"\|"stop"}` |
| `/api/slidev/control` | POST | 演示控制 `{action: "start"\|"stop"\|"pause"\|"resume"}` |

### 方式二：浏览器环境直接集成

适合嵌入到现有前端应用中，完全在浏览器中运行。

```typescript
import { createSlidevAdapter, createSlidevBot } from "@linxinhong/pi-claw/adapters/slidev";
import { CoreAgent } from "@linxinhong/pi-claw/core/agent";

// 创建 Adapter
const adapter = createSlidevAdapter({
  container: document.getElementById("slidev-container")!,
  slidev: {
    source: markdownContent,
    theme: "default",
  },
  tts: {
    engine: "web-speech",
    rate: 1.2,
  },
  stt: {
    engine: "web-speech",
    language: "zh-CN",
  },
  events: {
    onStateChange: (event) => console.log("State:", event.from, "->", event.to),
    onSlideChange: (slide) => console.log("Slide:", slide.current, "/", slide.total),
  },
});

// 初始化
await adapter.initialize({ platform: "slidev", enabled: true });

// 创建 CoreAgent（用于 AI 对话）
const coreAgent = new CoreAgent({
  model: "gpt-4",
  apiKey: "your-api-key",
});

// 监听用户消息
adapter.onMessage(async (message) => {
  const context = adapter.createPlatformContext(message.chat.id);
  
  // 使用 CoreAgent 处理消息
  const response = await coreAgent.processMessage(message, context, {
    user: message.sender,
  });
  
  // 发送响应
  await adapter.sendMessage({
    channelId: message.chat.id,
    content: response,
  });
});

// 启动
await adapter.start();
```

## 配置说明

### SlidevAdapterConfig

```typescript
interface SlidevAdapterConfig {
  // 容器元素（浏览器环境必需）
  container: HTMLElement;
  
  // Slidev 配置（必需）
  slidev: {
    source: string;           // Markdown 格式的幻灯片内容
    theme?: string;           // 主题，默认 "default"
    initialSlide?: number;    // 起始页码，默认 1
    loop?: boolean;           // 是否循环播放，默认 false
    showPageNumbers?: boolean; // 是否显示页码，默认 true
    customCSS?: string;       // 自定义 CSS
  };
  
  // TTS 配置（可选）
  tts?: {
    engine?: "web-speech" | "dashscope" | "custom";
    voice?: string;           // 语音类型
    rate?: number;            // 语速 0.1-10，默认 1
    pitch?: number;           // 音调 0.1-2，默认 1
    volume?: number;          // 音量 0-1，默认 1
    customEngine?: TTSEngine; // 自定义引擎
  };
  
  // STT 配置（可选）
  stt?: {
    engine?: "web-speech" | "custom";
    language?: string;        // 语言，默认 "zh-CN"
    continuous?: boolean;     // 连续识别，默认 true
    interimResults?: boolean; // 返回中间结果，默认 true
    customEngine?: STTEngine; // 自定义引擎
  };
  
  // AI 配置（可选）
  ai?: {
    model?: string;           // 模型名称
    apiKey?: string;          // API Key
    systemPrompt?: string;    // 系统提示词
  };
  
  // 对话框配置（可选）
  chat?: {
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    initialOpen?: boolean;    // 初始是否打开，默认 false
    placeholder?: string;     // 输入框占位符
  };
  
  // 事件回调（可选）
  events?: {
    onStateChange?: (event: StateChangeEvent) => void;
    onSlideChange?: (slide: SlideInfo) => void;
    onVoiceStart?: () => void;
    onVoiceEnd?: () => void;
    onError?: (error: Error) => void;
  };
}
```

### 完整配置示例

```typescript
const adapter = createSlidevAdapter({
  container: document.getElementById("slidev-container")!,
  
  slidev: {
    source: `
# 欢迎使用 Slidev

这是一个演示示例。

---

# 功能特性

- 🎬 幻灯片渲染
- 🤖 AI 对话
- 🎤 语音交互

---

# 谢谢观看

欢迎提问！
`,
    theme: "default",
    initialSlide: 1,
    loop: false,
    showPageNumbers: true,
  },
  
  tts: {
    engine: "web-speech",
    rate: 1.2,
    pitch: 1,
    volume: 1,
  },
  
  stt: {
    engine: "web-speech",
    language: "zh-CN",
    continuous: true,
    interimResults: true,
  },
  
  chat: {
    position: "bottom-right",
    initialOpen: false,
    placeholder: "输入消息或点击麦克风语音对话...",
  },
  
  events: {
    onStateChange: ({ from, to }) => {
      console.log(`状态变更: ${from} -> ${to}`);
    },
    onSlideChange: ({ current, total, title }) => {
      console.log(`幻灯片: ${current}/${total} - ${title}`);
    },
    onVoiceStart: () => {
      console.log("语音开始");
    },
    onVoiceEnd: () => {
      console.log("语音结束");
    },
    onError: (error) => {
      console.error("错误:", error);
    },
  },
});
```

## API 参考

### SlidevAdapter 方法

| 方法 | 返回类型 | 说明 |
|------|---------|------|
| `initialize(config)` | `Promise<void>` | 初始化适配器 |
| `start()` | `Promise<void>` | 启动演示 |
| `stop()` | `Promise<void>` | 停止演示 |
| `pause()` | `void` | 暂停演示 |
| `resume()` | `void` | 继续演示 |
| `next()` | `void` | 下一页 |
| `prev()` | `void` | 上一页 |
| `goto(slideNo)` | `void` | 跳转到指定页 |
| `startVoiceChat()` | `void` | 开始语音对话 |
| `stopVoiceChat()` | `void` | 停止语音对话 |
| `getState()` | `PresentationState` | 获取当前状态 |
| `getCurrentSlide()` | `SlideInfo` | 获取当前幻灯片信息 |
| `sendMessage(response)` | `Promise<void>` | 发送消息 |
| `onMessage(handler)` | `void` | 订阅消息事件 |
| `createPlatformContext(chatId)` | `SlidevPlatformContext` | 创建平台上下文 |

### 状态类型

```typescript
type PresentationState = 
  | "IDLE"      // 空闲，未开始
  | "PLAYING"   // 正在播放
  | "PAUSED"    // 已暂停
  | "CONVERSING"; // 对话中
```

### 幻灯片信息

```typescript
interface SlideInfo {
  total: number;      // 总页数
  current: number;    // 当前页码
  title?: string;     // 标题
  content?: string;   // 内容
}
```

## AI 工具

AI 助手可以使用以下工具控制演示：

### 导航工具

#### slide_navigate

控制幻灯片翻页。

```typescript
{
  name: "slide_navigate",
  parameters: {
    action: "next" | "prev" | "goto" | "first" | "last",
    slideNo?: number  // goto 时使用
  }
}
```

#### slide_get_info

获取当前幻灯片信息。

```typescript
{
  name: "slide_get_info",
  parameters: {}
}
```

#### slide_get_outline

获取演示大纲。

```typescript
{
  name: "slide_get_outline",
  parameters: {}
}
```

### TTS 工具

#### tts_speak

朗读指定文本。

```typescript
{
  name: "tts_speak",
  parameters: {
    text: string,
    voice?: string,
    rate?: number
  }
}
```

#### tts_speak_slide

朗读当前幻灯片。

```typescript
{
  name: "tts_speak_slide",
  parameters: {
    slideNo?: number,
    includeTitle?: boolean
  }
}
```

#### tts_stop

停止朗读。

```typescript
{
  name: "tts_stop",
  parameters: {}
}
```

### 编辑工具

#### slide_update

更新幻灯片内容。

```typescript
{
  name: "slide_update",
  parameters: {
    slideNo?: number,
    content: string,
    append?: boolean
  }
}
```

#### slide_highlight

高亮指定元素。

```typescript
{
  name: "slide_highlight",
  parameters: {
    selector: string,  // CSS 选择器
    duration?: number  // 持续时间（毫秒）
  }
}
```

## 浏览器兼容性

- Chrome 90+
- Edge 90+
- Safari 14.1+
- Firefox 88+

**注意：**
- TTS/STT 功能依赖 Web Speech API
- 部分浏览器可能需要用户授权才能使用语音功能
- 建议在使用语音功能前检查浏览器支持情况

```typescript
// 检查浏览器支持
if (!('SpeechSynthesis' in window)) {
  console.warn('当前浏览器不支持语音合成');
}

if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
  console.warn('当前浏览器不支持语音识别');
}
```

## 故障排除

### Slidev 无法加载

**问题：** 幻灯片内容没有正确渲染。

**解决方案：**
1. 检查 `source` 是否为有效的 Markdown 格式
2. 确保 `---` 作为分页符使用（前后有空行）
3. 检查容器元素是否正确设置尺寸

```typescript
// 正确的 Markdown 格式
const source = `
# 第一页

内容...

---

# 第二页

内容...
`;
```

### TTS 无法播放

**问题：** 语音合成没有声音。

**解决方案：**
1. 检查浏览器是否支持 Web Speech API
2. 检查是否有其他应用占用音频输出
3. 尝试手动触发（某些浏览器需要用户交互后才能播放）

```typescript
// 在用户点击后初始化
document.addEventListener('click', () => {
  adapter.start();
}, { once: true });
```

### STT 无法识别

**问题：** 语音识别无法启动或没有结果。

**解决方案：**
1. 检查麦克风权限是否已授权
2. 检查浏览器是否支持语音识别
3. 确保使用 HTTPS 或 localhost（某些浏览器要求）

```typescript
// 请求麦克风权限
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(() => {
    adapter.startVoiceChat();
  })
  .catch(err => {
    console.error('麦克风权限被拒绝:', err);
  });
```

### 跨域问题

**问题：** 在 iframe 中使用时报错。

**解决方案：**
1. 确保父页面和 iframe 页面同源
2. 或者设置适当的 CORS 头部
3. 使用 `postMessage` 进行跨窗口通信

---

如有其他问题，请查看 [README.md](../src/adapters/slidev/README.md) 或提交 Issue。
