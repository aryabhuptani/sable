const assert = require("node:assert/strict");
const test = require("node:test");

const { createBridgeJobRuntime } = require("../apps/signal-bridge/bridge-job-runtime");

function createRuntime(overrides = {}) {
  const replies = [];
  const progress = [];
  const cleaned = [];
  let activeJob = null;
  const sessions = {
    interactiveSessionId: null,
    backgroundSessionId: null,
  };
  const runtime = createBridgeJobRuntime({
    appServerMessages: {
      shouldForwardAgentMessageAlongsideToolSuggestion: () => true,
    },
    autoresearchMonitor: {
      sendCompletionNotices: async () => {},
      snapshotRuns: () => [],
    },
    cleanupPaths: async (paths) => cleaned.push(...paths),
    clearActiveJob: () => {
      activeJob = null;
    },
    clearInFlightTurn: () => {},
    clearSessionState: (kind) => {
      sessions[kind === "background" ? "backgroundSessionId" : "interactiveSessionId"] = null;
    },
    createJobControl: (sender) => ({ sender }),
    getBridgeStatusReport: async () => "status report",
    getOpsReport: async () => "ops report",
    getPendingPluginAuth: () => null,
    getSessionId: (key) => sessions[key],
    getTelegramTriageReport: async () => "telegram report",
    formatHelp: () => "help text",
    mergePromptSegments: (...segments) => segments.filter(Boolean).join("\n"),
    normalizeText: (value) => (typeof value === "string" && value.trim() ? value.trim() : ""),
    pluginAuth: {
      clear() {},
      formatStatus: () => "auth status",
      maybeStart: async () => false,
    },
    pluginRuntime: {
      dispatch: async (job) => {
        await replies.push({ sender: job.sender, message: `plugin ${job.command.commandName}` });
        return true;
      },
      formatStatus: () => "plugin status",
    },
    runCodex: async () => ({ sessionId: "session-1", message: "final" }),
    saveSessionId: (key, value) => {
      sessions[key] = value;
    },
    schedulerRuntime: {
      listSchedules: () => "schedule list",
      removeScheduledJob: () => true,
    },
    scheduledNoReplyMarker: "__NO_REPLY__",
    sendReply: async (sender, message) => replies.push({ sender, message }),
    setActiveJob: (sender, jobControl) => {
      activeJob = { sender, jobControl };
    },
    setInFlightTurn: (_sender, prompt) => progress.push(prompt),
    signalAttachments: {
      buildFileAttachmentPromptContext: async () => ({ ok: true, promptText: "file text" }),
      buildLocalAttachmentPathPromptContext: () => "local paths",
      materializeIncomingAudio: async () => [],
      materializeIncomingFiles: async () => [],
      materializeIncomingImages: async () => [],
    },
    signalProfile: { updateAvatar: async () => {} },
    timestamp: () => "now",
    voiceNotes: {
      formatTranscriptMessage: () => "transcript",
      isEnabled: () => true,
      transcribe: async () => ({ transcript: "voice text" }),
    },
    ...overrides,
  });
  return { activeJob: () => activeJob, cleaned, progress, replies, runtime, sessions };
}

test("job runtime handles status, ops, and schedule commands without running Codex", async () => {
  const { replies, runtime } = createRuntime();
  await runtime.processJob({ sender: "+1555", command: { type: "help" } });
  await runtime.processJob({ sender: "+1555", command: { type: "status" } });
  await runtime.processJob({ sender: "+1555", command: { type: "ops" } });
  await runtime.processJob({ sender: "+1555", command: { type: "list-schedules" } });

  assert.deepEqual(replies.map((reply) => reply.message), [
    "help text",
    "status report",
    "ops report",
    "schedule list",
  ]);
});

test("job runtime handles plugin status and plugin command dispatch without Codex", async () => {
  const { replies, runtime } = createRuntime();
  await runtime.processJob({ sender: "+1555", command: { type: "plugin-status" } });
  await runtime.processJob({
    sender: "+1555",
    command: { type: "plugin-command", commandName: "/hello" },
  });

  assert.deepEqual(replies.map((reply) => reply.message), [
    "plugin status",
    "plugin /hello",
  ]);
});

test("job runtime runs prompt jobs, stores session ids, and cleans materialized paths", async () => {
  const { activeJob, cleaned, progress, replies, runtime, sessions } = createRuntime({
    signalAttachments: {
      buildFileAttachmentPromptContext: async () => ({ ok: true, promptText: "file text" }),
      buildLocalAttachmentPathPromptContext: () => "local paths",
      materializeIncomingAudio: async () => ["/tmp/a.wav"],
      materializeIncomingFiles: async () => ["/tmp/a.txt"],
      materializeIncomingImages: async () => ["/tmp/a.png"],
    },
  });

  await runtime.processJob({
    sender: "+1555",
    command: { type: "prompt", prompt: "hello" },
    context: {},
  });

  assert.equal(activeJob(), null);
  assert.equal(sessions.interactiveSessionId, "session-1");
  assert.equal(progress[0].includes("voice text"), true);
  assert.deepEqual(replies.map((reply) => reply.message), [
    "Transcribing voice note...",
    "transcript",
    "Reading attached files...",
    "final",
  ]);
  assert.deepEqual(cleaned.sort(), ["/tmp/a.png", "/tmp/a.txt", "/tmp/a.wav"]);
});

test("job runtime suppresses scheduled silent replies", async () => {
  const { replies, runtime, sessions } = createRuntime({
    runCodex: async () => ({ sessionId: "bg-session", message: "hidden" }),
  });

  await runtime.processJob({
    sender: "+1555",
    command: { type: "prompt", prompt: "background" },
    context: {},
    origin: "scheduled",
    replyMode: "silent",
  });

  assert.deepEqual(replies, []);
  assert.equal(sessions.backgroundSessionId, "bg-session");
});
