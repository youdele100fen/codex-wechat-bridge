# Codex WeChat Bridge

`codex-wechat-bridge` connects a WeChat ClawBot account to Codex Desktop on macOS.

`codex-wechat-bridge` 用于把微信 ClawBot 账号和 macOS 上的 Codex Desktop 连起来。

It provides two coordinated behaviors:

- `start`: receives WeChat messages and submits them into the most recently notified Codex thread
- `monitor`: watches Codex rollout files and pushes WeChat notifications when tasks complete or abort

核心行为有两部分：

- `start`：接收微信消息，并把它作为新 Prompt 提交到最近一次通知对应的 Codex 线程
- `monitor`：监听 Codex 线程 rollout，在任务完成或中断时发微信通知

`start` already embeds the monitor loop, so in normal daily use one `codex-wechat start` process is enough.

日常使用时，`start` 已经内嵌了 `monitor`，通常只需要保持一个 `codex-wechat start` 进程常驻。

## Requirements / 运行前提

- macOS
- Node.js 18+
- Codex CLI
- Codex Desktop
- WeChat channel credentials created through `claude-code-wechat-channel setup`
- One-time macOS Accessibility permission for `osascript`

This is a desktop-automation bridge, not a generic cross-platform CLI integration.

这不是通用跨平台 CLI 插件，而是依赖 Codex Desktop 和 macOS 自动化能力的桥接工具。

## Quick Start / 3 分钟上手

```bash
git clone <repo-url>
cd codex-wechat-bridge
./install.sh
codex-wechat setup
codex-wechat doctor
codex-wechat start
```

Then:

1. Send the bot one normal WeChat message first.
2. Let Codex finish one task and send you a notification.
3. After that, send your next prompt from WeChat.

然后：

1. 先在微信里给 bot 发一条普通消息。
2. 先让 Codex 完成一次任务并给你发通知。
3. 从这之后，你就可以直接从微信继续发 Prompt。

## Commands / 命令

- `codex-wechat-bridge setup`
- `codex-wechat-bridge doctor`
- `codex-wechat-bridge start`
- `codex-wechat-bridge monitor`
- `codex-wechat setup`
- `codex-wechat doctor`
- `codex-wechat start`
- `codex-wechat monitor`

Useful options / 常用参数:

- `--workspace <dir>`
- `--force-login`
- `--once`

## How Prompt Routing Works / 微信 Prompt 如何路由

- The bridge is in prompt mode only. It does not send instant chat replies.
- Each sender is bound to the most recently notified Codex thread.
- A new WeChat message is submitted into that exact desktop thread.
- If a newer notification comes from another project, the active target switches to that project automatically.
- If there is no current target yet, the bridge sends a short guidance message instead of guessing.

- 当前桥接是纯 Prompt 模式，不再做“微信一句话即时回复一句话”。
- 每个微信发送者都会绑定到“最近一次成功通知”的 Codex 线程。
- 新微信消息会进入那个线程，而不是新开一个独立聊天会话。
- 如果更新的通知来自另一个 Project，当前目标也会自动切换到那个 Project。
- 如果当前没有可续接目标，桥接会直接提示，不会猜测线程。

## Notification Rules / 通知规则

- Successful turns notify when a rollout contains `task_complete` and the turn is not filtered out by monitor exclusions.
- Aborted turns notify only when `turn_aborted.reason != interrupted`.
- Bridge-internal threads, duplicate turns, and pre-bootstrap historical completions are skipped.
- Successful or aborted notifications both refresh the sender's current prompt target.

- 成功任务只要命中 `task_complete` 且未被监控过滤规则排除，就会发通知。
- 中断任务只有在 `turn_aborted.reason != interrupted` 时才会通知。
- 桥接内部线程、重复 turn、以及 monitor 启动前的历史完成事件不会通知。
- 成功通知和中断通知都会刷新该微信用户的当前 Prompt 目标。

## State Files / 状态文件

- Config: `~/.codex/wechat-bridge/config.json`
- Chat cursor: `~/.codex/wechat-bridge/runtime.json`
- Monitor state: `~/.codex/wechat-bridge/monitor.json`
- Sender state: `~/.codex/wechat-bridge/senders/*.json`
- Reused WeChat credentials: `~/.claude/channels/wechat/account.json`

## Documentation / 文档

- Beginner guide (Chinese): [docs/BEGINNER_GUIDE_zh.md](docs/BEGINNER_GUIDE_zh.md)
- Beginner guide (English): [docs/BEGINNER_GUIDE_en.md](docs/BEGINNER_GUIDE_en.md)
- GitHub publishing handoff: [docs/GITHUB_PUBLISH.md](docs/GITHUB_PUBLISH.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Known Limitations / 已知限制

- macOS only
- Codex Desktop must be running for WeChat prompt submission
- Accessibility permission is required for desktop paste and submit
- Prompt routing follows the most recently notified thread, which may be in another project

## Troubleshooting / 常见排障

- Run `codex-wechat doctor` first whenever something looks wrong.
- Check whether Codex Desktop is running and Accessibility permission is granted.
- If WeChat prompts fail, inspect `~/.codex/wechat-bridge/senders/*.json` and look at `lastError`.
- If notifications stop, inspect `~/.codex/wechat-bridge/monitor.json`.

- 任何异常先跑 `codex-wechat doctor`。
- 先确认 Codex Desktop 正在运行，并且已经授予辅助功能权限。
- 如果微信 Prompt 提交失败，优先查看 `~/.codex/wechat-bridge/senders/*.json` 里的 `lastError`。
- 如果通知停止，优先查看 `~/.codex/wechat-bridge/monitor.json`。

## License / 许可证

MIT
