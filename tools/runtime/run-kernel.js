"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

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
  createBackgroundJobRunStore,
  createRun,
  readRun,
  runPaths,
  transitionRun,
  updateRun,
};
