const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRun } = require("../tools/runtime/run-kernel");
const {
  formatRunNotification,
  handleRunCallback,
  parseArgs,
  shouldQueueSignal,
} = require("../tools/runtime/run-callback");

test("run callback parser uses run environment and validates events", () => {
  const options = parseArgs(["--event", "completed", "--dry-run"], {
    env: { SABLE_RUN_ID: "run-1", SABLE_RUN_PATH: "/tmp/run-1/run.json" },
  });
  assert.equal(options.runId, "run-1");
  assert.equal(options.runPath, "/tmp/run-1/run.json");
  assert.equal(options.dryRun, true);
  assert.throws(() => parseArgs(["--run-id", "run-1", "--event", "started"]), /Unsupported --event/);
});

test("run callback policy applies delivery and visibility", () => {
  const events = ["completed", "failed", "cancelled", "blocked", "needs_decision", "milestone"];
  const expected = {
    silent: [false, true, true, true, true, false],
    final_only: [true, true, true, true, true, false],
    milestones: [true, true, true, true, true, true],
    interactive: [true, true, true, true, true, true],
  };

  for (const [visibility, decisions] of Object.entries(expected)) {
    assert.deepEqual(events.map((event) => shouldQueueSignal({ delivery: "signal", visibility }, event)), decisions);
  }
  assert.equal(shouldQueueSignal({ delivery: "none", visibility: "interactive" }, "failed"), false);
  assert.equal(shouldQueueSignal({ delivery: "orchestrator_only", visibility: "interactive" }, "failed"), false);
});

test("run callback queues concise public text and records callback state", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-callback-"));
  const queued = [];
  try {
    await createRun(runDir, {
      run_id: "run-1",
      agent_profile: "coding",
      goal: "Implement callback wakeups",
      delivery: "signal",
      visibility: "final_only",
      status: "completed",
      public_summary: "Callback tests pass.",
      next_action: "Review the patch.",
      signal_recipient: "+15551112222",
    }, { now: new Date("2026-07-13T10:00:00.000Z") });

    const result = await handleRunCallback(
      { dryRun: false, event: "completed", runDir, runId: "run-1", runPath: "" },
      {
        now: new Date("2026-07-13T10:01:00.000Z"),
        queueSignalMessage: async (request) => {
          queued.push(request);
          return { id: "notification-1", payload: { message: request.message } };
        },
      }
    );

    assert.equal(result.notificationQueued, true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].recipient, "+15551112222");
    assert.match(queued[0].message, /Sable run completed: Implement callback wakeups/);
    assert.match(queued[0].message, /Summary: Callback tests pass/);
    assert.doesNotMatch(queued[0].message, /stdout|trace/i);

    const run = JSON.parse(await fs.readFile(path.join(runDir, "run.json"), "utf8"));
    assert.equal(run.last_callback_at, "2026-07-13T10:01:00.000Z");
    assert.equal(run.last_callback_event, "completed");
    assert.equal(run.last_callback_notification_id, "notification-1");
    const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "callback");
    assert.deepEqual(events[0].payload, {
      callback_event: "completed",
      notification_queued: true,
      reason: "queued",
      notification_request_id: "notification-1",
    });
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("run callback dry-run and suppressed callbacks have no queue side effects", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-run-callback-"));
  let queueCalls = 0;
  try {
    await createRun(runDir, {
      run_id: "run-2",
      agent_profile: "coding",
      goal: "Quiet work",
      delivery: "signal",
      visibility: "silent",
      status: "completed",
    });
    const queueSignalMessage = async () => { queueCalls += 1; };

    const dryRun = await handleRunCallback(
      { dryRun: true, event: "failed", runDir, runId: "run-2", runPath: "" },
      { queueSignalMessage }
    );
    const suppressed = await handleRunCallback(
      { dryRun: false, event: "completed", runDir, runId: "run-2", runPath: "" },
      { now: new Date("2026-07-13T11:00:00.000Z"), queueSignalMessage }
    );

    assert.equal(dryRun.reason, "dry-run");
    assert.equal(suppressed.reason, "policy");
    assert.equal(queueCalls, 0);
    const run = JSON.parse(await fs.readFile(path.join(runDir, "run.json"), "utf8"));
    assert.equal(run.last_callback_event, "completed");
    const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.notification_queued, false);
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("run notification formatting normalizes and bounds public fields", () => {
  const message = formatRunNotification({
    run_id: "run-3",
    goal: "A\n public goal",
    public_summary: "x".repeat(500),
    next_action: "Ask the operator.",
  }, "needs_decision");
  assert.match(message, /^Sable run needs decision: A public goal/m);
  assert.ok(message.length < 800);
});
