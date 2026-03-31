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
- 你在微信里发新问题后，插件会把这条问题接到你上一次收到通知的那个 Codex 任务里继续运行

这不是一个通用聊天机器人，也不是纯命令行桥接。当前版本依赖：

- macOS
- Codex Desktop
- WeChat ClawBot
- `osascript` + `System Events` 的桌面自动化

## 最短上手路径

如果你是第一次使用，最简单的顺序就是下面 5 步：

### Step 1：下载插件

```bash
git clone https://github.com/youdele100fen/codex-wechat-bridge.git
cd codex-wechat-bridge
```

这一步对完全没装过 WeChat ClawBot 或 `claude-code-wechat-channel` 的用户也完全可行。

### Step 2：安装命令

```bash
./install.sh
```

安装后你可以使用两个等价命令：

- `codex-wechat`
- `codex-wechat-bridge`

### Step 3：登录或刷新微信通道

```bash
codex-wechat setup
```

### Step 4：检查环境

```bash
codex-wechat doctor
```

### Step 5：启动桥接

```bash
codex-wechat start
```

## 首次真正跑通前，你最终需要完成的 2 件事

下面这两件事不是“必须先于 git clone 完成”，而是你在第一次真正跑通桥接前，最终一定要完成。

### 第 1 件事：完成 WeChat ClawBot 登录

这个插件不会自己创建微信 bot。它依赖的是已经登录成功的 **WeChat ClawBot** 通道。

但这里有一个很重要的细节：

- 你**不需要事先手动安装** `https://github.com/Johnixr/claude-code-wechat-channel`
- 你**也不需要先单独装一个本地 WeChat ClawBot 插件**
- 如果你**还没执行过** `git clone` 和 `./install.sh`，这时先**不要运行** `codex-wechat setup`
- 因为在安装桥接之前，你的系统里通常还没有 `codex-wechat` 这个命令

真正负责拉起登录的是这一步：

```bash
npx -y claude-code-wechat-channel setup
```

而在你安装完本仓库之后，更推荐直接运行：

```bash
codex-wechat setup
```

它内部同样会复用或触发 `claude-code-wechat-channel setup`。

这意味着：

- 第一次使用时，只要本机有 `node`、`npx`，并且网络能正常访问 npm，前置登录就可以直接开始
- 不需要先去手动 clone `Johnixr/claude-code-wechat-channel`
- 不需要先单独执行额外安装脚本
- 但 `codex-wechat setup` 这个命令本身，要等你完成下面的安装步骤后才可用

如果下面这些条件不满足，README 流程就会卡在登录前置这一步：

- `npx` 不可用
- 网络无法下载 `claude-code-wechat-channel`
- 微信扫码登录没有真正完成

成功标志：

- 终端提示微信扫码登录成功
- 出现账号 ID 和用户 ID
- 本地已生成 `~/.claude/channels/wechat/account.json`

详细步骤看这里：

- [WeChat ClawBot 前置准备（中文）](docs/PREREQUISITES_zh.md)
- [WeChat ClawBot Prerequisites (English)](docs/PREREQUISITES_en.md)

### 第 2 件事：完成 macOS Accessibility 授权

因为桥接要用 `osascript` 调用 `System Events`，把微信里的 Prompt 粘贴到 Codex Desktop 输入框中，所以第一次使用前必须先完成辅助功能授权。

你要在 macOS 里确认：

- 当前终端宿主应用已被允许使用辅助功能
  - 例如 `Terminal` 或 `iTerm`
- 如果系统弹出自动化或辅助功能提示，要点允许

成功标志：

- 现在先把系统权限准备好
- 等你完成下面的安装步骤后，再用 `codex-wechat doctor` 检查 `macOS Accessibility automation available` 是否通过

详细步骤也在前置文档中：

- [前置准备（中文）](docs/PREREQUISITES_zh.md)
- [Prerequisites (English)](docs/PREREQUISITES_en.md)

如果你想把默认工作区写成某个项目目录，可以在 Step 3 改用：

```bash
codex-wechat setup --workspace "/path/to/your/project"
```

`doctor` 第一次重点看这几项：

- `WeChat credentials`
- `Codex Desktop running`
- `macOS Accessibility automation available`
- `Monitor status`

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
- 你从微信发出的新问题，会接到你刚刚收到通知的那个 Codex 任务里继续运行

补充说明：

- 如果你同时在 iPhone 和 iPad 上对同一个最近通知线程发送完全相同的 Prompt，桥接会在短时间窗口内自动去重，避免同一句话被重复提交两次
- 对于桌面端提交后写入 rollout 较慢的任务，桥接会等待更长时间再判定失败，减少“其实已经成功提交，但微信先收到失败提示”的误报

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

这条命令的前提是：你已经完成了上面的 `git clone` 和 `./install.sh`。

如果你从来没有安装过 `claude-code-wechat-channel`，这本身不是问题。

真正需要检查的是：

- `npx` 是否可用
- 当前网络是否能正常下载 `claude-code-wechat-channel`
- 扫码登录是否真的完成

### 2. `codex-wechat: command not found`

通常是 `~/.local/bin` 还没有加入 PATH。重新执行 `./install.sh`，然后照它打印的 PATH 提示修复。

### 3. `macOS Accessibility automation available` 没通过

优先检查：

- 是否已经给 Terminal 或 iTerm 授权辅助功能
- 系统弹窗是否被拒绝过
- 当前是不是在 macOS 上运行

### 4. 微信发出的新问题没真正进入 Codex 的那个任务

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
- 微信发来的新问题，默认会接到“最近一次通知对应的那个 Codex 任务”里继续运行；这个任务也可能来自另一个 Project

## 许可证

MIT
