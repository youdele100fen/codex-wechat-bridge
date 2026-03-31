# Codex WeChat Bridge 前置准备

这份文档只讲两件事：

- 如何先准备好 **WeChat ClawBot**
- 如何事先完成 **macOS Accessibility** 授权

如果这两步没完成，后面的 `codex-wechat setup`、`codex-wechat doctor`、`codex-wechat start` 就算装上了，也很容易卡住。

## 1. WeChat ClawBot 是什么

`codex-wechat-bridge` 并不会自己创建微信 bot。

它依赖的是已经可用的 **WeChat ClawBot 通道**。更具体地说，你本机上必须先能完成：

```bash
npx -y claude-code-wechat-channel setup
```

桥接里的：

```bash
codex-wechat setup
```

内部也是复用或触发这一套流程，然后读取生成好的凭据文件。

## 2. 如何准备 WeChat ClawBot

### Step 1：先确认命令可跑

在终端里执行：

```bash
npx -y claude-code-wechat-channel setup
```

如果这一步能正常开始拉起二维码登录流程，说明你的基础环境已经具备。

### Step 2：扫码登录

终端会提示正在获取微信登录二维码。

这时用手机微信扫码，并在手机端确认登录。

### Step 3：确认成功标志

成功后，通常应看到以下几类信息：

- 微信连接成功
- 账号 ID
- 用户 ID
- 凭据保存路径

最关键的成功标志是下面这个文件已经生成：

```text
~/.claude/channels/wechat/account.json
```

## 3. `codex-wechat setup` 和它是什么关系

你也可以不手动执行 `npx -y claude-code-wechat-channel setup`，直接执行：

```bash
codex-wechat setup
```

它会：

- 复用已有的 WeChat ClawBot 凭据
- 或在需要时触发新的二维码登录
- 再把桥接自己的默认配置写到 `~/.codex/wechat-bridge/config.json`

因此，对新手最简单的理解是：

- `claude-code-wechat-channel setup` 是底层登录动作
- `codex-wechat setup` 是桥接对这个动作的封装

## 4. 如果二维码登录失败，看哪里

优先检查：

- 网络是否正常
- `npx` 是否可用
- 终端是否真的出现了二维码获取提示
- 手机是否完成了扫码确认

如果登录结束后仍然没有生成 `account.json`，说明 WeChat ClawBot 前置还没有成功完成。

这时不要继续启动桥接，先把这一步修通。

## 5. 为什么还要做 macOS Accessibility

桥接收到微信 Prompt 后，不是直接把文字交给某个纯 API。

当前实现会用：

- `osascript`
- `System Events`
- Codex Desktop 深链与前台激活

把微信里的 Prompt 粘贴进 Codex Desktop 当前 Thread 输入框，然后真实按下提交。

所以如果 macOS 不允许这类桌面自动化，微信 Prompt 就无法真正进入 Codex。

## 6. 如何事前授权 macOS Accessibility

### Step 1：打开系统设置

进入：

- 系统设置
- 隐私与安全性
- 辅助功能

### Step 2：给终端宿主应用授权

一般需要勾选的是你当前真正运行命令的应用，例如：

- `Terminal`
- `iTerm`

如果你是从其他终端壳层启动，也要确认对应宿主应用已被允许。

### Step 3：允许系统弹窗

第一次运行桌面提交时，macOS 可能会弹出和自动化相关的授权提示。

如果出现以下类型提示，应允许：

- 辅助功能
- 自动化
- 控制 `System Events`

### Step 4：用 doctor 复核

授权完成后执行：

```bash
codex-wechat doctor
```

你应该看到：

- `macOS Accessibility automation available` 为通过

## 7. 如果 Accessibility 没配好，会出现什么现象

常见症状有：

- `doctor` 中 `macOS Accessibility automation available` 不通过
- 微信 Prompt 发出后，没有真正进入 Codex Thread
- Codex 没被拉到前台
- sender state 里的 `lastError` 提示和桌面提交相关

## 8. 前置准备完成后的下一步

当下面两件事都满足后，你就可以进入安装与正式启动：

- `~/.claude/channels/wechat/account.json` 已存在
- `codex-wechat doctor` 中 `macOS Accessibility automation available` 通过

下一步请看：

- [小白教程（中文）](BEGINNER_GUIDE_zh.md)
- [Beginner Guide (English)](BEGINNER_GUIDE_en.md)
