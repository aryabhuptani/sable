"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRun } = require("../tools/runtime/run-kernel");
const { formatSummary, parseArgs, scanRuns } = require("../tools/runtime/run-watchdog");

const NOW = new Date("2026-07-13T12:00:00.000Z");

async function createFakeJob(jobsRoot, id, {
  pid = 1234,
  runStatus = "running",
  statusStatus = runStatus,
  updatedAt = "2026-07-13T11:55:00.000Z",
} = {}) {
  const jobDir = path.join(jobsRoot, id);
  await createRun(
    jobDir,
    {
      run_id: id,
      agent_profile: "coding",
      background_job_id: id,
      goal: `Fake ${id}`,
      status: runStatus,
      phase: runStatus,
      updated_at: updatedAt,
    },
    { now: new Date(updatedAt) }
  );
  const status = {
    id,
    jobDir,
    status: statusStatus,
    updatedAt,
  };
  if (pid !== null) status.workerPid = pid;
  await fs.writeFile(path.join(jobDir, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
  return jobDir;
}

test("watchdog reports only active runs with dead, missing, or stale workers", async () => {
  const jobsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-watchdog-"));
  try {
    await createFakeJob(jobsRoot, "healthy", { pid: 100, updatedAt: "2026-07-13T11:55:00.000Z" });
    await createFakeJob(jobsRoot, "dead", { pid: 200, updatedAt: "2026-07-13T11:55:00.000Z" });
    await createFakeJob(jobsRoot, "missing", { pid: null, runStatus: "pausing" });
    await createFakeJob(jobsRoot, "stale", { pid: 300, updatedAt: "2026-07-13T10:00:00.000Z" });
    await createFakeJob(jobsRoot, "stopping", { pid: 250, runStatus: "queued", statusStatus: "stopping" });
    await createFakeJob(jobsRoot, "done", { pid: 400, runStatus: "completed", updatedAt: "2026-07-13T10:00:00.000Z" });
    await createFakeJob(jobsRoot, "blocked", {
      pid: 500,
      runStatus: "blocked",
      statusStatus: "running",
      updatedAt: "2026-07-13T10:00:00.000Z",
    });

    const summary = await scanRuns({
      jobsRoot,
      now: NOW,
      olderThanMinutes: 30,
      isPidAlive: (pid) => ![200, 250].includes(pid),
    });

    assert.equal(summary.scanned, 7);
    assert.equal(summary.affected, 4);
    assert.deepEqual(
      Object.fromEntries(summary.findings.map((finding) => [finding.id, finding.reasons])),
      {
        dead: ["dead_pid"],
        missing: ["missing_pid"],
        stale: ["stale_updated_at"],
        stopping: ["dead_pid"],
      }
    );
    assert.ok(summary.findings.every((finding) => finding.fixed === false));
    assert.match(formatSummary(summary), /Watchdog reported 4 of 7 run\(s\)/);

    const untouched = JSON.parse(await fs.readFile(path.join(jobsRoot, "dead", "run.json"), "utf8"));
    assert.equal(untouched.status, "running");
  } finally {
    await fs.rm(jobsRoot, { recursive: true, force: true });
  }
});

test("watchdog does not reconcile stopping while any recorded worker pid is alive", async () => {
  const jobsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-watchdog-"));
  try {
    const jobDir = await createFakeJob(jobsRoot, "ambiguous", { pid: 200, runStatus: "queued", statusStatus: "stopping" });
    const statusPath = path.join(jobDir, "status.json"), runPath = path.join(jobDir, "run.json");
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    const run = JSON.parse(await fs.readFile(runPath, "utf8"));
    await fs.writeFile(statusPath, `${JSON.stringify({ ...status, codexPid: 300 }, null, 2)}\n`);
    await fs.writeFile(runPath, `${JSON.stringify({ ...run, worker_pid: 400 }, null, 2)}\n`);
    const summary = await scanRuns({ jobsRoot, now: NOW, olderThanMinutes: 30, isPidAlive: (pid) => pid === 400 });
    assert.equal(summary.affected, 0);
  } finally {
    await fs.rm(jobsRoot, { recursive: true, force: true });
  }
});

test("watchdog --fix rechecks liveness before reconciling cancellation", async () => {
  const jobsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-watchdog-"));
  try {
    const jobDir = await createFakeJob(jobsRoot, "revived", { pid: 777, runStatus: "queued", statusStatus: "stopping" });
    let checks = 0;
    const summary = await scanRuns({ fix: true, jobsRoot, now: NOW, olderThanMinutes: 30, isPidAlive: () => ++checks > 1 });
    assert.equal(summary.affected, 1);
    assert.equal(summary.findings[0].fixed, false);
    assert.equal(JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8")).status, "stopping");
  } finally {
    await fs.rm(jobsRoot, { recursive: true, force: true });
  }
});

test("watchdog --fix blocks both run files and appends an actionable event", async () => {
  const jobsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-watchdog-"));
  try {
    const jobDir = await createFakeJob(jobsRoot, "hung", {
      pid: 999,
      runStatus: "cancelling",
      updatedAt: "2026-07-13T10:00:00.000Z",
    });
    const summary = await scanRuns({
      fix: true,
      jobsRoot,
      now: NOW,
      olderThanMinutes: 30,
      isPidAlive: () => false,
    });

    assert.equal(summary.affected, 1);
    assert.equal(summary.findings[0].fixed, true);
    assert.deepEqual(summary.findings[0].reasons, ["dead_pid", "stale_updated_at"]);

    const run = JSON.parse(await fs.readFile(path.join(jobDir, "run.json"), "utf8"));
    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    const events = (await fs.readFile(path.join(jobDir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(run.status, "blocked");
    assert.equal(run.phase, "blocked");
    assert.match(run.next_action, /Inspect the background-job logs/);
    assert.equal(status.status, "blocked");
    assert.deepEqual(status.watchdog.reasons, ["dead_pid", "stale_updated_at"]);
    assert.equal(events.at(-1).type, "watchdog_blocked");
    assert.equal(events.at(-1).actor, "runtime-watchdog");
  } finally {
    await fs.rm(jobsRoot, { recursive: true, force: true });
  }
});

test("watchdog --fix reconciles stopping jobs after their worker exits", async () => {
  const jobsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-watchdog-"));
  try {
    const jobDir = await createFakeJob(jobsRoot, "stopping", {
      pid: 999,
      runStatus: "queued",
      statusStatus: "stopping",
      updatedAt: "2026-07-13T10:00:00.000Z",
    });
    const summary = await scanRuns({ fix: true, jobsRoot, now: NOW, olderThanMinutes: 30, isPidAlive: () => false });
    assert.equal(summary.affected, 1);
    const run = JSON.parse(await fs.readFile(path.join(jobDir, "run.json"), "utf8"));
    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    const events = (await fs.readFile(path.join(jobDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(run.status, "cancelled");
    assert.equal(run.phase, "cancelled");
    assert.equal(status.status, "cancelled");
    assert.ok(Date.parse(status.completedAt));
    assert.ok(Date.parse(status.cancellationAcknowledgedAt));
    assert.equal(events.at(-1).type, "cancellation_reconciled");
  } finally {
    await fs.rm(jobsRoot, { recursive: true, force: true });
  }
});

test("watchdog arguments and background-job command support concise JSON output", async () => {
  assert.deepEqual(parseArgs(["--fix", "--older-than-minutes", "12.5", "--json"]), {
    fix: true,
    format: "json",
    jobsRoot: "",
    olderThanMinutes: 12.5,
  });
  assert.throws(() => parseArgs(["--older-than-minutes", "0"]), /positive number/);

  const jobsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-watchdog-"));
  try {
    await createFakeJob(jobsRoot, "missing", { pid: null });
    const cli = path.join(__dirname, "..", "tools", "background-job", "background-job.js");
    const output = execFileSync(process.execPath, [
      cli,
      "watchdog",
      "--jobs-root",
      jobsRoot,
      "--older-than-minutes",
      "100000",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.equal(summary.fix, false);
    assert.equal(summary.affected, 1);
    assert.deepEqual(summary.findings[0].reasons, ["missing_pid"]);
  } finally {
    await fs.rm(jobsRoot, { recursive: true, force: true });
  }
});
