const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  aggregateBatch,
  formatBatchNotification,
  handleCallback,
  initBatch,
  parseArgs,
} = require("../tools/background-job/batch-notify");

test("background batch notify parser supports repeated jobs and callback options", () => {
  const options = parseArgs([
    "init",
    "--batch-file",
    "/tmp/batch.json",
    "--name",
    "Round 1",
    "--jobs-root",
    "/tmp/jobs",
    "--job",
    "job-a",
    "--job",
    "job-b",
    "--recipient",
    "+15551112222",
  ]);

  assert.equal(options.command, "init");
  assert.equal(options.batchFile, "/tmp/batch.json");
  assert.equal(options.name, "Round 1");
  assert.equal(options.jobsRoot, "/tmp/jobs");
  assert.deepEqual(options.jobs, ["job-a", "job-b"]);
  assert.equal(options.recipient, "+15551112222");
});

test("background batch notify aggregates pending and terminal sibling jobs", async () => {
  const tempDir = await makeTempBatchDir();
  const jobsRoot = path.join(tempDir, "jobs");
  const batchFile = path.join(tempDir, "batch.json");

  try {
    await writeJobStatus(jobsRoot, "job-a", { name: "A", status: "completed" });
    await writeJobStatus(jobsRoot, "job-b", { name: "B", status: "running" });
    await writeJobStatus(jobsRoot, "job-c", { name: "C", status: "stopping" });
    await initBatch({
      batchFile,
      jobs: ["job-a", "job-b", "job-c"],
      jobsRoot,
      name: "Research round",
    });

    const aggregate = await aggregateBatch({
      jobs: [{ id: "job-a" }, { id: "job-b" }, { id: "job-c" }],
      jobsRoot,
      name: "Research round",
    });

    assert.equal(aggregate.allTerminal, false);
    assert.deepEqual(aggregate.counts, {
      completed: 1,
      failed: 0,
      pending: 2,
      terminal: 1,
      total: 3,
    });
    assert.deepEqual(aggregate.jobs.map((job) => [job.id, job.status]), [
      ["job-a", "completed"],
      ["job-b", "running"],
      ["job-c", "stopping"],
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background batch notify queues one Signal message after all jobs finish", async () => {
  const tempDir = await makeTempBatchDir();
  const jobsRoot = path.join(tempDir, "jobs");
  const queueDir = path.join(tempDir, "queue");
  const batchFile = path.join(tempDir, "batch.json");

  try {
    await writeJobStatus(jobsRoot, "job-a", { name: "Alpha", status: "completed" });
    await writeJobStatus(jobsRoot, "job-b", { name: "Beta", status: "failed" });
    await initBatch({
      batchFile,
      jobs: ["job-a", "job-b"],
      jobsRoot,
      message: "Review the reports before launching round 2.",
      name: "Elimination round 1",
      recipient: "+15551112222",
    });

    const first = await handleCallback({ batchFile, queueDir });
    const second = await handleCallback({ batchFile, queueDir });

    assert.equal(first.notificationQueued, true);
    assert.equal(first.reason, "queued");
    assert.match(first.message, /Background batch finished: Elimination round 1/);
    assert.match(first.message, /1 completed, 1 failed, 2 total/);
    assert.match(first.message, /job-a \[completed\] Alpha/);
    assert.match(first.message, /job-b \[failed\] Beta/);
    assert.equal(second.notificationQueued, false);
    assert.equal(second.reason, "already-notified");

    const pendingDir = path.join(queueDir, "pending");
    const entries = await fs.readdir(pendingDir);
    assert.equal(entries.length, 1);
    const payload = JSON.parse(await fs.readFile(path.join(pendingDir, entries[0]), "utf8"));
    assert.equal(payload.recipient, "+15551112222");
    assert.deepEqual(payload.files, []);
    assert.match(payload.message, /Reports:/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background batch notify waits without queueing while a sibling job is still running", async () => {
  const tempDir = await makeTempBatchDir();
  const jobsRoot = path.join(tempDir, "jobs");
  const queueDir = path.join(tempDir, "queue");
  const batchFile = path.join(tempDir, "batch.json");

  try {
    await writeJobStatus(jobsRoot, "job-a", { name: "Alpha", status: "completed" });
    await writeJobStatus(jobsRoot, "job-b", { name: "Beta", status: "running" });
    await initBatch({
      batchFile,
      jobs: ["job-a", "job-b"],
      jobsRoot,
      name: "Elimination round 2",
      recipient: "+15551112222",
    });

    const result = await handleCallback({ batchFile, queueDir });

    assert.equal(result.notificationQueued, false);
    assert.equal(result.reason, "waiting");
    assert.equal(result.aggregate.allTerminal, false);
    await assertNoNotificationSideEffects({ batchFile, queueDir });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background batch notify dry-run renders without queueing or marking notified", async () => {
  const tempDir = await makeTempBatchDir();
  const jobsRoot = path.join(tempDir, "jobs");
  const queueDir = path.join(tempDir, "queue");
  const batchFile = path.join(tempDir, "batch.json");

  try {
    await writeJobStatus(jobsRoot, "job-a", { name: "Alpha", status: "completed" });
    await initBatch({
      batchFile,
      jobs: ["job-a"],
      jobsRoot,
      name: "Preview round",
      recipient: "+15551112222",
    });

    const result = await handleCallback({ batchFile, dryRun: true, queueDir });

    assert.equal(result.notificationQueued, false);
    assert.equal(result.reason, "dry-run");
    assert.match(result.message, /Background batch finished: Preview round/);
    await assertNoNotificationSideEffects({ batchFile, queueDir });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background batch notification text includes status and report commands", () => {
  const message = formatBatchNotification({
    batch: { message: "", name: "Round", jobsRoot: "/tmp/jobs" },
    counts: { completed: 2, failed: 0, total: 2 },
    jobs: [
      { id: "job-a", name: "Alpha", status: "completed" },
      { id: "job-b", name: "Beta", status: "completed" },
    ],
  });

  assert.match(message, /Background batch finished: Round/);
  assert.match(message, /2 completed, 0 failed, 2 total/);
  assert.match(message, /npm run background-job -- report --id job-a/);
});

async function writeJobStatus(jobsRoot, id, status) {
  const jobDir = path.join(jobsRoot, id);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    path.join(jobDir, "status.json"),
    `${JSON.stringify({ id, jobDir, ...status }, null, 2)}\n`,
    "utf8"
  );
}

function makeTempBatchDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "sable-background-batch-"));
}

async function assertNoNotificationSideEffects({ batchFile, queueDir }) {
  await assert.rejects(() => fs.access(path.join(queueDir, "pending")), { code: "ENOENT" });

  const batch = JSON.parse(await fs.readFile(batchFile, "utf8"));
  assert.equal(batch.notifiedAt, "");
  assert.equal(batch.notificationRequestId, "");
}
