# GitHub Publish Handoff

This file is the handoff for creating a standalone public GitHub repository without publishing the entire research workspace.

这份文档用于把 `codex-wechat-bridge` 单独发布成公共 GitHub 仓库，而不是把整个研究项目一起推上去。

## Recommended Repository Settings

- Repository name: `codex-wechat-bridge`
- Visibility: `Public`
- Description: `Bridge Codex Desktop and WeChat so Codex task notifications and prompts can flow through your phone on macOS.`
- Do not initialize the GitHub repo with a README, `.gitignore`, or license if you are pushing this prepared directory as-is.

## Option A: Publish from an Exported Standalone Directory

This is the safest option when your current plugin lives inside a larger git repository.

```bash
mkdir -p "$HOME/Desktop/codex-wechat-bridge-release"
rsync -av --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  "<path-to-current-codex-wechat-bridge>/" \
  "$HOME/Desktop/codex-wechat-bridge-release/"

cd "$HOME/Desktop/codex-wechat-bridge-release"
git init
git branch -M main
git add .
git commit -m "Initial public release"
git remote add origin git@github.com:<your-account>/codex-wechat-bridge.git
git push -u origin main
```

## Option B: Publish with HTTPS Remote

If you prefer HTTPS instead of SSH:

```bash
cd "$HOME/Desktop/codex-wechat-bridge-release"
git remote add origin https://github.com/<your-account>/codex-wechat-bridge.git
git push -u origin main
```

GitHub will ask for your login or token depending on your setup.

## Final Checks Before Pushing

Run these inside the standalone release directory:

```bash
node --check codex-wechat-bridge.mjs
node --check codex-wechat-bridge.test.mjs
node --test codex-wechat-bridge.test.mjs
bash -n install.sh
rg -n "/Users/|codex-wechat-bridge-local|\"private\": true" .
```

Expected outcome:

- syntax checks pass
- tests pass
- installer script parses cleanly
- the final `rg` command returns no results

## What To Do If GitHub Push Fails

Common causes:

- GitHub repository was not created yet
- wrong remote URL
- SSH key not configured
- HTTPS token or login not ready

If that happens:

1. Create the repo on GitHub first.
2. Copy the exact remote URL from GitHub.
3. Re-run `git remote set-url origin <your-remote-url>`.
4. Run `git push -u origin main` again.

## Suggested First Release Notes

You can use something like this for the first GitHub release:

```text
First public release of codex-wechat-bridge.

- WeChat task completion and interruption notifications
- WeChat prompt submission into the most recently notified Codex Desktop thread
- macOS desktop automation workflow
- beginner installation guides in Chinese and English
```
