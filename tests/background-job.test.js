const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildRunnerConfig,
  buildRunnerInvocation,
  controlJob,
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

test("background job parser supports run-kernel metadata", () => {
  const options = parseArgs([
    "start",
    "--name",
    "Nightly research",
    "--cwd",
    "/tmp",
    "--prompt",
    "collect evidence",
    "--agent-profile",
    "research",
    "--trigger",
    "scheduled",
    "--visibility",
    "silent",
    "--delivery",
    "none",
    "--recipient",
    "+15551112222",
    "--risk-tier",
    "1",
  ]);

  assert.equal(options.agentProfile, "research");
  assert.equal(options.trigger, "scheduled");
  assert.equal(options.visibility, "silent");
  assert.equal(options.delivery, "none");
  assert.equal(options.recipient, "+15551112222");
  assert.equal(options.riskTier, 1);
  assert.throws(
    () => parseArgs(["start", "--risk-tier", "6"]),
    /Expected an integer from 0 to 5/
  );
});

test("background job parser supports run control options", () => {
  const options = parseArgs([
    "control",
    "--id",
    "job-1",
    "--action",
    "steer",
    "--instruction",
    "Try the narrower eval first.",
  ]);

  assert.equal(options.command, "control");
  assert.equal(options.id, "job-1");
  assert.equal(options.action, "steer");
  assert.equal(options.instruction, "Try the narrower eval first.");
});

test("background job parser applies agent profile defaults", () => {
  const expected = {
    orchestrator: ["callback", "final_only", "signal", 1],
    personal: ["manual", "interactive", "signal", 3],
    coding: ["manual", "milestones", "orchestrator_only", 2],
    research: ["manual", "final_only", "orchestrator_only", 1],
    work: ["manual", "final_only", "orchestrator_only", 1],
  };

  for (const [agentProfile, [trigger, visibility, delivery, riskTier]] of Object.entries(expected)) {
    const options = parseArgs(["start", "--agent-profile", agentProfile]);
    assert.deepEqual(
      {
        agentProfile: options.agentProfile,
        trigger: options.trigger,
        visibility: options.visibility,
        delivery: options.delivery,
        riskTier: options.riskTier,
      },
      { agentProfile, trigger, visibility, delivery, riskTier }
    );
  }

  assert.throws(
    () => parseArgs(["start", "--agent-profile", "finance"]),
    /Unsupported --agent-profile: finance.*orchestrator, personal, coding, research, work/
  );
});

test("background job parser accepts legacy ops as personal", () => {
  const options = parseArgs(["start", "--agent-profile", "ops"]);
  assert.equal(options.agentProfile, "personal");
});

test("explicit metadata flags override agent profile defaults", () => {
  const options = parseArgs([
    "start",
    "--agent-profile",
    "personal",
    "--trigger",
    "scheduled",
    "--visibility",
    "silent",
    "--delivery",
    "none",
    "--risk-tier",
    "1",
  ]);

  assert.deepEqual(
    {
      agentProfile: options.agentProfile,
      trigger: options.trigger,
      visibility: options.visibility,
      delivery: options.delivery,
      riskTier: options.riskTier,
    },
    {
      agentProfile: "personal",
      trigger: "scheduled",
      visibility: "silent",
      delivery: "none",
      riskTier: 1,
    }
  );
});

test("background job profiles command lists configured domains", () => {
  const output = execFileSync(process.execPath, [
    path.join(__dirname, "..", "tools", "background-job", "background-job.js"),
    "profiles",
  ], { encoding: "utf8" });
  assert.match(output, /orchestrator\s+callback\s+final_only\s+signal\s+1/);
  assert.match(output, /coding\s+manual\s+milestones\s+orchestrator_only\s+2/);
  assert.match(output, /work\s+manual\s+final_only\s+orchestrator_only\s+1/);
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

test("background job Codex runner uses the same full-access bypass flags as the bridge", () => {
  const invocation = buildRunnerInvocation(
    {
      bin: "codex",
      home: "/tmp/codex-home",
      model: "",
      type: "codex",
    },
    {
      cwd: "/tmp/workspace",
    },
    {
      lastMessagePath: "/tmp/job/last-message.md",
    }
  );

  assert.equal(invocation.bin, "codex");
  assert.equal(invocation.env.CODEX_HOME, "/tmp/codex-home");
  assert.deepEqual(invocation.args, [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "--cd",
    "/tmp/workspace",
    "-o",
    "/tmp/job/last-message.md",
    "-",
  ]);
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
        agentProfile: "coding",
        trigger: "manual",
        visibility: "milestones",
        delivery: "orchestrator_only",
        riskTier: 2,
        recipient: "+15551112222",
      },
      { now: new Date("2026-05-07T12:00:00.000Z") }
    );

    assert.equal(status.status, "prepared");
    assert.equal(status.id, "job-1");
    assert.equal(status.cwd, cwd);
    assert.equal(status.runId, "job-1");
    assert.equal(status.agentProfile, "coding");
    assert.equal(status.visibility, "milestones");
    assert.equal(
      await fs.readFile(path.join(jobsRoot, "job-1", "prompt.md"), "utf8"),
      "Implement the bounded thing."
    );
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(jobsRoot, "job-1", "status.json"), "utf8")), status);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(jobsRoot, "job-1", "run.json"), "utf8")),
      {
        parent_run_id: null,
        phase: "prepared",
        public_summary: "",
        next_action: "",
        artifacts: [],
        last_callback_at: null,
        final_summary: null,
        controls: [],
        run_id: "job-1",
        agent_profile: "coding",
        goal: "Job One",
        trigger: "manual",
        visibility: "milestones",
        delivery: "orchestrator_only",
        risk_tier: 2,
        risk_tier_description: "Make reversible changes inside assigned workspace.",
        status: "queued",
        created_at: "2026-05-07T12:00:00.000Z",
        harness: "codex",
        model: "",
        background_job_id: "job-1",
        background_job_status_path: path.join(jobsRoot, "job-1", "status.json"),
        signal_recipient: "+15551112222",
        updated_at: "2026-05-07T12:00:00.000Z",
      }
    );
    assert.equal(await fs.readFile(path.join(jobsRoot, "job-1", "events.jsonl"), "utf8"), "");
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
  const runnerEnvOutput = path.join(tempDir, "runner-env.json");
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
      "  fs.writeFileSync(process.env.SABLE_TEST_RUNNER_ENV_OUTPUT, JSON.stringify({ checkpoint: process.env.SABLE_RUN_CHECKPOINT, update: process.env.SABLE_RUN_UPDATE }));",
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
      "  runId: process.env.SABLE_RUN_ID,",
      "  runPath: process.env.SABLE_RUN_PATH,",
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
    ], { env: { ...process.env, SABLE_TEST_RUNNER_ENV_OUTPUT: runnerEnvOutput } });

    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    assert.equal(status.status, "completed");
    assert.equal(status.exitCode, 0);
    assert.equal(status.callbackExitCode, 0);
    const lastMessage = await fs.readFile(path.join(jobDir, "last-message.md"), "utf8");
    assert.match(lastMessage, /^worker saw: \[Sable domain task packet v0\]/);
    assert.match(lastMessage, /Role: coding - Implements and verifies bounded software changes\./);
    assert.match(lastMessage, /visibility=milestones; delivery=orchestrator_only; risk=2/);
    assert.ok(lastMessage.endsWith("\n\nImplement the bounded thing.\n"));
    assert.match(await fs.readFile(path.join(jobDir, "stdout.jsonl"), "utf8"), /"type":"complete"/);
    assert.deepEqual(JSON.parse(await fs.readFile(callbackOutput, "utf8")), {
      id: "job-1",
      status: "completed",
      runId: "job-1",
      runPath: path.join(jobDir, "run.json"),
      lastMessage: lastMessage.trim(),
    });
    const runnerEnv = JSON.parse(await fs.readFile(runnerEnvOutput, "utf8"));
    assert.match(runnerEnv.checkpoint, /run-checkpoint\.js.*--run-dir/);
    assert.match(runnerEnv.update, /run-update\.js.*--run-dir/);
    const run = JSON.parse(await fs.readFile(path.join(jobDir, "run.json"), "utf8"));
    const events = (await fs.readFile(path.join(jobDir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(run.run_id, "job-1");
    assert.equal(run.status, "completed");
    assert.equal(run.phase, "completed");
    assert.equal(run.final_summary, lastMessage.trim());
    assert.ok(run.last_callback_at);
    assert.deepEqual(events.map((event) => event.type), ["started", "completed", "callback"]);
    assert.ok(events.every((event) => event.run_id === "job-1"));
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
      "    agentProfile: process.env.SABLE_AGENT_PROFILE,",
      "    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,",
      "    delivery: process.env.SABLE_RUN_DELIVERY,",
      "    input: input.trim(),",
      "    riskTier: process.env.SABLE_RUN_RISK_TIER,",
      "    taskPacketVersion: process.env.SABLE_TASK_PACKET_VERSION,",
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
    assert.equal(capture.agentProfile, "coding");
    assert.equal(capture.delivery, "orchestrator_only");
    assert.equal(capture.riskTier, "2");
    assert.equal(capture.taskPacketVersion, "v0");
    assert.ok(capture.args.includes("-p"));
    assert.match(capture.input, /^\[Sable domain task packet v0\]/);
    assert.ok(capture.input.endsWith("\n\nBuild the pretty thing."));
    const lastMessage = await fs.readFile(path.join(jobDir, "last-message.md"), "utf8");
    assert.match(lastMessage, /^claude saw: \[Sable domain task packet v0\]/);
    assert.ok(lastMessage.endsWith("\n\nBuild the pretty thing.\n"));
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
    const run = JSON.parse(await fs.readFile(path.join(jobDir, "run.json"), "utf8"));
    const events = (await fs.readFile(path.join(jobDir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(run.status, "failed");
    assert.match(run.final_summary, /ENOENT/);
    assert.deepEqual(events.map((event) => event.type), ["started", "failed", "callback"]);
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

test("background job stop does not rewrite terminal jobs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const jobsRoot = path.join(tempDir, "jobs");
  const jobDir = path.join(jobsRoot, "job-done");
  const harness = path.join(__dirname, "..", "tools", "background-job", "background-job.js");
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    path.join(jobDir, "status.json"),
    `${JSON.stringify(
      {
        completedAt: "2026-05-08T00:01:00.000Z",
        id: "job-done",
        name: "Done Job",
        cwd: tempDir,
        jobDir,
        pid: 99999999,
        status: "completed",
        updatedAt: "2026-05-08T00:01:00.000Z",
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    execFileSync(process.execPath, [harness, "stop", "--jobs-root", jobsRoot, "--id", "job-done"]);
    const status = JSON.parse(await fs.readFile(path.join(jobDir, "status.json"), "utf8"));
    assert.equal(status.status, "completed");
    assert.equal(status.updatedAt, "2026-05-08T00:01:00.000Z");
    assert.equal(status.stopError, undefined);
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

test("background job control writes run controls through the run kernel", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-background-job-"));
  const cwd = path.join(tempDir, "workspace");
  const jobsRoot = path.join(tempDir, "jobs");
  await fs.mkdir(cwd, { recursive: true });

  try {
    await startJob({
      ...parseArgs([
        "start",
        "--id",
        "job-control",
        "--name",
        "Control Job",
        "--cwd",
        cwd,
        "--prompt",
        "Wait for steering.",
        "--jobs-root",
        jobsRoot,
        "--dry-run",
      ]),
    });

    const run = await controlJob({
      ...parseArgs([
        "control",
        "--id",
        "job-control",
        "--action",
        "steer",
        "--instruction",
        "Use the isolated eval runner.",
        "--jobs-root",
        jobsRoot,
      ]),
    });

    assert.equal(run.next_action, "Steering queued: Use the isolated eval runner.");
    assert.deepEqual(run.controls.map((control) => control.action), ["steer"]);
    assert.deepEqual(run.controls.map((control) => control.actor), ["background-job-cli"]);
    const controlFile = JSON.parse(await fs.readFile(path.join(jobsRoot, "job-control", "control.json"), "utf8"));
    assert.equal(controlFile.controls[0].instruction, "Use the isolated eval runner.");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
