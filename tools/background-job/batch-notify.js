#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const { defaultJobsRoot } = require("./background-job");
const { queueSignalMessage } = require("../runtime/signal-message-queue");

const TERMINAL_STATUSES = new Set([
  "canceled",
  "cancelled",
  "completed",
  "failed",
  "stopped",
]);

function parseArgs(argv) {
  const parsed = {
    command: argv[0] || "status",
    batchFile: "",
    bridgeDir: "",
    dryRun: false,
    jobs: [],
    jobsRoot: "",
    message: "",
    name: "",
    queueDir: "",
    recipient: "",
  };

  if (parsed.command === "--help" || parsed.command === "-h") {
    parsed.command = "help";
  }

  for (let index = parsed.command === "help" ? 0 : 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch-file") {
      parsed.batchFile = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--bridge-dir") {
      parsed.bridgeDir = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--job" || arg === "--id") {
      parsed.jobs.push(argv[++index] || "");
    } else if (arg === "--jobs-root") {
      parsed.jobsRoot = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--message") {
      parsed.message = argv[++index] || "";
    } else if (arg === "--name") {
      parsed.name = argv[++index] || "";
    } else if (arg === "--queue-dir") {
      parsed.queueDir = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--recipient") {
      parsed.recipient = argv[++index] || "";
    } else if (arg === "--help" || arg === "-h") {
      parsed.command = "help";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.jobs = parsed.jobs.map(normalizeText).filter(Boolean);
  return parsed;
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") {
    return process.env.HOME || text;
  }
  if (text.startsWith("~/")) {
    return path.join(process.env.HOME || "", text.slice(2));
  }
  return text;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBatch(raw = {}, overrides = {}) {
  const jobs = Array.isArray(raw.jobs)
    ? raw.jobs.map((job) => (typeof job === "string" ? { id: job } : job))
    : [];
  return {
    createdAt: raw.createdAt || new Date().toISOString(),
    jobs: jobs
      .map((job) => ({
        id: normalizeText(job?.id),
        name: normalizeText(job?.name),
      }))
      .filter((job) => job.id),
    jobsRoot: normalizeText(overrides.jobsRoot) || normalizeText(raw.jobsRoot) || defaultJobsRoot(),
    message: normalizeText(overrides.message) || normalizeText(raw.message),
    name: normalizeText(overrides.name) || normalizeText(raw.name) || "background batch",
    notificationRequestId: normalizeText(raw.notificationRequestId),
    notifiedAt: normalizeText(raw.notifiedAt),
    recipient: normalizeText(overrides.recipient) || normalizeText(raw.recipient),
  };
}

async function initBatch(options, { now = new Date() } = {}) {
  requireBatchFile(options);
  if (options.jobs.length === 0) {
    throw new Error("init requires at least one --job.");
  }

  const batch = normalizeBatch(
    {
      createdAt: now.toISOString(),
      jobs: options.jobs.map((id) => ({ id })),
      jobsRoot: options.jobsRoot || defaultJobsRoot(),
      message: options.message,
      name: options.name || "background batch",
      recipient: options.recipient,
    },
    options
  );
  await fsp.mkdir(path.dirname(options.batchFile), { recursive: true });
  await writeJson(options.batchFile, batch);
  return batch;
}

async function loadBatch(batchFile, overrides = {}) {
  requireBatchFile({ batchFile });
  const raw = JSON.parse(await fsp.readFile(batchFile, "utf8"));
  return normalizeBatch(raw, overrides);
}

async function readJobStatus(jobsRoot, job) {
  const statusPath = path.join(jobsRoot, job.id, "status.json");
  try {
    const status = JSON.parse(await fsp.readFile(statusPath, "utf8"));
    return {
      id: job.id,
      name: normalizeText(status.name) || job.name,
      status: normalizeText(status.status) || "unknown",
      statusPath,
    };
  } catch (error) {
    return {
      error: normalizeText(error?.message),
      id: job.id,
      name: job.name,
      status: error?.code === "ENOENT" ? "missing" : "unreadable",
      statusPath,
    };
  }
}

async function aggregateBatch(batch) {
  const jobs = [];
  for (const job of batch.jobs) {
    jobs.push(await readJobStatus(batch.jobsRoot, job));
  }

  const counts = {
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    pending: jobs.filter((job) => !TERMINAL_STATUSES.has(job.status)).length,
    terminal: jobs.filter((job) => TERMINAL_STATUSES.has(job.status)).length,
    total: jobs.length,
  };

  return {
    allTerminal: counts.total > 0 && counts.terminal === counts.total,
    batch,
    counts,
    jobs,
  };
}

function formatBatchNotification(aggregate) {
  const { batch, counts, jobs } = aggregate;
  const failedLabel = counts.failed === 1 ? "1 failed" : `${counts.failed} failed`;
  const completedLabel = counts.completed === 1 ? "1 completed" : `${counts.completed} completed`;
  const lines = [
    `Background batch finished: ${batch.name}`,
    `${completedLabel}, ${failedLabel}, ${counts.total} total.`,
  ];
  if (batch.message) {
    lines.push("", batch.message);
  }
  lines.push(
    "",
    "Jobs:",
    ...jobs.map((job) => `- ${job.id} [${job.status}]${job.name ? ` ${job.name}` : ""}`),
    "",
    "Reports:",
    ...jobs.map((job) => `npm run background-job -- report --id ${job.id}`)
  );
  return `${lines.join("\n")}\n`;
}

async function handleCallback(options, deps = {}) {
  const aggregate = await aggregateBatch(await loadBatch(options.batchFile, options));
  if (!aggregate.allTerminal) {
    return {
      aggregate,
      notificationQueued: false,
      reason: "waiting",
    };
  }
  if (aggregate.batch.notifiedAt) {
    return {
      aggregate,
      notificationQueued: false,
      reason: "already-notified",
    };
  }
  if (options.dryRun) {
    return {
      aggregate,
      message: formatBatchNotification(aggregate),
      notificationQueued: false,
      reason: "dry-run",
    };
  }

  return withNotificationLock(options.batchFile, async () => {
    const lockedAggregate = await aggregateBatch(await loadBatch(options.batchFile, options));
    if (!lockedAggregate.allTerminal) {
      return {
        aggregate: lockedAggregate,
        notificationQueued: false,
        reason: "waiting",
      };
    }
    if (lockedAggregate.batch.notifiedAt) {
      return {
        aggregate: lockedAggregate,
        notificationQueued: false,
        reason: "already-notified",
      };
    }

    const message = formatBatchNotification(lockedAggregate);
    const notification = await queueSignalMessage({
      bridgeDir: options.bridgeDir,
      env: deps.env || process.env,
      idPrefix: "batch",
      message,
      queueDir: options.queueDir,
      recipient: lockedAggregate.batch.recipient || options.recipient,
    });
    const updatedBatch = {
      ...lockedAggregate.batch,
      notificationRequestId: notification.id,
      notifiedAt: new Date().toISOString(),
    };
    await writeJson(options.batchFile, updatedBatch);
    return {
      aggregate: { ...lockedAggregate, batch: updatedBatch },
      message,
      notification,
      notificationQueued: true,
      reason: "queued",
    };
  });
}

async function withNotificationLock(batchFile, callback) {
  const lockPath = `${batchFile}.notify.lock`;
  let handle;
  try {
    handle = await fsp.open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      return {
        notificationQueued: false,
        reason: "locked",
      };
    }
    throw error;
  }

  try {
    return await callback();
  } finally {
    await handle.close();
    await fsp.rm(lockPath, { force: true });
  }
}

async function writeJson(filePath, payload) {
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function requireBatchFile(options) {
  if (!options.batchFile) {
    throw new Error("Missing --batch-file.");
  }
}

function usage() {
  return [
    "Usage:",
    "  node tools/background-job/batch-notify.js init --batch-file FILE --name NAME --jobs-root DIR --job JOB_ID [--job JOB_ID...]",
    "  node tools/background-job/batch-notify.js status --batch-file FILE",
    "  node tools/background-job/batch-notify.js callback --batch-file FILE [--recipient +1555] [--queue-dir DIR]",
    "",
    "Use the callback command on every sibling job:",
    "  --callback-command 'node tools/background-job/batch-notify.js callback --batch-file /abs/path/batch.json'",
    "",
    "The callback queues one text-only Signal notification through the existing attachment queue after every listed job is terminal.",
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

  if (options.command === "help" || options.command === "--help") {
    console.log(usage());
    return 0;
  }
  if (options.command === "init") {
    console.log(JSON.stringify(await initBatch(options), null, 2));
    return 0;
  }
  if (options.command === "status") {
    console.log(JSON.stringify(await aggregateBatch(await loadBatch(options.batchFile, options)), null, 2));
    return 0;
  }
  if (options.command === "callback") {
    console.log(JSON.stringify(await handleCallback(options), null, 2));
    return 0;
  }

  console.error(`Unknown command: ${options.command}`);
  console.error(usage());
  return 2;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  TERMINAL_STATUSES,
  aggregateBatch,
  formatBatchNotification,
  handleCallback,
  initBatch,
  loadBatch,
  parseArgs,
  queueSignalMessage,
};
