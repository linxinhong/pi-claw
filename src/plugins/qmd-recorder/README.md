# QMD Recorder Plugin

利用 pi-claw 的 hook 机制，使用 Quarto Markdown (.qmd) 格式保存学习记录、错误和特性请求。

## 功能特性

### 自动记录 (通过 Hook)

- **工具调用错误**: 当工具调用失败时自动记录到错误日志
- **消息发送失败**: 当消息发送失败时自动记录
- **Agent Turn 异常**: 当 Agent Turn 以异常状态结束时记录

### 手动记录 (通过 AI 工具)

AI 可以使用以下工具手动记录信息：

| 工具名 | 用途 |
|--------|------|
| `record_learning` | 记录学习心得、知识更新或最佳实践 |
| `record_error` | 记录错误、故障或异常情况 |
| `record_feature_request` | 记录用户请求的新功能 |
| `query_records` | 查询已存在的记录文件 |

## 启用配置

在 `~/.pi-claw/config.json` 中添加插件配置：

```json
{
  "plugins": {
    "qmd-recorder": {
      "enabled": true,
      "recordsDir": "~/.pi-claw/records",
      "recordToolErrors": true,
      "recordMessageErrors": true,
      "recordAgentTurns": false,
      "autoRecordPriorityThreshold": "medium"
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | true | 是否启用插件 |
| `recordsDir` | string | `~/.pi-claw/records` | 记录文件保存目录 |
| `recordToolErrors` | boolean | true | 是否自动记录工具错误 |
| `recordMessageErrors` | boolean | true | 是否自动记录消息发送错误 |
| `recordAgentTurns` | boolean | false | 是否记录 Agent Turn 异常 |
| `autoRecordPriorityThreshold` | string | "medium" | 自动记录的优先级阈值 |

## 输出格式

记录文件使用 Quarto Markdown 格式，每日生成一个文件：

```
records/
├── learnings-2025-03-27.qmd
├── errors-2025-03-27.qmd
└── features-2025-03-27.qmd
```

### QMD 文件示例

```markdown
---
title: "学习记录"
description: "记录学习心得、知识更新和最佳实践"
date: "2025-03-27T07:30:00.000Z"
format:
  html:
    toc: true
    code-fold: true
---

# 学习记录

...

---

## [LRN-20250327-001] best_practice {status="pending" priority="medium"}

**记录时间**: 2025-03-27T07:30:00.000Z  
**类型**: 学习  
**优先级**: medium  
**状态**: pending  
**领域**: backend

### 摘要

使用 pi-claw 的 hook 机制实现自动记录功能

### 详细信息

通过监听 tool:called、message:sent 等 hook 事件，可以自动捕获系统中的异常情况并记录到 QMD 文件中。

### 建议操作

在更多场景中使用 hook 来自动化记录

### 元数据

| 字段 | 值 |
|------|-----|
| 来源 | agent |
| 标签 | hook, automation, qmd |

---
```

## 工具使用示例

### 记录学习

```json
{
  "tool": "record_learning",
  "params": {
    "category": "best_practice",
    "summary": "使用 hook 机制实现自动记录",
    "details": "详细描述...",
    "priority": "medium",
    "area": "backend",
    "tags": ["hook", "automation"]
  }
}
```

### 记录错误

```json
{
  "tool": "record_error",
  "params": {
    "category": "api_failure",
    "summary": "飞书 API 调用失败",
    "errorMessage": "Error: Request timeout",
    "priority": "high",
    "tags": ["feishu", "api"]
  }
}
```

### 查询记录

```json
{
  "tool": "query_records",
  "params": {
    "date": "2025-03-27",
    "type": "learning"
  }
}
```

## AI 使用指南

插件会自动将使用指南注入到系统提示词中，帮助 AI 知道何时使用记录工具。

### 用户偏好记录

以下偏好已记录到系统中：

| 偏好 | 值 | 记录时间 |
|------|-----|----------|
| 沟通语言 | 中文 | 2025-03-27 |

### 自动注入的提示词包括：

**何时记录学习 (record_learning)**
- 用户纠正你时 ("No, that's wrong...", "Actually...")
- 你发现更好的方法
- 用户解释你不知道的项目约定
- 你解决了需要调试的非显而易见的问题

**何时记录错误 (record_error)**
- 命令或 API 调用意外失败
- 工具执行返回错误
- 事情与预期不同
- 遇到重复的问题

**何时记录特性请求 (record_feature_request)**
- 用户说 "Can you also...", "I wish you could..."
- 用户请求尚不存在的功能

**何时查询记录 (query_records)**
- 开始复杂任务前，检查是否记录过类似问题
- 用户询问过去的问题、决策或解决方案

## 参考

- [self-improving-agent skill](https://github.com/peterskoett/self-improving-agent)
- [Quarto Markdown](https://quarto.org/docs/authoring/markdown-basics.html)
