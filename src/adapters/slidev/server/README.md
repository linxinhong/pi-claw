# Slidev Adapter Server 集成方案

## 方案概述

将 Slidev Adapter 与 pi-claw 现有的 express 服务器集成，提供：

1. **前端静态文件服务** - 托管 Slidev 演示页面
2. **API 端点** - 与 Slidev Adapter 交互（获取状态、控制翻页、发送消息等）
3. **WebSocket 支持** - 实时推送幻灯片状态变更

## 集成架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        pi-claw Express Server                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Static Files (/slidev)                                   │  │
│  │  - index.html                                             │  │
│  │  - slidev.js (Slidev Adapter 前端代码)                    │  │
│  │  - components/ (Vue 组件)                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  API Routes (/api/slidev)                                 │  │
│  │  GET  /status       - 获取演示状态                        │  │
│  │  GET  /slide        - 获取当前幻灯片信息                  │  │
│  │  POST /navigate     - 控制翻页 (next/prev/goto)           │  │
│  │  POST /message      - 发送消息到 AI                       │  │
│  │  POST /voice        - 开始/停止语音对话                   │  │
│  │  GET  /outline      - 获取演示大纲                        │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  WebSocket (/ws/slidev)                                   │  │
│  │  - 实时推送幻灯片变更                                     │  │
│  │  - 实时推送 AI 响应                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 复用现有 Express 的方式

### 1. 扩展现有 Express 应用

在 pi-claw 的 main.ts 中，为每个 Bot 提供 Express app 实例：

```typescript
// main.ts 修改
import express from "express";

// 创建共享的 Express 应用
const app = express();
app.use(express.json());

// 为每个平台提供 app 实例
for (const platform of platforms) {
  const factory = adapterRegistry.get(platform);
  if (factory?.createServer) {
    // 如果工厂支持创建服务器路由
    await factory.createServer(app, config);
  }
}

// 启动 HTTP 服务器
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
```

### 2. 在 Factory 中创建路由

```typescript
// factory.ts 添加 createServer 方法
export const slidevAdapterFactory: AdapterFactory & {
  createServer?(app: Express, config: BotConfig): Promise<void>;
} = {
  // ... 现有方法

  async createServer(app, config) {
    // 静态文件服务
    app.use('/slidev', express.static('./dist/slidev-static'));
    
    // API 路由
    const router = express.Router();
    
    router.get('/status', (req, res) => {
      // 返回演示状态
    });
    
    router.post('/navigate', (req, res) => {
      // 处理翻页
    });
    
    app.use('/api/slidev', router);
  }
};
```

### 3. 前端代码通过 API 与后端通信

```typescript
// 前端代码
const API_BASE = '/api/slidev';

// 获取状态
const status = await fetch(`${API_BASE}/status`).then(r => r.json());

// 控制翻页
await fetch(`${API_BASE}/navigate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'next' })
});

// 发送消息
await fetch(`${API_BASE}/message`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'Hello AI' })
});
```

## 文件组织

```
src/adapters/slidev/
├── server/
│   ├── README.md           # 本文档
│   ├── index.ts            # 服务器入口
│   ├── router.ts           # Express 路由定义
│   ├── static/             # 前端静态文件
│   │   ├── index.html
│   │   ├── slidev.js       # 前端入口
│   │   └── style.css
│   └── types.ts            # 服务器类型定义
├── adapter.ts              # 适配器主类（复用）
├── context.ts              # 平台上下文（复用）
└── ...                     # 其他组件
```

## 构建流程

```bash
# 1. 构建后端代码
pnpm build

# 2. 构建前端静态文件
pnpm build:slidev-client

# 3. 复制静态文件到 dist
# (已在 build 脚本中集成)
```

## 使用示例

### 启动带 Slidev 的 pi-claw

```json
// config.json
{
  "port": 3000,
  "slidev": {
    "enabled": true,
    "source": "# Hello Slidev\n\n---\n\n# Page 2",
    "route": "/slidev"
  }
}
```

```bash
# 启动
pnpm start

# 访问
open http://localhost:3000/slidev
```

### 前端集成示例

```html
<!-- 嵌入到其他页面 -->
<iframe src="http://localhost:3000/slidev" width="100%" height="600px"></iframe>

<!-- 或直接链接 -->
<a href="http://localhost:3000/slidev" target="_blank">打开演示</a>
```

## 优势

1. **复用现有 Express** - 无需额外服务器
2. **统一端口** - 与 pi-claw 共享端口
3. **统一配置** - 使用相同的 config.json
4. **统一日志** - 使用 pi-claw 的日志系统
5. **易于扩展** - 可添加更多 API 端点
