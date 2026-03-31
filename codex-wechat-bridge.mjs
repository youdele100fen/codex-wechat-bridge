#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const BRIDGE_NAME = "codex-wechat-bridge";
const BRIDGE_ALIASES = [BRIDGE_NAME, "codex-wechat"];
const BRIDGE_VERSION = "0.3.0";
const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";
const MSG_TYPE_USER = 1;
const MSG_TYPE_BOT = 2;
const MSG_STATE_FINISH = 2;
const MSG_ITEM_TEXT = 1;
const MSG_ITEM_VOICE = 3;
const DEFAULT_WORKSPACE = path.resolve(process.cwd());
const STATE_DB_FILE = path.join(os.homedir(), ".codex", "state_5.sqlite");
const INTERNAL_THREAD_MARKERS = [
  "你正在通过微信桥接代表 Codex 回复真实用户。",
  "只输出最终要发送给微信用户的纯文本。",
  "当前微信用户标识:"
];
const MAX_NOTIFIED_TURNS = 200;
const MAX_SENT_DELIVERY_KEYS = 1000;
const PROMPT_RESUME_STARTUP_WAIT_MS = 2000;
const DESKTOP_THREAD_OPEN_SETTLE_MS = 2000;
const PROMPT_SUBMISSION_OBSERVE_TIMEOUT_MS = 12000;
const PROMPT_SUBMISSION_POLL_MS = 250;
const PROMPT_TARGET_REQUIRED_MESSAGE = "当前还没有可续接的 Codex 任务。请先在 Codex 中完成一次任务并收到通知后，再从微信发送 Prompt。";
const DEFAULT_CONFIG = {
  workspace: DEFAULT_WORKSPACE,
  historyLimit: 10,
  codexTimeoutMs: 240000,
  longPollTimeoutMs: 35000,
  retryDelayMs: 2000,
  maxRecentFingerprints: 50,
  maxReplyChars: 1800,
  baseUrl: DEFAULT_BASE_URL,
  monitorAllProjects: true,
  monitorPollMs: 5000,
  notifyMaxChars: 700
};

const HOME = os.homedir();
const STATE_ROOT = path.join(HOME, ".codex", "wechat-bridge");
const CONFIG_FILE = path.join(STATE_ROOT, "config.json");
const RUNTIME_FILE = path.join(STATE_ROOT, "runtime.json");
const MONITOR_FILE = path.join(STATE_ROOT, "monitor.json");
const SENDERS_DIR = path.join(STATE_ROOT, "senders");
const LEGACY_CREDENTIALS_FILE = path.join(HOME, ".claude", "channels", "wechat", "account.json");

const usage = `Usage: ${BRIDGE_NAME} <command> [options]

Commands:
  setup              Reuse or refresh WeChat credentials and write default config
  doctor             Run environment and connectivity checks
  start              Start the long-poll chat bridge
  monitor            Watch Codex threads and notify WeChat when tasks complete
  help               Show this help

Options:
  --workspace <dir>  Override the stored default workspace for setup/start/doctor
  --force-login      Force a new WeChat QR login during setup
  --once             Run a single cycle during start or monitor
`;

function log(message) {
  process.stderr.write(`[${BRIDGE_NAME}] ${message}\n`);
}

function fail(message, code = 1) {
  process.stderr.write(`[${BRIDGE_NAME}] ERROR: ${message}\n`);
  process.exit(code);
}

function ensureStateDirs() {
  fs.mkdirSync(STATE_ROOT, { recursive: true });
  fs.mkdirSync(SENDERS_DIR, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function inspectJsonFile(file) {
  if (!fs.existsSync(file)) {
    return { ok: true, detail: "not yet created" };
  }
  try {
    JSON.parse(fs.readFileSync(file, "utf-8"));
    return { ok: true, detail: file };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

function parseArgs(argv) {
  const result = { command: "help", options: {} };
  const [command, ...rest] = argv;
  if (command) {
    result.command = command;
  }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--force-login") {
      result.options.forceLogin = true;
      continue;
    }
    if (arg === "--once") {
      result.options.once = true;
      continue;
    }
    if (arg === "--workspace") {
      const value = rest[index + 1];
      if (!value) {
        fail("--workspace requires a path");
      }
      result.options.workspace = path.resolve(value);
      index += 1;
      continue;
    }
    fail(`Unknown option: ${arg}`);
  }
  return result;
}

function mergeConfig(input = {}) {
  const safeInput = input && typeof input === "object" ? input : {};
  const {
    monitorEnabled,
    notifyMinDurationMs,
    notifyMinToolCalls,
    ...rest
  } = safeInput;

  return {
    ...DEFAULT_CONFIG,
    ...rest
  };
}

function loadConfig() {
  return mergeConfig(readJson(CONFIG_FILE, {}));
}

function saveConfig(config) {
  writeJson(CONFIG_FILE, mergeConfig(config));
}

function loadRuntime() {
  const runtime = readJson(RUNTIME_FILE, {});
  return {
    syncBuf: typeof runtime?.syncBuf === "string" ? runtime.syncBuf : "",
    accountId: typeof runtime?.accountId === "string" ? runtime.accountId : "",
    updatedAt: typeof runtime?.updatedAt === "string" ? runtime.updatedAt : ""
  };
}

function saveRuntime(runtime) {
  writeJson(RUNTIME_FILE, {
    syncBuf: typeof runtime?.syncBuf === "string" ? runtime.syncBuf : "",
    accountId: typeof runtime?.accountId === "string" ? runtime.accountId : "",
    updatedAt: runtime?.updatedAt || new Date().toISOString()
  });
}

function normalizeActiveTurn(turn = {}) {
  return {
    startedAt: typeof turn?.startedAt === "string" ? turn.startedAt : "",
    toolCallCount: Number.isFinite(turn?.toolCallCount)
      ? Math.max(0, Math.floor(turn.toolCallCount))
      : turn?.hasToolCall
        ? 1
        : 0,
    lastAssistantText: typeof turn?.lastAssistantText === "string" ? turn.lastAssistantText : "",
    lastUserPrompt: typeof turn?.lastUserPrompt === "string" ? turn.lastUserPrompt : ""
  };
}

function normalizePendingNotification(notification = {}) {
  return {
    kind: notification?.kind === "aborted" ? "aborted" : "complete",
    turnId: typeof notification?.turnId === "string" ? notification.turnId : "",
    deliveryKey: typeof notification?.deliveryKey === "string" ? notification.deliveryKey : "",
    threadTitle: typeof notification?.threadTitle === "string" ? notification.threadTitle : "",
    completedAt: typeof notification?.completedAt === "string" ? notification.completedAt : "",
    summary: typeof notification?.summary === "string" ? notification.summary : "",
    prompt: typeof notification?.prompt === "string" ? notification.prompt : "",
    durationMs: Number.isFinite(notification?.durationMs) ? notification.durationMs : 0,
    toolCallCount: Number.isFinite(notification?.toolCallCount)
      ? Math.max(0, Math.floor(notification.toolCallCount))
      : notification?.hasToolCall
        ? 1
        : 0,
    reason: typeof notification?.reason === "string" ? notification.reason : "",
    attempts: Number.isFinite(notification?.attempts) ? notification.attempts : 0,
    lastAttemptAt: typeof notification?.lastAttemptAt === "string" ? notification.lastAttemptAt : "",
    error: typeof notification?.error === "string" ? notification.error : ""
  };
}

function normalizeThreadMonitorState(thread = {}) {
  const activeTurns = {};
  for (const [turnId, value] of Object.entries(thread?.activeTurns || {})) {
    if (typeof turnId === "string" && turnId) {
      activeTurns[turnId] = normalizeActiveTurn(value);
    }
  }

  const pendingNotifications = {};
  for (const [turnId, value] of Object.entries(thread?.pendingNotifications || {})) {
    if (typeof turnId === "string" && turnId) {
      pendingNotifications[turnId] = normalizePendingNotification(value);
    }
  }

  const notifiedTurnIds = Array.isArray(thread?.notifiedTurnIds)
    ? thread.notifiedTurnIds.filter((value) => typeof value === "string" && value)
    : [];

  return {
    rolloutPath: typeof thread?.rolloutPath === "string" ? thread.rolloutPath : "",
    offset: Number.isFinite(thread?.offset) ? thread.offset : 0,
    currentTurnId: typeof thread?.currentTurnId === "string" ? thread.currentTurnId : "",
    notifiedTurnIds: notifiedTurnIds.slice(-MAX_NOTIFIED_TURNS),
    pendingNotifications,
    activeTurns
  };
}

function normalizeSentDeliveryKeys(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string" && value).slice(-MAX_SENT_DELIVERY_KEYS)
    : [];
}

function loadMonitorState() {
  const state = readJson(MONITOR_FILE, {});
  const threads = {};
  for (const [threadId, value] of Object.entries(state?.threads || {})) {
    if (typeof threadId === "string" && threadId) {
      threads[threadId] = normalizeThreadMonitorState(value);
    }
  }

  return {
    accountId: typeof state?.accountId === "string" ? state.accountId : "",
    bootstrappedAt: typeof state?.bootstrappedAt === "string" ? state.bootstrappedAt : "",
    threads,
    sentDeliveryKeys: normalizeSentDeliveryKeys(state?.sentDeliveryKeys),
    lastError: state?.lastError && typeof state.lastError === "object" ? state.lastError : null,
    lastSuccessAt: typeof state?.lastSuccessAt === "string" ? state.lastSuccessAt : "",
    updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : ""
  };
}

function saveMonitorState(state) {
  writeJson(MONITOR_FILE, {
    accountId: typeof state?.accountId === "string" ? state.accountId : "",
    bootstrappedAt: typeof state?.bootstrappedAt === "string" ? state.bootstrappedAt : "",
    threads: state?.threads || {},
    sentDeliveryKeys: normalizeSentDeliveryKeys(state?.sentDeliveryKeys),
    lastError: state?.lastError || null,
    lastSuccessAt: typeof state?.lastSuccessAt === "string" ? state.lastSuccessAt : "",
    updatedAt: new Date().toISOString()
  });
}

function resolveRuntimeSync(runtime, credentials) {
  if (!runtime.accountId) {
    return {
      syncBuf: "",
      reason: runtime.syncBuf ? "runtime has legacy sync cursor without bound bot; ignoring stale cursor" : "runtime is empty"
    };
  }

  if (runtime.accountId !== credentials.accountId) {
    return {
      syncBuf: "",
      reason: `runtime bot changed from ${runtime.accountId} to ${credentials.accountId}; resetting sync cursor`
    };
  }

  return {
    syncBuf: runtime.syncBuf || "",
    reason: `runtime bound to current bot ${runtime.accountId}`
  };
}

function resolveMonitorStateAccount(state, credentials) {
  if (!state.accountId) {
    state.accountId = credentials.accountId;
    state.bootstrappedAt = state.bootstrappedAt || new Date().toISOString();
    return "monitor state initialized for current bot";
  }

  if (state.accountId !== credentials.accountId) {
    state.accountId = credentials.accountId;
    state.bootstrappedAt = new Date().toISOString();
    state.threads = {};
    state.lastError = null;
    return "monitor bot changed; resetting monitor offsets";
  }

  state.bootstrappedAt = state.bootstrappedAt || new Date().toISOString();
  return `monitor state bound to current bot ${state.accountId}`;
}

function senderStatePath(senderId) {
  const hash = crypto.createHash("sha1").update(senderId).digest("hex");
  return path.join(SENDERS_DIR, `${hash}.json`);
}

function clearSenderPromptTarget(state) {
  state.lastNotifiedThreadId = "";
  state.lastNotifiedCwd = "";
  state.lastNotifiedTurnId = "";
  state.lastNotifiedKind = "";
  state.lastNotifiedAt = "";
  state.lastNotificationTitle = "";
  state.lastNotificationPrompt = "";
  return state;
}

function normalizeSenderState(input, senderId, accountId = "") {
  const safeInput = input && typeof input === "object" ? input : {};
  const state = {
    senderId,
    accountId: typeof safeInput.accountId === "string" ? safeInput.accountId : "",
    contextToken: typeof safeInput.contextToken === "string" ? safeInput.contextToken : "",
    history: Array.isArray(safeInput.history) ? safeInput.history : [],
    recentFingerprints: Array.isArray(safeInput.recentFingerprints) ? safeInput.recentFingerprints : [],
    lastError: safeInput.lastError && typeof safeInput.lastError === "object" ? safeInput.lastError : null,
    lastNotifiedThreadId: typeof safeInput.lastNotifiedThreadId === "string" ? safeInput.lastNotifiedThreadId : "",
    lastNotifiedCwd: typeof safeInput.lastNotifiedCwd === "string" ? safeInput.lastNotifiedCwd : "",
    lastNotifiedTurnId: typeof safeInput.lastNotifiedTurnId === "string" ? safeInput.lastNotifiedTurnId : "",
    lastNotifiedKind: typeof safeInput.lastNotifiedKind === "string" ? safeInput.lastNotifiedKind : "",
    lastNotifiedAt: typeof safeInput.lastNotifiedAt === "string" ? safeInput.lastNotifiedAt : "",
    lastNotificationTitle: typeof safeInput.lastNotificationTitle === "string" ? safeInput.lastNotificationTitle : "",
    lastNotificationPrompt: typeof safeInput.lastNotificationPrompt === "string" ? safeInput.lastNotificationPrompt : ""
  };

  if (accountId && state.accountId && state.accountId !== accountId) {
    state.accountId = accountId;
    state.contextToken = "";
    state.history = [];
    state.recentFingerprints = [];
    state.lastError = null;
    clearSenderPromptTarget(state);
    return state;
  }

  if (accountId) {
    state.accountId = accountId;
  }

  return state;
}

function loadSenderState(senderId, accountId = "") {
  const file = senderStatePath(senderId);
  return normalizeSenderState(readJson(file, null), senderId, accountId);
}

function saveSenderState(senderId, state, accountId = "") {
  writeJson(senderStatePath(senderId), normalizeSenderState(state, senderId, accountId));
}

function currentPromptTarget(state) {
  if (!state?.lastNotifiedThreadId || !state?.lastNotifiedCwd) {
    return null;
  }
  return {
    threadId: state.lastNotifiedThreadId,
    cwd: state.lastNotifiedCwd
  };
}

function normalizePromptForRolloutMatch(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

function buildDesktopThreadOpenArgs(deepLink) {
  return [String(deepLink || "").trim()];
}

function buildAccessibilityCheckArgs() {
  return ['-e', 'tell application "System Events" to UI elements enabled'];
}

function buildDesktopPromptSubmissionArgs(promptFile) {
  return [
    "-e",
    `on run argv
set promptFile to item 1 of argv
set promptText to read (POSIX file promptFile) as «class utf8»
set previousClipboard to missing value
try
  set previousClipboard to the clipboard
end try
set the clipboard to promptText
tell application "Codex" to activate
delay 1.0
tell application "System Events"
  keystroke "v" using command down
  delay 0.2
  key code 36
end tell
delay 0.2
if previousClipboard is not missing value then
  try
    set the clipboard to previousClipboard
  end try
end if
end run`,
    "--",
    promptFile
  ];
}

function inspectCodexDesktopRunning() {
  const result = runCommandSync("ps", ["-ax", "-o", "pid=,command="]);
  if (result.status !== 0) {
    return {
      ok: false,
      detail: (result.stderr || result.stdout || "ps query failed").trim()
    };
  }

  const matches = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("/Applications/Codex.app/Contents/MacOS/Codex"));

  return {
    ok: matches.length > 0,
    detail: matches.length ? matches.join(", ") : "Codex Desktop not running"
  };
}

function inspectMacAccessibilityAutomation() {
  if (process.platform !== "darwin") {
    return { ok: false, detail: "desktop automation is only supported on macOS" };
  }

  const result = runCommandSync("osascript", buildAccessibilityCheckArgs());
  const detail = (result.stdout || result.stderr || "").trim() || "Accessibility check failed";
  return {
    ok: result.status === 0 && /true/i.test(String(result.stdout || "")),
    detail
  };
}

function displayProjectLabel(cwd) {
  const label = projectLabelFromCwd(cwd);
  return label === "none" ? "未知 Project" : label;
}

function buildPromptResumeFailedMessage(target) {
  return `这条 Prompt 暂未成功提交到桌面 Codex 当前任务（Project：${displayProjectLabel(target?.cwd)}）。请确认 Codex Desktop 正在运行、已授予辅助功能权限，并且目标 Thread 仍可在桌面端打开后再试。`;
}

function createBridgeError(stage, message) {
  const error = new Error(message);
  error.bridgeStage = stage;
  return error;
}

function buildPromptResumeErrorState(target, error) {
  return {
    stage:
      typeof error?.bridgeStage === "string" && error.bridgeStage
        ? error.bridgeStage
        : "desktop-submit",
    at: new Date().toISOString(),
    threadId: typeof target?.threadId === "string" ? target.threadId : "",
    cwd: typeof target?.cwd === "string" ? target.cwd : "",
    project: displayProjectLabel(target?.cwd),
    message: String(error)
  };
}

function classifyResumeFailure(error) {
  const message = String(error);
  const stage = typeof error?.bridgeStage === "string" ? error.bridgeStage : "";
  if (stage === "desktop-open-thread") {
    return { kind: "desktop thread open failed", detail: message };
  }
  if (stage === "desktop-focus") {
    return { kind: "desktop automation unavailable", detail: message };
  }
  if (stage === "desktop-paste") {
    return { kind: "desktop paste failed", detail: message };
  }
  if (stage === "desktop-submit") {
    return { kind: "desktop submit failed", detail: message };
  }
  if (stage === "desktop-confirm-user-message") {
    return { kind: "desktop submission not observed in rollout", detail: message };
  }
  if (stage === "desktop-confirm-task-started") {
    return { kind: "desktop task start not observed", detail: message };
  }
  if (message.includes("target workspace does not exist")) {
    return { kind: "target workspace missing", detail: message };
  }
  if (message.includes("missing target thread id")) {
    return { kind: "target thread missing", detail: message };
  }
  if (message.includes("Codex Desktop not running")) {
    return { kind: "desktop not running", detail: message };
  }
  if (message.includes("Accessibility")) {
    return { kind: "accessibility permission unavailable", detail: message };
  }
  if (message.includes("exited with code")) {
    return { kind: "desktop automation exited early", detail: message };
  }
  return { kind: "desktop prompt submission error", detail: message };
}

function updateSenderPromptTarget(state, thread, notification) {
  state.lastNotifiedThreadId = typeof thread?.id === "string" ? thread.id : "";
  state.lastNotifiedCwd = typeof thread?.cwd === "string" ? thread.cwd : "";
  state.lastNotifiedTurnId = typeof notification?.turnId === "string" ? notification.turnId : "";
  state.lastNotifiedKind = notification?.kind === "aborted" ? "aborted" : "complete";
  state.lastNotifiedAt = typeof notification?.completedAt === "string" ? notification.completedAt : new Date().toISOString();
  state.lastNotificationTitle = typeof thread?.title === "string" ? thread.title : "";
  state.lastNotificationPrompt = typeof notification?.prompt === "string" ? notification.prompt : "";
  return state;
}

function projectLabelFromCwd(cwd) {
  const safeCwd = String(cwd || "").trim();
  if (!safeCwd) {
    return "none";
  }
  return path.basename(safeCwd) || safeCwd;
}

function isValidCredentials(data) {
  return Boolean(
    data &&
      typeof data.token === "string" &&
      data.token &&
      typeof data.baseUrl === "string" &&
      data.baseUrl &&
      typeof data.accountId === "string" &&
      data.accountId
  );
}

function loadCredentials() {
  const credentials = readJson(LEGACY_CREDENTIALS_FILE, null);
  return isValidCredentials(credentials) ? credentials : null;
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(token, body) {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin()
  };
  if (body) {
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf-8"));
  }
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function apiPost({ baseUrl, endpoint, token, body, timeoutMs }) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(endpoint, base).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(token, body),
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return text;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function getUpdates(baseUrl, token, syncBuf, timeoutMs) {
  try {
    const raw = await apiPost({
      baseUrl,
      endpoint: "ilink/bot/getupdates",
      token,
      timeoutMs,
      body: JSON.stringify({
        get_updates_buf: syncBuf,
        base_info: { channel_version: BRIDGE_VERSION }
      })
    });
    return { data: JSON.parse(raw), aborted: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        data: {
          ret: 0,
          msgs: [],
          get_updates_buf: syncBuf
        },
        aborted: true
      };
    }
    throw error;
  }
}

async function fetchQRCode(baseUrl) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${base}ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`QR fetch failed: ${response.status}`);
  }
  return response.json();
}

function extractTextFromMessage(message) {
  if (!Array.isArray(message.item_list) || message.item_list.length === 0) {
    return "";
  }

  for (const item of message.item_list) {
    if (item.type === MSG_ITEM_TEXT && item.text_item?.text) {
      return item.text_item.text;
    }

    if (item.type === MSG_ITEM_VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }

  return "";
}

function plainTextReply(text, maxChars) {
  let output = sanitizeNotificationField(text, maxChars, "");
  if (!output) {
    output = "我这边暂时没有生成可发送的回复，请你再发一次。";
  }
  return output;
}

function sanitizeNotificationField(text, maxChars, fallback = "") {
  let output = String(text || "").trim();
  output = output.replace(/```[a-zA-Z0-9_-]*\n?/g, "");
  output = output.replace(/```/g, "");
  output = output.replace(/`([^`]+)`/g, "$1");
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2");
  output = output.replace(/^#{1,6}\s*/gm, "");
  output = output.replace(/\*\*([^*]+)\*\*/g, "$1");
  output = output.replace(/\*([^*]+)\*/g, "$1");
  output = output.replace(/__([^_]+)__/g, "$1");
  output = output.replace(/_([^_]+)_/g, "$1");
  output = output.replace(/\r/g, "");
  output = output.replace(/\n{3,}/g, "\n\n");
  output = output.trim();
  if (!output) {
    output = String(fallback || "").trim();
  }
  if (output && output.length > maxChars) {
    output = `${output.slice(0, maxChars - 1).trim()}…`;
  }
  return output;
}

function buildProjectLabel(thread) {
  const rawCwd = sanitizeNotificationField(thread?.cwd || "", 240, "");
  if (!rawCwd) {
    return "未知 Project";
  }

  const trimmedCwd = rawCwd.replace(/[\\/]+$/, "");
  const projectName = path.basename(trimmedCwd) || rawCwd;
  return sanitizeNotificationField(projectName, 80, "未知 Project");
}

function buildThreadLabel(thread) {
  return sanitizeNotificationField(thread?.title || "", 120, "未命名线程");
}

function buildPromptLabel(notification) {
  return sanitizeNotificationField(notification?.prompt || "", 180, "未记录 Prompt");
}

function messageFingerprint(message, text) {
  const stable = {
    from_user_id: message.from_user_id ?? "",
    context_token: message.context_token ?? "",
    client_id: message.client_id ?? "",
    message_type: message.message_type ?? "",
    item_list: message.item_list ?? [],
    text
  };
  return crypto.createHash("sha1").update(JSON.stringify(stable)).digest("hex");
}

function pushHistory(history, entry, limit) {
  const next = [...history, entry];
  return next.slice(-Math.max(limit, 2));
}

function buildPrompt(senderId, history) {
  const transcript = history
    .map((entry) => `${entry.role === "assistant" ? "助手" : "用户"}: ${entry.text}`)
    .join("\n");

  return [
    "你正在通过微信桥接代表 Codex 回复真实用户。",
    "只输出最终要发送给微信用户的纯文本。",
    "默认用中文，除非用户明确使用其他语言。",
    "保持简洁、自然、可直接发送。",
    "不要使用 Markdown、标题、代码块或项目符号。",
    "如果信息不足，只提出一个最关键的澄清问题。",
    `当前微信用户标识: ${senderId}`,
    "",
    "最近对话:",
    transcript
  ].join("\n");
}

function tail(text, lines = 20) {
  return String(text || "")
    .trim()
    .split("\n")
    .slice(-lines)
    .join("\n");
}

async function runCodexReply(config, senderId, history) {
  const prompt = buildPrompt(senderId, history);
  const outputFile = path.join(os.tmpdir(), `${BRIDGE_NAME}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`);

  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "-C",
      config.workspace,
      "--color",
      "never",
      "-o",
      outputFile,
      "-"
    ];

    const child = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }
      stderr += `\nTimed out after ${config.codexTimeoutMs}ms`;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, config.codexTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      finished = true;
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      finished = true;
      let reply = "";
      try {
        reply = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf-8") : "";
      } catch {
        reply = "";
      } finally {
        try {
          fs.unlinkSync(outputFile);
        } catch {}
      }

      if (code === 0 && reply.trim()) {
        resolve(plainTextReply(reply, config.maxReplyChars));
        return;
      }

      reject(
        new Error(
          [
            `codex exec exited with code ${code ?? "unknown"}`,
            tail(stderr || stdout, 25)
          ]
            .filter(Boolean)
            .join("\n")
        )
      );
    });

    child.stdin.end(prompt);
  });
}

async function runCodexResumePrompt(config, target, prompt) {
  if (!target?.threadId) {
    throw createBridgeError("desktop-open-thread", "missing target thread id");
  }
  if (!target?.cwd || !fs.existsSync(target.cwd)) {
    throw createBridgeError(
      "desktop-open-thread",
      `target workspace does not exist: ${target?.cwd || "(empty)"}`
    );
  }

  const desktopState = inspectCodexDesktopRunning();
  if (!desktopState.ok) {
    throw createBridgeError("desktop-open-thread", desktopState.detail);
  }

  const accessibilityState = inspectMacAccessibilityAutomation();
  if (!accessibilityState.ok) {
    throw createBridgeError("desktop-focus", accessibilityState.detail);
  }

  const thread = findThreadById(target.threadId);
  if (!thread) {
    throw createBridgeError("desktop-open-thread", `thread missing in Codex state DB: ${target.threadId}`);
  }
  if (!thread.rolloutPath) {
    throw createBridgeError("desktop-confirm-user-message", `thread rollout path is missing: ${target.threadId}`);
  }
  if (!fs.existsSync(thread.rolloutPath)) {
    throw createBridgeError(
      "desktop-confirm-user-message",
      `thread rollout file does not exist: ${thread.rolloutPath}`
    );
  }

  const startOffset = getFileSize(thread.rolloutPath);
  const promptFile = path.join(
    os.tmpdir(),
    `${BRIDGE_NAME}-desktop-prompt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`
  );
  fs.writeFileSync(promptFile, prompt, "utf-8");

  try {
    const openResult = runCommandSync(
      "open",
      buildDesktopThreadOpenArgs(buildCodexThreadDeepLink(target.threadId))
    );
    if (openResult.status !== 0) {
      throw createBridgeError(
        "desktop-open-thread",
        [
          `open exited with code ${openResult.status ?? "unknown"}`,
          tail(openResult.stderr || openResult.stdout || "", 10)
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    await sleep(DESKTOP_THREAD_OPEN_SETTLE_MS);

    const submitResult = runCommandSync("osascript", buildDesktopPromptSubmissionArgs(promptFile));
    if (submitResult.status !== 0) {
      throw createBridgeError(
        "desktop-submit",
        [
          `osascript exited with code ${submitResult.status ?? "unknown"}`,
          tail(submitResult.stderr || submitResult.stdout || "", 10)
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    await observePromptSubmission(thread, prompt, startOffset);
  } finally {
    try {
      fs.unlinkSync(promptFile);
    } catch {}
  }
}

function buildCodexThreadDeepLink(threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  return `codex://threads/${encodeURIComponent(normalizedThreadId)}`;
}

function buildDesktopRefreshDeepLinks(threadId) {
  const targetDeepLink = buildCodexThreadDeepLink(threadId);
  return ["codex://threads/new", targetDeepLink];
}

function buildDesktopRefreshArgs(deepLink) {
  return ["-g", String(deepLink || "").trim()];
}

function refreshCodexDesktopThread(threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId || process.platform !== "darwin") {
    return;
  }

  for (const deepLink of buildDesktopRefreshDeepLinks(normalizedThreadId)) {
    const result = runCommandSync("open", buildDesktopRefreshArgs(deepLink));
    if (result.status === 0) {
      continue;
    }

    throw new Error(
      [
        `open exited with code ${result.status ?? "unknown"}`,
        tail(result.stderr || result.stdout || "", 10)
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function observePromptSubmission(thread, prompt, startOffset) {
  const normalizedPrompt = normalizePromptForRolloutMatch(prompt);
  const rolloutPath = thread.rolloutPath;
  let offset = startOffset;
  let sawMatchingUserMessage = false;
  let sawTaskStarted = false;
  const deadline = Date.now() + PROMPT_SUBMISSION_OBSERVE_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    if (!fs.existsSync(rolloutPath)) {
      throw createBridgeError(
        "desktop-confirm-user-message",
        `thread rollout file disappeared: ${rolloutPath}`
      );
    }

    const size = getFileSize(rolloutPath);
    if (size < offset) {
      offset = 0;
    }

    const { lines, nextOffset } = readJsonlAppend(rolloutPath, offset);
    offset = nextOffset;

    for (const record of lines) {
      if (record?.type !== "event_msg" || !record.payload) {
        continue;
      }
      if (record.payload.type === "task_started") {
        sawTaskStarted = true;
      }
      if (
        record.payload.type === "user_message" &&
        normalizePromptForRolloutMatch(record.payload.message) === normalizedPrompt
      ) {
        sawMatchingUserMessage = true;
      }
    }

    if (sawMatchingUserMessage && sawTaskStarted) {
      return;
    }

    await sleep(PROMPT_SUBMISSION_POLL_MS);
  }

  if (!sawMatchingUserMessage) {
    throw createBridgeError(
      "desktop-confirm-user-message",
      "did not observe matching user_message in rollout after desktop submission"
    );
  }

  throw createBridgeError(
    "desktop-confirm-task-started",
    "observed matching user_message but did not observe task_started in rollout after desktop submission"
  );
}

function buildCodexResumeArgs(target) {
  return [
    "exec",
    "-C",
    target.cwd,
    "--skip-git-repo-check",
    "--color",
    "never",
    "resume",
    target.threadId,
    "-"
  ];
}

function buildNotificationDeliveryKey(threadId, notification) {
  const kind = notification?.kind === "aborted" ? "aborted" : "complete";
  const turnId = typeof notification?.turnId === "string" ? notification.turnId : "";
  return threadId && turnId ? `${threadId}:${kind}:${turnId}` : "";
}

function buildNotificationClientId(deliveryKey) {
  const stable = String(deliveryKey || "").trim();
  if (!stable) {
    return `${BRIDGE_NAME}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }
  return `${BRIDGE_NAME}:notify:${crypto.createHash("sha1").update(stable).digest("hex")}`;
}

async function sendTextMessage(baseUrl, token, toUserId, text, contextToken, clientId = "") {
  const outgoingClientId = clientId || `${BRIDGE_NAME}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await apiPost({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    token,
    timeoutMs: 15000,
    body: JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: outgoingClientId,
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: MSG_ITEM_TEXT, text_item: { text } }],
        context_token: contextToken
      },
      base_info: { channel_version: BRIDGE_VERSION }
    })
  });
}

function runCommandSync(command, args) {
  return spawnSync(command, args, {
    encoding: "utf-8",
    env: process.env
  });
}

function findThreadById(threadId) {
  if (!threadId) {
    return null;
  }
  const rows = querySqliteJson(`
    select
      id,
      cwd,
      title,
      archived,
      rollout_path as rolloutPath
    from threads
    where id = ${sqlQuote(threadId)}
    limit 1
  `);
  return rows[0] || null;
}

function isGitWorkTree(cwd) {
  if (!cwd || !fs.existsSync(cwd)) {
    return null;
  }
  const result = runCommandSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"]);
  if (result.status === 0) {
    return String(result.stdout || "").trim() === "true";
  }
  const output = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
  if (/not a git repository/i.test(output)) {
    return false;
  }
  return null;
}

function detectManagedProcess(command) {
  if (
    command.includes("/node_modules/claude-code-wechat-channel/dist/wechat-channel.js")
  ) {
    return { kind: "legacy", roles: ["consumer"] };
  }

  if (!BRIDGE_ALIASES.some((alias) => command.includes(alias))) {
    return null;
  }

  if (/(^|\s)start(\s|$)/.test(command)) {
    return { kind: "bridge", roles: ["consumer", "monitor"] };
  }

  if (/(^|\s)monitor(\s|$)/.test(command)) {
    return { kind: "monitor", roles: ["monitor"] };
  }

  return null;
}

function listRelatedProcesses() {
  const result = runCommandSync("ps", ["-ax", "-o", "pid=,command="]);
  if (result.status !== 0) {
    return [];
  }

  return String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      const pid = Number(match[1]);
      const command = match[2];
      const detected = detectManagedProcess(command);
      if (!detected) {
        return null;
      }
      return { pid, command, kind: detected.kind, roles: detected.roles };
    })
    .filter(Boolean);
}

function describeProcesses(processes) {
  if (!processes.length) {
    return "no active processes";
  }
  return processes.map((processInfo) => `${processInfo.kind}:${processInfo.pid}`).join(", ");
}

function classifyConsumerState(processes, currentPid = null) {
  const relevant = processes.filter((processInfo) => processInfo.roles.includes("consumer") && processInfo.pid !== currentPid);
  const legacy = relevant.filter((processInfo) => processInfo.kind === "legacy");
  const bridge = relevant.filter((processInfo) => processInfo.kind === "bridge");
  return {
    relevant,
    legacy,
    bridge,
    hasLegacyConflict: legacy.length > 0,
    hasBridgeConflict: currentPid === null ? bridge.length > 1 : bridge.length > 0,
    hasConflict: legacy.length > 0 || (currentPid === null ? bridge.length > 1 : bridge.length > 0)
  };
}

function classifyMonitorState(processes, options = {}) {
  const currentPid = options.currentPid ?? null;
  const currentProvidesMonitor = Boolean(options.currentProvidesMonitor);
  const relevant = processes.filter((processInfo) => processInfo.roles.includes("monitor") && processInfo.pid !== currentPid);
  return {
    relevant,
    hasRunning: currentProvidesMonitor || relevant.length > 0,
    hasConflict: currentProvidesMonitor ? relevant.length > 0 : relevant.length > 1
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function querySqliteJson(sql) {
  const result = runCommandSync("sqlite3", ["-json", STATE_DB_FILE, sql]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "sqlite3 query failed").trim());
  }

  const raw = String(result.stdout || "").trim();
  if (!raw) {
    return [];
  }
  return JSON.parse(raw);
}

function describeMonitorScope(config) {
  return config.monitorAllProjects === false ? `workspace ${config.workspace}` : "all Codex projects";
}

function describeNotificationRules(config) {
  return "success when task_complete is observed; aborted turns notify only when reason != interrupted";
}

function describePromptSubmissionBackend() {
  return "desktop automation via Codex deep link + macOS Accessibility paste/submit";
}

function describePromptRoutingMode() {
  return "WeChat messages are submitted into the most recently notified Codex Desktop thread across all projects by default";
}

function inspectPromptTargetResumability(target) {
  if (!target) {
    return { ok: true, detail: "none yet; wait for the next WeChat task notification" };
  }
  if (!target.threadId) {
    return { ok: false, detail: "missing target thread id" };
  }
  if (!target.cwd) {
    return { ok: false, detail: `missing target cwd for thread ${target.threadId}` };
  }

  let thread;
  try {
    thread = findThreadById(target.threadId);
  } catch (error) {
    return { ok: false, detail: `thread lookup failed: ${error}` };
  }

  if (!thread) {
    return { ok: false, detail: `thread missing in Codex state DB: ${target.threadId}` };
  }

  if (typeof thread.cwd === "string" && thread.cwd && thread.cwd !== target.cwd) {
    return {
      ok: false,
      detail: `thread exists, but saved cwd ${target.cwd} does not match thread cwd ${thread.cwd}`
    };
  }

  if (!fs.existsSync(target.cwd)) {
    return { ok: false, detail: `thread exists; cwd missing: ${target.cwd}` };
  }

  const details = ["thread exists", "cwd exists"];
  if (!thread.rolloutPath) {
    return { ok: false, detail: `thread exists; cwd exists; rollout path missing for ${target.threadId}` };
  }
  if (!fs.existsSync(thread.rolloutPath)) {
    return {
      ok: false,
      detail: `thread exists; cwd exists; rollout missing: ${thread.rolloutPath}`
    };
  }

  details.push("rollout available");
  if (Number(thread.archived) === 1) {
    details.push("thread is archived");
  }

  return { ok: true, detail: details.join("; ") };
}

function listTrackedThreads(config) {
  if (config.monitorAllProjects === false) {
    return querySqliteJson(`
      select
        id,
        rollout_path,
        cwd,
        title,
        source,
        first_user_message,
        updated_at
      from threads
      where cwd = ${sqlQuote(config.workspace)}
        and archived = 0
        and rollout_path is not null
        and rollout_path != ''
      order by updated_at desc
    `);
  }

  return querySqliteJson(`
    select
      id,
      rollout_path,
      cwd,
      title,
      source,
      first_user_message,
      updated_at
    from threads
    where archived = 0
      and rollout_path is not null
      and rollout_path != ''
    order by updated_at desc
  `);
}

function isBridgeInternalThread(thread) {
  const combined = `${thread?.title || ""}\n${thread?.first_user_message || ""}`;
  return INTERNAL_THREAD_MARKERS.every((marker) => combined.includes(marker));
}

function getFileSize(file) {
  return fs.statSync(file).size;
}

function readJsonlAppend(file, startOffset) {
  const buffer = fs.readFileSync(file);
  const safeOffset = Math.max(0, Math.min(startOffset, buffer.length));
  const chunk = buffer.subarray(safeOffset);
  const lastNewlineIndex = chunk.lastIndexOf(0x0a);

  if (lastNewlineIndex === -1) {
    return {
      lines: [],
      nextOffset: safeOffset
    };
  }

  const complete = chunk.subarray(0, lastNewlineIndex + 1).toString("utf-8");
  const lines = complete
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return {
    lines,
    nextOffset: safeOffset + lastNewlineIndex + 1
  };
}

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || !value) {
    return 0;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : 0;
}

function formatLocalTime(value) {
  const epoch = toEpochMs(value);
  if (!epoch) {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(epoch));
}

function extractAssistantTextFromResponseItem(payload) {
  if (payload?.type !== "message" || payload?.role !== "assistant" || payload?.phase === "commentary") {
    return "";
  }

  const texts = [];
  for (const item of payload.content || []) {
    if (item?.type === "output_text" && item.text) {
      texts.push(item.text);
    }
  }
  return texts.join("\n").trim();
}

function extractUserTextFromResponseItem(payload) {
  if (payload?.type !== "message" || payload?.role !== "user") {
    return "";
  }

  const texts = [];
  for (const item of payload.content || []) {
    if (item?.type === "input_text" && item.text) {
      texts.push(item.text);
    }
  }
  return texts.join("\n").trim();
}

function buildCompletionSummary(taskCompletePayload, activeTurn, config) {
  const summarySource = taskCompletePayload?.last_agent_message || activeTurn?.lastAssistantText || "任务已完成。";
  return plainTextReply(summarySource, config.notifyMaxChars);
}

function buildAbortedSummary(activeTurn, config) {
  const source = String(activeTurn?.lastAssistantText || "").trim();
  if (!source) {
    return "";
  }
  return plainTextReply(source, config.notifyMaxChars);
}

function buildMonitorMessage(thread, notification, config) {
  const projectLabel = buildProjectLabel(thread);
  const threadLabel = buildThreadLabel(thread);
  const promptLabel = buildPromptLabel(notification);
  if (notification.kind === "aborted") {
    const lines = [
      "Codex 任务中断通知",
      `Project：${projectLabel}`,
      `Thread：${threadLabel}`,
      `Prompt：${promptLabel}`,
      `中断时间：${formatLocalTime(notification.completedAt)}`,
      `原因：${plainTextReply(notification.reason || "unknown", 120)}`
    ];
    if (notification.summary) {
      lines.push(`摘要：${plainTextReply(notification.summary, config.notifyMaxChars)}`);
    }
    return plainTextReply(
      lines.join("\n"),
      Math.min(config.maxReplyChars, config.notifyMaxChars + 200)
    );
  }

  const summary = plainTextReply(notification.summary || "任务已完成。", config.notifyMaxChars);
  return plainTextReply(
    [
      "Codex 任务完成通知",
      `Project：${projectLabel}`,
      `Thread：${threadLabel}`,
      `Prompt：${promptLabel}`,
      `完成时间：${formatLocalTime(notification.completedAt)}`,
      `结果：${summary}`
    ].join("\n"),
    Math.min(config.maxReplyChars, config.notifyMaxChars + 160)
  );
}

function ensureThreadMonitorState(monitorState, threadId) {
  if (!monitorState.threads[threadId]) {
    monitorState.threads[threadId] = normalizeThreadMonitorState();
  }
  return monitorState.threads[threadId];
}

function addNotifiedTurn(threadState, turnId) {
  if (!turnId) {
    return;
  }
  threadState.notifiedTurnIds = [...threadState.notifiedTurnIds.filter((value) => value !== turnId), turnId].slice(-MAX_NOTIFIED_TURNS);
}

function addSentDeliveryKey(monitorState, deliveryKey) {
  if (!deliveryKey) {
    return;
  }
  const next = [...normalizeSentDeliveryKeys(monitorState.sentDeliveryKeys), deliveryKey];
  monitorState.sentDeliveryKeys = [...new Set(next)].slice(-MAX_SENT_DELIVERY_KEYS);
}

async function sendMonitorNotification(config, credentials, thread, notification) {
  if (!credentials.userId) {
    throw new Error("current WeChat credentials do not include userId");
  }

  const senderState = loadSenderState(credentials.userId, credentials.accountId);
  if (!senderState.contextToken) {
    throw new Error("missing recipient contextToken; please send the bot one message from WeChat first");
  }

  const text = buildMonitorMessage(thread, notification, config);
  const deliveryKey = notification.deliveryKey || buildNotificationDeliveryKey(thread.id, notification);
  const clientId = buildNotificationClientId(deliveryKey);
  await sendTextMessage(
    credentials.baseUrl || config.baseUrl,
    credentials.token,
    credentials.userId,
    text,
    senderState.contextToken,
    clientId
  );
  updateSenderPromptTarget(senderState, thread, notification);
  senderState.lastError = null;
  saveSenderState(credentials.userId, senderState, credentials.accountId);
}

async function flushPendingNotifications(config, credentials, thread, threadState, monitorState) {
  const pendingList = Object.values(threadState.pendingNotifications || {}).sort((left, right) => {
    return toEpochMs(left.completedAt) - toEpochMs(right.completedAt);
  });

  for (const pending of pendingList) {
    const deliveryKey = pending.deliveryKey || buildNotificationDeliveryKey(thread.id, pending);
    if (deliveryKey && normalizeSentDeliveryKeys(monitorState.sentDeliveryKeys).includes(deliveryKey)) {
      addNotifiedTurn(threadState, pending.turnId);
      delete threadState.pendingNotifications[pending.turnId];
      saveMonitorState(monitorState);
      log(`skip resend for thread ${thread.id} turn ${pending.turnId}: delivery key already marked sent`);
      continue;
    }

    try {
      await sendMonitorNotification(config, credentials, thread, { ...pending, deliveryKey });
      addNotifiedTurn(threadState, pending.turnId);
      delete threadState.pendingNotifications[pending.turnId];
      addSentDeliveryKey(monitorState, deliveryKey);
      monitorState.lastError = null;
      monitorState.lastSuccessAt = new Date().toISOString();
      saveMonitorState(monitorState);
      log(`sent ${pending.kind === "aborted" ? "interruption" : "completion"} notification for thread ${thread.id} turn ${pending.turnId}`);
    } catch (error) {
      const message = String(error);
      threadState.pendingNotifications[pending.turnId] = {
        ...pending,
        attempts: (pending.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        error: message
      };
      monitorState.lastError = {
        stage: "monitor-send",
        at: new Date().toISOString(),
        message,
        threadId: thread.id,
        turnId: pending.turnId
      };
      saveMonitorState(monitorState);
      log(`${pending.kind === "aborted" ? "interruption" : "completion"} notification failed for thread ${thread.id} turn ${pending.turnId}: ${message}`);
      break;
    }
  }
}

function shouldPrimeThreadFromEnd(monitorState, thread) {
  const bootstrapEpoch = toEpochMs(monitorState.bootstrappedAt);
  const updatedEpoch = Number.isFinite(thread?.updated_at) ? thread.updated_at * 1000 : 0;
  return Boolean(bootstrapEpoch && updatedEpoch && updatedEpoch <= bootstrapEpoch);
}

function shouldNotifyAborted(payload) {
  return String(payload?.reason || "").trim() !== "interrupted";
}

function queueCompletionNotification(config, thread, threadState, payload, activeTurn, completedAt) {
  const turnId = payload?.turn_id || "";
  if (!turnId || threadState.notifiedTurnIds.includes(turnId) || threadState.pendingNotifications?.[turnId]) {
    return null;
  }

  const startedAtMs = toEpochMs(activeTurn?.startedAt);
  const completedAtMs = toEpochMs(completedAt);
  const durationMs = startedAtMs && completedAtMs && completedAtMs >= startedAtMs ? completedAtMs - startedAtMs : 0;
  const toolCallCount = Number.isFinite(activeTurn?.toolCallCount) ? activeTurn.toolCallCount : 0;

  const notification = normalizePendingNotification({
    kind: "complete",
    turnId,
    deliveryKey: buildNotificationDeliveryKey(thread.id, { kind: "complete", turnId }),
    threadTitle: thread.title || "",
    completedAt: completedAt || new Date().toISOString(),
    summary: buildCompletionSummary(payload, activeTurn, config),
    prompt: activeTurn?.lastUserPrompt || "",
    durationMs,
    toolCallCount
  });

  threadState.pendingNotifications[turnId] = notification;
  log(`queued completion notification for thread ${thread.id} turn ${turnId}`);
  return notification;
}

function queueAbortedNotification(config, thread, threadState, payload, activeTurn, abortedAt) {
  const turnId = payload?.turn_id || "";
  if (!turnId || threadState.notifiedTurnIds.includes(turnId) || threadState.pendingNotifications?.[turnId]) {
    return null;
  }

  const reason = String(payload?.reason || "").trim() || "unknown";
  if (!shouldNotifyAborted(payload)) {
    log(`skip aborted notification for thread ${thread.id} turn ${turnId}: reason=${reason}`);
    return null;
  }

  const startedAtMs = toEpochMs(activeTurn?.startedAt);
  const abortedAtMs = toEpochMs(abortedAt);
  const durationMs = startedAtMs && abortedAtMs && abortedAtMs >= startedAtMs ? abortedAtMs - startedAtMs : 0;
  const notification = normalizePendingNotification({
    kind: "aborted",
    turnId,
    deliveryKey: buildNotificationDeliveryKey(thread.id, { kind: "aborted", turnId }),
    threadTitle: thread.title || "",
    completedAt: abortedAt || new Date().toISOString(),
    summary: buildAbortedSummary(activeTurn, config),
    prompt: activeTurn?.lastUserPrompt || "",
    durationMs,
    toolCallCount: Number.isFinite(activeTurn?.toolCallCount) ? activeTurn.toolCallCount : 0,
    reason
  });

  threadState.pendingNotifications[turnId] = notification;
  log(`queued interrupted notification for thread ${thread.id} turn ${turnId}: reason=${reason}`);
  return notification;
}

function processRolloutRecord(config, thread, threadState, record) {
  const payload = record?.payload || {};

  if (record?.type === "event_msg" && payload.type === "task_started") {
    const turnId = payload.turn_id || "";
    if (!turnId) {
      return;
    }
    threadState.activeTurns[turnId] = normalizeActiveTurn({
      startedAt: record.timestamp || new Date().toISOString(),
      toolCallCount: 0,
      lastAssistantText: ""
    });
    threadState.currentTurnId = turnId;
    log(`monitor saw task_started for thread ${thread.id} turn ${turnId}`);
    return;
  }

  if (record?.type === "response_item" && payload.type === "function_call") {
    if (!threadState.currentTurnId || !threadState.activeTurns[threadState.currentTurnId]) {
      return;
    }
    threadState.activeTurns[threadState.currentTurnId].toolCallCount += 1;
    return;
  }

  if (record?.type === "response_item" && payload.type === "message") {
    if (!threadState.currentTurnId || !threadState.activeTurns[threadState.currentTurnId]) {
      return;
    }

    const userText = extractUserTextFromResponseItem(payload);
    if (userText) {
      threadState.activeTurns[threadState.currentTurnId].lastUserPrompt = userText;
      return;
    }

    const assistantText = extractAssistantTextFromResponseItem(payload);
    if (!assistantText) {
      return;
    }
    threadState.activeTurns[threadState.currentTurnId].lastAssistantText = assistantText;
    return;
  }

  if (record?.type === "event_msg" && payload.type === "user_message") {
    if (!threadState.currentTurnId || !threadState.activeTurns[threadState.currentTurnId]) {
      return;
    }
    const userPrompt = String(payload.message || "").trim();
    if (!userPrompt) {
      return;
    }
    threadState.activeTurns[threadState.currentTurnId].lastUserPrompt = userPrompt;
    return;
  }

  if (record?.type === "event_msg" && payload.type === "turn_aborted") {
    const turnId = payload.turn_id || "";
    if (!turnId) {
      return;
    }
    const activeTurn = threadState.activeTurns[turnId] || normalizeActiveTurn({
      startedAt: "",
      toolCallCount: 0,
      lastAssistantText: ""
    });
    queueAbortedNotification(config, thread, threadState, payload, activeTurn, record.timestamp || new Date().toISOString());
    delete threadState.activeTurns[turnId];
    if (threadState.currentTurnId === turnId) {
      threadState.currentTurnId = "";
    }
    log(`monitor cleared aborted turn for thread ${thread.id} turn ${turnId}`);
    return;
  }

  if (record?.type === "event_msg" && payload.type === "task_complete") {
    const turnId = payload.turn_id || "";
    const activeTurn = threadState.activeTurns[turnId] || normalizeActiveTurn({
      startedAt: "",
      toolCallCount: 0,
      lastAssistantText: ""
    });
    queueCompletionNotification(config, thread, threadState, payload, activeTurn, record.timestamp || new Date().toISOString());
    delete threadState.activeTurns[turnId];
    if (threadState.currentTurnId === turnId) {
      threadState.currentTurnId = "";
    }
  }
}

async function scanThreadsAndNotify(config, credentials, monitorState) {
  const threads = listTrackedThreads(config);

  for (const thread of threads) {
    if (isBridgeInternalThread(thread)) {
      continue;
    }

    const rolloutPath = String(thread.rollout_path || "");
    if (!rolloutPath || !fs.existsSync(rolloutPath)) {
      continue;
    }

    const threadState = ensureThreadMonitorState(monitorState, thread.id);
    threadState.rolloutPath = rolloutPath;

    if (!Number.isFinite(threadState.offset) || threadState.offset < 0) {
      threadState.offset = 0;
    }

    if (!threadState.offset && Object.keys(threadState.pendingNotifications).length === 0 && Object.keys(threadState.activeTurns).length === 0) {
      if (shouldPrimeThreadFromEnd(monitorState, thread)) {
        threadState.offset = getFileSize(rolloutPath);
        log(`monitor primed existing thread ${thread.id} at offset ${threadState.offset}`);
      } else {
        log(`monitor tracking new thread ${thread.id} from beginning`);
      }
    }

    const fileSize = getFileSize(rolloutPath);
    if (threadState.offset > fileSize) {
      log(`monitor offset reset for thread ${thread.id}: file shrank from ${threadState.offset} to ${fileSize}`);
      threadState.offset = 0;
    }

    const { lines, nextOffset } = readJsonlAppend(rolloutPath, threadState.offset);
    for (const record of lines) {
      processRolloutRecord(config, thread, threadState, record);
    }
    threadState.offset = nextOffset;
    await flushPendingNotifications(config, credentials, thread, threadState, monitorState);
  }
}

async function setupCommand(options) {
  ensureStateDirs();
  const config = loadConfig();
  if (options.workspace) {
    config.workspace = options.workspace;
  }
  saveConfig(config);

  const credentials = loadCredentials();
  if (credentials && !options.forceLogin) {
    log(`reusing credentials for ${credentials.accountId}`);
    log(`config saved to ${CONFIG_FILE}`);
    return;
  }

  log("running WeChat QR login via claude-code-wechat-channel setup");
  const status = spawnSync("npx", ["-y", "claude-code-wechat-channel", "setup"], {
    stdio: "inherit",
    env: process.env
  });
  if (status.status !== 0) {
    fail("setup failed while refreshing WeChat credentials");
  }

  if (!loadCredentials()) {
    fail(`setup finished but no credentials were found at ${LEGACY_CREDENTIALS_FILE}`);
  }

  log(`credentials refreshed and config saved to ${CONFIG_FILE}`);
}

async function doctorCommand(options) {
  ensureStateDirs();
  const config = loadConfig();
  if (options.workspace) {
    config.workspace = options.workspace;
  }

  const checks = [];
  const addCheck = (name, ok, detail) => {
    checks.push({ name, ok, detail });
  };

  const nodeVersion = runCommandSync("node", ["-v"]);
  addCheck("Node.js", nodeVersion.status === 0, (nodeVersion.stdout || nodeVersion.stderr).trim());

  const codexVersion = runCommandSync("codex", ["--version"]);
  addCheck("Codex CLI", codexVersion.status === 0, (codexVersion.stdout || codexVersion.stderr).trim());

  addCheck("Workspace", fs.existsSync(config.workspace), config.workspace);
  addCheck("Codex state DB", fs.existsSync(STATE_DB_FILE), STATE_DB_FILE);

  const runtime = loadRuntime();
  if (runtime.accountId) {
    addCheck("Runtime bot", true, `runtime bound to ${runtime.accountId}`);
  } else {
    addCheck("Runtime bot", true, "runtime not yet bound to a bot");
  }

  const relatedProcesses = listRelatedProcesses();
  const consumerState = classifyConsumerState(relatedProcesses);
  addCheck(
    "Consumer conflict",
    !consumerState.hasConflict,
    consumerState.hasConflict
      ? `conflict detected: ${describeProcesses(consumerState.relevant)}`
      : `unique consumer state: ${describeProcesses(consumerState.relevant)}`
  );

  const monitorProcessState = classifyMonitorState(relatedProcesses);
  addCheck(
    "Monitor status",
    monitorProcessState.hasRunning && !monitorProcessState.hasConflict,
    monitorProcessState.hasConflict
      ? `conflict detected: ${describeProcesses(monitorProcessState.relevant)}`
      : monitorProcessState.hasRunning
        ? `running: ${describeProcesses(monitorProcessState.relevant)}`
        : "not running; task completion notifications are offline"
  );
  addCheck("Notification rules", true, describeNotificationRules(config));
  addCheck("Prompt submission backend", true, describePromptSubmissionBackend());
  addCheck("Prompt routing mode", true, describePromptRoutingMode());
  const desktopState = inspectCodexDesktopRunning();
  addCheck("Codex Desktop running", desktopState.ok, desktopState.detail);
  const accessibilityState = inspectMacAccessibilityAutomation();
  addCheck(
    "macOS Accessibility automation available",
    accessibilityState.ok,
    accessibilityState.detail
  );

  const credentials = loadCredentials();
  let promptTargetInspection = {
    ok: true,
    detail: "unavailable until WeChat credentials and sender state are available"
  };
  addCheck(
    "WeChat credentials",
    Boolean(credentials),
    credentials ? `${credentials.accountId} @ ${credentials.baseUrl}` : `missing: ${LEGACY_CREDENTIALS_FILE}`
  );

  if (credentials) {
    if (credentials.userId) {
      saveSenderState(
        credentials.userId,
        loadSenderState(credentials.userId, credentials.accountId),
        credentials.accountId
      );
    }

    addCheck(
      "Monitor recipient",
      Boolean(credentials.userId),
      credentials.userId ? `current user ${credentials.userId}` : "credentials missing userId; cannot send monitor notifications"
    );

    const senderState = credentials.userId ? loadSenderState(credentials.userId, credentials.accountId) : null;
    addCheck(
      "Recipient binding",
      Boolean(senderState?.contextToken),
      senderState?.contextToken
        ? `contextToken available in ${senderStatePath(credentials.userId)}`
        : "missing contextToken; send the bot one WeChat message first"
    );
    addCheck(
      "Current prompt target thread",
      true,
      senderState?.lastNotifiedThreadId
        ? `${senderState.lastNotifiedThreadId}${senderState.lastNotificationTitle ? ` (${plainTextReply(senderState.lastNotificationTitle, 120)})` : ""}`
        : "none yet; wait for the next WeChat task notification"
    );
    addCheck(
      "Current prompt target project",
      true,
      senderState?.lastNotifiedCwd
        ? `${projectLabelFromCwd(senderState.lastNotifiedCwd)} @ ${senderState.lastNotifiedCwd}`
        : "none yet"
    );
    addCheck(
      "Last notification target timestamp",
      true,
      senderState?.lastNotifiedAt ? formatLocalTime(senderState.lastNotifiedAt) : "none yet"
    );
    promptTargetInspection = inspectPromptTargetResumability(currentPromptTarget(senderState));

    try {
      const runtimeSync = resolveRuntimeSync(runtime, credentials);
      const updateResult = await getUpdates(
        credentials.baseUrl || config.baseUrl,
        credentials.token,
        runtimeSync.syncBuf,
        5000
      );
      addCheck(
        "iLink reachability",
        true,
        updateResult.aborted ? "reachable; long poll timed out normally" : "reachable; authenticated getupdates succeeded"
      );
    } catch (error) {
      addCheck("iLink reachability", false, String(error));
    }
  }

  addCheck(
    "Current prompt target rollout observability",
    promptTargetInspection.ok,
    promptTargetInspection.detail
  );

  const monitorStateFile = inspectJsonFile(MONITOR_FILE);
  addCheck("Monitor state file", monitorStateFile.ok, monitorStateFile.detail);

  if (fs.existsSync(config.workspace)) {
    try {
      listTrackedThreads(config);
      addCheck("Thread query", true, `sqlite query succeeded for ${describeMonitorScope(config)}`);
    } catch (error) {
      addCheck("Thread query", false, String(error));
    }

  }

  const allPassed = checks.every((check) => check.ok);
  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    process.stdout.write(`${marker}  ${check.name}: ${check.detail}\n`);
  }

  if (!allPassed) {
    process.exitCode = 1;
  }
}

async function processIncomingMessage(config, credentials, message) {
  const text = extractTextFromMessage(message).trim();
  if (!text) {
    log(`skip message without text from ${message.from_user_id ?? "unknown"}`);
    return;
  }

  const senderId = message.from_user_id ?? "";
  if (!senderId) {
    log("skip message with empty sender_id");
    return;
  }

  const state = loadSenderState(senderId, credentials.accountId);
  if (message.context_token) {
    state.contextToken = message.context_token;
  }

  const fingerprint = messageFingerprint(message, text);
  if (state.recentFingerprints.includes(fingerprint)) {
    log(`skip duplicate message from ${senderId}`);
    return;
  }

  state.history = pushHistory(
    state.history,
    { role: "user", text, at: new Date().toISOString() },
    config.historyLimit
  );

  log(`received message from ${senderId}: ${text.slice(0, 80)}`);

  const target = currentPromptTarget(state);
  if (!target) {
    state.lastError = null;
    state.recentFingerprints = [...state.recentFingerprints, fingerprint].slice(-config.maxRecentFingerprints);
    saveSenderState(senderId, state, credentials.accountId);

    if (!state.contextToken) {
      log(`prompt target missing for ${senderId}, and no context_token is available to send guidance`);
      return;
    }

    try {
      await sendTextMessage(
        credentials.baseUrl || config.baseUrl,
        credentials.token,
        senderId,
        PROMPT_TARGET_REQUIRED_MESSAGE,
        state.contextToken
      );
      log(`sent prompt-target guidance to ${senderId}`);
    } catch (error) {
      state.lastError = {
        stage: "send",
        at: new Date().toISOString(),
        message: String(error)
      };
      saveSenderState(senderId, state, credentials.accountId);
      log(`guidance send failed for ${senderId}: ${error}`);
    }
    return;
  }

  try {
    await runCodexResumePrompt(config, target, text);
    state.lastError = null;
    state.recentFingerprints = [...state.recentFingerprints, fingerprint].slice(-config.maxRecentFingerprints);
    saveSenderState(senderId, state, credentials.accountId);
    log(`submitted prompt for ${senderId} to desktop thread ${target.threadId}`);
  } catch (error) {
    const resumeFailure = classifyResumeFailure(error);
    state.lastError = buildPromptResumeErrorState(target, error);
    state.recentFingerprints = [...state.recentFingerprints, fingerprint].slice(-config.maxRecentFingerprints);
    saveSenderState(senderId, state, credentials.accountId);
    log(
      `desktop prompt submit ${resumeFailure.kind} for ${senderId} -> ${target.threadId} (${displayProjectLabel(target.cwd)} @ ${target.cwd}): ${resumeFailure.detail}`
    );

    if (!state.contextToken) {
      log(`desktop submission error for ${senderId}, and no context_token is available to send failure guidance`);
      return;
    }

    try {
      await sendTextMessage(
        credentials.baseUrl || config.baseUrl,
        credentials.token,
        senderId,
        buildPromptResumeFailedMessage(target),
        state.contextToken
      );
      log(`sent desktop submission failure guidance to ${senderId}`);
    } catch (sendError) {
      state.lastError = {
        stage: "send",
        at: new Date().toISOString(),
        message: String(sendError)
      };
      saveSenderState(senderId, state, credentials.accountId);
      log(`desktop submission failure guidance send failed for ${senderId}: ${sendError}`);
    }
  }
}

async function startCommand(options) {
  ensureStateDirs();
  const config = loadConfig();
  if (options.workspace) {
    config.workspace = options.workspace;
  }
  saveConfig(config);

  if (!fs.existsSync(config.workspace)) {
    fail(`workspace does not exist: ${config.workspace}`);
  }

  const credentials = loadCredentials();
  if (!credentials) {
    fail(`missing WeChat credentials at ${LEGACY_CREDENTIALS_FILE}; run '${BRIDGE_NAME} setup' first`);
  }
  if (credentials.userId) {
    saveSenderState(
      credentials.userId,
      loadSenderState(credentials.userId, credentials.accountId),
      credentials.accountId
    );
  }

  const runtime = loadRuntime();
  const runtimeSync = resolveRuntimeSync(runtime, credentials);
  let syncBuf = runtimeSync.syncBuf;

  const monitorState = loadMonitorState();
  const monitorAccountReason = resolveMonitorStateAccount(monitorState, credentials);
  saveMonitorState(monitorState);

  const relatedProcesses = listRelatedProcesses();
  const consumerState = classifyConsumerState(relatedProcesses, process.pid);
  const monitorProcessState = classifyMonitorState(relatedProcesses, {
    currentPid: process.pid,
    currentProvidesMonitor: true
  });

  log(`using workspace: ${config.workspace}`);
  log(`using account: ${credentials.accountId}`);
  log(`state root: ${STATE_ROOT}`);
  log(`runtime state: ${runtimeSync.reason}`);
  log(`monitor state: ${monitorAccountReason}`);
  log(`monitor scope: ${describeMonitorScope(config)}`);
  log(`notification rules: ${describeNotificationRules(config)}`);
  log(`prompt submission backend: ${describePromptSubmissionBackend()}`);
  log(`prompt routing mode: ${describePromptRoutingMode()}`);
  const desktopState = inspectCodexDesktopRunning();
  log(`${desktopState.ok ? "desktop status" : "WARNING: desktop status"}: ${desktopState.detail}`);
  const accessibilityState = inspectMacAccessibilityAutomation();
  log(
    `${accessibilityState.ok ? "accessibility automation" : "WARNING: accessibility automation"}: ${accessibilityState.detail}`
  );
  if (consumerState.hasConflict) {
    fail(`detected competing consumers for the same bot: ${describeProcesses(consumerState.relevant)}`);
  }
  log(`consumer check: ${describeProcesses(consumerState.relevant)}`);
  if (monitorProcessState.hasConflict) {
    fail(`multiple monitor instances detected: ${describeProcesses(monitorProcessState.relevant)}`);
  }
  log("monitor status: embedded in current start process");
  log("listening for WeChat prompts...");

  let shouldStop = false;
  const stop = () => {
    shouldStop = true;
    log("stopping bridge");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const runEmbeddedMonitor = async () => {
    do {
      try {
        await scanThreadsAndNotify(config, credentials, monitorState);
        saveMonitorState(monitorState);
      } catch (error) {
        monitorState.lastError = {
          stage: "monitor-scan",
          at: new Date().toISOString(),
          message: String(error)
        };
        saveMonitorState(monitorState);
        log(`embedded monitor loop error: ${error}`);
        await sleep(config.retryDelayMs);
      }

      if (!options.once && !shouldStop) {
        await sleep(config.monitorPollMs);
      }
    } while (!shouldStop && !options.once);
  };

  const runChatBridge = async () => {
    do {
      try {
        const { data, aborted } = await getUpdates(
          credentials.baseUrl || config.baseUrl,
          credentials.token,
          syncBuf,
          config.longPollTimeoutMs
        );

        if (data.get_updates_buf) {
          syncBuf = data.get_updates_buf;
          saveRuntime({ syncBuf, accountId: credentials.accountId, updatedAt: new Date().toISOString() });
        }

        if (data.ret !== undefined && data.ret !== 0) {
          throw new Error(`getupdates failed: ret=${data.ret} errmsg=${data.errmsg ?? ""}`);
        }

        if (!aborted) {
          for (const message of data.msgs ?? []) {
            if (message.message_type !== MSG_TYPE_USER) {
              log(`skip non-user message type=${message.message_type ?? "unknown"} from ${message.from_user_id ?? "unknown"}`);
              continue;
            }
            await processIncomingMessage(config, credentials, message);
          }
        }
      } catch (error) {
        log(`poll loop error: ${error}`);
        await sleep(config.retryDelayMs);
      }
    } while (!shouldStop && !options.once);
  };

  await Promise.all([runChatBridge(), runEmbeddedMonitor()]);
}

async function monitorCommand(options) {
  ensureStateDirs();
  const config = loadConfig();
  if (options.workspace) {
    config.workspace = options.workspace;
  }
  saveConfig(config);

  if (!fs.existsSync(config.workspace)) {
    fail(`workspace does not exist: ${config.workspace}`);
  }

  if (!fs.existsSync(STATE_DB_FILE)) {
    fail(`missing Codex state database at ${STATE_DB_FILE}`);
  }

  const credentials = loadCredentials();
  if (!credentials) {
    fail(`missing WeChat credentials at ${LEGACY_CREDENTIALS_FILE}; run '${BRIDGE_NAME} setup' first`);
  }
  if (credentials.userId) {
    saveSenderState(
      credentials.userId,
      loadSenderState(credentials.userId, credentials.accountId),
      credentials.accountId
    );
  }

  const monitorState = loadMonitorState();
  const accountReason = resolveMonitorStateAccount(monitorState, credentials);
  saveMonitorState(monitorState);

  const relatedProcesses = listRelatedProcesses();
  const monitorProcessState = classifyMonitorState(relatedProcesses, {
    currentPid: process.pid,
    currentProvidesMonitor: true
  });
  const consumerState = classifyConsumerState(relatedProcesses);

  log(`using workspace: ${config.workspace}`);
  log(`using account: ${credentials.accountId}`);
  log(`state root: ${STATE_ROOT}`);
  log(`monitor state: ${accountReason}`);
  log(`monitor scope: ${describeMonitorScope(config)}`);
  log(`notification rules: ${describeNotificationRules(config)}`);
  if (consumerState.hasConflict) {
    log(`WARNING: detected competing chat consumers: ${describeProcesses(consumerState.relevant)}`);
  }
  if (monitorProcessState.hasConflict) {
    log(`WARNING: detected competing monitor instances: ${describeProcesses(monitorProcessState.relevant)}`);
  } else {
    log(`monitor check: ${describeProcesses(monitorProcessState.relevant)}`);
  }
  log("watching Codex thread completions...");

  let shouldStop = false;
  const stop = () => {
    shouldStop = true;
    log("stopping monitor");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  do {
    try {
      await scanThreadsAndNotify(config, credentials, monitorState);
      saveMonitorState(monitorState);
    } catch (error) {
      monitorState.lastError = {
        stage: "monitor-scan",
        at: new Date().toISOString(),
        message: String(error)
      };
      saveMonitorState(monitorState);
      log(`monitor loop error: ${error}`);
      await sleep(config.retryDelayMs);
    }

    if (!options.once && !shouldStop) {
      await sleep(config.monitorPollMs);
    }
  } while (!shouldStop && !options.once);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.command) {
    case "setup":
      await setupCommand(parsed.options);
      break;
    case "doctor":
      await doctorCommand(parsed.options);
      break;
    case "start":
      await startCommand(parsed.options);
      break;
    case "monitor":
      await monitorCommand(parsed.options);
      break;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage);
      break;
    default:
      fail(`Unknown command: ${parsed.command}\n\n${usage}`);
  }
}

main().catch((error) => {
  fail(String(error));
});
