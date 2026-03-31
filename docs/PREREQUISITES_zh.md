# Codex WeChat Bridge 前置准备

这份文档只讲两件事：

- 如何先准备好 **WeChat ClawBot**
- 如何事先完成 **macOS Accessibility** 授权

这两件事不是“必须先于 `git clone` 完成”的步骤。

更准确地说，它们是你在第一次真正跑通桥接前，最终一定要完成的两项准备。

## 1. WeChat ClawBot 是什么

`codex-wechat-bridge` 并不会自己创建微信 bot。

它依赖的是已经可用的 **WeChat ClawBot 通道**。更具体地说，你本机上必须先能完成：

```bash
npx -y claude-code-wechat-channel setup
```

但这不等于你必须先手动安装：

- GitHub 上的 `Johnixr/claude-code-wechat-channel`
- 或某个额外的本地 WeChat ClawBot 插件

对大多数新手来说，并不需要先做单独安装。只要本机有 `node`、`npx`，并且网络能访问 npm，桥接就可以在 `setup` 阶段直接拉起这一步。

桥接里的：

```bash
codex-wechat setup
```

内部也是复用或触发这一套流程，然后读取生成好的凭据文件。

但要注意顺序：

- 你当然可以先 `git clone` 本仓库
- 真正开始微信登录时，再运行 `codex-wechat setup` 就行
- `codex-wechat setup` 内部会复用或触发这条 `npx` 登录流程

## 2. 如何准备 WeChat ClawBot

### Step 1：先确认命令可跑

在终端里执行：

```bash
npx -y claude-code-wechat-channel setup
```

如果这一步能正常开始拉起二维码登录流程，说明你的基础环境已经具备。

这里的关键点是：

- `npx -y` 会按需下载并执行 `claude-code-wechat-channel`
- 所以第一次使用时，用户不需要先去 GitHub 手动 clone 那个仓库
- 也不需要先做单独安装
- 对真正照 README 操作的小白来说，更推荐在安装完本桥接后，直接使用 `codex-wechat setup`

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
- 对小白用户，推荐直接按 README 顺序：先安装桥接，再运行 `codex-wechat setup`

## 4. 如果二维码登录失败，看哪里

优先检查：

- 网络是否正常
- `npx` 是否可用
- npm 是否可访问
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

把微信里的内容粘贴进 Codex Desktop 当前那个任务的输入框，然后真实按下提交。

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

如果你这时还没安装本桥接，请先记住这一步；等安装完成后，再回来执行 `codex-wechat doctor` 复核。

你应该看到：

- `macOS Accessibility automation available` 为通过

## 7. 如果 Accessibility 没配好，会出现什么现象

常见症状有：

- `doctor` 中 `macOS Accessibility automation available` 不通过
- 微信里发出的新问题，没有真正进入 Codex 的那个任务窗口
- Codex 没被拉到前台
- sender state 里的 `lastError` 提示和桌面提交相关

## 8. 前置准备完成后的下一步

当下面两件事都满足后，你就可以进入安装与正式启动：

- `~/.claude/channels/wechat/account.json` 已存在
- `codex-wechat doctor` 中 `macOS Accessibility automation available` 通过

下一步请看：

- [小白教程（中文）](BEGINNER_GUIDE_zh.md)
- [Beginner Guide (English)](BEGINNER_GUIDE_en.md)
