# MCP (Model Context Protocol) 集成指南

pi-claw 支持通过 MCP (Model Context Protocol) 接入外部工具和数据源，实现 AI 能力的无限扩展。

## 什么是 MCP？

MCP (Model Context Protocol) 是由 Anthropic 推出的开放协议，用于标准化 AI 模型与外部数据源、工具之间的集成。它就像 AI 世界的 "USB-C" 接口，让任何支持 MCP 的 AI 应用都能无缝连接各种外部服务。

## 架构概述

```
┌─────────────────────────────────────────────────────────────┐
│                        pi-claw                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   CoreAgent │◄──►│ MCP Manager │◄──►│ MCP Clients │     │
│  └─────────────┘    └─────────────┘    └──────┬──────┘     │
└────────────────────────────────────────────────┼────────────┘
                                                 │
                    ┌────────────────────────────┼────────────┐
                    │                            │            │
                    ▼                            ▼            ▼
              ┌─────────┐                 ┌─────────┐   ┌─────────┐
              │Filesystem│                │  GitHub │   │  Slack  │
              │  Server  │                │  Server │   │  Server │
              └─────────┘                 └─────────┘   └─────────┘
```

## 配置方法

在 `~/.pi-claw/config.json` 中添加 MCP 配置：

```json
{
  "workspaceDir": "~/.pi-claw",
  "port": 3000,
  "model": "qwen",
  
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "displayName": "文件系统",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/linxinhong/workspace"],
        "enabled": true
      },
      {
        "name": "github",
        "displayName": "GitHub",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "your_token_here"
        },
        "enabled": true
      },
      {
        "name": "postgres",
        "displayName": "PostgreSQL",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
        "enabled": false
      }
    ]
  },
  
  "feishu": {
    "appId": "your_app_id",
    "appSecret": "your_app_secret"
  }
}
```

## 配置字段说明

### mcp

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 否 | 是否启用 MCP，默认为 `true` |
| `servers` | array | 是 | MCP 服务器配置列表 |

### mcp.servers[i]

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 服务器唯一标识（用于生成工具名） |
| `displayName` | string | 否 | 服务器显示名称 |
| `transport` | string | 是 | 传输类型：`stdio` 或 `http` |
| `command` | string | stdio | 要执行的命令 |
| `args` | array | 否 | 命令参数 |
| `env` | object | 否 | 环境变量 |
| `url` | string | http | HTTP 服务器 URL |
| `headers` | object | 否 | HTTP 请求头 |
| `enabled` | boolean | 否 | 是否启用此服务器 |
| `timeout` | number | 否 | 请求超时（毫秒），默认 60000 |

## 传输类型

### STDIO 传输

适用于本地运行的 MCP 服务器：

```json
{
  "name": "filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
  "env": {
    "CUSTOM_VAR": "value"
  }
}
```

### HTTP/SSE 传输

适用于远程 MCP 服务器：

```json
{
  "name": "remote-server",
  "transport": "http",
  "url": "https://mcp.example.com",
  "headers": {
    "Authorization": "Bearer your-token"
  }
}
```

## 常用 MCP 服务器

### 官方服务器

| 服务器 | 安装命令 | 功能 |
|--------|----------|------|
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem <path>` | 文件系统操作 |
| GitHub | `npx -y @modelcontextprotocol/server-github` | GitHub API 访问 |
| PostgreSQL | `npx -y @modelcontextprotocol/server-postgres <connection-string>` | 数据库查询 |
| SQLite | `npx -y @modelcontextprotocol/server-sqlite <db-path>` | SQLite 操作 |
| Slack | `npx -y @modelcontextprotocol/server-slack` | Slack 集成 |
| Google Maps | `npx -y @modelcontextprotocol/server-google-maps` | 地图服务 |

### 社区服务器

参考 [MCP 官方文档](https://modelcontextprotocol.io/examples) 获取更多社区服务器。

## 工具命名规范

接入的 MCP 工具会自动转换为 pi-claw 工具，命名格式为：

```
mcp_{serverName}_{toolName}
```

例如：
- `mcp_filesystem_read_file`
- `mcp_github_search_repositories`
- `mcp_postgres_query`

## 使用示例

配置完成后，你可以直接在对话中使用 MCP 工具：

```
用户：帮我查看一下 workspace 目录下的文件
AI：我来帮您查看目录内容。
    -> mcp_filesystem_list_directory
    目录包含以下文件：
    - project-a/
    - project-b/
    - README.md

用户：帮我搜索 GitHub 上关于 mcp 的仓库
AI：我来帮您搜索。
    -> mcp_github_search_repositories
    找到以下相关仓库：
    - modelcontextprotocol/specification
    - modelcontextprotocol/servers
    ...
```

## 故障排查

### 查看 MCP 连接状态

启动时查看日志输出：
```
[UnifiedBot] Initializing MCP manager with 2 servers
[MCP Manager] Found 2 enabled MCP servers
[MCP Client filesystem] Connecting...
[MCP Client filesystem] Initialized with server: filesystem-server@1.0.0
[MCP Client filesystem] Discovered 5 tools
[MCP Manager] Initialization complete. 2/2 servers connected.
```

### 常见问题

1. **连接失败**
   - 检查命令是否正确安装：`npx @modelcontextprotocol/server-xxx --help`
   - 检查环境变量是否正确设置
   - 查看日志中的详细错误信息

2. **工具未显示**
   - 确认 `enabled` 字段为 `true`
   - 检查服务器是否支持 `tools` 能力
   - 查看 `[MCP Client xxx] Discovered N tools` 日志

3. **工具调用失败**
   - 检查参数是否符合 schema
   - 查看服务器端的错误输出
   - 增加 `timeout` 配置

## 安全注意事项

1. **谨慎配置环境变量**
   - 不要在配置文件中硬编码敏感信息
   - 使用环境变量引用：`"env": { "TOKEN": "${ENV_VAR}" }`

2. **限制文件系统访问**
   - 只为 filesystem server 提供必要的目录访问权限
   - 避免授予根目录访问权限

3. **审查第三方服务器**
   - 只使用可信来源的 MCP 服务器
   - 检查服务器代码后再运行

## 进一步阅读

- [MCP 官方文档](https://modelcontextprotocol.io)
- [MCP 规范](https://spec.modelcontextprotocol.io)
- [官方服务器列表](https://github.com/modelcontextprotocol/servers)
