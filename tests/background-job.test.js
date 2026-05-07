const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createJobId,
  defaultJobsRoot,
  defaultWorktreeDir,
  formatJobList,
  parseArgs,
  resolveWorktreePlan,
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

test("background job parser supports isolated worktree options and callbacks", () => {
  const options = parseArgs([
    "start",
    "--name",
    "Batch 1",
    "--worktree-from",
    "/tmp/source",
    "--worktree-branch",
    "bg/batch-1",
    "--worktree-dir",
    "/tmp/worktree",
    "--worktree-base",
    "main",
    "--callback-command",
    "npm run background-job -- report --id $SABLE_BACKGROUND_JOB_ID",
    "--prompt",
    "do work",
  ]);

  assert.equal(options.worktreeFrom, "/tmp/source");
  assert.equal(options.worktreeBranch, "bg/batch-1");
  assert.equal(options.worktreeDir, "/tmp/worktree");
  assert.equal(options.worktreeBase, "main");
  assert.match(options.callbackCommand, /background-job/);
});

test("background job ids are timestamped and slugged", () => {
  assert.equal(
    createJobId("Darkbloom Simulator Batch 1", new Date("2026-05-07T12:34:56.000Z")),
    "20260507123456-darkbloom-simulator-batch-1"
  );
});

test("background job worktree paths are deterministic beside the source repo", () => {
  assert.equal(
    defaultWorktreeDir("/home/arya/projects/sable", "job-1"),
    "/home/arya/projects/sable-worktrees/job-1"
  );
  assert.deepEqual(resolveWorktreePlan({ worktreeFrom: "/repo/sable", worktreeBase: "main" }, "job-1"), {
    base: "main",
    branch: "bg/job-1",
    path: "/repo/sable-worktrees/job-1",
    sourceRepo: "/repo/sable",
  });
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

test("background job dry-run can prepare an isolated worktree job without creating the worktree", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const sourceRepo = path.join(tempDir, "source");
  const worktreeDir = path.join(tempDir, "worktree");
  const jobsRoot = path.join(tempDir, "jobs");
  await fs.mkdir(sourceRepo);

  try {
    const status = await startJob(
      {
        callbackCommand: "echo done",
        codex: "codex",
        codexHome: path.join(tempDir, "codex-home"),
        command: "start",
        cwd: "",
        dryRun: true,
        id: "job-1",
        jobsRoot,
        model: "",
        name: "Job One",
        prompt: "Implement the bounded thing.",
        promptFile: "",
        worktreeBase: "main",
        worktreeBranch: "bg/job-1",
        worktreeDir,
        worktreeFrom: sourceRepo,
      },
      { now: new Date("2026-05-07T12:00:00.000Z") }
    );

    assert.equal(status.status, "prepared");
    assert.equal(status.cwd, worktreeDir);
    assert.equal(status.callbackCommand, "echo done");
    assert.deepEqual(status.worktree, {
      base: "main",
      branch: "bg/job-1",
      path: worktreeDir,
      sourceRepo,
    });
    await assert.rejects(fs.stat(worktreeDir), /ENOENT/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background job start can create a real git worktree before launching worker", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const sourceRepo = path.join(tempDir, "source");
  const worktreeDir = path.join(tempDir, "worktree");
  const jobsRoot = path.join(tempDir, "jobs");
  await fs.mkdir(sourceRepo);

  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: sourceRepo, stdio: "ignore" });
    await fs.writeFile(path.join(sourceRepo, "README.md"), "# fixture\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: sourceRepo, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-m", "init"],
      { cwd: sourceRepo, stdio: "ignore" }
    );

    const status = await startJob(
      {
        callbackCommand: "",
        codex: "codex",
        codexHome: path.join(tempDir, "codex-home"),
        command: "start",
        cwd: "",
        dryRun: false,
        id: "job-1",
        jobsRoot,
        model: "",
        name: "Job One",
        prompt: "Implement the bounded thing.",
        promptFile: "",
        worktreeBase: "main",
        worktreeBranch: "bg/job-1",
        worktreeDir,
        worktreeFrom: sourceRepo,
      },
      {
        now: new Date("2026-05-07T12:00:00.000Z"),
        spawnFn: () => ({ pid: 12345, unref() {} }),
      }
    );

    assert.equal(status.cwd, worktreeDir);
    assert.equal(status.status, "running");
    assert.equal(await fs.readFile(path.join(worktreeDir, "README.md"), "utf8"), "# fixture\n");
    assert.match(execFileSync("git", ["-C", worktreeDir, "branch", "--show-current"], { encoding: "utf8" }), /bg\/job-1/);
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
