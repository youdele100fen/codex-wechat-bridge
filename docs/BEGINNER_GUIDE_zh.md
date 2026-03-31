# Codex WeChat Bridge 小白教程

这份教程面向第一次接触 `codex-wechat-bridge` 的用户，目标是从零安装到可以在微信里收通知、发 Prompt。

## 1. 这是什么

`codex-wechat-bridge` 可以把你的微信 bot 和本机的 Codex Desktop 连起来。

你会得到两种能力：

- Codex 任务完成后，自动把结果发到微信
- 你在微信里继续发 Prompt，桥接会把它提交到最近一次通知对应的 Codex Thread

注意：

- 当前版本只支持 macOS
- 依赖 Codex Desktop 正在运行
- 依赖 macOS 辅助功能授权
- 依赖微信通道登录成功

## 2. 开始前你需要准备什么

请先确认你已经有：

- 一台 Mac
- Node.js 18 或更高版本
- Codex CLI
- Codex Desktop
- 微信 bot 登录能力

你可以先简单检查：

```bash
node -v
codex --version
```

如果这两个命令都能正常输出版本号，就可以继续。

## 3. 下载插件

```bash
git clone <repo-url>
cd codex-wechat-bridge
```

如果你是从 GitHub 网页下载 ZIP，也可以先解压，再进入这个目录。

## 4. 安装命令

运行：

```bash
./install.sh
```

这个脚本会做几件事：

- 检查是不是 macOS
- 检查 Node.js 版本
- 检查 `codex`、`npx`、`osascript`
- 把两个命令安装到 `~/.local/bin/`

安装后你可以使用两个等价命令：

- `codex-wechat-bridge`
- `codex-wechat`

如果终端提示命令找不到，通常是 `~/.local/bin` 还没有加入 PATH。脚本会打印出修复命令，照着执行一次即可。

## 5. 首次登录微信 bot

运行：

```bash
codex-wechat setup
```

如果你想把“默认工作区”写成某个具体项目目录，可以在那个项目目录里执行，或者显式加上：

```bash
codex-wechat setup --workspace "/path/to/your/project"
```

执行 `setup` 后，会调用微信登录流程。按提示扫码登录即可。

登录成功后，凭据会保存在：

- `~/.claude/channels/wechat/account.json`

## 6. 授予 macOS 辅助功能权限

因为桥接需要把微信里的 Prompt 粘贴到 Codex Desktop 输入框里，所以第一次使用前要授权。

路径一般是：

- 系统设置
- 隐私与安全性
- 辅助功能

确保终端、Codex Desktop，以及相关自动化调用有权限。

如果没有这个权限，微信 Prompt 无法真正提交到 Codex Thread。

## 7. 运行体检

运行：

```bash
codex-wechat doctor
```

重点看这些项目：

- `Codex CLI`
- `Codex Desktop running`
- `macOS Accessibility automation available`
- `WeChat credentials`
- `Monitor status`
- `Recipient binding`

如果 `Recipient binding` 还没通过，不要着急。这通常只是因为你还没有先给 bot 发第一条微信消息。

## 8. 做第一次绑定

先在手机微信里给 bot 发一条普通消息，比如：

```text
你好
```

这样桥接会保存这个微信用户的 `contextToken`，之后才能主动给你回通知。

## 9. 启动桥接

运行：

```bash
codex-wechat start
```

正常情况下，`start` 已经自动包含 `monitor` 能力，所以一般不需要再单独开一个 `monitor`。

日常建议：

- 只保留一个 `codex-wechat start`
- 不要多开多个相同监听进程

## 10. 第一次使用流程

第一次要按这个顺序来：

1. 在电脑端的 Codex 里先完成一个真实任务
2. 等微信收到一条“Codex 任务完成通知”
3. 从此刻开始，你再从微信发 Prompt，桥接才知道应该把 Prompt 接到哪个 Thread

如果你还没有收到任何通知，就直接从微信发 Prompt，桥接会提示：

`当前还没有可续接的 Codex 任务。请先在 Codex 中完成一次任务并收到通知后，再从微信发送 Prompt。`

## 11. 平时怎么用

日常使用很简单：

1. 保持 `codex-wechat start` 在后台运行
2. 正常在电脑端使用 Codex
3. 当某个任务完成时，微信会收到通知
4. 你随后在微信里发的新 Prompt，会进入“最近一条通知对应的 Thread”

要注意：

- 最近通知来自哪个 Project，微信 Prompt 就会进入哪个 Project 的那个 Thread
- 这意味着跨 Project 工作是支持的，但目标会跟着最新通知切换

## 12. 常见问题

### 12.1 `codex-wechat: command not found`

原因通常是 PATH 没配好。

解决方法：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

然后重新打开终端再试。

### 12.2 微信没有收到通知

先检查：

```bash
codex-wechat doctor
```

重点看：

- `Monitor status`
- `Recipient binding`
- `WeChat credentials`

### 12.3 微信发了 Prompt，但没真正进入 Codex

重点检查：

- Codex Desktop 是否正在运行
- macOS 辅助功能是否已授权
- 是否已经先收到过至少一条任务通知
- `~/.codex/wechat-bridge/senders/*.json` 里的 `lastError`

### 12.4 目标 Thread 切到了别的 Project

这是当前版本的正常设计。

微信 Prompt 会默认进入“最近一条通知对应的 Thread”，不一定是你现在电脑前打开的那个项目。

## 13. 状态文件在哪里

- 配置：`~/.codex/wechat-bridge/config.json`
- 微信轮询游标：`~/.codex/wechat-bridge/runtime.json`
- 通知监控状态：`~/.codex/wechat-bridge/monitor.json`
- 每个微信用户的状态：`~/.codex/wechat-bridge/senders/*.json`
- 微信凭据：`~/.claude/channels/wechat/account.json`

## 14. 推荐的日常检查命令

```bash
codex-wechat doctor
```

当你遇到以下情况时，优先重新跑一次：

- 换了微信 bot
- 重启了电脑
- Codex Desktop 行为异常
- 微信收不到通知
- 微信 Prompt 提交失败
