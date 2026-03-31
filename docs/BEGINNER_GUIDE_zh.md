# Codex WeChat Bridge 小白教程

这是一份按步骤执行的教程。你可以把它理解为：

- 先下载和安装插件
- 再完成首次跑通所需的两项准备
- 再启动桥接
- 最后做一次真实验收

如果你想单独查看 WeChat ClawBot 或 macOS 权限的详细说明，再看：

- [前置准备（中文）](PREREQUISITES_zh.md)

## Step 0：确认前置条件

你至少需要：

- 一台 Mac
- Node.js 18 或更高版本
- `npx`
- Codex CLI
- Codex Desktop
- 可以联网访问 npm，以便按需拉起 WeChat ClawBot 登录

先简单检查：

```bash
node -v
npx --version
codex --version
```

你现在应该看到什么：

- `node -v` 能输出版本号
- `npx --version` 能输出版本号
- `codex --version` 能输出版本号

## Step 1：下载并安装插件

先下载并进入仓库：

```bash
git clone https://github.com/youdele100fen/codex-wechat-bridge.git
cd codex-wechat-bridge
```

再安装命令：

```bash
./install.sh
```

安装后可以使用：

- `codex-wechat`
- `codex-wechat-bridge`

你现在应该看到什么：

- `install.sh` 结束时打印出下一步命令
- 终端里可以识别 `codex-wechat`

## Step 2：完成 WeChat ClawBot 登录

现在开始处理微信登录。执行：

```bash
codex-wechat setup
```

这里要特别说明：

- 你不需要先手动安装 `https://github.com/Johnixr/claude-code-wechat-channel`
- 也不需要先额外装一个本地 WeChat ClawBot 插件
- `codex-wechat setup` 会自动复用或触发底层的 `npx -y claude-code-wechat-channel setup`
- 所以对小白来说，这里直接执行 `codex-wechat setup` 就够了

只要本机有 `node`、`npx`，并且网络能正常访问 npm，这一步就会按需下载并执行 `claude-code-wechat-channel`。

扫码登录后，最关键的成功标志是：

- `~/.claude/channels/wechat/account.json` 已生成

你现在应该看到什么：

- 终端提示微信连接成功
- 出现账号 ID / 用户 ID
- 本地凭据文件已经写出

## Step 3：预先授权 macOS Accessibility

进入：

- 系统设置
- 隐私与安全性
- 辅助功能

允许你当前的终端宿主应用，例如：

- `Terminal`
- `iTerm`

如果系统后续弹出和自动化、辅助功能、`System Events` 相关的授权提示，也要允许。

你现在应该看到什么：

- 当前终端宿主应用已经在系统设置里被允许
- 等你完成 Step 4 后，再用 `codex-wechat doctor` 看到 `macOS Accessibility automation available` 为通过

## Step 4：运行 `doctor`

执行：

```bash
codex-wechat doctor
```

第一次最重要的是看：

- `WeChat credentials`
- `Codex Desktop running`
- `macOS Accessibility automation available`
- `Monitor status`

你现在应该看到什么：

- `WeChat credentials` 为通过
- `macOS Accessibility automation available` 为通过
- 如果 Codex Desktop 已经打开，`Codex Desktop running` 也应通过

## Step 5：先给 bot 发一条普通消息

在手机微信里给 bot 发一条普通消息，例如：

```text
你好
```

这一步的目的，是让桥接保存这个微信用户的 `contextToken`。

你现在应该看到什么：

- 再次运行 `codex-wechat doctor` 时，`Recipient binding` 变成通过

## Step 6：启动 `start`

执行：

```bash
codex-wechat start
```

正常情况下，`start` 已经内嵌了 `monitor` 能力，所以一般不需要再额外开一个 `monitor`。

你现在应该看到什么：

- 终端打印正在监听 WeChat prompts
- 终端打印 monitor 已嵌入当前 `start` 进程

## Step 7：完成首轮真实验收

请按这个顺序做：

1. 先在电脑端正常完成一个真实 Codex 任务
2. 等微信收到一条 `Codex 任务完成通知`
3. 再从微信发一条新 Prompt

这样设计的原因是：

- 微信里发来的新问题，会接到“最近一次通知对应的那个 Codex 任务”里继续运行
- 如果你还没有收到过任何通知，桥接就还不知道该续接哪个任务

你现在应该看到什么：

- 第一步之后，微信收到第一条任务通知
- 第二步之后，你再发的微信问题会进入对应任务里继续运行
- 成功后不会立即收到聊天式回复，而是等待下一条任务完成通知

## 常见问题

### 1. ClawBot 前置没有完成

现象：

- `account.json` 不存在
- `WeChat credentials` 不通过

注意：

- “从来没安装过 `claude-code-wechat-channel`” 本身不是问题
- 真正的问题通常是 `npx`、网络、npm 访问，或扫码登录没有完成

先做：

```bash
npx -y claude-code-wechat-channel setup
```

或：

```bash
codex-wechat setup
```

如果 `codex-wechat setup` 在这里失败，优先检查：

- `npx` 是否可用
- 当前网络是否能正常下载 `claude-code-wechat-channel`
- 微信扫码登录是否真的完成

### 2. `codex-wechat: command not found`

通常是 PATH 没加好。

先重新执行：

```bash
./install.sh
```

然后照脚本打印的 PATH 提示去修复。

### 3. Accessibility 未授权或授权给错应用

现象：

- `macOS Accessibility automation available` 不通过
- 微信 Prompt 没进入 Codex

重点检查：

- 你授权的是不是当前真正运行命令的宿主应用
- 例如 `Terminal` 或 `iTerm`

### 4. 微信没有收到通知

先执行：

```bash
codex-wechat doctor
```

重点看：

- `Monitor status`
- `Recipient binding`
- `WeChat credentials`

### 5. 微信发出的新问题没真正进入 Codex 的那个任务

重点看：

- Codex Desktop 是否在运行
- Accessibility 是否已通过
- 是否已经先收到过第一条任务通知
- `~/.codex/wechat-bridge/senders/*.json` 里的 `lastError`
