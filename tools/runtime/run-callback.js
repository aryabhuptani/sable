#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { createInstanceConfig } = require("../instance/instance-config");
const { appendRunEvent, readRun, updateRun } = require("./run-kernel");
const { queueSignalMessage } = require("./signal-message-queue");

const CALLBACK_EVENTS = new Set(["completed", "failed", "cancelled", "blocked", "needs_decision", "milestone"]);
const IMPORTANT_EVENTS = new Set(["failed", "cancelled", "blocked", "needs_decision"]);
const FINAL_EVENTS = new Set(["completed", ...IMPORTANT_EVENTS]);

function parseArgs(argv, { env = process.env } = {}) {
  const options = {
    dryRun: false,
    event: "",
    jobsRoot: "",
    runDir: "",
    runId: env.SABLE_RUN_ID || "",
    runPath: env.SABLE_RUN_PATH || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") {
      options.runId = argv[++index] || "";
    } else if (arg === "--run-dir") {
      options.runDir = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--run-path") {
      options.runPath = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--event") {
      options.event = String(argv[++index] || "").trim().toLowerCase();
    } else if (arg === "--jobs-root") {
      options.jobsRoot = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && !CALLBACK_EVENTS.has(options.event)) {
    throw new Error(`Unsupported --event: ${options.event || "(missing)"}. Expected one of: ${[...CALLBACK_EVENTS].join(", ")}.`);
  }
  if (!options.help && !options.runId && !options.runDir && !options.runPath) {
    throw new Error("Provide --run-id, --run-dir, --run-path, or SABLE_RUN_ID/SABLE_RUN_PATH.");
  }
  return options;
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return process.env.HOME || text;
  if (text.startsWith("~/")) return path.join(process.env.HOME || "", text.slice(2));
  return text;
}

function defaultJobsRoot({ env = process.env } = {}) {
  const instance = createInstanceConfig({ env });
  return path.join(path.dirname(instance.projectTasksPath), "background-jobs");
}

async function resolveRunDir(options, { env = process.env } = {}) {
  if (options.runDir) return path.resolve(options.runDir);
  if (options.runPath) return path.dirname(path.resolve(options.runPath));

  const jobsRoot = options.jobsRoot || defaultJobsRoot({ env });
  const exact = path.join(jobsRoot, options.runId);
  const exactRun = await tryReadRun(exact);
  if (exactRun && matchesRunId(exactRun, options.runId)) return exact;

  for (const entry of await safeReadDir(jobsRoot)) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(jobsRoot, entry.name);
    const run = await tryReadRun(candidate);
    if (run && matchesRunId(run, options.runId)) return candidate;
  }
  throw new Error(`Run not found: ${options.runId}`);
}

function matchesRunId(run, runId) {
  return run.run_id === runId || run.background_job_id === runId;
}

async function tryReadRun(runDir) {
  try {
    return await readRun(runDir);
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

function shouldQueueSignal(run, event) {
  if (String(run.delivery || "orchestrator_only").toLowerCase() !== "signal") return false;
  const visibility = String(run.visibility || "final_only").toLowerCase();
  if (visibility === "silent") return IMPORTANT_EVENTS.has(event);
  if (visibility === "milestones" || visibility === "interactive") {
    return event === "milestone" || FINAL_EVENTS.has(event);
  }
  return FINAL_EVENTS.has(event);
}

function publicText(value, limit = 320) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function formatRunNotification(run, event) {
  const label = event === "needs_decision" ? "needs decision" : event;
  const goal = publicText(run.goal, 160);
  const summary = publicText(run.public_summary || run.final_summary);
  const nextAction = publicText(run.next_action, 240);
  const lines = [`Sable run ${label}${goal ? `: ${goal}` : ""}`, `Run: ${publicText(run.run_id, 160)}`];
  if (summary) lines.push(`Summary: ${summary}`);
  if (nextAction) lines.push(`Next: ${nextAction}`);
  return `${lines.join("\n")}\n`;
}

async function handleRunCallback(options, deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || new Date();
  const runDir = await resolveRunDir(options, { env });
  const run = await readRun(runDir);
  if (options.runId && !matchesRunId(run, options.runId)) {
    throw new Error(`Run id mismatch: expected ${options.runId}, found ${run.run_id || "(missing)"}.`);
  }

  const message = formatRunNotification(run, options.event);
  const eligible = shouldQueueSignal(run, options.event);
  if (options.dryRun) {
    return { dryRun: true, event: options.event, message, notificationQueued: false, reason: eligible ? "dry-run" : "policy", runDir };
  }

  let notification = null;
  if (eligible) {
    notification = await (deps.queueSignalMessage || queueSignalMessage)({
      env,
      idPrefix: "run-callback",
      message,
    });
  }
  const timestamp = now.toISOString();
  await updateRun(runDir, {
    last_callback_at: timestamp,
    last_callback_event: options.event,
    ...(notification ? { last_callback_notification_id: notification.id } : {}),
  }, { now });
  await appendRunEvent(runDir, {
    type: "callback",
    actor: "runtime",
    summary: `Callback handled ${options.event}${notification ? " and queued Signal notification" : " without Signal notification"}.`,
    payload: {
      callback_event: options.event,
      notification_queued: Boolean(notification),
      reason: notification ? "queued" : "policy",
      ...(notification ? { notification_request_id: notification.id } : {}),
    },
  }, { now });

  return {
    event: options.event,
    message,
    notification,
    notificationQueued: Boolean(notification),
    reason: notification ? "queued" : "policy",
    runDir,
  };
}

function usage() {
  return [
    "Usage:",
    "  node tools/runtime/run-callback.js --event completed|failed|cancelled|blocked|needs_decision|milestone [--run-id ID] [--run-dir DIR | --run-path FILE] [--jobs-root DIR] [--dry-run]",
    "",
    "SABLE_RUN_ID and SABLE_RUN_PATH are used when the corresponding options are omitted.",
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
  console.log(JSON.stringify(await handleRunCallback(options), null, 2));
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = {
  CALLBACK_EVENTS,
  formatRunNotification,
  handleRunCallback,
  parseArgs,
  resolveRunDir,
  shouldQueueSignal,
};
