# Codex WeChat Bridge Prerequisites

This document covers only two things:

- how to prepare **WeChat ClawBot**
- how to grant **macOS Accessibility** permission in advance

If these two prerequisites are not ready, `codex-wechat setup`, `codex-wechat doctor`, and `codex-wechat start` will be much more likely to fail.

## 1. What WeChat ClawBot means here

`codex-wechat-bridge` does not create a WeChat bot by itself.

It depends on an already working **WeChat ClawBot channel**. In practice, your machine must be able to complete:

```bash
npx -y claude-code-wechat-channel setup
```

But this does not mean you must manually preinstall:

- the GitHub repo `Johnixr/claude-code-wechat-channel`
- or some extra local WeChat ClawBot plugin

For most beginners, no separate preinstallation is required. If `node`, `npx`, and normal npm network access are available, the bridge can trigger this step directly during setup.

The bridge command:

```bash
codex-wechat setup
```

reuses or triggers that same flow and then reads the generated credentials file.

But order matters:

- if you have not run `git clone` and `./install.sh` yet
- then you usually do **not** have the `codex-wechat` command yet
- so before installation, the direct preflight command is `npx -y claude-code-wechat-channel setup`

## 2. How to prepare WeChat ClawBot

### Step 1: make sure the setup command can run

Run:

```bash
npx -y claude-code-wechat-channel setup
```

If this starts the QR-code login flow, your base environment is ready.

The important detail is:

- `npx -y` downloads and runs `claude-code-wechat-channel` on demand
- so first-time users do not need to manually clone that GitHub repo first
- and they do not need a separate install step before using `codex-wechat`
- before the bridge is installed, this `npx` command is the one to run first, not `codex-wechat setup`

### Step 2: scan the QR code

The terminal should show that it is fetching a WeChat login QR code.

Use your phone to scan it and confirm login inside WeChat.

### Step 3: confirm the success markers

After a successful login, you should normally see output such as:

- WeChat connection succeeded
- account ID
- user ID
- credentials save path

The most important success marker is that this file now exists:

```text
~/.claude/channels/wechat/account.json
```

## 3. How this relates to `codex-wechat setup`

You can skip the raw `npx` command and simply run:

```bash
codex-wechat setup
```

This will:

- reuse existing WeChat ClawBot credentials
- or trigger a fresh QR login when needed
- then write bridge config to `~/.codex/wechat-bridge/config.json`

The simplest mental model is:

- `claude-code-wechat-channel setup` is the underlying login flow
- `codex-wechat setup` is the bridge-friendly wrapper around it
- once the bridge is installed, `codex-wechat setup` becomes the most convenient entry point
- before the bridge is installed, the correct first entry point is `npx -y claude-code-wechat-channel setup`

## 4. If QR login fails, check these first

Start with:

- whether the network is working
- whether `npx` is available
- whether npm is reachable
- whether the terminal really showed the QR login flow
- whether the phone finished the scan-and-confirm step

If login finishes but `account.json` still does not exist, the WeChat ClawBot prerequisite is not complete yet.

Do not continue to start the bridge until this is fixed.

## 5. Why macOS Accessibility is also required

When the bridge receives a WeChat prompt, it does not submit it through a generic API.

The current implementation uses:

- `osascript`
- `System Events`
- Codex Desktop deep links and app activation

to paste the WeChat text into the Codex Desktop input box and submit it for real.

So if macOS blocks desktop automation, the WeChat prompt cannot truly enter Codex.

## 6. How to grant macOS Accessibility in advance

### Step 1: open System Settings

Go to:

- System Settings
- Privacy & Security
- Accessibility

### Step 2: allow the terminal host app

Usually you need to allow the actual terminal app that runs the command, for example:

- `Terminal`
- `iTerm`

If you use another terminal host, allow that host app instead.

### Step 3: allow pop-up prompts

The first desktop submission may trigger system prompts related to automation.

If macOS asks for permission involving any of these, allow it:

- Accessibility
- Automation
- controlling `System Events`

### Step 4: verify with doctor

After granting permission, run:

```bash
codex-wechat doctor
```

If the bridge is not installed yet, just remember this verification step for later and run it after installation.

You should see:

- `macOS Accessibility automation available` as passing

## 7. Symptoms of missing Accessibility permission

Common symptoms include:

- `macOS Accessibility automation available` fails in `doctor`
- a new WeChat question does not actually enter the target Codex task window
- Codex does not come to the foreground
- the sender state `lastError` mentions desktop submission problems

## 8. What to do next

Once both of these are true:

- `~/.claude/channels/wechat/account.json` exists
- `macOS Accessibility automation available` passes in `codex-wechat doctor`

you can move on to the full setup guide:

- [Beginner Guide (English)](BEGINNER_GUIDE_en.md)
- [小白教程（中文）](BEGINNER_GUIDE_zh.md)
