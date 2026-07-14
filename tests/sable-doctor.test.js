const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildDoctorReport,
  checkCodexHomeWritable,
  checkBridgeRuntimePaths,
  checkPrivateStateBoundary,
  checkServiceInstall,
  formatDoctorReport,
  parseArgs,
  readEnvSummary,
} = require("../tools/doctor/sable-doctor");
const { createInstanceConfig } = require("../tools/instance/instance-config");
const { getInstanceEnvPath } = require("../tools/instance/init-instance");

test("doctor reports the current repo as healthy enough for migration work", () => {
  const report = buildDoctorReport({
    commandExists: (command) => command === "codex",
  });

  assert.equal(report.ok, true);
  assert.ok(report.checks.some((check) => check.name === "command:codex" && check.status === "pass"));
  assert.ok(report.checks.some((check) => check.name === "plugins:official" && check.status === "pass"));
  assert.ok(report.checks.some((check) => check.name === "plugins:local"));
    assert.ok(report.checks.some((check) => check.name === "runner:codex-cli" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.name === "runner:codex-home"));
    assert.ok(report.checks.some((check) => check.name === "bridge:runtime-paths" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.name === "instance:python-config" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.name === "config:signal-bridge-env-example" && check.status === "pass"));
});

test("doctor redacts env contents and reports only key presence", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-doctor-env-"));
  const envPath = path.join(tempDir, ".env");

  try {
    await fs.writeFile(
      envPath,
      "ALLOWED_NUMBERS=+15551112222\nCODEX_HOME=/tmp/codex-home\nSECRET=value\n",
      "utf8"
    );

    const summary = readEnvSummary(envPath);
    assert.equal(summary.ALLOWED_NUMBERS, "[present]");
    assert.equal(summary.CODEX_HOME, "[present]");
    assert.equal(summary.SECRET, "[present]");
    assert.equal(JSON.stringify(summary).includes("+15551112222"), false);
    assert.equal(JSON.stringify(summary).includes("/tmp/codex-home"), false);
    assert.equal(JSON.stringify(summary).includes("value"), false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor fails when migration-critical repo files are missing", async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), "sable-doctor-repo-"));
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "sable-doctor-home-"));

  try {
    await fs.mkdir(path.join(tempHome, "memory"), { recursive: true });
    await fs.mkdir(path.join(tempHome, "memory", "knowledge"), { recursive: true });
    await fs.mkdir(path.join(tempHome, "memory", "tasks"), { recursive: true });
    await fs.mkdir(path.join(tempHome, "skills"), { recursive: true });
    await fs.writeFile(path.join(tempHome, "AGENTS.md"), "# Agent\n", "utf8");
    await fs.writeFile(path.join(tempHome, "TODO.md"), "# Todo\n", "utf8");

    const report = buildDoctorReport({
      repoRoot: tempRepo,
      homeDir: tempHome,
      commandExists: () => true,
      env: {
        CODEX_HOME: "/tmp/codex-home",
      },
    });

    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.name === "package.json" && check.status === "fail"));
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test("doctor output is plain text and does not print secret values", () => {
  const report = buildDoctorReport({
    commandExists: () => true,
    env: {
      CODEX_HOME: "/home/arya/.codex-bridge",
    },
  });

  const text = formatDoctorReport(report);
  assert.match(text, /Sable doctor: PASS/);
  assert.doesNotMatch(text, /TELEGRAM_API_HASH=/);
  assert.doesNotMatch(text, /ALLOWED_NUMBERS=/);
  assert.doesNotMatch(text, /\/home\/arya\/\.codex-bridge/);
  assert.match(text, /~\/\.codex-bridge/);
});

test("doctor reports bridge runtime paths through active instance config", () => {
  const instance = createInstanceConfig({
    repoRoot: "/srv/sable-core",
    env: {
      SABLE_INSTANCE_HOME: "/srv/alex",
      SABLE_MEMORY_ROOT: "/data/alex/memory",
      SABLE_TASKS_ROOT: "/data/alex/tasks",
    },
  });

  const check = checkBridgeRuntimePaths(
    {
      SABLE_CODEX_CWD: "/srv/alex/workspace",
      SABLE_TELEGRAM_CLI_PATH: "/srv/alex/custom/telegram.py",
      VOICE_NOTES_MODEL_PATH: "/srv/alex/models/whisper",
    },
    instance
  );

  assert.equal(check.status, "pass");
  assert.equal(check.name, "bridge:runtime-paths");
  assert.match(check.detail, /codexCwd=~\/workspace/);
  assert.match(check.detail, /telegramCliPath=~\/custom\/telegram.py/);
  assert.match(check.detail, /voiceModelPath=~\/models\/whisper/);
  assert.match(check.detail, /schedulerJobsPath=~\/domains\/orchestrator\/schedules\/scheduler-jobs.json/);
  assert.match(check.detail, /researchRoot=~\/domains\/research\/projects/);
  assert.doesNotMatch(check.detail, /\/srv\/alex\/workspace/);
});

test("doctor reports initialized instance, service, and codex-home details", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "sable-doctor-home-"));
  const tempConfig = await fs.mkdtemp(path.join(os.tmpdir(), "sable-doctor-systemd-"));

  try {
    const instance = createInstanceConfig({
      homeDir: tempHome,
      repoRoot: "/opt/sable",
    });
    await fs.mkdir(instance.knowledgeRoot, { recursive: true });
    await fs.mkdir(instance.tasksRoot, { recursive: true });
    await fs.mkdir(instance.skillsRoot, { recursive: true });
    await fs.mkdir(path.join(instance.homeDir, ".codex-bridge"), { recursive: true });
    await fs.mkdir(path.join(instance.homeDir, "plugins"), { recursive: true });
    await fs.mkdir(path.dirname(getInstanceEnvPath(instance)), { recursive: true });
    await fs.writeFile(getInstanceEnvPath(instance), "SABLE_INSTANCE_HOME=/tmp/example\n", "utf8");

    const codexCheck = checkCodexHomeWritable({}, instance);
    assert.equal(codexCheck.status, "pass");

    const boundaryCheck = checkPrivateStateBoundary(instance);
    assert.equal(boundaryCheck.status, "pass");

    const serviceChecks = checkServiceInstall({ XDG_CONFIG_HOME: tempConfig }, instance);
    assert.equal(serviceChecks[0].status, "warn");
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(tempConfig, { recursive: true, force: true });
  }
});

test("doctor fails private boundary when instance state is inside repo", () => {
  const instance = createInstanceConfig({
    homeDir: "/tmp/repo/private-instance",
    repoRoot: "/tmp/repo",
  });
  const check = checkPrivateStateBoundary(instance);

  assert.equal(check.status, "fail");
  assert.match(check.detail, /private paths are inside the repo/);
});

test("doctor argument parser supports json and path overrides", () => {
  const options = parseArgs(["--json", "--repo-root", "/tmp/repo", "--home-dir", "/tmp/home"]);

  assert.equal(options.json, true);
  assert.equal(options.repoRoot, "/tmp/repo");
  assert.equal(options.homeDir, "/tmp/home");
});

test("doctor argument parser leaves instance home discoverable by env by default", () => {
  const options = parseArgs([]);

  assert.equal(options.homeDir, "");
});
