const assert = require("node:assert/strict");
const test = require("node:test");

const { createCodexCliRunnerAdapter } = require("../apps/signal-bridge/runner-adapter");

const BRIDGE_DIR = "/home/arya/projects/sable/apps/signal-bridge";

function createRunner(envSource = {}) {
  return createCodexCliRunnerAdapter({
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
    timestamp: () => "2026-05-04T00:00:00.000Z",
    appendTestAppServerLog: () => {},
    onStderr: () => {},
    envSource,
  });
}

test("Codex CLI runner adapter exposes stable runner identity", () => {
  const runner = createRunner();

  assert.equal(runner.id, "codex-cli");
  assert.equal(runner.kind, "runner");
  assert.equal(runner.displayName, "Codex CLI");
});

test("Codex CLI runner adapter preserves launch args and child env behavior", () => {
  const runner = createRunner({
    CODEX_HOME: "/home/arya/.codex-bridge",
    PATH: "/usr/bin",
  });

  assert.deepEqual(runner.buildLaunchArgs(), [
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

  const env = runner.buildChildEnv("+12025550123");
  assert.equal(env.CODEX_HOME, "/home/arya/.codex-bridge");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.SIGNAL_BRIDGE_DIR, BRIDGE_DIR);
  assert.equal(env.SIGNAL_REPLY_TO, "+12025550123");
});

test("Codex CLI runner adapter keeps compatibility aliases during migration", () => {
  const runner = createRunner();

  assert.equal(runner.buildCodexAppServerArgs, runner.buildLaunchArgs);
  assert.equal(runner.buildCodexChildEnv, runner.buildChildEnv);
  assert.equal(runner.recordTestAppServerSpawnArgs, runner.recordTestLaunchArgs);
  assert.equal(runner.createAppServerClient, runner.createSessionClient);
  assert.equal(runner.callCodexAppServer, runner.call);
});
