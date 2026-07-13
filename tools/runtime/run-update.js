#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { handleRunCallback, resolveRunDir } = require("./run-callback");
const { appendRunEvent, readRun, updateRun } = require("./run-kernel");

const PUBLIC_TEXT_LIMITS = Object.freeze({
  nextAction: 240,
  phase: 80,
  publicSummary: 320,
});
const UPDATE_STATUSES = new Set(["queued", "running", "blocked"]);

function parseArgs(argv, { env = process.env } = {}) {
  let explicitRunId = false;
  let explicitRunDir = false;
  let explicitRunPath = false;
  const options = {
    actor: "agent",
    callback: true,
    event: "milestone",
    jobsRoot: "",
    nextAction: "",
    phase: "",
    publicSummary: "",
    runDir: env.SABLE_RUN_DIR || "",
    runId: env.SABLE_RUN_ID || "",
    runPath: env.SABLE_RUN_PATH || "",
    status: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") {
      options.runId = readValue(argv, ++index, arg);
      explicitRunId = true;
    } else if (arg === "--run-dir") {
      options.runDir = resolvePath(readValue(argv, ++index, arg), env);
      explicitRunDir = true;
    } else if (arg === "--run-path") {
      options.runPath = resolvePath(readValue(argv, ++index, arg), env);
      explicitRunPath = true;
    } else if (arg === "--jobs-root") options.jobsRoot = resolvePath(readValue(argv, ++index, arg), env);
    else if (arg === "--public-summary" || arg === "--summary") options.publicSummary = readValue(argv, ++index, arg);
    else if (arg === "--next-action") options.nextAction = readValue(argv, ++index, arg);
    else if (arg === "--phase") options.phase = readValue(argv, ++index, arg);
    else if (arg === "--status") options.status = readValue(argv, ++index, arg).toLowerCase();
    else if (arg === "--event") options.event = readValue(argv, ++index, arg).toLowerCase();
    else if (arg === "--actor") options.actor = readValue(argv, ++index, arg);
    else if (arg === "--no-callback") options.callback = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.help) return options;
  if (explicitRunId && !explicitRunDir) options.runDir = "";
  if (explicitRunId && !explicitRunPath) options.runPath = "";
  if ((explicitRunDir || explicitRunPath) && !explicitRunId) options.runId = "";
  if (explicitRunDir && !explicitRunPath) options.runPath = "";
  if (explicitRunPath && !explicitRunDir) options.runDir = "";
  if (!options.runId && !options.runDir && !options.runPath) {
    throw new Error("Provide --run-id, --run-dir, --run-path, or SABLE_RUN_ID/SABLE_RUN_PATH.");
  }

  options.publicSummary = boundedPublicText(options.publicSummary, "public summary", PUBLIC_TEXT_LIMITS.publicSummary);
  options.nextAction = boundedPublicText(options.nextAction, "next action", PUBLIC_TEXT_LIMITS.nextAction);
  options.phase = boundedPublicText(options.phase, "phase", PUBLIC_TEXT_LIMITS.phase);
  options.event = validateLabel(options.event, "event type");
  options.actor = boundedPublicText(options.actor, "actor", 80);
  if (options.status && !UPDATE_STATUSES.has(options.status)) {
    throw new Error(`Unsupported --status: ${options.status}. Expected one of: ${[...UPDATE_STATUSES].join(", ")}.`);
  }
  if (!options.publicSummary && !options.nextAction && !options.phase && !options.status) {
    throw new Error("Provide at least one non-empty public update field.");
  }
  return options;
}

function readValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || String(value).startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }
  return String(value);
}

function resolvePath(value, env) {
  const home = env.HOME || process.env.HOME || "";
  const expanded = value === "~" ? home : value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
  return path.resolve(expanded);
}

function boundedPublicText(value, name, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length > limit) {
    throw new Error(`${name} exceeds ${limit} characters.`);
  }
  return text;
}

function validateLabel(value, name) {
  const label = boundedPublicText(value, name, 64).toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(label)) {
    throw new Error(`Invalid ${name}: ${value}.`);
  }
  return label;
}

async function publishRunUpdate(options, deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || new Date();
  const publicSummary = boundedPublicText(options.publicSummary, "public summary", PUBLIC_TEXT_LIMITS.publicSummary);
  const nextAction = boundedPublicText(options.nextAction, "next action", PUBLIC_TEXT_LIMITS.nextAction);
  const phase = boundedPublicText(options.phase, "phase", PUBLIC_TEXT_LIMITS.phase);
  const status = String(options.status || "").trim().toLowerCase();
  const eventType = validateLabel(options.event || "milestone", "event type");
  const actor = boundedPublicText(options.actor || "agent", "actor", 80);
  if (status && !UPDATE_STATUSES.has(status)) {
    throw new Error(`Unsupported --status: ${status}. Expected one of: ${[...UPDATE_STATUSES].join(", ")}.`);
  }
  const runDir = await (deps.resolveRunDir || resolveRunDir)(options, { env });
  const current = await readRun(runDir);
  if (options.runId && current.run_id !== options.runId && current.background_job_id !== options.runId) {
    throw new Error(`Run id mismatch: expected ${options.runId}, found ${current.run_id || "(missing)"}.`);
  }

  const patch = {};
  if (publicSummary) patch.public_summary = publicSummary;
  if (nextAction) patch.next_action = nextAction;
  if (phase) patch.phase = phase;
  if (status) patch.status = status;
  if (Object.keys(patch).length === 0) {
    throw new Error("Provide at least one non-empty public update field.");
  }

  const run = await updateRun(runDir, patch, { now });
  const summary = publicSummary || nextAction || phase || `Run status: ${status}.`;
  const event = await appendRunEvent(runDir, {
    type: eventType,
    actor,
    summary,
    payload: { update: patch },
  }, { now });

  let callback = null;
  if (options.callback !== false && event.type === "milestone") {
    callback = await (deps.handleRunCallback || handleRunCallback)({
      dryRun: false,
      event: "milestone",
      jobsRoot: options.jobsRoot || "",
      runDir,
      runId: run.run_id,
      runPath: "",
    }, { env, now, ...(deps.queueSignalMessage ? { queueSignalMessage: deps.queueSignalMessage } : {}) });
  }

  return { callback, event, run, runDir };
}

function usage() {
  return [
    "Usage:",
    "  node tools/runtime/run-update.js [--run-id ID | --run-dir DIR | --run-path FILE] [--public-summary TEXT] [--next-action TEXT] [--phase PHASE] [--status queued|running|blocked] [--event TYPE] [--actor ACTOR] [--no-callback]",
    "",
    "At least one update field is required. SABLE_RUN_ID and SABLE_RUN_PATH are used by default.",
    "Milestone events invoke the existing policy-gated callback unless --no-callback is set.",
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
  console.log(JSON.stringify(await publishRunUpdate(options), null, 2));
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  PUBLIC_TEXT_LIMITS,
  UPDATE_STATUSES,
  boundedPublicText,
  main,
  parseArgs,
  publishRunUpdate,
};
