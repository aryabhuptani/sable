#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { createInstanceConfig } = require("../instance/instance-config");
const { transitionRun } = require("./run-kernel");

const DEFAULT_OLDER_THAN_MINUTES = 30;
const ACTIVE_STATUSES = new Set(["running", "cancelling", "pausing", "stopping"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "stopped"]);

function defaultJobsRoot({ env = process.env, instanceConfig } = {}) {
  const instance = instanceConfig || createInstanceConfig({ env });
  return path.join(instance.runsRoot || path.dirname(instance.projectTasksPath), "background-jobs");
}

function parseArgs(argv) {
  const options = {
    fix: false,
    format: "text",
    jobsRoot: "",
    olderThanMinutes: DEFAULT_OLDER_THAN_MINUTES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fix") {
      options.fix = true;
    } else if (arg === "--json") {
      options.format = "json";
    } else if (arg === "--text") {
      options.format = "text";
    } else if (arg === "--jobs-root") {
      options.jobsRoot = path.resolve(argv[++index] || "");
    } else if (arg === "--older-than-minutes") {
      options.olderThanMinutes = parsePositiveNumber(argv[++index], "--older-than-minutes");
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

async function scanRuns({
  fix = false,
  isPidAlive = defaultIsPidAlive,
  jobsRoot = defaultJobsRoot(),
  now = new Date(),
  olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
} = {}) {
  const checkedAt = new Date(now);
  const thresholdMs = parsePositiveNumber(olderThanMinutes, "olderThanMinutes") * 60 * 1000;
  const findings = [];
  const errors = [];
  const entries = await safeReadDir(jobsRoot);
  let scanned = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jobDir = path.join(jobsRoot, entry.name);
    let run;
    let status;
    try {
      [run, status] = await Promise.all([
        readJsonIfPresent(path.join(jobDir, "run.json")),
        readJsonIfPresent(path.join(jobDir, "status.json")),
      ]);
    } catch (error) {
      errors.push({ id: entry.name, error: error.message });
      continue;
    }
    if (!run && !status) continue;
    scanned += 1;

    const runStatus = normalizeStatus(run?.status);
    const jobStatus = normalizeStatus(status?.status);
    if (TERMINAL_STATUSES.has(runStatus) || TERMINAL_STATUSES.has(jobStatus)) continue;
    const activeStatus = ACTIVE_STATUSES.has(runStatus)
      ? runStatus
      : ((!runStatus || runStatus === "queued") && ACTIVE_STATUSES.has(jobStatus) ? jobStatus : "");
    if (!activeStatus) continue;

    const pids = collectPids(run, status);
    const pid = pids[0] || null;
    const reasons = [];
    if (pids.length === 0) {
      reasons.push("missing_pid");
    } else if (!pids.some(isPidAlive)) {
      reasons.push("dead_pid");
    }

    const updatedAt = run?.updated_at || status?.updatedAt || null;
    const updatedTime = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    const ageMinutes = Number.isFinite(updatedTime)
      ? Math.max(0, (checkedAt.getTime() - updatedTime) / 60000)
      : null;
    if (ageMinutes !== null && checkedAt.getTime() - updatedTime > thresholdMs) {
      reasons.push("stale_updated_at");
    }
    if (reasons.length === 0) continue;

    const id = run?.run_id || status?.id || entry.name;
    const finding = {
      id,
      status: activeStatus,
      reasons,
      pid,
      updated_at: updatedAt,
      age_minutes: ageMinutes === null ? null : Math.round(ageMinutes * 10) / 10,
      fixed: false,
    };
    if (fix) {
      finding.fixed = await fixRun(jobDir, { finding, run, status, now: checkedAt, olderThanMinutes, isPidAlive });
    }
    findings.push(finding);
  }

  return {
    checked_at: checkedAt.toISOString(),
    jobs_root: jobsRoot,
    older_than_minutes: olderThanMinutes,
    fix,
    scanned,
    affected: findings.length,
    findings,
    errors,
  };
}

async function fixRun(jobDir, { finding, run, status, now, olderThanMinutes, isPidAlive = defaultIsPidAlive }) {
  const reconcilingCancellation = finding.status === "stopping" || finding.status === "cancelling";
  if (reconcilingCancellation) {
    [run, status] = await Promise.all([
      readJsonIfPresent(path.join(jobDir, "run.json")),
      readJsonIfPresent(path.join(jobDir, "status.json")),
    ]);
    const currentRunStatus = normalizeStatus(run?.status);
    const currentJobStatus = normalizeStatus(status?.status);
    if (![currentRunStatus, currentJobStatus].some(value => value === "stopping" || value === "cancelling")) return false;
    if (collectPids(run, status).some(isPidAlive)) return false;
  }
  const expectedRunStatus = normalizeStatus(run?.status);
  const expectedUpdatedAt = run?.updated_at;
  const cancelled = reconcilingCancellation && finding.reasons.some(reason => reason === "dead_pid" || reason === "missing_pid");
  const reasonText = describeReasons(finding.reasons);
  const summary = cancelled
    ? `Watchdog reconciled cancellation for ${finding.id}: ${reasonText}.`
    : `Watchdog blocked ${finding.id}: ${reasonText}.`;
  const nextAction = cancelled ? "Archive this cancelled run when it is no longer needed." : "Inspect the background-job logs, then restart or explicitly resolve the run.";

  if (run) {
    const transition = await transitionRun(
      jobDir,
      {
        status: cancelled ? "cancelled" : "blocked",
        phase: cancelled ? "cancelled" : "blocked",
        ...(cancelled ? { completed_at: now.toISOString(), cancellation_acknowledged_at: now.toISOString() } : {}),
        public_summary: summary,
        next_action: nextAction,
      },
      {
        type: cancelled ? "cancellation_reconciled" : "watchdog_blocked",
        actor: "runtime-watchdog",
        summary,
        payload: {
          previous_status: finding.status,
          reasons: finding.reasons,
          pid: finding.pid,
          observed_updated_at: finding.updated_at,
          older_than_minutes: olderThanMinutes,
          next_action: nextAction,
        },
      },
      { now, expectedStatus: expectedRunStatus, expectedUpdatedAt }
    );
    if (!transition.transitioned) return false;
  }

  if (status) {
    await writeJsonAtomic(path.join(jobDir, "status.json"), {
      ...status,
      status: cancelled ? "cancelled" : "blocked",
      updatedAt: now.toISOString(),
      ...(cancelled ? { completedAt: now.toISOString(), cancellationAcknowledgedAt: now.toISOString(), cancellationSource: "legacy_stop_reconciliation" } : {}),
      nextAction,
      watchdog: {
        detectedAt: now.toISOString(),
        previousStatus: finding.status,
        reasons: finding.reasons,
      },
    });
  }
  return true;
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function normalizePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function collectPids(run, status) {
  return [...new Set([
    run?.worker_pid, run?.workerPid, run?.pid, run?.runnerPid,
    status?.workerPid, status?.pid, status?.runnerPid, status?.codexPid, status?.claudePid,
  ].map(normalizePid).filter(Boolean))];
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function describeReasons(reasons) {
  return reasons
    .map((reason) => ({
      dead_pid: "worker PID is not alive",
      missing_pid: "worker PID is missing",
      stale_updated_at: "run heartbeat is stale",
    })[reason] || reason)
    .join("; ");
}

function formatSummary(summary) {
  const mode = summary.fix ? "fixed" : "reported";
  const lines = [`Watchdog ${mode} ${summary.affected} of ${summary.scanned} run(s).`];
  for (const finding of summary.findings) {
    const age = finding.age_minutes === null ? "unknown age" : `${finding.age_minutes}m old`;
    lines.push(`${finding.id} [${finding.status}] ${finding.reasons.join(",")} (${age})`);
  }
  for (const error of summary.errors) {
    lines.push(`${error.id} [unreadable] ${error.error}`);
  }
  return lines.join("\n");
}

function usage() {
  return [
    "Usage:",
    "  node tools/runtime/run-watchdog.js [--jobs-root DIR] [--older-than-minutes N] [--fix] [--json|--text]",
    "",
    "Reports active runs with a missing/dead worker PID or stale updated_at. Mutates only with --fix.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const summary = await scanRuns({
    ...options,
    jobsRoot: options.jobsRoot || defaultJobsRoot(),
  });
  console.log(options.format === "json" ? JSON.stringify(summary, null, 2) : formatSummary(summary));
  return summary.errors.length > 0 ? 1 : 0;
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function safeReadDir(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIVE_STATUSES,
  DEFAULT_OLDER_THAN_MINUTES,
  defaultIsPidAlive,
  formatSummary,
  parseArgs,
  scanRuns,
};
