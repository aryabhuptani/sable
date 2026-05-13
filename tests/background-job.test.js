const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildRunnerConfig,
  createJobId,
  defaultJobsRoot,
  defaultWorktreeDir,
  extractClaudeResult,
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

test("background job parser supports Claude runner options", () => {
  const options = parseArgs([
    "start",
    "--name",
    "HTML polish",
    "--cwd",
    "/tmp",
    "--prompt",
    "make the page less cursed",
    "--runner",
    "claude",
    "--runner-bin",
    "/opt/bin/claude",
    "--runner-home",
    "/tmp/claude-home",
    "--permission-mode",
    "acceptEdits",
    "--allowed-tools",
    "Read,Edit,Bash(git diff *)",
    "--output-format",
    "json",
    "--dry-run",
  ]);

  assert.equal(options.runner, "claude");
  assert.equal(options.runnerBin, "/opt/bin/claude");
  assert.equal(options.runnerHome, "/tmp/claude-home");
  assert.equal(options.permissionMode, "acceptEdits");
  assert.equal(options.allowedTools, "Read,Edit,Bash(git diff *)");
  assert.equal(options.outputFormat, "json");
});

test("background job runner config preserves Codex defaults and supports Claude", () => {
  assert.deepEqual(
    buildRunnerConfig({
      codex: "codex-custom",
      codexHome: "/tmp/codex-home",
      model: "gpt-5.5",
      runner: "codex",
    }),
    {
      bin: "codex-custom",
      home: "/tmp/codex-home",
      model: "gpt-5.5",
      type: "codex",
    }
  );

  assert.deepEqual(
    buildRunnerConfig({
      allowedTools: "Read,Edit",
      claude: "claude-custom",
      claudeHome: "/tmp/claude-home",
      outputFormat: "json",
      permissionMode: "acceptEdits",
      runner: "claude",
    }),
    {
      allowedTools: "Read,Edit",
      bin: "claude-custom",
      disallowedTools: "",
      home: "/tmp/claude-home",
      model: "",
      outputFormat: "json",
      permissionMode: "acceptEdits",
      type: "claude",
    }
  );
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

test("background job dry-run records Claude runner metadata", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const cwd = path.join(tempDir, "workspace");
  const jobsRoot = path.join(tempDir, "jobs");
  await fs.mkdir(cwd);

  try {
    const status = await startJob(
      {
        allowedTools: "Read,Edit",
        callbackCommand: "",
        claude: "claude-custom",
        claudeHome: path.join(tempDir, "claude-home"),
        command: "start",
        cwd,
        dryRun: true,
        id: "job-claude",
        jobsRoot,
        model: "sonnet",
        name: "Claude Job",
        outputFormat: "json",
        permissionMode: "acceptEdits",
        prompt: "Implement the bounded thing.",
        promptFile: "",
        runner: "claude",
      },
      { now: new Date("2026-05-07T12:00:00.000Z") }
    );

    assert.equal(status.status, "prepared");
    assert.equal(status.runner, "claude");
    assert.equal(status.runnerBin, "claude-custom");
    assert.equal(status.runnerHome, path.join(tempDir, "claude-home"));
    assert.equal(status.permissionMode, "acceptEdits");
    assert.equal(status.allowedTools, "Read,Edit");
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

test("background job run-worker writes completion state and invokes callback", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const cwd = path.join(tempDir, "workspace");
  const codexHome = path.join(tempDir, "codex-home");
  const jobsRoot = path.join(tempDir, "jobs");
  const jobDir = path.join(jobsRoot, "job-1");
  const callbackOutput = path.join(tempDir, "callback.json");
  const fakeCodex = path.join(tempDir, "fake-codex.js");
  const callbackScript = path.join(tempDir, "callback.js");
  const harness = path.join(__dirname, "..", "tools", "background-job", "background-job.js");

  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputPath = args[args.indexOf('-o') + 1];",
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  fs.writeFileSync(outputPath, `worker saw: ${input.trim()}\\n`);",
      "  console.log(JSON.stringify({ type: 'complete' }));",
      "});",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  await fs.writeFile(
    callbackScript,
    [
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.argv[2], JSON.stringify({",
      "  id: process.env.SABLE_BACKGROUND_JOB_ID,",
      "  status: process.env.SABLE_BACKGROUND_JOB_STATUS,",
      "  lastMessage: fs.readFileSync(process.env.SABLE_BACKGROUND_JOB_LAST_MESSAGE, 'utf8').trim(),",
      "}));",
      "",
    ].join("\n")
  );
  await fs.writeFile(path.join(jobDir, "prompt.md"), "Implement the bounded thing.", "utf8");
  await fs.writeFile(
    path.join(jobDir, "status.json"),
    `${JSON.stringify(
      {
        id: "job-1",
        name: "Job One",
        cwd,
        callbackCommand: `${process.execPath} ${callbackScript} ${callbackOutput}`,
        codex: fakeCodex,
        codexHome,
        createdAt: "2026-05-08T00:00:00.000Z",
        dryRun: false,
        jobDir,
        model: "",
        pid: 12345,
        status: "running",
        updatedAt: "2026-05-08T00:00:00.000Z",
        worktree: null,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    execFileSync(process.execPath, [
      harness,
      "run-worker",
      "--jobs-root",
      jobsRoot,
      "--id",
      "job-1",
      "--codex",
      fakeCodex,
      "--codex-home",
      codexHome,
    ]);

    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    assert.equal(status.status, "completed");
    assert.equal(status.exitCode, 0);
    assert.equal(status.callbackExitCode, 0);
    assert.equal(await fs.readFile(path.join(jobDir, "last-message.md"), "utf8"), "worker saw: Implement the bounded thing.\n");
    assert.match(await fs.readFile(path.join(jobDir, "stdout.jsonl"), "utf8"), /"type":"complete"/);
    assert.deepEqual(JSON.parse(await fs.readFile(callbackOutput, "utf8")), {
      id: "job-1",
      status: "completed",
      lastMessage: "worker saw: Implement the bounded thing.",
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background job Claude run-worker parses JSON result into last message", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const cwd = path.join(tempDir, "workspace");
  const claudeHome = path.join(tempDir, "claude-home");
  const jobsRoot = path.join(tempDir, "jobs");
  const jobDir = path.join(jobsRoot, "job-claude");
  const fakeClaude = path.join(tempDir, "fake-claude.js");
  const capturePath = path.join(tempDir, "claude-capture.json");
  const harness = path.join(__dirname, "..", "tools", "background-job", "background-job.js");

  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(claudeHome, { recursive: true });
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  fs.writeFileSync(process.env.FAKE_CLAUDE_CAPTURE, JSON.stringify({",
      "    args: process.argv.slice(2),",
      "    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,",
      "    input: input.trim(),",
      "  }));",
      "  console.log(JSON.stringify({ result: `claude saw: ${input.trim()}` }));",
      "});",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  await fs.writeFile(path.join(jobDir, "prompt.md"), "Build the pretty thing.", "utf8");
  await fs.writeFile(
    path.join(jobDir, "status.json"),
    `${JSON.stringify(
      {
        id: "job-claude",
        name: "Claude Job",
        cwd,
        callbackCommand: "",
        claude: fakeClaude,
        claudeHome,
        createdAt: "2026-05-08T00:00:00.000Z",
        dryRun: false,
        jobDir,
        model: "",
        outputFormat: "json",
        permissionMode: "acceptEdits",
        pid: 12345,
        runner: "claude",
        runnerBin: fakeClaude,
        runnerHome: claudeHome,
        status: "running",
        updatedAt: "2026-05-08T00:00:00.000Z",
        worktree: null,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    execFileSync(
      process.execPath,
      [
        harness,
        "run-worker",
        "--jobs-root",
        jobsRoot,
        "--id",
        "job-claude",
        "--runner",
        "claude",
        "--runner-bin",
        fakeClaude,
        "--runner-home",
        claudeHome,
      ],
      { env: { ...process.env, FAKE_CLAUDE_CAPTURE: capturePath } }
    );

    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    const capture = JSON.parse(await fs.readFile(capturePath, "utf8"));
    assert.equal(status.status, "completed");
    assert.equal(status.runner, "claude");
    assert.equal(status.exitCode, 0);
    assert.equal(capture.claudeConfigDir, claudeHome);
    assert.ok(capture.args.includes("-p"));
    assert.match(capture.input, /Build the pretty thing/);
    assert.equal(
      await fs.readFile(path.join(jobDir, "last-message.md"), "utf8"),
      "claude saw: Build the pretty thing.\n"
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background job run-worker records missing runner binary as failed", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const cwd = path.join(tempDir, "workspace");
  const jobsRoot = path.join(tempDir, "jobs");
  const jobDir = path.join(jobsRoot, "job-missing-runner");
  const missingRunner = path.join(tempDir, "missing-claude");
  const harness = path.join(__dirname, "..", "tools", "background-job", "background-job.js");

  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "prompt.md"), "Build the pretty thing.", "utf8");
  await fs.writeFile(
    path.join(jobDir, "status.json"),
    `${JSON.stringify(
      {
        id: "job-missing-runner",
        name: "Missing Runner Job",
        cwd,
        callbackCommand: "",
        claude: missingRunner,
        claudeHome: path.join(tempDir, "claude-home"),
        createdAt: "2026-05-08T00:00:00.000Z",
        dryRun: false,
        jobDir,
        model: "",
        outputFormat: "json",
        permissionMode: "acceptEdits",
        pid: 12345,
        runner: "claude",
        runnerBin: missingRunner,
        runnerHome: path.join(tempDir, "claude-home"),
        status: "running",
        updatedAt: "2026-05-08T00:00:00.000Z",
        worktree: null,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    execFileSync(process.execPath, [
      harness,
      "run-worker",
      "--jobs-root",
      jobsRoot,
      "--id",
      "job-missing-runner",
      "--runner",
      "claude",
      "--runner-bin",
      missingRunner,
    ]);

    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    assert.equal(status.status, "failed");
    assert.equal(status.exitCode, 1);
    assert.match(status.error, /ENOENT/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("background job stop tolerates already-exited worker pid", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const jobsRoot = path.join(tempDir, "jobs");
  const jobDir = path.join(jobsRoot, "job-stale");
  const harness = path.join(__dirname, "..", "tools", "background-job", "background-job.js");
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    path.join(jobDir, "status.json"),
    `${JSON.stringify(
      {
        id: "job-stale",
        name: "Stale Job",
        cwd: tempDir,
        jobDir,
        pid: 99999999,
        status: "running",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    execFileSync(process.execPath, [harness, "stop", "--jobs-root", jobsRoot, "--id", "job-stale"]);
    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    assert.equal(status.status, "stopping");
    assert.match(status.stopError, /kill ESRCH/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("extractClaudeResult supports json, stream json, and plain text", () => {
  assert.equal(extractClaudeResult(JSON.stringify({ result: "final" })), "final");
  assert.equal(
    extractClaudeResult(`${JSON.stringify({ type: "assistant", text: "draft" })}\n${JSON.stringify({ result: "done" })}`),
    "done"
  );
  assert.equal(extractClaudeResult("plain final"), "plain final");
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
    "job-1 [running:codex] Batch 1 /tmp/work"
  );
});
