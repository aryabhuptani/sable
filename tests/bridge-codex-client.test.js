const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createBridgeCodexClient } = require("../apps/signal-bridge/bridge-codex-client");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BRIDGE_DIR = path.join(PROJECT_ROOT, "apps", "signal-bridge");

function createClient(envSource = {}) {
  return createBridgeCodexClient({
    spawn: () => {
      throw new Error("spawn should not be called");
    },
    cwd: BRIDGE_DIR,
    projectDir: BRIDGE_DIR,
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

test("codex child env inherits bridge CODEX_HOME", () => {
  const client = createClient({
    CODEX_HOME: "/home/arya/.codex-bridge",
    PATH: "/usr/bin",
  });

  const env = client.buildCodexChildEnv("+12025550123");

  assert.equal(env.CODEX_HOME, "/home/arya/.codex-bridge");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.SIGNAL_BRIDGE_DIR, BRIDGE_DIR);
  assert.equal(env.SIGNAL_REPLY_TO, "+12025550123");
});

test("codex app-server launches with full-access bridge flags", () => {
  const client = createClient();

  assert.deepEqual(client.buildCodexAppServerArgs(), [
    "--search",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    BRIDGE_DIR,
    "-c",
    "shell_environment_policy.inherit=all",
    "app-server",
    "--listen",
    "stdio://",
  ]);
});

test("codex child env clears blank reply recipient", () => {
  const client = createClient({
    SIGNAL_REPLY_TO: "+12025550123",
  });

  const env = client.buildCodexChildEnv(" ");

  assert.equal(env.SIGNAL_REPLY_TO, undefined);
});
