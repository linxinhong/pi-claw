# 部署到 Claw 服务器

当用户说"部署到claw"时，执行自动部署流程。

## 触发指令

> 部署到claw

或类似表达：
- "帮我部署到claw"
- "deploy to claw"
- "发布到claw"

## 执行流程

1. **本地提交**
   ```bash
   git commit
   ```
   - 提交所有本地更改
   - 如果 git status 为空，跳过此步骤

2. **推送到远程**
   ```bash
   git push
   ```
   - 将提交推送到远程仓库

3. **服务器拉取更新**
   ```bash
   claw "cd ~/pi-claw && git pull"
   ```
   - 通过 claw 命令在远程服务器执行 git pull
   - 服务器路径：`~/pi-claw`

## 注意事项

- 执行前会询问用户确认
- 如果工作区有未提交的更改，会提示用户
- 需要确保本地 git 配置正确
- 需要确保 claw 命令可用且有服务器访问权限

## 关于 `claw` 命令

`claw` 是一个自定义 alias，本质是 `ssh` 命令的封装：

```bash
# ~/.zshrc 或 ~/.bashrc 中定义
alias claw='ssh username@server-hostname'
```

这样设计的好处：
- 简化 SSH 操作，无需输入完整用户名和主机名
- 命令更简短易记
- 统一的服务器访问入口

## 日志路径

### 本地日志
```
~/.pi-claw/logs/
├── pi-claw.log          # 主应用日志
├── pi-claw.error.log    # 错误日志
├── plugin.log           # 插件日志
├── hook.log             # Hook系统日志
├── feishu.log           # 飞书适配器日志
├── main.log             # 主入口日志
└── tui.log              # TUI界面日志
```

### 服务器日志（通过 claw 查看）
```bash
# 查看主日志
claw "tail -100 ~/pi-claw/logs/pi-claw.log"

# 查看错误日志
claw "tail -50 ~/pi-claw/logs/pi-claw.error.log"

# 实时监控日志
claw "tail -f ~/pi-claw/logs/pi-claw.log"
```

## 前置条件

- 本地仓库已初始化 git
- 已配置远程仓库
- 已配置 `claw` alias（指向目标服务器的 SSH 连接）
- 服务器端 `~/pi-claw` 目录存在且为 git 仓库
- 已配置 SSH 免密登录（推荐）
