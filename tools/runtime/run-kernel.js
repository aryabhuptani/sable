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
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "stopped"]);
const ABANDONABLE_RUN_STATUSES = new Set(["blocked", "paused", "queued", "waiting", "needs_input"]);
const DEFAULT_ARCHIVE_RETENTION = Object.freeze({ heavyDays: 30, metadataDays: 90 });
const HEAVY_ARCHIVE_FILES = new Set(["stderr.log", "stdout.jsonl", "prompt.md", "control.json"]);

function watchdogProvesWorkerDead(run, status) {
  const watchdog = status?.watchdog;
  const detectedAt = watchdog?.detectedAt;
  const reasons = Array.isArray(watchdog?.reasons) ? watchdog.reasons : [];
  const cancelled = Array.isArray(run?.controls) && run.controls.some(control => control?.action === "cancel" && control.created_at <= detectedAt);
  return String(run?.status || "").toLowerCase() === "blocked"
    && String(status?.status || "").toLowerCase() === "blocked"
    && ["cancelling", "stopping"].includes(String(watchdog?.previousStatus || "").toLowerCase())
    && reasons.some(reason => reason === "dead_pid" || reason === "missing_pid")
    && detectedAt === run?.updated_at
    && detectedAt === status?.updatedAt
    && cancelled;
}

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

async function transitionRun(runDir, patch, event, { now = new Date(), expectedStatus, expectedUpdatedAt } = {}) {
  const lockPath = path.join(runDir, ".transition.lock");
  let lock;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { lock = await fs.open(lockPath, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST" || attempt === 99) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    const current = await readRun(runDir);
    if ((expectedStatus !== undefined && String(current.status || current.phase || "").toLowerCase() !== expectedStatus)
      || (expectedUpdatedAt !== undefined && current.updated_at !== expectedUpdatedAt)) {
      return { event: null, run: current, transitioned: false };
    }
    const updated = { ...current, ...patch, updated_at: now.toISOString() };
    await writeJsonAtomic(runPaths(runDir).runPath, updated);
    const appended = await appendRunEvent(runDir, event, { now });
    return { event: appended, run: updated, transitioned: true };
  } finally {
    await lock?.close();
    await fs.rm(lockPath, { force: true });
  }
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

function createBackgroundJobRunStore({ jobsRoot, now = () => new Date(), isProcessAlive = defaultIsProcessAlive } = {}) {
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

  async function archiveRun(runId, { actor = "runtime" } = {}) {
    let runDir = await findRunDir(runId);
    if (!runDir) {
      const legacy = await migrateLegacyRun(runId);
      if (legacy?.ok === false) return legacy;
      runDir = legacy;
    }
    if (!runDir) return null;
    await assertOwnedRunDirectory(runDir, jobsRoot);
    if (!(await isOwnedRegularFile(runPaths(runDir).runPath, runDir))) throw new Error("Unsafe run metadata file.");
    if (!(await isOwnedRegularFile(runPaths(runDir).eventsPath, runDir))) throw new Error("Unsafe run event file.");
    const current = await readRun(runDir);
    const status = String(current.status || "").toLowerCase();
    if (!TERMINAL_RUN_STATUSES.has(status)) {
      return { ok: false, code: "RUN_NOT_TERMINAL", message: "Only completed, failed, or cancelled runs can be archived." };
    }
    const archiveRoot = path.join(jobsRoot, ".archive");
    await ensureOwnedDirectory(archiveRoot, jobsRoot);
    const destination = path.join(archiveRoot, path.basename(runDir));
    try {
      await fs.lstat(destination);
      return { ok: false, code: "ARCHIVE_CONFLICT", message: "An archived run with this id already exists." };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const timestamp = now().toISOString();
    await updateRun(runDir, { archived_at: timestamp, archived_by: actor }, { now: new Date(timestamp) });
    await appendRunEvent(runDir, { type: "archived", actor, summary: "Run archived." }, { now: new Date(timestamp) });
    await fs.rename(runDir, destination);
    return { ok: true, run: await readRun(destination), archiveDir: destination };
  }

  async function abandonRun(runId, { actor = "runtime", reason = "No longer relevant." } = {}) {
    if (typeof reason !== "string" || !reason.trim() || Buffer.byteLength(reason) > 4096) {
      return { ok: false, code: "INVALID_ABANDON_REASON", message: "Abandonment reason must be 1–4096 bytes." };
    }
    let runDir = await findRunDir(runId);
    if (!runDir) {
      const legacy = await migrateLegacyRun(runId, { allowAbandonable: true });
      if (legacy?.ok === false) return legacy;
      runDir = legacy;
    }
    if (!runDir) return null;
    await assertOwnedRunDirectory(runDir, jobsRoot);
    if (!(await isOwnedRegularFile(runPaths(runDir).runPath, runDir))) throw new Error("Unsafe run metadata file.");
    if (!(await isOwnedRegularFile(runPaths(runDir).eventsPath, runDir))) throw new Error("Unsafe run event file.");
    const current = await readRun(runDir);
    const status = String(current.status || current.phase || "").toLowerCase();
    if (TERMINAL_RUN_STATUSES.has(status)) return archiveRun(runId, { actor });
    if (!ABANDONABLE_RUN_STATUSES.has(status)) {
      return {
        ok: false,
        code: "RUN_MAY_BE_EXECUTING",
        message: "This run may still be executing. Cancel it and wait for cancellation acknowledgement before archiving.",
      };
    }
    const statusPath = path.join(runDir, "status.json");
    let runtimeStatus = {};
    if (await isOwnedRegularFile(statusPath, runDir)) runtimeStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
    if (workerAlive(current, runtimeStatus) !== false) {
      return {
        ok: false,
        code: "RUN_WORKER_ACTIVE",
        message: "This run still has a live worker. Cancel it and wait for cancellation acknowledgement before archiving.",
      };
    }
    const timestamp = now().toISOString();
    const trimmedReason = reason.trim();
    await transitionRun(runDir, {
      status: "cancelled",
      phase: "cancelled",
      completed_at: timestamp,
      abandoned_at: timestamp,
      abandoned_by: actor,
      abandonment_reason: trimmedReason,
      cancellation_source: "explicit_abandonment",
      cancellation_acknowledged_at: timestamp,
      next_action: "",
    }, {
      type: "abandoned",
      actor,
      summary: `Run abandoned: ${trimmedReason}`,
      payload: { previous_status: status, reason: trimmedReason, cancellation_source: "explicit_abandonment" },
    }, { now: new Date(timestamp) });
    const archived = await archiveRun(runId, { actor });
    if (archived?.ok) archived.abandoned = true;
    return archived;
  }

  function workerAlive(run, status = {}) {
    const workerPids = [
      run?.worker_pid, run?.workerPid, run?.pid, run?.runnerPid,
      status?.workerPid, status?.pid, status?.runnerPid, status?.codexPid, status?.claudePid,
    ].map(value => Number(value)).filter(value => Number.isSafeInteger(value) && value > 0);
    if (watchdogProvesWorkerDead(run, status)) return false;
    if (!workerPids.length) return String(run?.status || status?.status || "").toLowerCase() === "queued" ? false : null;
    return workerPids.some(pid => isProcessAlive(pid));
  }

  async function migrateLegacyRun(runId, { allowAbandonable = false } = {}) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(String(runId || ""))) return null;
    const runDir = path.join(jobsRoot, runId);
    try {
      await assertOwnedRunDirectory(runDir, jobsRoot);
      const statusPath = path.join(runDir, "status.json");
      if (!(await isOwnedRegularFile(statusPath, runDir))) return null;
      const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      if (String(status.id || runId) !== runId) return null;
      const terminalStatus = String(status.status || "").toLowerCase();
      if (!TERMINAL_RUN_STATUSES.has(terminalStatus) && !(allowAbandonable && ABANDONABLE_RUN_STATUSES.has(terminalStatus))) {
        return { ok: false, code: allowAbandonable ? "RUN_MAY_BE_EXECUTING" : "RUN_NOT_TERMINAL", message: allowAbandonable ? "This run may still be executing. Cancel it and wait for cancellation acknowledgement before archiving." : "Only completed, failed, or cancelled runs can be archived." };
      }
      await createRun(runDir, {
        run_id: runId,
        background_job_id: String(status.backgroundJobId || status.background_job_id || runId),
        status: terminalStatus,
        phase: terminalStatus,
        agent_profile: status.agentProfile || status.agent_profile || null,
        goal: status.name || runId,
        schedule_id: status.scheduleId || status.schedule_id || null,
        pinned: status.pinned === true,
        referenced: status.referenced === true,
        references: Array.isArray(status.references) ? status.references : [],
        created_at: status.createdAt || status.created_at,
        updated_at: status.updatedAt || status.updated_at,
        completed_at: status.completedAt || status.completed_at,
        legacy_migrated: true,
      }, { now: now() });
      return runDir;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function pruneArchives({
    dryRun = false,
    heavyDays = DEFAULT_ARCHIVE_RETENTION.heavyDays,
    metadataDays = DEFAULT_ARCHIVE_RETENTION.metadataDays,
    protectedRunIds = [],
  } = {}) {
    validateRetentionDays(heavyDays, metadataDays);
    const archiveRoot = path.join(jobsRoot, ".archive");
    const entries = await safeReadDir(archiveRoot);
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const archiveDir = path.join(archiveRoot, entry.name);
      try {
        await assertOwnedRunDirectory(archiveDir, archiveRoot);
        if (!(await isOwnedRegularFile(runPaths(archiveDir).runPath, archiveDir))) continue;
        records.push({ archiveDir, run: await readRun(archiveDir) });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const protectedIds = buildProtectedRunIds(records, protectedRunIds);
    const result = { scanned: records.length, protected: 0, heavyFilesPruned: 0, archivesPruned: 0, dryRun };
    const nowMs = now().getTime();
    for (const { archiveDir, run } of records) {
      const runId = String(run.run_id || run.background_job_id || path.basename(archiveDir));
      if (protectedIds.has(runId)) { result.protected += 1; continue; }
      const archivedMs = Date.parse(run.archived_at || run.updated_at || run.created_at || "");
      if (!Number.isFinite(archivedMs)) continue;
      const ageDays = (nowMs - archivedMs) / 86_400_000;
      if (ageDays >= metadataDays) {
        result.archivesPruned += 1;
        if (!dryRun) await removeOwnedArchiveDirectory(archiveDir, archiveRoot);
        continue;
      }
      if (ageDays >= heavyDays) {
        for (const name of HEAVY_ARCHIVE_FILES) {
          const filePath = path.join(archiveDir, name);
          if (!(await isOwnedRegularFile(filePath, archiveDir))) continue;
          result.heavyFilesPruned += 1;
          if (!dryRun) await fs.unlink(filePath);
        }
      }
    }
    return result;
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
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(String(runId || ""))) return null;
    const exactDir = path.join(jobsRoot, runId);
    try {
      await assertOwnedRunDirectory(exactDir, jobsRoot);
      if (!(await isOwnedRegularFile(runPaths(exactDir).runPath, exactDir))) return null;
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
        await assertOwnedRunDirectory(runDir, jobsRoot);
        if (!(await isOwnedRegularFile(runPaths(runDir).runPath, runDir))) continue;
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
    abandonRun,
    archiveRun,
    controlRun,
    getRun,
    listRuns,
    pruneArchives,
    workerAlive,
  };
}

function defaultIsProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function validateRetentionDays(heavyDays, metadataDays) {
  if (!Number.isFinite(heavyDays) || heavyDays < 0 || !Number.isFinite(metadataDays) || metadataDays < heavyDays) {
    throw new Error("Archive retention must use non-negative days with metadata retention at least as long as heavy-file retention.");
  }
}

function buildProtectedRunIds(records, explicitIds) {
  const ids = new Set((explicitIds || []).map(String));
  const latestBySchedule = new Map();
  for (const { run } of records) {
    const id = String(run.run_id || run.background_job_id || "");
    if (!id) continue;
    if (run.pinned === true || (Array.isArray(run.references) && run.references.length > 0) || run.referenced === true) ids.add(id);
    const scheduleId = String(run.schedule_id || run.scheduleId || "");
    if (!scheduleId) continue;
    const date = Date.parse(run.archived_at || run.updated_at || run.created_at || "") || 0;
    if (!latestBySchedule.has(scheduleId) || latestBySchedule.get(scheduleId).date < date) latestBySchedule.set(scheduleId, { id, date });
  }
  for (const value of latestBySchedule.values()) ids.add(value.id);
  return ids;
}

async function ensureOwnedDirectory(directory, parent) {
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe archive directory.");
  const [realDirectory, realParent] = await Promise.all([fs.realpath(directory), fs.realpath(parent)]);
  if (path.dirname(realDirectory) !== realParent) throw new Error("Archive directory escapes its configured root.");
}

async function assertOwnedRunDirectory(directory, parent) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe run directory.");
  const [realDirectory, realParent] = await Promise.all([fs.realpath(directory), fs.realpath(parent)]);
  if (path.dirname(realDirectory) !== realParent) throw new Error("Run directory escapes its configured root.");
}

async function isOwnedRegularFile(filePath, parent) {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return path.dirname(await fs.realpath(filePath)) === await fs.realpath(parent);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function removeOwnedArchiveDirectory(directory, archiveRoot) {
  await assertOwnedRunDirectory(directory, archiveRoot);
  await assertTreeContainsNoSymlinks(directory);
  await fs.rm(directory, { recursive: true });
}

async function assertTreeContainsNoSymlinks(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("Refusing to prune an archive containing symlinks.");
    if (entry.isDirectory()) await assertTreeContainsNoSymlinks(path.join(directory, entry.name));
  }
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
  DEFAULT_ARCHIVE_RETENTION,
  describeRiskTier,
  readRun,
  readRunCheckpoint,
  RISK_TIERS,
  runPaths,
  transitionRun,
  updateRun,
  validateRiskTier,
};
