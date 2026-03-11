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

## 前置条件

- 本地仓库已初始化 git
- 已配置远程仓库
- 已安装并配置 claw CLI 工具
- 服务器端 `~/pi-claw` 目录存在且为 git 仓库
