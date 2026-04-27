const assert = require("node:assert/strict");
const test = require("node:test");

const { createBridgeCodexClient } = require("../apps/signal-bridge/bridge-codex-client");

function createClient(envSource = {}) {
  return createBridgeCodexClient({
    spawn: () => {
      throw new Error("spawn should not be called");
    },
    cwd: "/home/arya/projects/sable/apps/signal-bridge",
    projectDir: "/home/arya/projects/sable/apps/signal-bridge",
    signalReplyToEnv: "SIGNAL_REPLY_TO",
    signalBridgeDirEnv: "SIGNAL_BRIDGE_DIR",
    appServerClientVersion: "test",
    appServerRequestTimeoutMs: 1000,
    normalizeText: (value) => String(value || "").trim(),
    timestamp: () => "2026-04-28T00:00:00.000Z",
    appendTestAppServerLog: () => {},
    onStderr: () => {},
    envSource,
  });
}

test("codex child env does not inherit bridge CODEX_HOME", () => {
  const client = createClient({
    CODEX_HOME: "/home/arya/.codex-bridge",
    PATH: "/usr/bin",
  });

  const env = client.buildCodexChildEnv("+12025550123");

  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.SIGNAL_BRIDGE_DIR, "/home/arya/projects/sable/apps/signal-bridge");
  assert.equal(env.SIGNAL_REPLY_TO, "+12025550123");
});

test("codex child env clears blank reply recipient", () => {
  const client = createClient({
    SIGNAL_REPLY_TO: "+12025550123",
  });

  const env = client.buildCodexChildEnv(" ");

  assert.equal(env.SIGNAL_REPLY_TO, undefined);
});
