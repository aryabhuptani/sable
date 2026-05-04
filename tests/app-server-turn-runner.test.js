const assert = require("node:assert/strict");
const test = require("node:test");

const { createAppServerMessageHelpers } = require("../apps/signal-bridge/app-server-message-helpers");
const {
  buildAppServerThreadParams,
  buildAppServerTurnParams,
  createAppServerTurnRunner,
} = require("../apps/signal-bridge/app-server-turn-runner");
const { isInvalidSessionError, normalizeText, truncateText } = require("../apps/signal-bridge/bridge-utils");

function createRunnerHarness(overrides = {}) {
  const sentReplies = [];
  const liveUpdates = [];
  const appServerLog = [];
  const ops = {
    usage: 0,
    rateLimit: 0,
    started: 0,
    completed: 0,
  };
  let activeSender = "+12025550123";
  let createClientCalls = 0;

  const appServerMessages = createAppServerMessageHelpers({
    formatProgressMessage: (text) => `• ${String(text).trim()}`,
    normalizeText,
    timestamp: () => "2026-05-04T00:00:00.000Z",
    truncateText,
  });

  function createAppServerClient({ onNotification, onServerRequest, replyRecipient }) {
    createClientCalls += 1;
    const callNumber = createClientCalls;
    const client = {
      closed: false,
      async initialize() {
        return {};
      },
      async request(method, params) {
        if (overrides.failFirstResume && callNumber === 1 && method === "thread/resume") {
          throw new Error("conversation not found for session");
        }

        if (method === "thread/start" || method === "thread/resume") {
          return { thread: { id: params.threadId || "thread-fresh" } };
        }

        if (method === "turn/start") {
          assert.equal(replyRecipient, activeSender);
          onNotification({ method: "turn/started", params: { turn: { id: "turn-1" } } });
          onNotification({
            method: "item/completed",
            params: { item: { type: "agentMessage", text: "done" } },
          });
          onNotification({ method: "turn/completed", params: { turn: { id: "turn-1" } } });
          return { turn: { id: "turn-1" } };
        }

        if (method === "test/server-request") {
          return onServerRequest(params);
        }

        throw new Error(`unexpected method ${method}`);
      },
      close() {
        client.closed = true;
      },
    };
    return client;
  }

  const runner = createAppServerTurnRunner({
    runtimeHooks: {
      turnIdleTimeoutMs: 10_000,
      liveUpdateBatchWindowMs: 1,
      liveUpdateDuplicateWindowMs: 1,
      captureUsageSnapshot: () => {
        ops.usage += 1;
      },
      captureRateLimitSnapshot: () => {
        ops.rateLimit += 1;
      },
      noteTurnStarted: () => {
        ops.started += 1;
      },
      noteTurnCompleted: () => {
        ops.completed += 1;
      },
    },
    appServerMessages,
    codexCwd: "/home/arya",
    codexSessionReader: {
      async findToolSuggestionForTurn() {
        return null;
      },
      async findSessionErrorMessageForTurn() {
        return "";
      },
    },
    createAppServerClient,
    createLiveUpdateChannel: ({ recipient }) => ({
      queue(message) {
        liveUpdates.push({ recipient, message });
      },
      async flush() {},
      stop() {},
    }),
    formatProgressMessage: (text) => `• ${String(text).trim()}`,
    getActiveSender: () => activeSender,
    isInvalidSessionError,
    logger: { error() {}, log() {} },
    normalizeText,
    registerCancellationHandler: () => () => {},
    sendReply: async (recipient, text) => {
      sentReplies.push({ recipient, text });
    },
    testSupport: {
      appendAppServerLog(entry) {
        appServerLog.push(entry);
      },
    },
    timestamp: () => "2026-05-04T00:00:00.000Z",
    truncateText,
  });

  return {
    appServerLog,
    getCreateClientCalls: () => createClientCalls,
    liveUpdates,
    ops,
    runner,
    sentReplies,
    setActiveSender(value) {
      activeSender = value;
    },
  };
}

test("app-server turn params preserve Codex full-access bridge policy", () => {
  assert.deepEqual(buildAppServerThreadParams({ codexCwd: "/repo", threadId: "abc" }), {
    cwd: "/repo",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "guardian_subagent",
    personality: "pragmatic",
    threadId: "abc",
  });

  assert.deepEqual(
    buildAppServerTurnParams({
      codexCwd: "/repo",
      threadId: "abc",
      prompt: "hello",
      imagePaths: ["/tmp/a.png"],
    }),
    {
      threadId: "abc",
      cwd: "/repo",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      approvalsReviewer: "guardian_subagent",
      personality: "pragmatic",
      input: [
        { type: "text", text: "hello" },
        { type: "localImage", path: "/tmp/a.png" },
      ],
    }
  );
});

test("app-server turn runner starts a thread, streams progress, and returns final text", async () => {
  const harness = createRunnerHarness();

  const result = await harness.runner.runCodexViaAppServer("hello", null, ["/tmp/a.png"]);

  assert.deepEqual(result, {
    sessionId: "thread-fresh",
    message: "done",
    toolSuggestion: null,
    startedFreshBecauseResumeFailed: false,
  });
  assert.deepEqual(harness.liveUpdates, [
    { recipient: "+12025550123", message: "• Working..." },
  ]);
  assert.deepEqual(
    harness.appServerLog.map((entry) => entry.method),
    ["thread/start", "turn/start"]
  );
  assert.equal(harness.ops.started, 1);
  assert.equal(harness.ops.completed, 1);
});

test("app-server turn runner falls back to a fresh thread when resume is invalid", async () => {
  const harness = createRunnerHarness({ failFirstResume: true });
  let invalidated = false;

  const result = await harness.runner.runCodexViaAppServer(
    "hello",
    "stale-session",
    [],
    null,
    false,
    () => {
      invalidated = true;
    }
  );

  assert.equal(invalidated, true);
  assert.equal(result.startedFreshBecauseResumeFailed, true);
  assert.equal(result.sessionId, "thread-fresh");
  assert.equal(result.message, "done");
  assert.equal(harness.getCreateClientCalls(), 2);
  assert.deepEqual(
    harness.appServerLog.map((entry) => entry.method),
    ["thread/resume", "thread/start", "turn/start"]
  );
});
