const assert = require("node:assert/strict");
const test = require("node:test");

const { parseCommand } = require("../apps/signal-bridge/bridge-commands");
const { createBridgeQueueRuntime } = require("../apps/signal-bridge/bridge-queue-runtime");

function createEnvelope({ source = "+12025550123", text = "hello" } = {}) {
  return {
    source,
    dataMessage: {
      message: text,
    },
  };
}

function createSignalInbound() {
  return {
    extractSenderCandidates: (envelope) => [envelope?.source].filter(Boolean),
    extractIncomingText: (envelope) => envelope?.dataMessage?.message || "",
    isAllowedSender: (candidates) => candidates.includes("+12025550123"),
  };
}

function createSignalAttachments() {
  return {
    buildAttachmentContext: () => ({
      imagePaths: [],
      fileContexts: [],
      cleanupPaths: [],
    }),
    extractIncomingAudioAttachments: () => [],
    extractIncomingFileAttachments: () => [],
    extractIncomingImageAttachments: () => [],
    materializeIncomingAudio: async () => [],
  };
}

function createRuntimeHarness(overrides = {}) {
  const replies = [];
  const incoming = [];
  const processed = [];
  const errors = [];
  let jobRuntime = {
    async processJob(job) {
      processed.push(job);
    },
    async sendJobReply(job, text) {
      replies.push({ recipient: job.sender, text });
    },
  };
  let restartRequested = false;
  let shutdownRequested = false;
  let queueDrainedCount = 0;

  const runtime = createBridgeQueueRuntime({
    cancelJobControl: overrides.cancelJobControl || (() => true),
    cleanupPaths: async () => {},
    defaultFilePrompt: "Please analyze the attached files.",
    defaultImagePrompt: "Please analyze the attached image.",
    getBridgeStatusReport: async () => "status report",
    getJobRuntime: () => jobRuntime,
    getRestartRequested: () => restartRequested,
    getShutdownRequested: () => shutdownRequested,
    isCancellationError: () => false,
    logIncoming: (...args) => incoming.push(args),
    logger: {
      error: (message) => errors.push(message),
      log: () => {},
    },
    onQueueDrained: async () => {
      queueDrainedCount += 1;
    },
    parseCommand,
    schedulerRuntime: overrides.schedulerRuntime || {
      async checkForDueScheduledJobs({ enqueueBackgroundJob, ensureBackgroundProcessing }) {
        enqueueBackgroundJob({ sender: "scheduled", command: { type: "prompt" } });
        ensureBackgroundProcessing();
      },
    },
    sendReply: async (recipient, text) => replies.push({ recipient, text }),
    signalAttachments: createSignalAttachments(),
    signalInbound: createSignalInbound(),
    telegramTriageLimit: 5,
    timestamp: () => "2026-05-04T00:00:00.000Z",
    voiceNotes: {
      isEnabled: () => false,
      startQueuedPreparation: () => null,
    },
  });

  return {
    errors,
    incoming,
    processed,
    replies,
    runtime,
    setJobRuntime(value) {
      jobRuntime = value;
    },
    setRestartRequested(value) {
      restartRequested = value;
    },
    setShutdownRequested(value) {
      shutdownRequested = value;
    },
    getQueueDrainedCount: () => queueDrainedCount,
  };
}

test("bridge queue runtime accepts inbound Signal text and processes it", async () => {
  const harness = createRuntimeHarness();

  await harness.runtime.handleReceiveEvent({ params: { envelope: createEnvelope() } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.processed.length, 1);
  assert.equal(harness.processed[0].sender, "+12025550123");
  assert.equal(harness.processed[0].command.prompt, "hello");
  assert.deepEqual(harness.incoming, [["+12025550123", "hello", 0]]);
  assert.equal(harness.getQueueDrainedCount(), 1);
});

test("bridge queue runtime queues concurrent messages and acknowledges the sender", async () => {
  const harness = createRuntimeHarness();
  let releaseFirstJob;
  const firstJobDone = new Promise((resolve) => {
    releaseFirstJob = resolve;
  });

  harness.setJobRuntime({
    async processJob(job) {
      harness.processed.push(job);
      if (job.command.prompt === "first") {
        await firstJobDone;
      }
    },
    async sendJobReply(job, text) {
      harness.replies.push({ recipient: job.sender, text });
    },
  });

  await harness.runtime.handleReceiveEvent({
    params: { envelope: createEnvelope({ text: "first" }) },
  });
  await harness.runtime.handleReceiveEvent({
    params: { envelope: createEnvelope({ text: "second" }) },
  });

  assert.deepEqual(harness.replies, [
    { recipient: "+12025550123", text: "Queued, will process after current task." },
  ]);
  assert.equal(harness.runtime.getLiveState().interactiveQueueDepth, 1);

  releaseFirstJob();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    harness.processed.map((job) => job.command.prompt),
    ["first", "second"]
  );
});

test("bridge queue runtime handles cancel and restart-drain status paths", async () => {
  const harness = createRuntimeHarness();

  await harness.runtime.handleReceiveEvent({
    params: { envelope: createEnvelope({ text: "/cancel" }) },
  });
  assert.deepEqual(harness.replies, [
    { recipient: "+12025550123", text: "No active task to cancel." },
  ]);

  harness.replies.length = 0;
  harness.setRestartRequested(true);
  await harness.runtime.handleReceiveEvent({
    params: { envelope: createEnvelope({ text: "/bridgestatus" }) },
  });
  await harness.runtime.handleReceiveEvent({
    params: { envelope: createEnvelope({ text: "please do something" }) },
  });

  assert.deepEqual(harness.replies, [
    { recipient: "+12025550123", text: "status report" },
    {
      recipient: "+12025550123",
      text: "Restart in progress. I'm finishing the current task before reconnecting, so please resend after Sable is back.",
    },
  ]);
});

test("bridge queue runtime enqueues due scheduled background jobs", async () => {
  const harness = createRuntimeHarness();

  await harness.runtime.checkForDueScheduledJobs();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.processed.length, 1);
  assert.equal(harness.processed[0].sender, "scheduled");
  assert.equal(harness.getQueueDrainedCount(), 1);
});

test("bridge queue runtime exposes restart pause state to scheduled jobs", async () => {
  let observedPaused = null;
  const harness = createRuntimeHarness({
    schedulerRuntime: {
      async checkForDueScheduledJobs({ isPaused }) {
        observedPaused = isPaused();
      },
    },
  });

  harness.setRestartRequested(true);
  await harness.runtime.checkForDueScheduledJobs();

  assert.equal(observedPaused, true);
  assert.equal(harness.processed.length, 0);
});
