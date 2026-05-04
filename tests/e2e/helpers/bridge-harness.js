const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const APP_DIR = path.join(PROJECT_ROOT, "apps", "signal-bridge");
const BRIDGE_PATH = path.join(APP_DIR, "bridge.js");
const FAKE_SIGNAL_PATH = path.join(PROJECT_ROOT, "tests", "e2e", "fakes", "fake-signal-cli.js");
const FAKE_CODEX_PATH = path.join(PROJECT_ROOT, "tests", "e2e", "fakes", "fake-codex.js");

async function makeExecutableShim(targetPath, shimPath) {
  await fsp.symlink(targetPath, shimPath);
  await fsp.chmod(targetPath, 0o755);
}

async function readJsonLines(filePath) {
  try {
    const content = await fsp.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function waitFor(predicate, { timeoutMs = 5_000, intervalMs = 50, description = "condition" } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

async function startBridgeScenario({
  signalScenario,
  codexScenario,
  initialSchedulerJobs = null,
  extraEnv = {},
}) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-e2e-"));
  const binDir = path.join(tempRoot, "bin");
  const signalScenarioPath = path.join(tempRoot, "signal-scenario.json");
  const codexScenarioPath = path.join(tempRoot, "codex-scenario.json");
  const codexCursorPath = path.join(tempRoot, "codex-cursor.txt");
  const signalLogPath = path.join(tempRoot, "signal.log");
  const appServerLogPath = path.join(tempRoot, "app-server.log");
  const bridgeLogPath = path.join(tempRoot, "bridge.log");
  const statePath = path.join(tempRoot, "bridge-state.json");
  const restartRequestPath = path.join(tempRoot, "restart-requested");
  const restartNoticePath = path.join(tempRoot, "restart-notice-pending");
  const schedulerJobsPath = path.join(tempRoot, "scheduler-jobs.json");

  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(signalScenarioPath, JSON.stringify(signalScenario, null, 2));
  await fsp.writeFile(codexScenarioPath, JSON.stringify(codexScenario, null, 2));
  await fsp.writeFile(codexCursorPath, "0");
  if (Array.isArray(initialSchedulerJobs)) {
    await fsp.writeFile(
      schedulerJobsPath,
      `${JSON.stringify({ jobs: initialSchedulerJobs }, null, 2)}\n`,
      "utf8"
    );
  }
  await makeExecutableShim(FAKE_SIGNAL_PATH, path.join(binDir, "signal-cli"));
  await makeExecutableShim(FAKE_CODEX_PATH, path.join(binDir, "codex"));
  const resolvedExtraEnv =
    typeof extraEnv === "function" ? extraEnv({ tempRoot, binDir, schedulerJobsPath }) : extraEnv;

  let bridgeOutput = "";
  let childExit = null;
  let childError = null;
  const child = spawn("node", [BRIDGE_PATH], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      PHONE_NUMBER: "+15550000000",
      ALLOWED_NUMBERS: "+15551112222",
      SABLE_E2E_RECEIVE_SCENARIO_PATH: signalScenarioPath,
      SABLE_E2E_APP_SERVER_LOG_PATH: appServerLogPath,
      SABLE_E2E_SIGNAL_LOG_PATH: signalLogPath,
      SABLE_E2E_TURN_SCENARIO_PATH: codexScenarioPath,
      SABLE_E2E_TURN_CURSOR_PATH: codexCursorPath,
      FAKE_SIGNAL_SCENARIO_PATH: signalScenarioPath,
      FAKE_SIGNAL_LOG_PATH: signalLogPath,
      FAKE_CODEX_SCENARIO_PATH: codexScenarioPath,
      FAKE_CODEX_CURSOR_PATH: codexCursorPath,
      SABLE_BRIDGE_STATE_PATH: statePath,
      SABLE_RESTART_REQUEST_PATH: restartRequestPath,
      SABLE_RESTART_NOTICE_PATH: restartNoticePath,
      SABLE_SCHEDULER_JOBS_PATH: schedulerJobsPath,
      SABLE_SCHEDULER_POLL_INTERVAL_MS: "100",
      APP_SERVER_IDLE_TIMEOUT_MS: "2000",
      SABLE_OBSIDIAN_LINK_PORT: "0",
      SABLE_OBSIDIAN_VAULT_NAME: "memory",
      ...resolvedExtraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  function captureBridgeOutput(chunk) {
    const text = chunk.toString();
    bridgeOutput += text;
    fs.appendFileSync(bridgeLogPath, text);
  }

  child.stdout.on("data", captureBridgeOutput);
  child.stderr.on("data", captureBridgeOutput);
  child.on("exit", (code, signal) => {
    childExit = { code, signal };
  });
  child.on("error", (error) => {
    childError = error;
  });

  async function shutdown() {
    if (childExit) {
      child.stdout.off("data", captureBridgeOutput);
      child.stderr.off("data", captureBridgeOutput);
      await fsp.rm(tempRoot, { recursive: true, force: true });
      return;
    }

    if (!child.killed) {
      child.kill("SIGTERM");
    }

    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);

    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }

    child.stdout.off("data", captureBridgeOutput);
    child.stderr.off("data", captureBridgeOutput);
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (child.exitCode !== null) {
      throw new Error("Bridge exited during startup");
    }
  } catch (error) {
    await shutdown();
    const diagnostics = [
      error.message,
      "",
      "Bridge output:",
      bridgeOutput || "(none)",
      "",
      `Child exit: ${childExit ? JSON.stringify(childExit) : "(still running)"}`,
      `Child error: ${childError ? childError.message : "(none)"}`,
    ].join("\n");
    throw new Error(diagnostics);
  }

  async function getSignalRequests() {
    const lines = await readJsonLines(signalLogPath);
    return lines.map((entry) => entry.message).filter(Boolean);
  }

  async function getCodexRequests() {
    return readJsonLines(appServerLogPath);
  }

  return {
    tempRoot,
    statePath,
    restartRequestPath,
    restartNoticePath,
    schedulerJobsPath,
    signalLogPath,
    appServerLogPath,
    bridgeLogPath,
    isRunning: () => child.exitCode === null && childError === null,
    sendSignal: (signal = "SIGTERM") => child.kill(signal),
    waitForExit: async (description = "bridge exit") =>
      waitFor(
        async () => childExit || childError || null,
        { description }
      ),
    getSignalRequests,
    getCodexRequests,
    waitForSignalRequest: async (matcher, description = "signal request") =>
      waitFor(async () => {
        const requests = await getSignalRequests();
        return requests.find((request) => matcher(request)) || null;
      }, { description }),
    waitForCodexRequest: async (matcher, description = "codex request") =>
      waitFor(async () => {
        const requests = await getCodexRequests();
        return requests.find((request) => matcher(request)) || null;
      }, { description }),
    shutdown,
  };
}

function extractSentMessages(signalRequests) {
  return signalRequests
    .filter((request) => request.method === "send")
    .map((request) => request.params?.message)
    .filter((message) => typeof message === "string");
}

module.exports = {
  assert,
  extractSentMessages,
  path,
  fsp,
  startBridgeScenario,
  waitFor,
};
