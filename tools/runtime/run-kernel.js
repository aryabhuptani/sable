"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const RISK_TIERS = Object.freeze({
  0: "Observe only; no writes or external actions.",
  1: "Read and analyze local or explicitly provided data.",
  2: "Make reversible changes inside assigned workspace.",
  3: "Perform bounded, reversible external actions.",
  4: "Perform sensitive/high-impact actions with explicit authorization.",
  5: "Exceptional actions under direct human supervision.",
});
const MIN_RISK_TIER = 0;
const MAX_RISK_TIER = 5;

function runPaths(runDir) {
  return {
    controlPath: path.join(runDir, "control.json"),
    eventsPath: path.join(runDir, "events.jsonl"),
    runPath: path.join(runDir, "run.json"),
  };
}

async function createRun(runDir, run, { now = new Date() } = {}) {
  const paths = runPaths(runDir);
  const timestamp = now.toISOString();
  const current = {
    parent_run_id: null,
    phase: "queued",
    public_summary: "",
    next_action: "",
    artifacts: [],
    last_callback_at: null,
    final_summary: null,
    controls: [],
    ...run,
    created_at: run.created_at || timestamp,
    updated_at: run.updated_at || timestamp,
  };
  await fs.mkdir(runDir, { recursive: true });
  await writeJsonAtomic(paths.runPath, current);
  await fs.writeFile(paths.eventsPath, "", { encoding: "utf8", flag: "a" });
  return current;
}

async function readRun(runDir) {
  return JSON.parse(await fs.readFile(runPaths(runDir).runPath, "utf8"));
}

async function updateRun(runDir, patch, { now = new Date() } = {}) {
  const current = await readRun(runDir);
  const updated = {
    ...current,
    ...patch,
    updated_at: now.toISOString(),
  };
  await writeJsonAtomic(runPaths(runDir).runPath, updated);
  return updated;
}

async function appendRunEvent(runDir, event, { now = new Date() } = {}) {
  const current = await readRun(runDir);
  const createdAt = now.toISOString();
  const entry = {
    event_id: event.event_id || `evt-${crypto.randomUUID()}`,
    run_id: current.run_id,
    type: event.type,
    created_at: event.created_at || createdAt,
    actor: event.actor || current.agent_profile,
    summary: event.summary || "",
    payload: event.payload || {},
  };
  await fs.appendFile(runPaths(runDir).eventsPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

async function transitionRun(runDir, patch, event, { now = new Date() } = {}) {
  const updated = await updateRun(runDir, patch, { now });
  const appended = await appendRunEvent(runDir, event, { now });
  return { event: appended, run: updated };
}

function validateRiskTier(value, { name = "risk tier" } = {}) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  const exact = typeof value === "number" ? Number.isInteger(value) : String(parsed) === String(value);
  if (!exact || parsed < MIN_RISK_TIER || parsed > MAX_RISK_TIER) {
    throw new Error(`Invalid ${name}: ${value}. Expected an integer from ${MIN_RISK_TIER} to ${MAX_RISK_TIER}.`);
  }
  return parsed;
}

function describeRiskTier(value) {
  const tier = validateRiskTier(value);
  return RISK_TIERS[tier];
}

function checkRiskTier(runTier, requiredTier) {
  const current = validateRiskTier(runTier, { name: "run risk tier" });
  const required = validateRiskTier(requiredTier, { name: "required risk tier" });
  return {
    allowed: current >= required,
    current,
    currentDescription: RISK_TIERS[current],
    required,
    requiredDescription: RISK_TIERS[required],
  };
}

async function blockRunForRisk(
  runDir,
  { action = "", actor = "runtime", requiredTier, summary = "" } = {},
  { now = new Date() } = {}
) {
  const run = await readRun(runDir);
  const gate = checkRiskTier(run.risk_tier ?? 0, requiredTier);
  if (gate.allowed) {
    return { blocked: false, gate, run };
  }
  const message =
    summary ||
    `Blocked ${action || "action"}: requires risk tier ${gate.required}, run is tier ${gate.current}.`;
  const result = await transitionRun(
    runDir,
    {
      next_action: message,
      phase: "blocked",
      public_summary: message,
      status: "blocked",
    },
    {
      type: "needs_decision",
      actor,
      summary: message,
      payload: {
        action,
        required_risk_tier: gate.required,
        required_risk_tier_description: gate.requiredDescription,
        run_risk_tier: gate.current,
        run_risk_tier_description: gate.currentDescription,
      },
    },
    { now }
  );
  return { blocked: true, gate, run: result.run };
}

async function readRunCheckpoint(runDir) {
  const paths = runPaths(runDir);
  let run = null;
  try {
    run = await readRun(runDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  let controlFile = {};
  try {
    controlFile = JSON.parse(await fs.readFile(paths.controlPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const controls = dedupeControls([
    ...(Array.isArray(run?.controls) ? run.controls : []),
    ...(Array.isArray(controlFile.controls) ? controlFile.controls : []),
  ]);
  const status = String(run?.status || "");
  const hasAction = (action) => controls.some((control) => String(control?.action || "") === action);
  const lastPauseResume = [...controls]
    .filter((control) => ["pause", "resume"].includes(String(control?.action || "")))
    .at(-1);
  const instructions = controls
    .filter((control) => String(control?.action || "") === "steer" && String(control?.instruction || "").trim())
    .map((control) => ({
      control_id: control.control_id || "",
      created_at: control.created_at || "",
      instruction: String(control.instruction).trim(),
    }));

  return {
    blocked: status === "blocked",
    cancelled: hasAction("cancel") || status === "cancelling" || status === "cancelled",
    controls,
    instructions,
    paused: status === "pausing" || String(lastPauseResume?.action || "") === "pause",
    run_id: run?.run_id || "",
    status,
  };
}

function dedupeControls(controls) {
  const seen = new Set();
  const deduped = [];
  for (const control of controls) {
    const key = control?.control_id || JSON.stringify(control);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(control);
  }
  return deduped;
}

function createBackgroundJobRunStore({ jobsRoot, now = () => new Date() } = {}) {
  if (!jobsRoot) {
    throw new Error("jobsRoot is required.");
  }

  async function listRuns({ statuses = null, limit = 10 } = {}) {
    const statusSet = Array.isArray(statuses) && statuses.length > 0 ? new Set(statuses) : null;
    const entries = await safeReadDir(jobsRoot);
    const runs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const runDir = path.join(jobsRoot, entry.name);
      try {
        const run = await readRun(runDir);
        if (!statusSet || statusSet.has(run.status)) {
          runs.push(run);
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    runs.sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
    return runs.slice(0, limit);
  }

  async function getRun(runId) {
    const runDir = await findRunDir(runId);
    return runDir ? readRun(runDir) : null;
  }

  async function controlRun(runId, { action, instruction = "", actor = "signal" } = {}) {
    const runDir = await findRunDir(runId);
    if (!runDir) {
      return null;
    }
    if (!["pause", "resume", "cancel", "steer"].includes(action)) {
      return { ok: false, message: `Unsupported run control: ${action}` };
    }

    const timestamp = now().toISOString();
    const control = {
      control_id: `ctl-${crypto.randomUUID()}`,
      action,
      actor,
      instruction,
      created_at: timestamp,
    };
    const current = await readRun(runDir);
    const controls = [...(Array.isArray(current.controls) ? current.controls : []), control];
    const patch = {
      controls,
      next_action: nextActionForControl(action, instruction),
    };
    if (action === "cancel") {
      patch.status = "cancelling";
      patch.phase = "cancelling";
    } else if (action === "pause") {
      patch.status = "pausing";
      patch.phase = "pausing";
    } else if (action === "resume") {
      patch.status = "running";
      patch.phase = "running";
    }
    const run = await updateRun(runDir, patch, { now: new Date(timestamp) });
    await appendRunEvent(
      runDir,
      {
        type: "control",
        actor,
        summary: control.summary || nextActionForControl(action, instruction),
        payload: control,
      },
      { now: new Date(timestamp) }
    );
    await writeJsonAtomic(runPaths(runDir).controlPath, { controls });
    return { run };
  }

  async function findRunDir(runId) {
    const exactDir = path.join(jobsRoot, runId);
    try {
      const exactRun = await readRun(exactDir);
      if (exactRun.run_id === runId || exactRun.background_job_id === runId) {
        return exactDir;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const entries = await safeReadDir(jobsRoot);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const runDir = path.join(jobsRoot, entry.name);
      try {
        const run = await readRun(runDir);
        if (run.run_id === runId || run.background_job_id === runId) {
          return runDir;
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    return null;
  }

  return {
    controlRun,
    getRun,
    listRuns,
  };
}

async function safeReadDir(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function nextActionForControl(action, instruction) {
  if (action === "steer") {
    return `Steering queued: ${instruction}`;
  }
  if (action === "cancel") {
    return "Cancellation requested by orchestrator.";
  }
  if (action === "pause") {
    return "Pause requested by orchestrator.";
  }
  if (action === "resume") {
    return "Resume requested by orchestrator.";
  }
  return "";
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

module.exports = {
  appendRunEvent,
  blockRunForRisk,
  checkRiskTier,
  createBackgroundJobRunStore,
  createRun,
  describeRiskTier,
  readRun,
  readRunCheckpoint,
  RISK_TIERS,
  runPaths,
  transitionRun,
  updateRun,
  validateRiskTier,
};
