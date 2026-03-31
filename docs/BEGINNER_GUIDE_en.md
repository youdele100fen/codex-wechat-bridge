# Codex WeChat Bridge Beginner Guide

This is a step-by-step guide for first-time users.

The flow is:

- download and install the bridge
- complete the two things required for the first successful run
- start the bridge
- run one real end-to-end check

If you want the detailed explanation for WeChat ClawBot or macOS permissions, read:

- [Prerequisites](PREREQUISITES_en.md)

## Step 0: confirm the prerequisites

You need at least:

- a Mac
- Node.js 18 or later
- `npx`
- Codex CLI
- Codex Desktop
- working npm network access so WeChat ClawBot login can be started on demand

Basic checks:

```bash
node -v
npx --version
codex --version
```

What you should see now:

- `node -v` prints a version
- `npx --version` prints a version
- `codex --version` prints a version

## Step 1: download and install the bridge

Clone the repo first:

```bash
git clone https://github.com/youdele100fen/codex-wechat-bridge.git
cd codex-wechat-bridge
```

Install the commands:

```bash
./install.sh
```

After installation you can use:

- `codex-wechat`
- `codex-wechat-bridge`

What you should see now:

- the installer prints the next commands
- your terminal can resolve `codex-wechat`

## Step 2: complete WeChat ClawBot login

Now start the WeChat login step:

```bash
codex-wechat setup
```

One important clarification:

- you do not need to manually preinstall `https://github.com/Johnixr/claude-code-wechat-channel`
- you do not need a separate local WeChat ClawBot plugin first
- `codex-wechat setup` will reuse or trigger the underlying `npx -y claude-code-wechat-channel setup` flow automatically

As long as `node`, `npx`, and npm network access are available, this step can download and run `claude-code-wechat-channel` on demand.

After QR login succeeds, the key success marker is:

- `~/.claude/channels/wechat/account.json` exists

What you should see now:

- the terminal says WeChat login succeeded
- account ID and user ID are shown
- the local credentials file has been written

## Step 3: grant macOS Accessibility in advance

Go to:

- System Settings
- Privacy & Security
- Accessibility

Allow the terminal host app you actually use, for example:

- `Terminal`
- `iTerm`

If macOS later prompts for Automation, Accessibility, or `System Events`, allow that too.

What you should see now:

- your terminal host app is allowed in System Settings
- after Step 4, `codex-wechat doctor` should show `macOS Accessibility automation available` as passing

## Step 4: run `doctor`

Run:

```bash
codex-wechat doctor
```

For first-time setup, pay special attention to:

- `WeChat credentials`
- `Codex Desktop running`
- `macOS Accessibility automation available`
- `Monitor status`

What you should see now:

- `WeChat credentials` passes
- `macOS Accessibility automation available` passes
- if Codex Desktop is open, `Codex Desktop running` should also pass

## Step 5: send one normal message to the bot first

From your phone, send one normal WeChat message to the bot, for example:

```text
hello
```

This lets the bridge store the sender `contextToken`.

What you should see now:

- after running `codex-wechat doctor` again, `Recipient binding` should pass

## Step 6: start `start`

Run:

```bash
codex-wechat start
```

In normal use, `start` already embeds the monitor loop, so you usually do not need a second `monitor` process.

What you should see now:

- the terminal says it is listening for WeChat prompts
- the terminal says monitor is embedded in the current `start` process

## Step 7: complete the first real validation

Use this order:

1. finish one real Codex task on your computer
2. wait for one `Codex task complete` notification in WeChat
3. then send a new prompt from WeChat

This order matters because:

- a new WeChat question is routed into the Codex task from the most recent notification
- before the first notification exists, the bridge has no task target to continue

What you should see now:

- after step 1, WeChat receives the first task notification
- after step 3, your new WeChat question enters that task and continues there
- you do not get an instant chat-style reply; you wait for the next task-complete notification

## Common problems

### 1. The ClawBot prerequisite is not complete

Symptoms:

- `account.json` does not exist
- `WeChat credentials` fails

Important note:

- “I never installed `claude-code-wechat-channel` before” is not the real problem by itself
- the real issue is usually `npx`, network access, npm reachability, or an incomplete QR login

Start with:

```bash
codex-wechat setup
```

If this fails, then check:

- whether `npx` is available
- whether npm is reachable
- whether the QR login actually completed

### 2. `codex-wechat: command not found`

Usually your PATH is missing the install location.

Start by re-running:

```bash
./install.sh
```

Then follow the PATH instructions printed by the installer.

### 3. Accessibility is missing or granted to the wrong app

Symptoms:

- `macOS Accessibility automation available` fails
- WeChat prompts do not enter Codex

Check whether you allowed the correct host application:

- `Terminal`
- `iTerm`
- or whichever terminal host actually runs the command

### 4. WeChat does not receive notifications

Run:

```bash
codex-wechat doctor
```

Focus on:

- `Monitor status`
- `Recipient binding`
- `WeChat credentials`

### 5. A WeChat prompt does not actually enter the Codex thread

Check:

- Codex Desktop is running
- Accessibility passes
- you have already received the first task notification
- `lastError` inside `~/.codex/wechat-bridge/senders/*.json`
