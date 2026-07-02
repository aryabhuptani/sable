const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createBridgeConfig,
  selectPythonBin,
  validateBridgeConfig,
} = require("../apps/signal-bridge/bridge-config");
const {
  normalizeBooleanEnv,
  normalizeIntegerEnv,
  normalizeText,
  parseAllowedNumbers,
} = require("../apps/signal-bridge/bridge-utils");

const projectDir = "/repo/apps/signal-bridge";
const instanceConfig = {
  homeDir: "/home/tester",
  researchRoot: "/home/tester/memory/knowledge/research",
  defaultSchedulerJobsPath: "/home/tester/memory/tasks/default-schedules.json",
  schedulerJobsPath: "/home/tester/memory/tasks/schedules.json",
  schedulerStatePath: "/home/tester/memory/tasks/scheduler-state.json",
};

function createConfig(env = {}, overrides = {}) {
  return createBridgeConfig({
    env,
    execFileSync: overrides.execFileSync || (() => {}),
    fs: overrides.fs || { existsSync: () => false },
    instanceConfig,
    normalizeBooleanEnv,
    normalizeIntegerEnv,
    normalizeText,
    parseAllowedNumbers,
    projectDir,
  });
}

test("bridge config preserves local defaults while allowing future instance overrides", () => {
  const config = createConfig({
    PHONE_NUMBER: "+12025550100",
    ALLOWED_NUMBERS: "+12025550123,+12025550124",
    ALLOWED_SENDERS: "+12025550123",
  });

  assert.equal(config.CODEX_CWD, "/home/tester");
  assert.equal(config.STATE_PATH, path.join(projectDir, ".bridge-state.json"));
  assert.equal(config.RESEARCH_ROOT, instanceConfig.researchRoot);
  assert.equal(config.DEFAULT_SCHEDULER_JOBS_PATH, instanceConfig.defaultSchedulerJobsPath);
  assert.equal(config.SCHEDULER_JOBS_PATH, instanceConfig.schedulerJobsPath);
  assert.equal(config.SCHEDULER_STATE_PATH, instanceConfig.schedulerStatePath);
  assert.equal(config.VOICE_NOTES_MODEL, "base.en");
  assert.equal(
    config.VOICE_NOTES_MODEL_PATH,
    "/home/tester/models/faster-whisper-base.en"
  );
  assert.equal(config.CODEX_SESSIONS_DIR, "/home/tester/.codex/sessions");
  assert.equal(config.ATTACHMENT_QUEUE_PENDING_DIR, `${projectDir}/.attachment-queue/pending`);
  assert.equal(config.OPS_ALERTS_ENABLED, true);
  assert.equal(config.PRIMARY_RUNNER, "codex-cli");
  assert.equal(config.HERMES_CONTAINER, "hermes-sable-trial");
  assert.equal(config.HERMES_CWD, "/opt/data/workspace");
  assert.equal(config.HERMES_TIMEOUT_MS, 600000);
  assert.equal(config.phoneNumber, "+12025550100");
  assert.deepEqual([...config.allowedNumbers], ["+12025550123", "+12025550124"]);
  assert.deepEqual([...config.allowedSenders], ["+12025550123"]);
});

test("bridge config applies environment overrides and disables ops alerts in e2e mode", () => {
  const config = createConfig({
    ALLOWED_NUMBERS: "+1",
    APP_SERVER_IDLE_TIMEOUT_MS: "1234",
    CODEX_HOME: "/tmp/codex-home",
    SABLE_CODEX_CWD: "/tmp/work",
    SABLE_E2E_SIGNAL_LOG_PATH: "/tmp/signal.log",
    SABLE_DEFAULT_SCHEDULER_JOBS_PATH: "/tmp/default-schedules.json",
    SABLE_SCHEDULER_STATE_PATH: "/tmp/scheduler-state.json",
    SABLE_RESEARCH_ROOT: "/tmp/research",
    SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR: "/tmp/attachments",
    SABLE_PRIMARY_RUNNER: "hermes-cli",
    SABLE_HERMES_CONTAINER: "hermes-sable",
    SABLE_HERMES_CWD: "/opt/data/custom-workspace",
    SABLE_HERMES_TIMEOUT_MS: "42000",
    VOICE_NOTES_ENABLED: "false",
    VOICE_NOTES_TIMEOUT_SEC: "12",
  });

  assert.equal(config.CODEX_CWD, "/tmp/work");
  assert.equal(config.CODEX_SESSIONS_DIR, "/tmp/codex-home/sessions");
  assert.equal(config.RESEARCH_ROOT, "/tmp/research");
  assert.equal(config.DEFAULT_SCHEDULER_JOBS_PATH, "/tmp/default-schedules.json");
  assert.equal(config.SCHEDULER_STATE_PATH, "/tmp/scheduler-state.json");
  assert.equal(config.ATTACHMENT_QUEUE_RESULTS_DIR, "/tmp/attachments/results");
  assert.equal(config.APP_SERVER_IDLE_TIMEOUT_MS, 1234);
  assert.equal(config.VOICE_NOTES_ENABLED, false);
  assert.equal(config.VOICE_NOTES_TIMEOUT_SEC, 12);
  assert.equal(config.TEST_SIGNAL_LOG_PATH, "/tmp/signal.log");
  assert.equal(config.OPS_ALERTS_ENABLED, false);
  assert.equal(config.PRIMARY_RUNNER, "hermes-cli");
  assert.equal(config.HERMES_CONTAINER, "hermes-sable");
  assert.equal(config.HERMES_CWD, "/opt/data/custom-workspace");
  assert.equal(config.HERMES_TIMEOUT_MS, 42000);
});

test("selectPythonBin prefers an existing validated venv candidate and falls back to python3", () => {
  const calls = [];
  const fs = {
    existsSync: (candidate) => candidate === "/venv/bin/python",
  };
  const execFileSync = (candidate, args) => {
    calls.push([candidate, args]);
    if (candidate === "/bad/bin/python") {
      throw new Error("bad python");
    }
  };

  assert.equal(
    selectPythonBin({
      candidates: ["/missing/bin/python", "/venv/bin/python", "python3"],
      cwd: "/repo",
      execFileSync,
      fs,
      validationArgs: ["--version"],
    }),
    "/venv/bin/python"
  );
  assert.deepEqual(calls, [["/venv/bin/python", ["--version"]]]);

  assert.equal(
    selectPythonBin({
      candidates: ["/bad/bin/python", "python3"],
      cwd: "/repo",
      execFileSync: (candidate) => {
        if (candidate === "python3") {
          return;
        }
        throw new Error("bad python");
      },
      fs: { existsSync: () => true },
      validationArgs: ["--version"],
    }),
    "python3"
  );
});

test("bridge config validation reports only missing required Signal settings", () => {
  assert.deepEqual(
    validateBridgeConfig({ allowedNumbers: new Set(), phoneNumber: "" }),
    ["PHONE_NUMBER", "ALLOWED_NUMBERS"]
  );
  assert.deepEqual(
    validateBridgeConfig({ allowedNumbers: new Set(["+1"]), phoneNumber: "+2" }),
    []
  );
});
