const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RUN_COMMAND_USAGE,
  createBridgeRunCommands,
} = require("../apps/signal-bridge/bridge-run-commands");

const runs = [
  {
    run_id: "coding-20260713-001",
    agent_profile: "coding",
    status: "running",
    phase: "testing",
    updated_at: "2026-07-13T00:12:00Z",
    public_summary: "Implementation is done; callback tests remain.",
    next_action: "Fix the callback assertion.",
    artifacts: [{ type: "file", path: "result.md" }],
    trace: "raw trace must never be shown",
  },
  {
    run_id: "research-20260713-002",
    agent_profile: "research",
    status: "blocked",
    phase: "waiting_for_external",
    public_summary: "Waiting for a dataset decision.",
    next_action: "Choose the licensed dataset.",
  },
];

function createStore(overrides = {}) {
  return {
    listRuns: async ({ statuses } = {}) =>
      statuses ? runs.filter((run) => statuses.includes(run.status)) : runs,
    getRun: async (runId) => runs.find((run) => run.run_id === runId) || null,
    controlRun: async (runId, control) => ({
      ...runs.find((run) => run.run_id === runId),
      status: control.action === "pause" ? "paused" : "running",
    }),
    ...overrides,
  };
}

test("run commands format concise public summaries without traces", async () => {
  const commands = createBridgeRunCommands({ runStore: createStore() });

  const list = await commands.handle({ type: "list-runs" });
  assert.match(list, /Recent runs \(2\):/);
  assert.match(list, /coding-20260713-001 - running · testing/);
  assert.doesNotMatch(list, /raw trace/);

  const detail = await commands.handle({ type: "show-run", runId: "coding-20260713-001" });
  assert.match(detail, /Summary: Implementation is done/);
  assert.match(detail, /Next: Fix the callback assertion/);
  assert.match(detail, /Artifacts: 1/);
  assert.doesNotMatch(detail, /raw trace/);
});

test("blockers query only blocked runs and includes their next action", async () => {
  let query = null;
  const commands = createBridgeRunCommands({
    runStore: createStore({
      listRuns: async (options) => {
        query = options;
        return [runs[1]];
      },
    }),
  });

  const message = await commands.handle({ type: "list-run-blockers" });
  assert.deepEqual(query, { statuses: ["blocked"], limit: 10 });
  assert.match(message, /research-20260713-002 - blocked/);
  assert.match(message, /Next: Choose the licensed dataset/);
});

test("controls pass action, steering instruction, and Signal actor to the run store", async () => {
  const calls = [];
  const commands = createBridgeRunCommands({
    runStore: createStore({
      controlRun: async (runId, control) => {
        calls.push({ runId, control });
        return { run: runs[0] };
      },
    }),
  });

  const message = await commands.handle(
    {
      type: "control-run",
      runId: "coding-20260713-001",
      action: "steer",
      instruction: "Run the narrow tests first.",
    },
    { actor: "signal:+1555" }
  );

  assert.deepEqual(calls, [
    {
      runId: "coding-20260713-001",
      control: {
        action: "steer",
        instruction: "Run the narrow tests first.",
        actor: "signal:+1555",
      },
    },
  ]);
  assert.match(message, /Steering queued/);
});

test("run commands handle missing stores, missing runs, and usage", async () => {
  const unavailable = createBridgeRunCommands();
  assert.match(await unavailable.handle({ type: "list-runs" }), /not available/);
  assert.equal(await unavailable.handle({ type: "run-usage" }), RUN_COMMAND_USAGE);

  const commands = createBridgeRunCommands({ runStore: createStore() });
  assert.equal(
    await commands.handle({ type: "show-run", runId: "missing" }),
    "No run matched missing."
  );
});
