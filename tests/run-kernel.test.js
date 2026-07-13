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
