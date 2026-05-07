const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createJobId,
  defaultJobsRoot,
  formatJobList,
  parseArgs,
  startJob,
} = require("../tools/background-job/background-job");

test("background job parser supports start options without assuming a repo", () => {
  const options = parseArgs([
    "start",
    "--name",
    "Darkbloom v0",
    "--cwd",
    "/tmp",
    "--prompt",
    "do work",
    "--model",
    "gpt-5.5",
    "--dry-run",
  ]);

  assert.equal(options.command, "start");
  assert.equal(options.name, "Darkbloom v0");
  assert.equal(options.cwd, "/tmp");
  assert.equal(options.prompt, "do work");
  assert.equal(options.model, "gpt-5.5");
  assert.equal(options.dryRun, true);
});

test("background job ids are timestamped and slugged", () => {
  assert.equal(
    createJobId("Darkbloom Simulator Batch 1", new Date("2026-05-07T12:34:56.000Z")),
    "20260507123456-darkbloom-simulator-batch-1"
  );
});

test("background job dry-run writes durable prompt and status files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const cwd = path.join(tempDir, "workspace");
  const jobsRoot = path.join(tempDir, "jobs");
  await fs.mkdir(cwd);

  try {
    const status = await startJob(
      {
        codex: "codex",
        codexHome: path.join(tempDir, "codex-home"),
        command: "start",
        cwd,
        dryRun: true,
        id: "job-1",
        jobsRoot,
        model: "",
        name: "Job One",
        prompt: "Implement the bounded thing.",
        promptFile: "",
      },
      { now: new Date("2026-05-07T12:00:00.000Z") }
    );

    assert.equal(status.status, "prepared");
    assert.equal(status.id, "job-1");
    assert.equal(status.cwd, cwd);
    assert.equal(
      await fs.readFile(path.join(jobsRoot, "job-1", "prompt.md"), "utf8"),
      "Implement the bounded thing."
    );
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(jobsRoot, "job-1", "status.json"), "utf8")), status);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background job default root follows project task state", () => {
  assert.equal(
    defaultJobsRoot({
      instanceConfig: {
        projectTasksPath: "/tmp/instance/tasks/projects/sable/TODO.md",
      },
    }),
    "/tmp/instance/tasks/projects/sable/background-jobs"
  );
});

test("background job list formatting is compact", () => {
  assert.equal(formatJobList([]), "No background jobs.");
  assert.equal(
    formatJobList([{ id: "job-1", status: "running", name: "Batch 1", cwd: "/tmp/work" }]),
    "job-1 [running] Batch 1 /tmp/work"
  );
});
