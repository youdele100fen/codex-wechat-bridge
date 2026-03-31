import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

const MODULE_PATH = new URL("./codex-wechat-bridge.mjs", import.meta.url);

async function loadBridgeForTests({ replacements = [] } = {}) {
  let source = await fs.readFile(MODULE_PATH, "utf8");
  for (const [pattern, replacement] of replacements) {
    source = source.replace(pattern, replacement);
  }
  source = source.replace(
    /main\(\)\.catch\(\(error\) => \{\s*fail\(String\(error\)\);\s*\}\);\s*$/,
    ""
  );
  source += `
export {
  DEFAULT_CONFIG,
  normalizeActiveTurn,
  normalizePendingNotification,
  queueCompletionNotification,
  flushPendingNotifications,
  processRolloutRecord,
  buildMonitorMessage,
  buildCodexThreadDeepLink,
  buildDesktopPromptSubmissionArgs,
  buildDesktopRefreshDeepLinks,
  buildDesktopRefreshArgs,
  buildCodexResumeArgs,
  runCodexResumePrompt,
  detectManagedProcess,
  classifyConsumerState,
  classifyMonitorState,
  inspectPromptTargetResumability,
  sendTextMessage,
  sendMonitorNotification,
  processIncomingMessage,
  extractTextFromMessage,
  buildDesktopThreadOpenArgs
};
`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function senderStateStoreReplacements() {
  return [
    [
      /function loadSenderState\(senderId, accountId = ""\) \{[\s\S]*?\n\}/,
      `function loadSenderState(senderId, accountId = "") {
  globalThis.__bridgeSenderStateStore = globalThis.__bridgeSenderStateStore || {};
  const existing = globalThis.__bridgeSenderStateStore[senderId];
  if (existing) {
    return JSON.parse(JSON.stringify(existing));
  }
  return {
    senderId,
    accountId,
    contextToken: "",
    history: [],
    recentFingerprints: [],
    recentPromptSubmissions: [],
    lastError: null,
    lastNotifiedThreadId: "",
    lastNotifiedCwd: "",
    lastNotifiedTurnId: "",
    lastNotifiedKind: "",
    lastNotifiedAt: "",
    lastNotificationTitle: "",
    lastNotificationPrompt: ""
  };
}
`
    ],
    [
      /function saveSenderState\(senderId, state, accountId = ""\) \{[\s\S]*?\n\}/,
      `function saveSenderState(senderId, state, accountId = "") {
  globalThis.__bridgeSenderStateStore = globalThis.__bridgeSenderStateStore || {};
  globalThis.__bridgeSenderStateStore[senderId] = JSON.parse(JSON.stringify({ ...state, accountId }));
}
`
    ]
  ];
}

test("success notification queues even for short tasks without any tool calls", async () => {
  const bridge = await loadBridgeForTests();
  const config = {
    ...bridge.DEFAULT_CONFIG
  };
  const thread = { id: "thread-1", title: "quiet task" };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {},
    activeTurns: {}
  };
  const activeTurn = bridge.normalizeActiveTurn({
    startedAt: "2026-03-31T00:00:00.000Z",
    toolCallCount: 0,
    lastAssistantText: "done"
  });

  const queued = bridge.queueCompletionNotification(
    config,
    thread,
    threadState,
    { turn_id: "turn-1", last_agent_message: "done", type: "task_complete" },
    activeTurn,
    "2026-03-31T00:00:19.000Z"
  );

  assert.ok(queued);
  assert.equal(queued.turnId, "turn-1");
  assert.equal(queued.toolCallCount, 0);
});

test("shareable default workspace follows the current working directory instead of a machine-specific path", async () => {
  const bridge = await loadBridgeForTests();

  assert.equal(bridge.DEFAULT_CONFIG.workspace, process.cwd());
});

test("success notification also queues when tool call count is high", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = { id: "thread-2", title: "tool-heavy task" };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {},
    activeTurns: {}
  };
  const activeTurn = bridge.normalizeActiveTurn({
    startedAt: "2026-03-31T00:00:00.000Z",
    toolCallCount: 3,
    lastAssistantText: "done"
  });

  const queued = bridge.queueCompletionNotification(
    config,
    thread,
    threadState,
    { turn_id: "turn-2", last_agent_message: "done", type: "task_complete" },
    activeTurn,
    "2026-03-31T00:00:05.000Z"
  );

  assert.ok(queued);
  assert.equal(queued.turnId, "turn-2");
  assert.equal(queued.toolCallCount, 3);
});

test("success notification queues when task duration reaches threshold even without tools", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = { id: "thread-3", title: "long task" };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {},
    activeTurns: {}
  };
  const activeTurn = bridge.normalizeActiveTurn({
    startedAt: "2026-03-31T00:00:00.000Z",
    toolCallCount: 0,
    lastAssistantText: "done"
  });

  const queued = bridge.queueCompletionNotification(
    config,
    thread,
    threadState,
    { turn_id: "turn-3", last_agent_message: "done", type: "task_complete" },
    activeTurn,
    "2026-03-31T00:00:20.000Z"
  );

  assert.ok(queued);
  assert.equal(queued.durationMs, 20000);
});

test("aborted turn with interrupted reason does not queue a notification", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = { id: "thread-4", title: "manual stop" };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {},
    activeTurns: {
      "turn-4": bridge.normalizeActiveTurn({
        startedAt: "2026-03-31T00:00:00.000Z",
        toolCallCount: 4,
        lastAssistantText: "partial result"
      })
    },
    currentTurnId: "turn-4"
  };

  bridge.processRolloutRecord(config, thread, threadState, {
    type: "event_msg",
    timestamp: "2026-03-31T00:00:10.000Z",
    payload: {
      type: "turn_aborted",
      turn_id: "turn-4",
      reason: "interrupted"
    }
  });

  assert.deepEqual(threadState.pendingNotifications, {});
  assert.equal(threadState.currentTurnId, "");
  assert.equal(threadState.activeTurns["turn-4"], undefined);
});

test("aborted turn with non-interrupted reason queues an interruption notification", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = { id: "thread-5", title: "broken task" };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {},
    activeTurns: {
      "turn-5": bridge.normalizeActiveTurn({
        startedAt: "2026-03-31T00:00:00.000Z",
        toolCallCount: 1,
        lastAssistantText: "partial result"
      })
    },
    currentTurnId: "turn-5"
  };

  bridge.processRolloutRecord(config, thread, threadState, {
    type: "event_msg",
    timestamp: "2026-03-31T00:00:10.000Z",
    payload: {
      type: "turn_aborted",
      turn_id: "turn-5",
      reason: "crashed"
    }
  });

  const queued = threadState.pendingNotifications["turn-5"];
  assert.ok(queued);
  assert.equal(queued.kind, "aborted");
  assert.equal(queued.reason, "crashed");
  assert.match(
    bridge.buildMonitorMessage(thread, queued, config),
    /Codex 任务中断通知/
  );
});

test("success notification includes project thread and command fields", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = {
    id: "thread-project-1",
    cwd: "/tmp/sample-project-a",
    title: "请只回复：dupfix-test-real-once",
    first_user_message: "请只回复：dupfix-test-real-once"
  };
  const notification = bridge.normalizePendingNotification({
    kind: "complete",
    turnId: "turn-project-1",
    completedAt: "2026-03-31T00:00:20.000Z",
    summary: "任务已经完成",
    prompt: "请只回复：dupfix-test-real-once"
  });

  const message = bridge.buildMonitorMessage(thread, notification, config);

  assert.match(message, /Codex 任务完成通知/);
  assert.match(message, /Project：sample-project-a/);
  assert.match(message, /Thread：请只回复：dupfix-test-real-once/);
  assert.match(message, /Prompt：请只回复：dupfix-test-real-once/);
  assert.match(message, /结果：任务已经完成/);
});

test("aborted notification includes project command and reason fields", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = {
    id: "thread-project-2",
    cwd: "/tmp/sample-project",
    title: "失败线程",
    first_user_message: "请帮我运行失败测试"
  };
  const notification = bridge.normalizePendingNotification({
    kind: "aborted",
    turnId: "turn-project-2",
    completedAt: "2026-03-31T00:00:20.000Z",
    summary: "最后停在了构建阶段",
    reason: "crashed",
    prompt: "请帮我运行失败测试"
  });

  const message = bridge.buildMonitorMessage(thread, notification, config);

  assert.match(message, /Codex 任务中断通知/);
  assert.match(message, /Project：sample-project/);
  assert.match(message, /Thread：失败线程/);
  assert.match(message, /Prompt：请帮我运行失败测试/);
  assert.match(message, /原因：crashed/);
  assert.match(message, /摘要：最后停在了构建阶段/);
});

test("notification fields fall back and truncate long prompt previews", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const longTitle = `# ${"线程标题".repeat(40)}`;
  const longPrompt = `\`\`\`md\n${"提示词内容".repeat(60)}\n\`\`\``;
  const thread = {
    id: "thread-project-3",
    cwd: "",
    title: longTitle,
    first_user_message: "线程开头提示词"
  };
  const notification = bridge.normalizePendingNotification({
    kind: "complete",
    turnId: "turn-project-3",
    completedAt: "2026-03-31T00:00:20.000Z",
    summary: "ok",
    prompt: longPrompt
  });

  const message = bridge.buildMonitorMessage(thread, notification, config);

  assert.match(message, /Project：未知 Project/);
  assert.match(message, /Thread：线程标题/);
  assert.match(message, /Prompt：提示词内容/);
  assert.ok(!message.includes("```"));
  assert.ok(message.includes("…"));
});

test("notification prompt field falls back when turn prompt is missing", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = {
    id: "thread-project-4",
    cwd: "/tmp/another-project",
    title: "",
    first_user_message: "线程初始提示词"
  };
  const notification = bridge.normalizePendingNotification({
    kind: "complete",
    turnId: "turn-project-4",
    completedAt: "2026-03-31T00:00:20.000Z",
    summary: "ok"
  });

  const message = bridge.buildMonitorMessage(thread, notification, config);

  assert.match(message, /Project：another-project/);
  assert.match(message, /Thread：未命名线程/);
  assert.match(message, /Prompt：未记录 Prompt/);
});

test("completion notification uses the latest turn prompt instead of thread first message", async () => {
  const bridge = await loadBridgeForTests();
  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = {
    id: "thread-project-5",
    cwd: "/tmp/sample-project-b",
    title: "hello2",
    first_user_message: "hello2"
  };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {},
    activeTurns: {
      "turn-project-5": bridge.normalizeActiveTurn({
        startedAt: "2026-03-31T00:00:00.000Z",
        toolCallCount: 0,
        lastAssistantText: "3.14159265358979323846"
      })
    },
    currentTurnId: "turn-project-5"
  };

  bridge.processRolloutRecord(config, thread, threadState, {
    type: "event_msg",
    timestamp: "2026-03-31T00:00:01.000Z",
    payload: {
      type: "user_message",
      message: "告诉我圆周率20位"
    }
  });

  bridge.processRolloutRecord(config, thread, threadState, {
    type: "event_msg",
    timestamp: "2026-03-31T00:00:02.000Z",
    payload: {
      type: "task_complete",
      turn_id: "turn-project-5",
      last_agent_message: "3.14159265358979323846"
    }
  });

  const queued = threadState.pendingNotifications["turn-project-5"];
  const message = bridge.buildMonitorMessage(thread, queued, config);

  assert.ok(queued);
  assert.equal(queued.prompt, "告诉我圆周率20位");
  assert.match(message, /Thread：hello2/);
  assert.match(message, /Prompt：告诉我圆周率20位/);
  assert.ok(!message.includes("Prompt：hello2"));
});

test("successful notification persists monitor state immediately after send", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      [
        /function saveMonitorState\(state\) \{[\s\S]*?\n\}/,
        `function saveMonitorState(state) {
  globalThis.__bridgeSaveMonitorCalls = (globalThis.__bridgeSaveMonitorCalls || 0) + 1;
  globalThis.__bridgeLastSavedMonitorState = JSON.parse(JSON.stringify(state));
}
`
      ],
      [
        /async function sendMonitorNotification\(config, credentials, thread, notification\) \{[\s\S]*?\n\}/,
        `async function sendMonitorNotification(config, credentials, thread, notification) {
  globalThis.__bridgeSentNotifications = globalThis.__bridgeSentNotifications || [];
  globalThis.__bridgeSentNotifications.push({ threadId: thread.id, turnId: notification.turnId });
}
`
      ]
    ]
  });
  globalThis.__bridgeSaveMonitorCalls = 0;
  globalThis.__bridgeLastSavedMonitorState = null;
  globalThis.__bridgeSentNotifications = [];

  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = { id: "thread-6", title: "persist after send" };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {
      "turn-6": bridge.normalizePendingNotification({
        kind: "complete",
        turnId: "turn-6",
        threadTitle: "persist after send",
        completedAt: "2026-03-31T00:00:20.000Z",
        summary: "done"
      })
    },
    activeTurns: {},
    currentTurnId: ""
  };
  const monitorState = {
    accountId: "bot",
    bootstrappedAt: "",
    threads: {
      "thread-6": threadState
    },
    lastError: null,
    lastSuccessAt: "",
    updatedAt: ""
  };

  await bridge.flushPendingNotifications(config, { userId: "user" }, thread, threadState, monitorState);

  assert.equal(globalThis.__bridgeSentNotifications.length, 1);
  assert.equal(globalThis.__bridgeSaveMonitorCalls > 0, true);
  assert.ok(globalThis.__bridgeLastSavedMonitorState);
  assert.deepEqual(threadState.pendingNotifications, {});
  assert.deepEqual(threadState.notifiedTurnIds, ["turn-6"]);
});

test("flushPendingNotifications skips resend when delivery key was already persisted", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      [
        /async function sendMonitorNotification\(config, credentials, thread, notification\) \{[\s\S]*?\n\}/,
        `async function sendMonitorNotification(config, credentials, thread, notification) {
  globalThis.__bridgeUnexpectedResends = (globalThis.__bridgeUnexpectedResends || 0) + 1;
}
`
      ],
      [
        /function saveMonitorState\(state\) \{[\s\S]*?\n\}/,
        `function saveMonitorState(state) {
  globalThis.__bridgeSavedAfterSkip = JSON.parse(JSON.stringify(state));
}
`
      ]
    ]
  });
  globalThis.__bridgeUnexpectedResends = 0;
  globalThis.__bridgeSavedAfterSkip = null;

  const config = { ...bridge.DEFAULT_CONFIG };
  const thread = { id: "thread-7", title: "already delivered" };
  const threadState = {
    notifiedTurnIds: [],
    pendingNotifications: {
      "turn-7": {
        kind: "complete",
        turnId: "turn-7",
        deliveryKey: "delivery-7",
        completedAt: "2026-03-31T00:00:20.000Z",
        summary: "done"
      }
    },
    activeTurns: {},
    currentTurnId: ""
  };
  const monitorState = {
    accountId: "bot",
    bootstrappedAt: "",
    threads: { "thread-7": threadState },
    sentDeliveryKeys: ["delivery-7"],
    lastError: null,
    lastSuccessAt: "",
    updatedAt: ""
  };

  await bridge.flushPendingNotifications(config, { userId: "user" }, thread, threadState, monitorState);

  assert.equal(globalThis.__bridgeUnexpectedResends, 0);
  assert.deepEqual(threadState.pendingNotifications, {});
  assert.deepEqual(threadState.notifiedTurnIds, ["turn-7"]);
  assert.ok(globalThis.__bridgeSavedAfterSkip);
});

test("sendTextMessage reuses provided client_id for idempotent delivery", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      [
        /async function apiPost\(\{ baseUrl, endpoint, token, body, timeoutMs \}\) \{[\s\S]*?\n\}/,
        `async function apiPost({ body }) {
  globalThis.__bridgeLastSendBody = JSON.parse(body);
  return JSON.stringify({ ret: 0 });
}
`
      ]
    ]
  });
  globalThis.__bridgeLastSendBody = null;

  await bridge.sendTextMessage(
    "https://example.com",
    "token",
    "user@im.wechat",
    "hello",
    "ctx-token",
    "stable-client-id"
  );

  assert.equal(globalThis.__bridgeLastSendBody.msg.client_id, "stable-client-id");
});

test("detectManagedProcess recognizes codex-wechat alias start commands", async () => {
  const bridge = await loadBridgeForTests();

  const detected = bridge.detectManagedProcess(
    "node /opt/codex/bin/codex-wechat start"
  );

  assert.deepEqual(detected, {
    kind: "bridge",
    roles: ["consumer", "monitor"]
  });
});

test("classifyConsumerState counts codex-wechat alias instances as bridge conflicts", async () => {
  const bridge = await loadBridgeForTests();

  const state = bridge.classifyConsumerState([
    {
      pid: 1001,
      command: "node /opt/codex/bin/codex-wechat start",
      kind: "bridge",
      roles: ["consumer", "monitor"]
    }
  ]);

  assert.equal(state.hasConflict, false);
  assert.equal(state.bridge.length, 1);

  const stateWithCurrentPid = bridge.classifyConsumerState(
    [
      {
        pid: 1001,
        command: "node /opt/codex/bin/codex-wechat start",
        kind: "bridge",
        roles: ["consumer", "monitor"]
      },
      {
        pid: 1002,
        command: "node /workspace/tools/codex-wechat-bridge/codex-wechat-bridge.mjs start",
        kind: "bridge",
        roles: ["consumer", "monitor"]
      }
    ],
    1002
  );

  assert.equal(stateWithCurrentPid.hasConflict, true);
  assert.equal(stateWithCurrentPid.bridge.length, 1);
});

test("extractTextFromMessage ignores quoted notification title and keeps only user text", async () => {
  const bridge = await loadBridgeForTests();

  const text = bridge.extractTextFromMessage({
    item_list: [
      {
        type: 1,
        text_item: { text: "继续处理这个任务" },
        ref_msg: { title: "Codex 任务完成通知" }
      }
    ]
  });

  assert.equal(text, "继续处理这个任务");
});

test("buildCodexResumeArgs allows resuming outside a git repository", async () => {
  const bridge = await loadBridgeForTests();

  assert.deepEqual(
    bridge.buildCodexResumeArgs({
      threadId: "thread-non-git-1",
      cwd: "/tmp/non-git-project"
    }),
    [
      "exec",
      "-C",
      "/tmp/non-git-project",
      "--skip-git-repo-check",
      "--color",
      "never",
      "resume",
      "thread-non-git-1",
      "-"
    ]
  );
});

test("buildCodexThreadDeepLink targets the supported Codex desktop thread route", async () => {
  const bridge = await loadBridgeForTests();

  assert.equal(
    bridge.buildCodexThreadDeepLink("019d3f3a-82bc-7883-9139-3bad4d81e74b"),
    "codex://threads/019d3f3a-82bc-7883-9139-3bad4d81e74b"
  );
  assert.deepEqual(
    bridge.buildDesktopThreadOpenArgs("codex://threads/019d3f3a-82bc-7883-9139-3bad4d81e74b"),
    ["codex://threads/019d3f3a-82bc-7883-9139-3bad4d81e74b"]
  );
});

test("buildDesktopPromptSubmissionArgs reads prompt files as UTF-8 and submits with Enter", async () => {
  const bridge = await loadBridgeForTests();

  const args = bridge.buildDesktopPromptSubmissionArgs("/tmp/prompt.txt");
  const script = args[1];

  assert.match(script, /read \(POSIX file promptFile\) as «class utf8»/);
  assert.match(script, /key code 36/);
  assert.doesNotMatch(script, /key code 36 using command down/);
});

test("runCodexResumePrompt submits the prompt through Codex desktop automation and confirms the rollout update", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-rollout-"));
  const rolloutPath = path.join(tempDir, "rollout.jsonl");
  await fs.writeFile(
    rolloutPath,
    '{"timestamp":"2026-03-31T00:00:00.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-old","last_agent_message":"done"}}\n',
    "utf8"
  );

  const bridge = await loadBridgeForTests({
    replacements: [
      [
        /import \{ spawn, spawnSync \} from "node:child_process";/,
        `const spawn = (...args) => globalThis.__bridgeSpawnMock(...args);
const spawnSync = (...args) => globalThis.__bridgeSpawnSyncMock(...args);`
      ],
      [
        /function findThreadById\(threadId\) \{[\s\S]*?\n\}/,
        `function findThreadById(threadId) {
  return threadId === "thread-ui-submit-1"
    ? {
        id: "thread-ui-submit-1",
        cwd: "/tmp",
        title: "hello",
        archived: 0,
        rolloutPath: globalThis.__bridgeRolloutPath
      }
    : null;
}
`
      ],
      [
        /function sleep\(ms\) \{[\s\S]*?\n\}/,
        `function sleep(ms) {
  globalThis.__bridgeSleepCalls = globalThis.__bridgeSleepCalls || [];
  globalThis.__bridgeSleepCalls.push(ms);
  return Promise.resolve();
}
`
      ]
    ]
  });

  globalThis.__bridgeRolloutPath = rolloutPath;
  globalThis.__bridgeSpawnSyncCalls = [];
  globalThis.__bridgeSleepCalls = [];
  globalThis.__bridgeSpawnMock = () => {
    throw new Error("spawn should not be used for desktop prompt submission");
  };
  globalThis.__bridgeSpawnSyncMock = (command, args, options) => {
    globalThis.__bridgeSpawnSyncCalls.push({ command, args, options });
    if (command === "ps") {
      return {
        status: 0,
        stdout: "123 /Applications/Codex.app/Contents/MacOS/Codex\n",
        stderr: ""
      };
    }
    if (
      command === "osascript" &&
      Array.isArray(args) &&
      args.some((value) => String(value).includes('UI elements enabled'))
    ) {
      return { status: 0, stdout: "true\n", stderr: "" };
    }
    if (command === "osascript") {
      fsSync.appendFileSync(
        rolloutPath,
        [
          '{"timestamp":"2026-03-31T00:00:01.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-new","model_context_window":258400,"collaboration_mode_kind":"default"}}',
          '{"timestamp":"2026-03-31T00:00:01.100Z","type":"event_msg","payload":{"type":"user_message","message":"测试问题：香蕉是什么颜色的","images":[],"local_images":[],"text_elements":[]}}'
        ].join("\n") + "\n",
        "utf8"
      );
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await bridge.runCodexResumePrompt(
    { ...bridge.DEFAULT_CONFIG },
    {
      threadId: "thread-ui-submit-1",
      cwd: "/tmp"
    },
    "测试问题：香蕉是什么颜色的"
  );

  assert.deepEqual(
    globalThis.__bridgeSpawnSyncCalls.map((call) => call.command),
    ["ps", "osascript", "open", "osascript"]
  );
  assert.deepEqual(globalThis.__bridgeSleepCalls, [2000]);
  assert.equal(
    globalThis.__bridgeSpawnSyncCalls.find((call) => call.command === "open")?.args?.[0],
    "codex://threads/thread-ui-submit-1"
  );
  const submitScript = globalThis.__bridgeSpawnSyncCalls
    .find(
      (call) =>
        call.command === "osascript" &&
        Array.isArray(call.args) &&
        !call.args.some((value) => String(value).includes("UI elements enabled"))
    )
    ?.args?.[1];
  assert.match(submitScript || "", /read \(POSIX file promptFile\) as «class utf8»/);
  assert.match(submitScript || "", /key code 36/);
  assert.doesNotMatch(submitScript || "", /key code 36 using command down/);
});

test("runCodexResumePrompt fails when desktop automation does not produce a matching rollout user_message", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-rollout-"));
  const rolloutPath = path.join(tempDir, "rollout.jsonl");
  await fs.writeFile(rolloutPath, "", "utf8");

  const bridge = await loadBridgeForTests({
    replacements: [
      [
        /import \{ spawn, spawnSync \} from "node:child_process";/,
        `const spawn = (...args) => globalThis.__bridgeSpawnMock(...args);
const spawnSync = (...args) => globalThis.__bridgeSpawnSyncMock(...args);`
      ],
      [
        /function findThreadById\(threadId\) \{[\s\S]*?\n\}/,
        `function findThreadById(threadId) {
  return threadId === "thread-ui-submit-2"
    ? {
        id: "thread-ui-submit-2",
        cwd: "/tmp",
        title: "hello",
        archived: 0,
        rolloutPath: globalThis.__bridgeRolloutPath
      }
    : null;
}
`
      ],
      [
        /function sleep\(ms\) \{[\s\S]*?\n\}/,
        `function sleep() {
  return Promise.resolve();
}
`
      ],
      [
        /const PROMPT_SUBMISSION_OBSERVE_TIMEOUT_MS = \d+;/,
        "const PROMPT_SUBMISSION_OBSERVE_TIMEOUT_MS = 20;"
      ],
      [
        /const PROMPT_SUBMISSION_POLL_MS = 250;/,
        "const PROMPT_SUBMISSION_POLL_MS = 0;"
      ]
    ]
  });

  globalThis.__bridgeRolloutPath = rolloutPath;
  globalThis.__bridgeSpawnSyncCalls = [];
  globalThis.__bridgeSpawnMock = () => {
    throw new Error("spawn should not be used for desktop prompt submission");
  };
  globalThis.__bridgeSpawnSyncMock = (command, args, options) => {
    globalThis.__bridgeSpawnSyncCalls.push({ command, args, options });
    if (command === "ps") {
      return {
        status: 0,
        stdout: "123 /Applications/Codex.app/Contents/MacOS/Codex\n",
        stderr: ""
      };
    }
    if (
      command === "osascript" &&
      Array.isArray(args) &&
      args.some((value) => String(value).includes('UI elements enabled'))
    ) {
      return { status: 0, stdout: "true\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await assert.rejects(
    bridge.runCodexResumePrompt(
      { ...bridge.DEFAULT_CONFIG },
      {
        threadId: "thread-ui-submit-2",
        cwd: "/tmp"
      },
      "测试问题：苹果是什么颜色的"
    ),
    /matching user_message/
  );
});

test("inspectPromptTargetResumability reports rollout observability for desktop prompt submission", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-target-"));
  const rolloutPath = path.join(tempDir, "rollout.jsonl");
  await fs.writeFile(rolloutPath, "", "utf8");
  const bridge = await loadBridgeForTests({
    replacements: [
      [
        /function findThreadById\(threadId\) \{[\s\S]*?\n\}/,
        `function findThreadById(threadId) {
  return threadId === "thread-non-git-2"
    ? { id: "thread-non-git-2", cwd: "/tmp", title: "hello", rolloutPath: ${JSON.stringify(rolloutPath)} }
    : null;
}
`
      ]
    ]
  });

  const inspection = bridge.inspectPromptTargetResumability({
    threadId: "thread-non-git-2",
    cwd: "/tmp"
  });

  assert.equal(inspection.ok, true);
  assert.match(inspection.detail, /thread exists/);
  assert.match(inspection.detail, /cwd exists/);
  assert.match(inspection.detail, /rollout available/);
});

test("sendMonitorNotification updates the sender's current prompt target after a successful send", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      ...senderStateStoreReplacements(),
      [
        /async function sendTextMessage\(baseUrl, token, toUserId, text, contextToken, clientId = ""\) \{[\s\S]*?\n\}/,
        `async function sendTextMessage() {
  globalThis.__bridgeSendMonitorDeliveries = (globalThis.__bridgeSendMonitorDeliveries || 0) + 1;
}
`
      ]
    ]
  });

  globalThis.__bridgeSenderStateStore = {
    "user@im.wechat": {
      senderId: "user@im.wechat",
      contextToken: "ctx-token",
      history: [],
      recentFingerprints: [],
      lastError: null
    }
  };
  globalThis.__bridgeSendMonitorDeliveries = 0;

  await bridge.sendMonitorNotification(
    { ...bridge.DEFAULT_CONFIG },
    {
      userId: "user@im.wechat",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      id: "thread-notify-1",
      cwd: "/tmp/project-a",
      title: "线程 A"
    },
    {
      kind: "complete",
      turnId: "turn-notify-1",
      prompt: "请继续分析",
      completedAt: "2026-03-31T00:00:20.000Z"
    }
  );

  assert.equal(globalThis.__bridgeSendMonitorDeliveries, 1);
  assert.equal(
    globalThis.__bridgeSenderStateStore["user@im.wechat"]?.lastNotifiedThreadId,
    "thread-notify-1"
  );
  assert.equal(
    globalThis.__bridgeSenderStateStore["user@im.wechat"]?.lastNotifiedCwd,
    "/tmp/project-a"
  );
});

test("processIncomingMessage sends guidance instead of chat reply when no prompt target exists", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      ...senderStateStoreReplacements(),
      [
        /async function runCodexReply\(config, senderId, history\) \{[\s\S]*?\n\}/,
        `async function runCodexReply() {
  globalThis.__bridgeUnexpectedChatReply = (globalThis.__bridgeUnexpectedChatReply || 0) + 1;
  return "chat reply";
}
`
      ],
      [
        /async function sendTextMessage\(baseUrl, token, toUserId, text, contextToken, clientId = ""\) \{[\s\S]*?\n\}/,
        `async function sendTextMessage(baseUrl, token, toUserId, text) {
  globalThis.__bridgeSentTexts = globalThis.__bridgeSentTexts || [];
  globalThis.__bridgeSentTexts.push({ toUserId, text });
}
`
      ]
    ]
  });

  globalThis.__bridgeSenderStateStore = {
    "user@im.wechat": {
      senderId: "user@im.wechat",
      contextToken: "ctx-token",
      history: [],
      recentFingerprints: [],
      lastError: null
    }
  };
  globalThis.__bridgeUnexpectedChatReply = 0;
  globalThis.__bridgeSentTexts = [];

  await bridge.processIncomingMessage(
    { ...bridge.DEFAULT_CONFIG },
    {
      accountId: "bot-1",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      from_user_id: "user@im.wechat",
      context_token: "ctx-token",
      item_list: [{ type: 1, text_item: { text: "继续处理" } }]
    }
  );

  assert.equal(globalThis.__bridgeUnexpectedChatReply, 0);
  assert.match(
    globalThis.__bridgeSentTexts[0]?.text || "",
    /当前还没有可续接的 Codex 任务/
  );
});

test("processIncomingMessage resumes the most recently notified thread and does not send an immediate reply", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      ...senderStateStoreReplacements(),
      [
        /async function runCodexReply\(config, senderId, history\) \{[\s\S]*?\n\}/,
        `async function runCodexReply() {
  globalThis.__bridgeUnexpectedChatReply = (globalThis.__bridgeUnexpectedChatReply || 0) + 1;
  return "chat reply";
}
`
      ],
      [
        /async function runCodexResumePrompt\(config, target, prompt\) \{[\s\S]*?\n\}/,
        `async function runCodexResumePrompt(config, target, prompt) {
  globalThis.__bridgeResumeCalls = globalThis.__bridgeResumeCalls || [];
  globalThis.__bridgeResumeCalls.push({ target, prompt });
}
`
      ],
      [
        /async function sendTextMessage\(baseUrl, token, toUserId, text, contextToken, clientId = ""\) \{[\s\S]*?\n\}/,
        `async function sendTextMessage(baseUrl, token, toUserId, text) {
  globalThis.__bridgeSentTexts = globalThis.__bridgeSentTexts || [];
  globalThis.__bridgeSentTexts.push({ toUserId, text });
}
`
      ]
    ]
  });

  globalThis.__bridgeSenderStateStore = {
    "user@im.wechat": {
      senderId: "user@im.wechat",
      contextToken: "ctx-token",
      history: [],
      recentFingerprints: [],
      lastError: null,
      lastNotifiedThreadId: "thread-recent-1",
      lastNotifiedCwd: "/tmp/project-b",
      lastNotifiedTurnId: "turn-recent-1",
      lastNotifiedKind: "complete",
      lastNotifiedAt: "2026-03-31T00:00:20.000Z",
      lastNotificationTitle: "线程 B",
      lastNotificationPrompt: "上一轮提示词"
    }
  };
  globalThis.__bridgeUnexpectedChatReply = 0;
  globalThis.__bridgeResumeCalls = [];
  globalThis.__bridgeSentTexts = [];

  await bridge.processIncomingMessage(
    { ...bridge.DEFAULT_CONFIG },
    {
      accountId: "bot-1",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      from_user_id: "user@im.wechat",
      context_token: "ctx-token",
      item_list: [{ type: 1, text_item: { text: "请继续做稳健性分析" } }]
    }
  );

  assert.equal(globalThis.__bridgeUnexpectedChatReply, 0);
  assert.equal(globalThis.__bridgeSentTexts.length, 0);
  assert.deepEqual(globalThis.__bridgeResumeCalls, [
    {
      target: {
        threadId: "thread-recent-1",
        cwd: "/tmp/project-b"
      },
      prompt: "请继续做稳健性分析"
    }
  ]);
});

test("processIncomingMessage stores desktop submission failure context and sends project-specific guidance when submission fails", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      ...senderStateStoreReplacements(),
      [
        /async function runCodexResumePrompt\(config, target, prompt\) \{[\s\S]*?\n\}/,
        `async function runCodexResumePrompt() {
  const error = new Error("did not observe matching user_message in rollout after desktop submission");
  error.bridgeStage = "desktop-confirm-user-message";
  throw error;
}
`
      ],
      [
        /async function sendTextMessage\(baseUrl, token, toUserId, text, contextToken, clientId = ""\) \{[\s\S]*?\n\}/,
        `async function sendTextMessage(baseUrl, token, toUserId, text) {
  globalThis.__bridgeSentResumeFailureTexts = globalThis.__bridgeSentResumeFailureTexts || [];
  globalThis.__bridgeSentResumeFailureTexts.push({ toUserId, text });
}
`
      ]
    ]
  });

  globalThis.__bridgeSenderStateStore = {
    "user@im.wechat": {
      senderId: "user@im.wechat",
      accountId: "bot-1",
      contextToken: "ctx-token",
      history: [],
      recentFingerprints: [],
      lastError: null,
      lastNotifiedThreadId: "thread-fail-1",
      lastNotifiedCwd: "/tmp/project-b",
      lastNotifiedTurnId: "turn-fail-1",
      lastNotifiedKind: "complete",
      lastNotifiedAt: "2026-03-31T00:00:20.000Z",
      lastNotificationTitle: "线程 B",
      lastNotificationPrompt: "上一轮提示词"
    }
  };
  globalThis.__bridgeSentResumeFailureTexts = [];

  await bridge.processIncomingMessage(
    { ...bridge.DEFAULT_CONFIG },
    {
      accountId: "bot-1",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      from_user_id: "user@im.wechat",
      context_token: "ctx-token",
      item_list: [{ type: 1, text_item: { text: "算出圆周率九位数" } }]
    }
  );

  const savedState = globalThis.__bridgeSenderStateStore["user@im.wechat"];
  assert.equal(savedState.lastError?.stage, "desktop-confirm-user-message");
  assert.equal(savedState.lastError?.threadId, "thread-fail-1");
  assert.equal(savedState.lastError?.cwd, "/tmp/project-b");
  assert.equal(savedState.lastError?.project, "project-b");
  assert.match(savedState.lastError?.message || "", /matching user_message/);
  assert.match(globalThis.__bridgeSentResumeFailureTexts[0]?.text || "", /Project：project-b/);
});

test("processIncomingMessage suppresses same prompt repeated across devices for the same target thread", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      ...senderStateStoreReplacements(),
      [
        /async function runCodexResumePrompt\(config, target, prompt\) \{[\s\S]*?\n\}/,
        `async function runCodexResumePrompt(config, target, prompt) {
  globalThis.__bridgeResumeCalls = globalThis.__bridgeResumeCalls || [];
  globalThis.__bridgeResumeCalls.push({ target, prompt });
}
`
      ],
      [
        /async function sendTextMessage\(baseUrl, token, toUserId, text, contextToken, clientId = ""\) \{[\s\S]*?\n\}/,
        `async function sendTextMessage(baseUrl, token, toUserId, text) {
  globalThis.__bridgeSentTexts = globalThis.__bridgeSentTexts || [];
  globalThis.__bridgeSentTexts.push({ toUserId, text });
}
`
      ]
    ]
  });

  globalThis.__bridgeSenderStateStore = {
    "user@im.wechat": {
      senderId: "user@im.wechat",
      accountId: "bot-1",
      contextToken: "ctx-token",
      history: [],
      recentFingerprints: [],
      recentPromptSubmissions: [],
      lastError: null,
      lastNotifiedThreadId: "thread-recent-1",
      lastNotifiedCwd: "/tmp/project-b",
      lastNotifiedTurnId: "turn-recent-1",
      lastNotifiedKind: "complete",
      lastNotifiedAt: "2026-03-31T00:00:20.000Z",
      lastNotificationTitle: "线程 B",
      lastNotificationPrompt: "上一轮提示词"
    }
  };
  globalThis.__bridgeResumeCalls = [];
  globalThis.__bridgeSentTexts = [];

  const prompt = "检查 README 的前置条件是否多余";
  await bridge.processIncomingMessage(
    { ...bridge.DEFAULT_CONFIG },
    {
      accountId: "bot-1",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      from_user_id: "user@im.wechat",
      context_token: "ctx-token-ipad",
      client_id: "ipad-client",
      item_list: [{ type: 1, text_item: { text: prompt } }]
    }
  );

  await bridge.processIncomingMessage(
    { ...bridge.DEFAULT_CONFIG },
    {
      accountId: "bot-1",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      from_user_id: "user@im.wechat",
      context_token: "ctx-token-iphone",
      client_id: "iphone-client",
      item_list: [{ type: 1, text_item: { text: prompt } }]
    }
  );

  assert.equal(globalThis.__bridgeResumeCalls.length, 1);
  assert.equal(globalThis.__bridgeResumeCalls[0]?.prompt, prompt);
  assert.equal(globalThis.__bridgeSentTexts.length, 0);
});

test("processIncomingMessage does not suppress the same prompt when the target thread changed", async () => {
  const bridge = await loadBridgeForTests({
    replacements: [
      ...senderStateStoreReplacements(),
      [
        /async function runCodexResumePrompt\(config, target, prompt\) \{[\s\S]*?\n\}/,
        `async function runCodexResumePrompt(config, target, prompt) {
  globalThis.__bridgeResumeCalls = globalThis.__bridgeResumeCalls || [];
  globalThis.__bridgeResumeCalls.push({ target, prompt });
}
`
      ]
    ]
  });

  globalThis.__bridgeSenderStateStore = {
    "user@im.wechat": {
      senderId: "user@im.wechat",
      accountId: "bot-1",
      contextToken: "ctx-token",
      history: [],
      recentFingerprints: [],
      recentPromptSubmissions: [],
      lastError: null,
      lastNotifiedThreadId: "thread-a",
      lastNotifiedCwd: "/tmp/project-a",
      lastNotifiedTurnId: "turn-a",
      lastNotifiedKind: "complete",
      lastNotifiedAt: "2026-03-31T00:00:20.000Z",
      lastNotificationTitle: "线程 A",
      lastNotificationPrompt: "上一轮提示词"
    }
  };
  globalThis.__bridgeResumeCalls = [];

  const prompt = "请继续执行同一个提示词";
  await bridge.processIncomingMessage(
    { ...bridge.DEFAULT_CONFIG },
    {
      accountId: "bot-1",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      from_user_id: "user@im.wechat",
      context_token: "ctx-token",
      client_id: "device-a",
      item_list: [{ type: 1, text_item: { text: prompt } }]
    }
  );

  globalThis.__bridgeSenderStateStore["user@im.wechat"].lastNotifiedThreadId = "thread-b";
  globalThis.__bridgeSenderStateStore["user@im.wechat"].lastNotifiedCwd = "/tmp/project-b";

  await bridge.processIncomingMessage(
    { ...bridge.DEFAULT_CONFIG },
    {
      accountId: "bot-1",
      token: "token",
      baseUrl: "https://example.com"
    },
    {
      from_user_id: "user@im.wechat",
      context_token: "ctx-token",
      client_id: "device-b",
      item_list: [{ type: 1, text_item: { text: prompt } }]
    }
  );

  assert.deepEqual(globalThis.__bridgeResumeCalls, [
    {
      target: {
        threadId: "thread-a",
        cwd: "/tmp/project-a"
      },
      prompt
    },
    {
      target: {
        threadId: "thread-b",
        cwd: "/tmp/project-b"
      },
      prompt
    }
  ]);
});

test("runCodexResumePrompt keeps waiting for rollout confirmation beyond the old 12 second window", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-rollout-slow-"));
  const rolloutPath = path.join(tempDir, "rollout.jsonl");
  await fs.writeFile(rolloutPath, "", "utf8");

  const bridge = await loadBridgeForTests({
    replacements: [
      [
        /import \{ spawn, spawnSync \} from "node:child_process";/,
        `const spawn = (...args) => globalThis.__bridgeSpawnMock(...args);
const spawnSync = (...args) => globalThis.__bridgeSpawnSyncMock(...args);`
      ],
      [
        /function findThreadById\(threadId\) \{[\s\S]*?\n\}/,
        `function findThreadById(threadId) {
  return threadId === "thread-ui-submit-slow"
    ? {
        id: "thread-ui-submit-slow",
        cwd: "/tmp",
        title: "slow thread",
        archived: 0,
        rolloutPath: globalThis.__bridgeRolloutPath
      }
    : null;
}
`
      ],
      [
        /Date\.now\(\)/g,
        "globalThis.__bridgeNow()"
      ],
      [
        /function sleep\(ms\) \{[\s\S]*?\n\}/,
        `function sleep() {
  globalThis.__bridgeSleepCallCount = (globalThis.__bridgeSleepCallCount || 0) + 1;
  globalThis.__bridgeFakeNow += 15000;
  if (globalThis.__bridgeSleepCallCount === 2) {
    fs.appendFileSync(
      globalThis.__bridgeRolloutPath,
      [
        '{"timestamp":"2026-03-31T00:00:20.000Z","type":"event_msg","payload":{"type":"user_message","message":"慢一点的提交确认","images":[],"local_images":[],"text_elements":[]}}',
        '{"timestamp":"2026-03-31T00:00:20.100Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-slow","model_context_window":258400,"collaboration_mode_kind":"default"}}'
      ].join("\\n") + "\\n",
      "utf8"
    );
  }
  return Promise.resolve();
}
`
      ]
    ]
  });

  globalThis.__bridgeRolloutPath = rolloutPath;
  globalThis.__bridgeFakeNow = 0;
  globalThis.__bridgeNow = () => globalThis.__bridgeFakeNow;
  globalThis.__bridgeSleepCallCount = 0;
  globalThis.__bridgeSpawnMock = () => {
    throw new Error("spawn should not be used for desktop prompt submission");
  };
  globalThis.__bridgeSpawnSyncMock = (command, args, options) => {
    if (command === "ps") {
      return {
        status: 0,
        stdout: "123 /Applications/Codex.app/Contents/MacOS/Codex\\n",
        stderr: ""
      };
    }
    if (
      command === "osascript" &&
      Array.isArray(args) &&
      args.some((value) => String(value).includes('UI elements enabled'))
    ) {
      return { status: 0, stdout: "true\\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await assert.doesNotReject(
    bridge.runCodexResumePrompt(
      { ...bridge.DEFAULT_CONFIG },
      {
        threadId: "thread-ui-submit-slow",
        cwd: "/tmp"
      },
      "慢一点的提交确认"
    )
  );
});
