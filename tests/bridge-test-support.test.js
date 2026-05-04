const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createBridgeTestSupport } = require("../apps/signal-bridge/bridge-test-support");

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sable-test-support-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return root;
}

test("bridge test support schedules receive scenario events", async (t) => {
  const root = makeTempRoot(t);
  const scenarioPath = path.join(root, "receive.json");
  fs.writeFileSync(
    scenarioPath,
    JSON.stringify({
      receive: [{ sender: "+1555", message: "hi", attachments: [{ id: "a" }] }],
    }),
    "utf8"
  );
  const received = [];
  const timers = [];
  const support = createBridgeTestSupport({
    handleReceiveEvent: async (message) => received.push(message),
    setTimer: (callback) => {
      timers.push(callback);
      return "timer";
    },
  });

  await support.startReceiveScenario(scenarioPath);
  timers[0]();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(received[0].params.envelope, {
    sourceNumber: "+1555",
    source: "+1555",
    dataMessage: {
      message: "hi",
      attachments: [{ id: "a" }],
    },
  });
});

test("bridge test support logs JSONL and reads attachment maps", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sable-test-support-"));
  const receivePath = path.join(root, "receive.json");
  const appLogPath = path.join(root, "app.jsonl");
  const signalLogPath = path.join(root, "signal.jsonl");
  fs.writeFileSync(
    receivePath,
    JSON.stringify({ attachments: { a: { dataBase64: "abc" } } }),
    "utf8"
  );

  const support = createBridgeTestSupport({
    appendTimestamp: () => "now",
    testAppServerLogPath: appLogPath,
    testReceiveScenarioPath: receivePath,
    testSignalLogPath: signalLogPath,
  });
  support.appendAppServerLog({ method: "thread/start" });
  support.appendSignalLog({ method: "send" });

  assert.deepEqual(JSON.parse(fs.readFileSync(appLogPath, "utf8")), {
    at: "now",
    method: "thread/start",
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(signalLogPath, "utf8")), {
    at: "now",
    method: "send",
  });
  assert.deepEqual(support.getAttachmentMap(), { a: { dataBase64: "abc" } });
  fs.rmSync(root, { force: true, recursive: true });
});

test("bridge test support runs Codex test turn scenarios", async (t) => {
  const root = makeTempRoot(t);
  const scenarioPath = path.join(root, "turns.json");
  const cursorPath = path.join(root, "cursor");
  const appLogPath = path.join(root, "app.jsonl");
  fs.writeFileSync(
    scenarioPath,
    JSON.stringify({
      turns: [{ threadId: "thread-a", message: "reply", messageDelayMs: 0 }],
    }),
    "utf8"
  );

  const support = createBridgeTestSupport({
    appendTimestamp: () => "now",
    buildAppServerThreadParams: (threadId) => ({ threadId }),
    buildAppServerTurnParams: (threadId, prompt, imagePaths) => ({
      threadId,
      prompt,
      imagePaths,
    }),
    registerCancellationHandler: () => () => {},
    setTimer: (callback) => {
      setImmediate(callback);
      return "timer";
    },
    testAppServerLogPath: appLogPath,
    testTurnCursorPath: cursorPath,
    testTurnScenarioPath: scenarioPath,
  });

  assert.deepEqual(await support.runCodexViaTestScenario("prompt", null, ["/tmp/a.png"]), {
    sessionId: "thread-a",
    message: "reply",
    toolSuggestion: null,
    startedFreshBecauseResumeFailed: false,
  });
  assert.equal(fs.readFileSync(cursorPath, "utf8"), "1");
  const logLines = fs.readFileSync(appLogPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(logLines[0].method, "thread/start");
  assert.equal(logLines[1].method, "turn/start");
});
