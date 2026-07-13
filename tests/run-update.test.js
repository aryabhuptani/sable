const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRun } = require("../tools/runtime/run-kernel");
const {
  PUBLIC_TEXT_LIMITS,
  parseArgs,
  publishRunUpdate,
} = require("../tools/runtime/run-update");

test("run update parser resolves run environment and explicit paths", () => {
  const fromEnv = parseArgs(["--summary", "  Built\n the module.  "], {
    env: { SABLE_RUN_ID: "run-1", SABLE_RUN_PATH: "/tmp/run-1/run.json" },
  });
  assert.equal(fromEnv.runId, "run-1");
  assert.equal(fromEnv.runPath, "/tmp/run-1/run.json");
  assert.equal(fromEnv.publicSummary, "Built the module.");
  assert.equal(fromEnv.event, "milestone");
  assert.equal(fromEnv.callback, true);

  const explicit = parseArgs(["--run-dir", "~/runs/one", "--phase", "tests", "--no-callback"], {
    env: { HOME: "/home/test", SABLE_RUN_ID: "ignored" },
  });
  assert.equal(explicit.runDir, "/home/test/runs/one");
  assert.equal(explicit.runId, "");
  assert.equal(explicit.runPath, "");
  assert.equal(explicit.callback, false);

  const explicitId = parseArgs(["--run-id", "run-elsewhere", "--phase", "planning"], {
    env: { SABLE_RUN_DIR: "/tmp/current", SABLE_RUN_PATH: "/tmp/current/run.json" },
  });
  assert.equal(explicitId.runDir, "");
  assert.equal(explicitId.runPath, "");
});

test("run update writes bounded public state and a milestone event", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-update-"));
  try {
    await createRun(runDir, {
      run_id: "run-2",
      agent_profile: "coding",
      status: "running",
    }, { now: new Date("2026-07-13T12:00:00.000Z") });

    const result = await publishRunUpdate(parseArgs([
      "--run-dir", runDir,
      "--public-summary", "Implementation complete; tests are running.",
      "--next-action", "Run focused runtime tests.",
      "--phase", "verification",
      "--no-callback",
    ]), { now: new Date("2026-07-13T12:01:00.000Z") });

    assert.equal(result.callback, null);
    assert.equal(result.run.public_summary, "Implementation complete; tests are running.");
    assert.equal(result.run.next_action, "Run focused runtime tests.");
    assert.equal(result.run.phase, "verification");
    assert.equal(result.run.updated_at, "2026-07-13T12:01:00.000Z");
    const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "milestone");
    assert.equal(events[0].summary, "Implementation complete; tests are running.");
    assert.deepEqual(events[0].payload, { update: {
      public_summary: "Implementation complete; tests are running.",
      next_action: "Run focused runtime tests.",
      phase: "verification",
    } });
    assert.equal(events[0].payload.trace, undefined);
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("run update sends milestone through callback policy", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-update-"));
  const queued = [];
  try {
    await createRun(runDir, {
      run_id: "run-3",
      agent_profile: "coding",
      delivery: "signal",
      visibility: "milestones",
      status: "running",
    });

    const result = await publishRunUpdate(parseArgs([
      "--run-dir", runDir,
      "--summary", "The parser and state update are complete.",
    ]), {
      now: new Date("2026-07-13T12:02:00.000Z"),
      queueSignalMessage: async (request) => {
        queued.push(request);
        return { id: "notification-3" };
      },
    });

    assert.equal(result.callback.notificationQueued, true);
    assert.equal(queued.length, 1);
    assert.match(queued[0].message, /Summary: The parser and state update are complete/);
    const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.map((event) => event.type), ["milestone", "callback"]);
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("run update rejects empty, oversized, terminal status, and trace-style arguments", async () => {
  assert.throws(() => parseArgs(["--run-id", "run-4", "--summary", "   "]), /non-empty public update/);
  assert.throws(() => parseArgs([
    "--run-id", "run-4", "--summary", "x".repeat(PUBLIC_TEXT_LIMITS.publicSummary + 1),
  ]), /exceeds 320 characters/);
  assert.throws(() => parseArgs(["--run-id", "run-4", "--status", "completed"]), /Unsupported --status/);
  assert.throws(() => parseArgs(["--run-id", "run-4", "--trace", "raw reasoning"]), /Unknown argument: --trace/);
  await assert.rejects(() => publishRunUpdate({
    publicSummary: "x".repeat(PUBLIC_TEXT_LIMITS.publicSummary + 1),
    runDir: "/tmp/not-read",
  }), /exceeds 320 characters/);
});
