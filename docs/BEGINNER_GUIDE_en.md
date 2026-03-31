# Codex WeChat Bridge Beginner Guide

This guide is for first-time users who want to go from zero to a working setup where Codex sends WeChat notifications and accepts prompts from WeChat.

## 1. What this tool does

`codex-wechat-bridge` connects your WeChat bot to Codex Desktop on macOS.

It gives you two main abilities:

- send a WeChat notification when a Codex task completes
- send a new prompt from WeChat into the most recently notified Codex thread

Important limitations:

- macOS only
- Codex Desktop must be running
- macOS Accessibility permission is required
- WeChat channel login must already work

## 2. What you need before starting

Please make sure you already have:

- a Mac
- Node.js 18 or later
- Codex CLI
- Codex Desktop
- WeChat bot login capability

You can check the basics with:

```bash
node -v
codex --version
```

If both commands print a version, you can continue.

## 3. Download the tool

```bash
git clone <repo-url>
cd codex-wechat-bridge
```

If you downloaded a ZIP from GitHub instead, unzip it first and enter the extracted folder.

## 4. Install the commands

Run:

```bash
./install.sh
```

The installer will:

- verify macOS
- verify the Node.js version
- verify `codex`, `npx`, and `osascript`
- install command links into `~/.local/bin/`

After installation, you can use either of these equivalent commands:

- `codex-wechat-bridge`
- `codex-wechat`

If your terminal still says the command is missing, `~/.local/bin` is probably not in your PATH yet. The installer prints the exact fix.

## 5. Log in to the WeChat bot

Run:

```bash
codex-wechat setup
```

If you want to store a specific default workspace, run it from that project directory or pass:

```bash
codex-wechat setup --workspace "/path/to/your/project"
```

`setup` will launch the WeChat login flow. Scan the QR code and finish login.

Credentials are stored at:

- `~/.claude/channels/wechat/account.json`

## 6. Grant macOS Accessibility permission

The bridge pastes WeChat prompts into the Codex Desktop input box, so Accessibility permission is required.

Typical path:

- System Settings
- Privacy & Security
- Accessibility

Make sure your terminal and related automation calls are allowed.

Without this permission, WeChat prompts cannot be submitted into the desktop thread.

## 7. Run diagnostics

Run:

```bash
codex-wechat doctor
```

Pay special attention to:

- `Codex CLI`
- `Codex Desktop running`
- `macOS Accessibility automation available`
- `WeChat credentials`
- `Monitor status`
- `Recipient binding`

If `Recipient binding` is not ready yet, that usually just means you have not sent the bot your first WeChat message.

## 8. Create the first recipient binding

From your phone, send the bot one normal message first, for example:

```text
hello
```

This lets the bridge save your `contextToken`, which is required before it can send notifications back to you.

## 9. Start the bridge

Run:

```bash
codex-wechat start
```

In normal daily use, `start` already includes the monitor loop, so you usually do not need a separate `monitor` process.

Recommended habit:

- keep exactly one `codex-wechat start` running
- do not launch multiple competing listeners

## 10. Your first real-use flow

The first setup flow should be:

1. Finish one real task in Codex on your computer
2. Wait until WeChat receives a `Codex task complete` notification
3. Only after that, send the next prompt from WeChat

If you send a WeChat prompt before any notification has ever arrived, the bridge will reply with a guidance message instead of guessing a thread target.

## 11. Daily usage

The normal loop is:

1. Keep `codex-wechat start` running
2. Use Codex on your computer as usual
3. When a task completes, you receive a WeChat notification
4. Your next WeChat prompt is routed into the thread from the most recent notification

One important detail:

- the target may belong to another project if the latest notification came from that other project

This is expected behavior in the current version.

## 12. Common problems

### 12.1 `codex-wechat: command not found`

Usually your PATH is missing `~/.local/bin`.

Fix:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Then reopen the terminal and try again.

### 12.2 WeChat does not receive notifications

Run:

```bash
codex-wechat doctor
```

Check:

- `Monitor status`
- `Recipient binding`
- `WeChat credentials`

### 12.3 A WeChat prompt does not actually reach Codex

Check:

- Codex Desktop is running
- Accessibility permission is granted
- you have already received at least one task notification
- `lastError` inside `~/.codex/wechat-bridge/senders/*.json`

### 12.4 The target thread switched to another project

That is expected in the current design.

WeChat prompts always go to the most recently notified thread, even if that thread belongs to another project.

## 13. Where state files live

- config: `~/.codex/wechat-bridge/config.json`
- chat cursor: `~/.codex/wechat-bridge/runtime.json`
- monitor state: `~/.codex/wechat-bridge/monitor.json`
- sender state: `~/.codex/wechat-bridge/senders/*.json`
- WeChat credentials: `~/.claude/channels/wechat/account.json`

## 14. Best health-check command

```bash
codex-wechat doctor
```

Run it again whenever:

- you changed WeChat accounts
- you rebooted the Mac
- Codex Desktop behaves strangely
- WeChat notifications stop
- WeChat prompt submission fails
