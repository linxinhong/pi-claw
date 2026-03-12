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
   claw "cd ~/pi-claw/ && git pull"
   ```
   - 通过 claw 命令在远程服务器执行 git pull
   - **注意**：服务器运行 `pnpm run dev` 有热加载，拉取后会自动重新加载，无需手动重启

## 关于 `claw` 命令

`claw` 是一个 shell alias，**本质就是 ssh 命令**：

```bash
# ~/.zshrc 或 ~/.bashrc 中的实际配置示例：
alias claw='ssh root@8.166.130.56'

# 实际使用时：
claw "cd ~/pi-claw && git pull"
# 等价于：
ssh user@hostname "cd ~/pi-claw && git pull"
```

**关键点**：
- `claw` 不是一个独立工具，而是 `ssh` 的别名
- 它直接转发所有参数给 ssh
- 用于简化 SSH 命令输入

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

### 常用命令示例
```bash
# 服务器拉取更新（&& 表示前一个命令成功后才执行后一个）
claw "cd ~/pi-claw/ && git pull"

# 查看服务器目录
claw "ls -la ~/pi-claw/"

# 重启服务（示例）
claw "cd ~/pi-claw && npm restart"
```

## 前置条件

- 本地仓库已初始化 git
- 已配置远程仓库
- 已配置 `claw` alias（即配置好指向目标服务器的 SSH alias）
- 服务器端 `~/pi-claw` 目录存在且为 git 仓库
- 已配置 SSH 免密登录（推荐）

## 注意事项

- 执行前会询问用户确认
- 如果工作区有未提交的更改，会提示用户
- 需要确保本地 git 配置正确
- 如果当前环境没有 `claw` alias，需要提示用户手动执行服务器拉取
