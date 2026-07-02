const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createBridgeLifecycle,
  formatInterruptedTurnNotice,
} = require("../apps/signal-bridge/bridge-lifecycle");

function createFakeFs(existingPaths = new Set()) {
  const writes = [];
  const removals = [];
  return {
    existsSync: (path) => existingPaths.has(path),
    promises: {
      writeFile: async (path, content) => writes.push({ path, content }),
      rm: async (path) => {
        removals.push(path);
        existingPaths.delete(path);
      },
    },
    removals,
    writes,
  };
}

function createLifecycle(overrides = {}) {
  const restartPath = "/tmp/restart";
  const noticePath = "/tmp/notice";
  const fakeFs = overrides.fs || createFakeFs();
  let restartRequested = false;
  let shutdownRequested = false;
  const broadcasts = [];
  const replies = [];
  const exits = [];
  const logs = [];
  const signalRpc = {
    killCalls: [],
    kill(signal) {
      this.killCalls.push(signal);
      return true;
    },
    rejectAllPendingRequests(error) {
      this.rejected = error;
    },
  };
  const lifecycle = createBridgeLifecycle({
    backgroundQueue: [],
    broadcastAllowedMessage: async (message) => broadcasts.push(message),
    clearInFlightTurn: () => {
      inFlightTurn = null;
    },
    closeServer: () => {
      closed = true;
    },
    fs: fakeFs,
    getInFlightTurn: () => inFlightTurn,
    getRestartRequested: () => restartRequested,
    getShutdownRequested: () => shutdownRequested,
    hasActiveWork: () => activeWork,
    interactiveQueue: [],
    logger: { error: (line) => logs.push(line), log: (line) => logs.push(line) },
    processBackgroundQueue: async () => {},
    processExit: (code) => exits.push(code),
    processInteractiveQueue: async () => {},
    restartNoticePath: noticePath,
    restartRequestPath: restartPath,
    sendReply: async (sender, message) => replies.push({ sender, message }),
    setRestartRequested: (value) => {
      restartRequested = value;
    },
    setShutdownRequested: (value) => {
      shutdownRequested = value;
    },
    signalRpc,
    timestamp: () => "now",
    ...overrides,
  });
  let activeWork = false;
  let closed = false;
  let inFlightTurn = null;
  return {
    broadcasts,
    exits,
    fakeFs,
    get closed() {
      return closed;
    },
    get restartRequested() {
      return restartRequested;
    },
    get shutdownRequested() {
      return shutdownRequested;
    },
    lifecycle,
    logs,
    noticePath,
    replies,
    restartPath,
    setActiveWork: (value) => {
      activeWork = value;
    },
    setInFlightTurn: (value) => {
      inFlightTurn = value;
    },
    setRestartRequested: (value) => {
      restartRequested = value;
    },
    signalRpc,
  };
}

test("bridge lifecycle restarts once requested and writes reconnect notice", async () => {
  const harness = createLifecycle();
  harness.setRestartRequested(true);

  await harness.lifecycle.restartIfRequested();

  assert.deepEqual(harness.broadcasts, ["🟡 Restarting Connection to Sable"]);
  assert.deepEqual(harness.fakeFs.writes, [{ path: harness.noticePath, content: "now\n" }]);
  assert.deepEqual(harness.fakeFs.removals, [harness.restartPath]);
  assert.deepEqual(harness.signalRpc.killCalls, ["SIGTERM"]);
  assert.deepEqual(harness.exits, [0]);
});

test("bridge lifecycle sends reconnect and interrupted-turn notices", async () => {
  const fakeFs = createFakeFs(new Set(["/tmp/notice"]));
  const harness = createLifecycle({ fs: fakeFs });
  harness.setInFlightTurn({
    sender: "+1555",
    promptPreview: "hello",
  });

  await harness.lifecycle.maybeSendRestartReconnectNotice();
  await harness.lifecycle.maybeSendInterruptedTurnNotice();

  assert.deepEqual(harness.broadcasts, ["🟢 Reconnected to Sable"]);
  assert.deepEqual(harness.replies, [
    {
      sender: "+1555",
      message: [
        "Previous reply was interrupted by a bridge restart before Sable could finish.",
        "Ask me to continue and I'll pick it back up if the session survived.",
        "Last prompt: hello",
      ].join("\n"),
    },
  ]);
});

test("bridge lifecycle shutdown exits immediately when idle", () => {
  const harness = createLifecycle();
  harness.lifecycle.shutdown();

  assert.equal(harness.closed, true);
  assert.equal(harness.signalRpc.rejected.message, "Bridge shutting down");
  assert.deepEqual(harness.signalRpc.killCalls, ["SIGTERM"]);
  assert.deepEqual(harness.exits, [0]);
});

test("bridge lifecycle shutdown defers exit while work is active", () => {
  let interactiveProcessed = false;
  let backgroundProcessed = false;
  const harness = createLifecycle({
    backgroundQueue: ["background-job"],
    interactiveQueue: ["interactive-job"],
    processBackgroundQueue: async () => {
      backgroundProcessed = true;
    },
    processInteractiveQueue: async () => {
      interactiveProcessed = true;
    },
  });
  harness.setActiveWork(true);

  harness.lifecycle.shutdown();

  assert.equal(harness.shutdownRequested, true);
  assert.equal(harness.restartRequested, true);
  assert.equal(interactiveProcessed, true);
  assert.equal(backgroundProcessed, true);
  assert.equal(harness.closed, false);
  assert.equal(harness.signalRpc.rejected, undefined);
  assert.deepEqual(harness.signalRpc.killCalls, []);
  assert.deepEqual(harness.exits, []);
});

test("formatInterruptedTurnNotice omits missing prompt previews", () => {
  assert.equal(
    formatInterruptedTurnNotice({}),
    [
      "Previous reply was interrupted by a bridge restart before Sable could finish.",
      "Ask me to continue and I'll pick it back up if the session survived.",
    ].join("\n")
  );
});
