# Codex WeChat Bridge

Use WeChat ClawBot to receive Codex task notifications and send new prompts back into Codex Desktop on macOS.

English docs:

- [Prerequisites](docs/PREREQUISITES_en.md)
- [Beginner Guide](docs/BEGINNER_GUIDE_en.md)
- [GitHub Publish Guide](docs/GITHUB_PUBLISH.md)

---

## 这是什么

`codex-wechat-bridge` 是一个把微信和 Codex Desktop 连起来的插件。

装好之后，你可以得到两种能力：

- Codex 任务完成后，结果自动发到微信
- 你在微信里继续发 Prompt，桥接会把它提交回最近一次通知对应的 Codex Thread

这不是一个通用聊天机器人，也不是纯命令行桥接。当前版本依赖：

- macOS
- Codex Desktop
- WeChat ClawBot
- `osascript` + `System Events` 的桌面自动化

## 开始前必须先准备好的 2 个前提

### 前提 1：先准备好 WeChat ClawBot

这个插件不会自己创建微信 bot。它依赖的是已经登录成功的 **WeChat ClawBot** 通道。

你至少要能完成这一步：

```bash
npx -y claude-code-wechat-channel setup
```

如果你更希望让插件帮你调用这一步，也可以直接运行：

```bash
codex-wechat setup
```

它内部同样会复用或触发 `claude-code-wechat-channel setup`。

成功标志：

- 终端提示微信扫码登录成功
- 出现账号 ID 和用户 ID
- 本地已生成 `~/.claude/channels/wechat/account.json`

详细步骤看这里：

- [WeChat ClawBot 前置准备（中文）](docs/PREREQUISITES_zh.md)
- [WeChat ClawBot Prerequisites (English)](docs/PREREQUISITES_en.md)

### 前提 2：先准备好 macOS Accessibility

因为桥接要用 `osascript` 调用 `System Events`，把微信里的 Prompt 粘贴到 Codex Desktop 输入框中，所以第一次使用前必须先完成辅助功能授权。

你要在 macOS 里确认：

- 当前终端宿主应用已被允许使用辅助功能
  - 例如 `Terminal` 或 `iTerm`
- 如果系统弹出自动化或辅助功能提示，要点允许

成功标志：

- `codex-wechat doctor` 中 `macOS Accessibility automation available` 显示通过

详细步骤也在前置文档中：

- [前置准备（中文）](docs/PREREQUISITES_zh.md)
- [Prerequisites (English)](docs/PREREQUISITES_en.md)

## 5 步完成安装与首次启动

### Step 1：下载插件

```bash
git clone https://github.com/youdele100fen/codex-wechat-bridge.git
cd codex-wechat-bridge
```

### Step 2：安装命令

```bash
./install.sh
```

安装后你可以使用两个等价命令：

- `codex-wechat`
- `codex-wechat-bridge`

### Step 3：登录或刷新 WeChat ClawBot 凭据

```bash
codex-wechat setup
```

如果你想把默认工作区写成某个项目目录，也可以这样：

```bash
codex-wechat setup --workspace "/path/to/your/project"
```

### Step 4：运行体检

```bash
codex-wechat doctor
```

第一次重点看这几项：

- `WeChat credentials`
- `Codex Desktop running`
- `macOS Accessibility automation available`
- `Monitor status`

### Step 5：启动桥接

```bash
codex-wechat start
```

日常使用时，一般只需要保持一个 `codex-wechat start` 进程。

## 第一次怎么验证成功

按下面顺序做：

1. 先在微信里给 bot 发一条普通消息，例如 `你好`
2. 在电脑端正常完成一个真实 Codex 任务
3. 等微信收到第一条 `Codex 任务完成通知`
4. 再从微信发一条新的 Prompt

如果一切正常，你会看到：

- 微信能收到通知
- `doctor` 里的 `WeChat credentials` 和 `macOS Accessibility automation available` 为通过
- 微信发出的新 Prompt 会进入最近一次通知对应的 Codex Thread

## 常见报错先看哪里

### 1. `account.json` 不存在

先检查 WeChat ClawBot 前置是否真的完成：

```bash
npx -y claude-code-wechat-channel setup
```

或者：

```bash
codex-wechat setup
```

### 2. `codex-wechat: command not found`

通常是 `~/.local/bin` 还没有加入 PATH。重新执行 `./install.sh`，然后照它打印的 PATH 提示修复。

### 3. `macOS Accessibility automation available` 没通过

优先检查：

- 是否已经给 Terminal 或 iTerm 授权辅助功能
- 系统弹窗是否被拒绝过
- 当前是不是在 macOS 上运行

### 4. 微信 Prompt 没真正进入 Codex Thread

优先检查：

- Codex Desktop 是否正在运行
- Accessibility 是否已授权
- 是否已经先收到过第一条任务通知
- `~/.codex/wechat-bridge/senders/*.json` 里的 `lastError`

## 文档导航

- [前置准备（中文）](docs/PREREQUISITES_zh.md)
- [小白教程（中文）](docs/BEGINNER_GUIDE_zh.md)
- [Prerequisites (English)](docs/PREREQUISITES_en.md)
- [Beginner Guide (English)](docs/BEGINNER_GUIDE_en.md)
- [GitHub 发布说明](docs/GITHUB_PUBLISH.md)

## 当前限制

- 仅支持 macOS
- 微信 Prompt 提交依赖正在运行的 Codex Desktop
- 依赖 `osascript` 与 `System Events`
- 微信 Prompt 默认会进入“最近一次通知对应的 Thread”，这个 Thread 可能来自另一个 Project

## 许可证

MIT
