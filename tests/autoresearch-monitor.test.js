const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectCompletedRuns,
  createAutoresearchMonitor,
  didFrontierDrain,
  summarizeAutoresearchRuns,
} = require("../apps/signal-bridge/autoresearch-monitor");

async function writeRun(root, topicSlug, runSlug, state) {
  const runRoot = path.join(root, topicSlug, "autoresearch", "active", runSlug);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.mkdir(path.join(root, topicSlug, "wiki"), { recursive: true });
  await fs.writeFile(
    path.join(runRoot, "STATE.json"),
    `${JSON.stringify({ topicSlug, runSlug, ...state }, null, 2)}\n`,
    "utf8"
  );
  return runRoot;
}

test("autoresearch monitor snapshots active run state from the research root", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-monitor-"));
  try {
    const runRoot = await writeRun(tempRoot, "darkbloom", "privacy-audit", {
      rootQuestion: "Where can privacy fail?",
      status: "active",
      pendingQuestions: ["one", "two"],
      processedQuestions: [{ question: "done" }],
      maxTotalQuestions: 7,
      startedAt: "2026-05-04T10:00:00.000Z",
      updatedAt: "2026-05-04T10:30:00.000Z",
    });
    const monitor = createAutoresearchMonitor({ researchRoot: tempRoot });

    const runs = monitor.snapshotRuns();

    assert.equal(runs.size, 1);
    assert.deepEqual(runs.get(runRoot), {
      runRoot,
      topicSlug: "darkbloom",
      runSlug: "privacy-audit",
      rootQuestion: "Where can privacy fail?",
      status: "active",
      pendingCount: 2,
      processedCount: 1,
      maxTotalQuestions: 7,
      startedAt: "2026-05-04T10:00:00.000Z",
      lastUpdatedAt: "2026-05-04T10:30:00.000Z",
      statePath: path.join(runRoot, "STATE.json"),
      logPath: path.join(runRoot, "LOG.md"),
      wikiIndexPath: path.join(tempRoot, "darkbloom", "wiki", "index.md"),
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("autoresearch monitor summarizes runnable, stalled, and budget-exhausted runs", () => {
  const now = new Date("2026-05-04T12:00:00.000Z");
  const runs = new Map([
    [
      "/runs/active",
      {
        topicSlug: "darkbloom",
        runSlug: "active",
        status: "active",
        pendingCount: 2,
        processedCount: 1,
        maxTotalQuestions: 10,
        startedAt: "2026-05-04T10:00:00.000Z",
        lastUpdatedAt: "2026-05-04T11:50:00.000Z",
      },
    ],
    [
      "/runs/budget",
      {
        topicSlug: "darkbloom",
        runSlug: "budget",
        status: "active",
        pendingCount: 1,
        processedCount: 3,
        maxTotalQuestions: 3,
        startedAt: "2026-05-04T09:00:00.000Z",
        lastUpdatedAt: "2026-05-04T11:45:00.000Z",
      },
    ],
    [
      "/runs/completed",
      {
        topicSlug: "darkbloom",
        runSlug: "completed",
        status: "completed",
        pendingCount: 0,
        processedCount: 4,
        maxTotalQuestions: 10,
        startedAt: "2026-05-04T08:00:00.000Z",
        lastUpdatedAt: "2026-05-04T11:00:00.000Z",
      },
    ],
  ]);

  const summary = summarizeAutoresearchRuns(runs, now, 60 * 60 * 1000);

  assert.equal(summary.total, 3);
  assert.equal(summary.active, 2);
  assert.equal(summary.runnable, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.stalled, 1);
  assert.equal(summary.budgetExhausted, 1);
  assert.equal(summary.oldestActiveRun, "darkbloom/budget");
});

test("autoresearch monitor detects completions and frontier drain", () => {
  const beforeRuns = new Map([
    ["/runs/a", { status: "active", pendingCount: 1, processedCount: 1, maxTotalQuestions: 10 }],
    ["/runs/b", { status: "active", pendingCount: 0, processedCount: 2, maxTotalQuestions: 10 }],
  ]);
  const afterRuns = new Map([
    ["/runs/a", { status: "completed", pendingCount: 0, processedCount: 2, maxTotalQuestions: 10 }],
    ["/runs/b", { status: "completed", pendingCount: 0, processedCount: 2, maxTotalQuestions: 10 }],
  ]);

  assert.deepEqual(collectCompletedRuns(beforeRuns, afterRuns), [afterRuns.get("/runs/a")]);
  assert.equal(didFrontierDrain(beforeRuns, afterRuns), true);
});

test("autoresearch monitor sends per-run and all-complete notices", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-monitor-"));
  try {
    const runRoot = await writeRun(tempRoot, "darkbloom", "privacy-audit", {
      rootQuestion: "Can responses leak plaintext?",
      status: "active",
      pendingQuestions: ["finish"],
      processedQuestions: [],
      maxTotalQuestions: 5,
      startedAt: "2026-05-04T10:00:00.000Z",
      updatedAt: "2026-05-04T10:30:00.000Z",
    });
    const monitor = createAutoresearchMonitor({ researchRoot: tempRoot });
    const beforeRuns = monitor.snapshotRuns();
    await writeRun(tempRoot, "darkbloom", "privacy-audit", {
      rootQuestion: "Can responses leak plaintext?",
      status: "completed",
      pendingQuestions: [],
      processedQuestions: [
        {
          question: "Can responses leak plaintext?",
          notes: ["The response path remains plaintext to the coordinator."],
        },
      ],
      maxTotalQuestions: 5,
      startedAt: "2026-05-04T10:00:00.000Z",
      completedAt: "2026-05-04T11:00:00.000Z",
    });
    const replies = [];

    await monitor.sendCompletionNotices(beforeRuns, "+15551112222", async (sender, message) => {
      replies.push({ sender, message });
    });

    assert.equal(replies.length, 2);
    assert.equal(replies[0].sender, "+15551112222");
    assert.match(replies[0].message, /Autoresearch completed for Darkbloom\./);
    assert.match(replies[0].message, /Response confidentiality is still the weakest live boundary/);
    assert.match(replies[0].message, new RegExp(`Run log: ${runRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/LOG\\.md`));
    assert.match(replies[1].message, /All active autoresearch work is complete for Darkbloom\./);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
