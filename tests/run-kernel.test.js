const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  blockRunForRisk,
  checkRiskTier,
  createBackgroundJobRunStore,
  createRun,
  readRun,
  readRunCheckpoint,
  runPaths,
  transitionRun,
} = require("../tools/runtime/run-kernel");

test("run kernel creates, transitions, lists, and controls background runs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-kernel-"));
  try {
    const runDir = path.join(tempDir, "job-1");
    await createRun(
      runDir,
      {
        run_id: "job-1",
        agent_profile: "coding",
        goal: "Implement the runtime",
        status: "queued",
        background_job_id: "job-1",
      },
      { now: new Date("2026-07-13T10:00:00.000Z") }
    );

    await transitionRun(
      runDir,
      { status: "running", phase: "implementation", public_summary: "Editing files." },
      { type: "started", summary: "Worker started." },
      { now: new Date("2026-07-13T10:01:00.000Z") }
    );

    const store = createBackgroundJobRunStore({
      jobsRoot: tempDir,
      now: () => new Date("2026-07-13T10:02:00.000Z"),
    });
    assert.deepEqual((await store.listRuns()).map((run) => run.run_id), ["job-1"]);

    const controlled = await store.controlRun("job-1", {
      action: "steer",
      actor: "signal",
      instruction: "Run focused tests.",
    });
    assert.equal(controlled.run.next_action, "Steering queued: Run focused tests.");

    const run = await readRun(runDir);
    assert.equal(run.controls.length, 1);
    assert.equal(run.controls[0].instruction, "Run focused tests.");
    assert.deepEqual(JSON.parse(await fs.readFile(runPaths(runDir).controlPath, "utf8")), {
      controls: run.controls,
    });

    const events = (await fs.readFile(runPaths(runDir).eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(events.map((event) => event.type), ["started", "control"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("run kernel exposes risk gates and checkpoint state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-kernel-"));
  try {
    const runDir = path.join(tempDir, "job-2");
    await createRun(
      runDir,
      {
        run_id: "job-2",
        agent_profile: "ops",
        goal: "Bounded operation",
        status: "running",
        risk_tier: 1,
        background_job_id: "job-2",
      },
      { now: new Date("2026-07-13T11:00:00.000Z") }
    );

    assert.deepEqual(checkRiskTier(2, 1), {
      allowed: true,
      current: 2,
      currentDescription: "Make reversible changes inside assigned workspace.",
      required: 1,
      requiredDescription: "Read and analyze local or explicitly provided data.",
    });

    const blocked = await blockRunForRisk(
      runDir,
      { action: "send email", requiredTier: 3 },
      { now: new Date("2026-07-13T11:01:00.000Z") }
    );
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.run.status, "blocked");
    assert.match(blocked.run.public_summary, /requires risk tier 3/);

    const store = createBackgroundJobRunStore({
      jobsRoot: tempDir,
      now: () => new Date("2026-07-13T11:02:00.000Z"),
    });
    await store.controlRun("job-2", { action: "steer", instruction: "Do the smaller safe check." });
    await store.controlRun("job-2", { action: "cancel" });

    const checkpoint = await readRunCheckpoint(runDir);
    assert.equal(checkpoint.blocked, false);
    assert.equal(checkpoint.cancelled, true);
    assert.equal(checkpoint.run_id, "job-2");
    assert.deepEqual(checkpoint.instructions.map((item) => item.instruction), ["Do the smaller safe check."]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("archives only terminal runs and removes them from the live ledger", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-archive-"));
  try {
    await createRun(path.join(tempDir, "active"), { run_id: "active", status: "running" });
    await createRun(path.join(tempDir, "done"), { run_id: "done", status: "completed", final_summary: "Finished safely." });
    const store = createBackgroundJobRunStore({ jobsRoot: tempDir, now: () => new Date("2026-08-03T10:00:00Z") });
    assert.equal((await store.archiveRun("active")).code, "RUN_NOT_TERMINAL");
    const result = await store.archiveRun("done", { actor: "obsidian" });
    assert.equal(result.ok, true);
    assert.equal(result.run.status, "completed");
    assert.equal(result.run.final_summary, "Finished safely.");
    assert.equal(result.run.archived_by, "obsidian");
    assert.deepEqual((await store.listRuns()).map((run) => run.run_id), ["active"]);
    assert.equal((await fs.lstat(path.join(tempDir, ".archive", "done"))).isDirectory(), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("migrates legacy terminal runs into the canonical archive and retention ledger", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-legacy-"));
  try {
    const legacyDir = path.join(tempDir, "legacy-done");
    await fs.mkdir(legacyDir);
    await fs.writeFile(path.join(legacyDir, "status.json"), JSON.stringify({
      id: "legacy-done", status: "completed", name: "Legacy task", agentProfile: "lab",
      scheduleId: "daily", pinned: true, references: ["report"],
      createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-02T00:00:00Z",
    }));
    await fs.writeFile(path.join(legacyDir, "stderr.log"), "heavy");
    const store = createBackgroundJobRunStore({ jobsRoot: tempDir, now: () => new Date("2026-08-03T00:00:00Z") });
    const result = await store.archiveRun("legacy-done", { actor: "obsidian" });
    assert.equal(result.ok, true);
    assert.equal(result.run.legacy_migrated, true);
    assert.equal(result.run.schedule_id, "daily");
    assert.equal(result.run.pinned, true);
    assert.deepEqual(result.run.references, ["report"]);
    assert.equal((await store.pruneArchives()).protected, 1);
    assert.equal(await fs.readFile(path.join(tempDir, ".archive", "legacy-done", "stderr.log"), "utf8"), "heavy");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("refuses to migrate active legacy runs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-legacy-active-"));
  try {
    const legacyDir = path.join(tempDir, "legacy-active");
    await fs.mkdir(legacyDir);
    await fs.writeFile(path.join(legacyDir, "status.json"), JSON.stringify({ id: "legacy-active", status: "running" }));
    const store = createBackgroundJobRunStore({ jobsRoot: tempDir });
    assert.equal((await store.archiveRun("legacy-active")).code, "RUN_NOT_TERMINAL");
    await assert.rejects(fs.access(path.join(legacyDir, "run.json")));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("archive pruning has split retention and protects pinned, referenced, and latest scheduled runs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-prune-"));
  const archiveRoot = path.join(tempDir, ".archive");
  try {
    const makeArchive = async (id, archivedAt, extra = {}) => {
      const runDir = path.join(archiveRoot, id);
      await createRun(runDir, { run_id: id, status: "completed", archived_at: archivedAt, ...extra }, { now: new Date(archivedAt) });
      await fs.writeFile(path.join(runDir, "stdout.jsonl"), "heavy");
      await fs.writeFile(path.join(runDir, "last-message.txt"), "final summary");
    };
    await makeArchive("heavy", "2026-06-20T00:00:00Z");
    await makeArchive("expired", "2026-04-01T00:00:00Z");
    await makeArchive("pinned", "2026-04-01T00:00:00Z", { pinned: true });
    await makeArchive("referenced", "2026-04-01T00:00:00Z", { references: ["report"] });
    await makeArchive("schedule-old", "2026-04-01T00:00:00Z", { schedule_id: "daily" });
    await makeArchive("schedule-latest", "2026-04-02T00:00:00Z", { schedule_id: "daily" });
    const store = createBackgroundJobRunStore({ jobsRoot: tempDir, now: () => new Date("2026-08-03T00:00:00Z") });
    const dry = await store.pruneArchives({ dryRun: true });
    assert.equal(dry.archivesPruned, 2);
    assert.equal(dry.heavyFilesPruned, 1);
    assert.equal(dry.protected, 3);
    const result = await store.pruneArchives();
    assert.deepEqual(result, { scanned: 6, protected: 3, heavyFilesPruned: 1, archivesPruned: 2, dryRun: false });
    await assert.rejects(fs.access(path.join(archiveRoot, "heavy", "stdout.jsonl")));
    assert.equal(await fs.readFile(path.join(archiveRoot, "heavy", "last-message.txt"), "utf8"), "final summary");
    await assert.rejects(fs.access(path.join(archiveRoot, "expired")));
    await assert.rejects(fs.access(path.join(archiveRoot, "schedule-old")));
    assert.equal((await fs.lstat(path.join(archiveRoot, "pinned"))).isDirectory(), true);
    assert.equal((await fs.lstat(path.join(archiveRoot, "schedule-latest"))).isDirectory(), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("archive pruning refuses symlinked archive directories", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-symlink-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-outside-"));
  try {
    await fs.mkdir(path.join(tempDir, ".archive"));
    await fs.symlink(outside, path.join(tempDir, ".archive", "escape"));
    const store = createBackgroundJobRunStore({ jobsRoot: tempDir });
    assert.deepEqual(await store.pruneArchives(), { scanned: 0, protected: 0, heavyFilesPruned: 0, archivesPruned: 0, dryRun: false });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
