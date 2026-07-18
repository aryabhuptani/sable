#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const { createInstanceConfig } = require("../instance/instance-config");
const { formatAgentProfiles, getAgentProfile } = require("../runtime/agent-profiles");
const {
  agentTaskPacketEnv,
  buildAgentTaskPacket,
  prependAgentTaskPreamble,
} = require("../runtime/agent-task-packet");
const { handleRunCallback } = require("../runtime/run-callback");
const {
  formatSummary: formatWatchdogSummary,
  scanRuns: scanWatchdogRuns,
} = require("../runtime/run-watchdog");
const {
  createBackgroundJobRunStore,
  createRun,
  describeRiskTier,
  readRun,
  readRunCheckpoint,
  runPaths,
  transitionRun,
  updateRun,
  validateRiskTier,
} = require("../runtime/run-kernel");

const DEFAULT_RECENT_LOG_LINES = 80;
const DEFAULT_CLAUDE_PERMISSION_MODE = "acceptEdits";
const DEFAULT_CLAUDE_OUTPUT_FORMAT = "json";
const DEFAULT_AGENT_PROFILE = "coding";
const TRIGGERS = new Set(["manual", "scheduled", "callback", "autonomous"]);
const VISIBILITIES = new Set(["silent", "final_only", "milestones", "interactive"]);
const DELIVERIES = new Set(["none", "orchestrator_only", "signal"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "stopped"]);

function parseArgs(argv) {
  const first = argv[0] || "list";
  const options = {
    command: first === "--help" || first === "-h" ? "help" : first,
    name: "",
    id: "",
    cwd: "",
    prompt: "",
    promptFile: "",
    jobsRoot: "",
    dryRun: false,
    fix: false,
    runner: process.env.SABLE_BACKGROUND_RUNNER || "codex",
    runnerBin: "",
    runnerHome: "",
    codex: process.env.CODEX_BIN || "codex",
    codexHome: process.env.CODEX_HOME || defaultCodexHome(),
    claude: process.env.CLAUDE_BIN || "claude",
    claudeHome: process.env.CLAUDE_CONFIG_DIR || defaultClaudeHome(),
    callbackCommand: "",
    agentProfile: DEFAULT_AGENT_PROFILE,
    trigger: undefined,
    visibility: undefined,
    delivery: undefined,
    riskTier: undefined,
    model: "",
    permissionMode: process.env.SABLE_BACKGROUND_CLAUDE_PERMISSION_MODE || DEFAULT_CLAUDE_PERMISSION_MODE,
    allowedTools: process.env.SABLE_BACKGROUND_CLAUDE_ALLOWED_TOOLS || "",
    disallowedTools: process.env.SABLE_BACKGROUND_CLAUDE_DISALLOWED_TOOLS || "",
    outputFormat: process.env.SABLE_BACKGROUND_CLAUDE_OUTPUT_FORMAT || DEFAULT_CLAUDE_OUTPUT_FORMAT,
    recentLines: DEFAULT_RECENT_LOG_LINES,
    olderThanMinutes: undefined,
    watchdogFormat: "text",
    worktreeBase: "HEAD",
    worktreeBranch: "",
    worktreeDir: "",
    worktreeFrom: "",
    action: "",
    instruction: "",
  };

  for (let index = options.command === "help" ? 0 : 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--name") {
      options.name = argv[++index] || "";
    } else if (arg === "--id" || arg === "--job") {
      options.id = argv[++index] || "";
    } else if (arg === "--cwd") {
      options.cwd = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--prompt") {
      options.prompt = argv[++index] || "";
    } else if (arg === "--prompt-file") {
      options.promptFile = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--jobs-root") {
      options.jobsRoot = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--runner") {
      options.runner = argv[++index] || options.runner;
    } else if (arg === "--runner-bin") {
      options.runnerBin = argv[++index] || "";
    } else if (arg === "--runner-home") {
      options.runnerHome = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--codex") {
      options.codex = argv[++index] || options.codex;
    } else if (arg === "--codex-home") {
      options.codexHome = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--claude") {
      options.claude = argv[++index] || options.claude;
    } else if (arg === "--claude-home" || arg === "--claude-config-dir") {
      options.claudeHome = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--callback-command") {
      options.callbackCommand = argv[++index] || "";
    } else if (arg === "--agent-profile") {
      options.agentProfile = argv[++index] || "";
    } else if (arg === "--trigger") {
      options.trigger = argv[++index] || "";
    } else if (arg === "--visibility") {
      options.visibility = argv[++index] || "";
    } else if (arg === "--delivery") {
      options.delivery = argv[++index] || "";
    } else if (arg === "--risk-tier") {
      options.riskTier = parseRiskTier(argv[++index]);
    } else if (arg === "--model") {
      options.model = argv[++index] || "";
    } else if (arg === "--permission-mode") {
      options.permissionMode = argv[++index] || options.permissionMode;
    } else if (arg === "--allowed-tools") {
      options.allowedTools = argv[++index] || "";
    } else if (arg === "--disallowed-tools") {
      options.disallowedTools = argv[++index] || "";
    } else if (arg === "--output-format") {
      options.outputFormat = argv[++index] || options.outputFormat;
    } else if (arg === "--action") {
      options.action = argv[++index] || "";
    } else if (arg === "--instruction") {
      options.instruction = argv[++index] || "";
    } else if (arg === "--recent-lines") {
      options.recentLines = parsePositiveInteger(argv[++index], DEFAULT_RECENT_LOG_LINES);
    } else if (arg === "--worktree-from") {
      options.worktreeFrom = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--worktree-branch") {
      options.worktreeBranch = argv[++index] || "";
    } else if (arg === "--worktree-dir") {
      options.worktreeDir = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--worktree-base") {
      options.worktreeBase = argv[++index] || "HEAD";
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--fix") {
      options.fix = true;
    } else if (arg === "--older-than-minutes") {
      options.olderThanMinutes = parsePositiveNumber(argv[++index], "--older-than-minutes");
    } else if (arg === "--json") {
      options.watchdogFormat = "json";
    } else if (arg === "--text") {
      options.watchdogFormat = "text";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  Object.assign(options, normalizeRunMetadata(options));

  return options;
}

function normalizeChoice(name, value, allowed) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error(`Unsupported --${name}: ${value}. Expected one of: ${[...allowed].join(", ")}.`);
  }
  return normalized;
}

function parseRiskTier(value) {
  return validateRiskTier(value, { name: "--risk-tier" });
}

function defaultCodexHome({ env = process.env } = {}) {
  return path.join(createInstanceConfig({ env }).homeDir, ".codex-bridge");
}

function defaultClaudeHome({ env = process.env } = {}) {
  return path.join(createInstanceConfig({ env }).homeDir, ".claude");
}

function normalizeRunner(value) {
  const runner = String(value || "codex").trim().toLowerCase();
  if (!["codex", "claude"].includes(runner)) {
    throw new Error(`Unsupported background job runner: ${value}`);
  }
  return runner;
}

function buildRunnerConfig(options = {}, job = {}) {
  const runner = normalizeRunner(options.runner || job.runner || "codex");
  if (runner === "claude") {
    return {
      type: "claude",
      bin: options.runnerBin || options.claude || job.runnerBin || job.claude || "claude",
      home:
        options.runnerHome ||
        options.claudeHome ||
        job.runnerHome ||
        job.claudeHome ||
        defaultClaudeHome(),
      model: options.model || job.model || "",
      permissionMode:
        options.permissionMode ||
        job.permissionMode ||
        DEFAULT_CLAUDE_PERMISSION_MODE,
      allowedTools: options.allowedTools || job.allowedTools || "",
      disallowedTools: options.disallowedTools || job.disallowedTools || "",
      outputFormat: options.outputFormat || job.outputFormat || DEFAULT_CLAUDE_OUTPUT_FORMAT,
    };
  }
  return {
    type: "codex",
    bin: options.runnerBin || options.codex || job.runnerBin || job.codex || "codex",
    home: options.runnerHome || options.codexHome || job.runnerHome || job.codexHome || defaultCodexHome(),
    model: options.model || job.model || "",
  };
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function defaultJobsRoot({ env = process.env, instanceConfig } = {}) {
  const instance = instanceConfig || createInstanceConfig({ env });
  return path.join(instance.runsRoot || path.dirname(instance.projectTasksPath), "background-jobs");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function createJobId(name, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const slug = slugify(name) || "job";
  return `${stamp}-${slug}`;
}

function defaultWorktreeDir(sourceRepo, id) {
  const repoDir = path.resolve(sourceRepo);
  return path.join(path.dirname(repoDir), `${path.basename(repoDir)}-worktrees`, id);
}

function jobPaths(jobDir) {
  const run = runPaths(jobDir);
  return {
    controlPath: run.controlPath,
    eventsPath: run.eventsPath,
    jobDir,
    lastMessagePath: path.join(jobDir, "last-message.md"),
    promptPath: path.join(jobDir, "prompt.md"),
    runPath: run.runPath,
    statusPath: path.join(jobDir, "status.json"),
    stderrPath: path.join(jobDir, "stderr.log"),
    stdoutPath: path.join(jobDir, "stdout.jsonl"),
  };
}

async function readPrompt(options) {
  if (options.promptFile) {
    return fsp.readFile(options.promptFile, "utf8");
  }
  return String(options.prompt || "");
}

async function startJob(options, { now = new Date(), spawnFn = spawn } = {}) {
  if (!options.name) {
    throw new Error("start requires --name.");
  }
  if (!options.prompt && !options.promptFile) {
    throw new Error("start requires --prompt or --prompt-file.");
  }

  const jobsRoot = options.jobsRoot || defaultJobsRoot();
  const id = options.id || createJobId(options.name, now);
  const worktree = resolveWorktreePlan(options, id);
  const cwd = worktree ? worktree.path : options.cwd;
  if (!cwd) {
    throw new Error("start requires --cwd or --worktree-from. The harness does not assume a repo/workspace.");
  }
  if (options.cwd && options.worktreeFrom) {
    throw new Error("Use --cwd for an existing workspace or --worktree-from for an isolated worktree, not both.");
  }
  if (worktree) {
    if (!fs.existsSync(worktree.sourceRepo)) {
      throw new Error(`worktree source repo does not exist: ${worktree.sourceRepo}`);
    }
    if (!options.dryRun) {
      await createGitWorktree(worktree);
    }
  } else if (!fs.existsSync(cwd)) {
    throw new Error(`cwd does not exist: ${cwd}`);
  }

  const jobDir = path.join(jobsRoot, id);
  const paths = jobPaths(jobDir);
  const prompt = await readPrompt(options);
  if (!prompt.trim()) {
    throw new Error("background job prompt is empty.");
  }

  await fsp.mkdir(jobDir, { recursive: true });
  await fsp.writeFile(paths.promptPath, prompt, "utf8");
  const runnerConfig = buildRunnerConfig(options);
  const runMetadata = normalizeRunMetadata(options);

  const status = {
    id,
    name: options.name,
    cwd,
    callbackCommand: options.callbackCommand || "",
    codex: runnerConfig.type === "codex" ? runnerConfig.bin : options.codex || "",
    codexHome: runnerConfig.type === "codex" ? runnerConfig.home : options.codexHome || "",
    claude: runnerConfig.type === "claude" ? runnerConfig.bin : options.claude || "",
    claudeHome: runnerConfig.type === "claude" ? runnerConfig.home : options.claudeHome || "",
    createdAt: now.toISOString(),
    dryRun: Boolean(options.dryRun),
    jobDir,
    ...runMetadata,
    model: options.model || "",
    runner: runnerConfig.type,
    runnerBin: runnerConfig.bin,
    runnerHome: runnerConfig.home,
    permissionMode: runnerConfig.permissionMode || "",
    allowedTools: runnerConfig.allowedTools || "",
    disallowedTools: runnerConfig.disallowedTools || "",
    outputFormat: runnerConfig.outputFormat || "",
    pid: null,
    runEventsPath: paths.eventsPath,
    runId: id,
    runPath: paths.runPath,
    riskTierDescription: describeRiskTier(runMetadata.riskTier),
    status: options.dryRun ? "prepared" : "starting",
    updatedAt: now.toISOString(),
    worktree,
  };

  await writeStatus(paths.statusPath, status);
  await createBackgroundRun(status, paths, { now });
  if (options.dryRun) {
    return status;
  }

  const child = spawnFn(
    process.execPath,
    [
      __filename,
      "run-worker",
      "--jobs-root",
      jobsRoot,
      "--id",
      id,
      "--runner",
      runnerConfig.type,
      "--runner-bin",
      runnerConfig.bin,
      "--runner-home",
      runnerConfig.home,
      ...(runnerConfig.model ? ["--model", runnerConfig.model] : []),
      ...(runnerConfig.permissionMode ? ["--permission-mode", runnerConfig.permissionMode] : []),
      ...(runnerConfig.allowedTools ? ["--allowed-tools", runnerConfig.allowedTools] : []),
      ...(runnerConfig.disallowedTools ? ["--disallowed-tools", runnerConfig.disallowedTools] : []),
      ...(runnerConfig.outputFormat ? ["--output-format", runnerConfig.outputFormat] : []),
    ],
    {
      detached: true,
      env: process.env,
      stdio: "ignore",
    }
  );
  child.unref();

  status.pid = child.pid;
  status.status = "running";
  status.updatedAt = new Date().toISOString();
  await writeStatus(paths.statusPath, status);
  return status;
}

function resolveWorktreePlan(options, id) {
  if (!options.worktreeFrom) {
    return null;
  }
  const sourceRepo = path.resolve(options.worktreeFrom);
  const branch = options.worktreeBranch || `bg/${id}`;
  return {
    base: options.worktreeBase || "HEAD",
    branch,
    path: options.worktreeDir || defaultWorktreeDir(sourceRepo, id),
    sourceRepo,
  };
}

async function createGitWorktree(worktree, execFileFn = execFile) {
  await fsp.mkdir(path.dirname(worktree.path), { recursive: true });
  await new Promise((resolve, reject) => {
    execFileFn(
      "git",
      ["-C", worktree.sourceRepo, "worktree", "add", "-b", worktree.branch, worktree.path, worktree.base],
      (error, stdout, stderr) => {
        if (error) {
          error.message = [error.message, stdout, stderr].filter(Boolean).join("\n");
          reject(error);
          return;
        }
        resolve();
      }
    );
  });
}

async function runWorker(options) {
  const job = await loadJob(options);
  const paths = jobPaths(job.jobDir);
  const runnerConfig = buildRunnerConfig(options, job);
  const run = await ensureBackgroundRun(job, paths);
  const startedAt = new Date();
  await updateStatus(paths.statusPath, {
    startedAt: startedAt.toISOString(),
    runner: runnerConfig.type,
    runnerBin: runnerConfig.bin,
    runnerHome: runnerConfig.home,
    status: "running",
    workerPid: process.pid,
  });
  await transitionRun(
    job.jobDir,
    {
      phase: "running",
      started_at: startedAt.toISOString(),
      status: "running",
      public_summary: "Background worker started.",
      next_action: "Run the configured agent harness.",
    },
    {
      type: "started",
      summary: `Background worker started with ${runnerConfig.type}.`,
      payload: { harness: runnerConfig.type, worker_pid: process.pid },
    },
    { now: startedAt }
  );

  const stdout = fs.openSync(paths.stdoutPath, "a");
  const stderr = fs.openSync(paths.stderrPath, "a");
  const invocation = buildRunnerInvocation(runnerConfig, job, paths);
  const prompt = await fsp.readFile(paths.promptPath, "utf8");
  const taskPacket = buildAgentTaskPacket({ job, run, status: job });
  const childPrompt = prependAgentTaskPreamble(prompt, taskPacket);

  const child = spawn(invocation.bin, invocation.args, {
    cwd: job.cwd,
    env: {
      ...process.env,
      ...invocation.env,
      ...agentTaskPacketEnv(taskPacket),
      SABLE_RUN_CHECKPOINT: `${process.execPath} ${shellQuote(path.join(__dirname, "..", "runtime", "run-checkpoint.js"))} --run-dir ${shellQuote(job.jobDir)}`,
      SABLE_RUN_UPDATE: `${process.execPath} ${shellQuote(path.join(__dirname, "..", "runtime", "run-update.js"))} --run-dir ${shellQuote(job.jobDir)}`,
      SABLE_RUN_CONTROL_PATH: paths.controlPath,
      SABLE_RUN_EVENTS_PATH: paths.eventsPath,
      SABLE_RUN_ID: job.runId || job.id,
      SABLE_RUN_PATH: paths.runPath,
    },
    stdio: ["pipe", stdout, stderr],
  });

  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", (error) => resolve({ code: 1, error: error.message, signal: null }));
  });

  await updateStatus(paths.statusPath, {
    ...(child.pid ? { runnerPid: child.pid } : {}),
    runnerStartedAt: new Date().toISOString(),
    ...(runnerConfig.type === "codex"
      ? { ...(child.pid ? { codexPid: child.pid } : {}), codexStartedAt: new Date().toISOString() }
      : {}),
    ...(runnerConfig.type === "claude"
      ? { ...(child.pid ? { claudePid: child.pid } : {}), claudeStartedAt: new Date().toISOString() }
      : {}),
  });

  if (child.stdin) {
    child.stdin.end(
      invocation.stdinPrefix ? `${invocation.stdinPrefix}\n\n${childPrompt}` : childPrompt
    );
  }

  const exit = await waitForChildWithControls(child, exitPromise, job.jobDir);

  fs.closeSync(stdout);
  fs.closeSync(stderr);

  if (typeof invocation.afterExit === "function") {
    await invocation.afterExit(exit);
  }

  const completedAt = new Date();
  const terminalStatus = exit.cancelled ? "cancelled" : exit.code === 0 ? "completed" : "failed";
  await updateStatus(paths.statusPath, {
    completedAt: completedAt.toISOString(),
    error: exit.error || "",
    exitCode: exit.code,
    signal: exit.signal || "",
    status: terminalStatus,
  });
  const finalSummary = await readFinalSummary(paths, terminalStatus, exit);
  await transitionRun(
    job.jobDir,
    {
      final_summary: finalSummary,
      next_action: "",
      phase: terminalStatus,
      public_summary: finalSummary,
      status: terminalStatus,
    },
    {
      type: terminalStatus,
      summary: finalSummary,
      payload: { exit_code: exit.code, signal: exit.signal || "", error: exit.error || "" },
    },
    { now: completedAt }
  );

  await runTerminalCallback(job, paths, terminalStatus);
  if (job.callbackCommand) {
    await runCompletionCallback(job, paths, exit, terminalStatus);
  }
}

function normalizeRunMetadata(options = {}) {
  const profile = getAgentProfile(options.agentProfile || DEFAULT_AGENT_PROFILE);
  return {
    agentProfile: profile.agentProfile,
    trigger: normalizeChoice("trigger", options.trigger || profile.defaultTrigger, TRIGGERS),
    visibility: normalizeChoice("visibility", options.visibility || profile.defaultVisibility, VISIBILITIES),
    delivery: normalizeChoice("delivery", options.delivery || profile.defaultDelivery, DELIVERIES),
    riskTier: options.riskTier === undefined ? profile.defaultRiskTier : parseRiskTier(options.riskTier),
  };
}

async function createBackgroundRun(job, paths, { now = new Date() } = {}) {
  const metadata = normalizeRunMetadata(job);
  return createRun(job.jobDir, {
    run_id: job.runId || job.id,
    agent_profile: metadata.agentProfile,
    goal: job.name,
    trigger: metadata.trigger,
    visibility: metadata.visibility,
    delivery: metadata.delivery,
    risk_tier: metadata.riskTier,
    risk_tier_description: describeRiskTier(metadata.riskTier),
    status: "queued",
    phase: job.dryRun ? "prepared" : "queued",
    created_at: job.createdAt || now.toISOString(),
    harness: job.runner || "codex",
    model: job.model || "",
    background_job_id: job.id,
    background_job_status_path: paths.statusPath,
  }, { now });
}

async function ensureBackgroundRun(job, paths) {
  try {
    return await readRun(job.jobDir);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return createBackgroundRun(job, paths, { now: new Date(job.createdAt || Date.now()) });
  }
}

async function readFinalSummary(paths, terminalStatus, exit) {
  if (terminalStatus === "cancelled") {
    return "Background worker cancelled by user request.";
  }
  if (terminalStatus === "completed" && fs.existsSync(paths.lastMessagePath)) {
    const message = (await fsp.readFile(paths.lastMessagePath, "utf8")).trim();
    if (message) {
      return message;
    }
  }
  if (exit.error) {
    return `Background worker failed: ${exit.error}`;
  }
  return terminalStatus === "completed"
    ? "Background worker completed successfully."
    : `Background worker failed with exit code ${exit.code}${exit.signal ? ` (${exit.signal})` : ""}.`;
}

async function waitForChildWithControls(child, exitPromise, runDir, { intervalMs = 100 } = {}) {
  let settled = false;
  const wrappedExit = exitPromise.then((exit) => {
    settled = true;
    return exit;
  });

  while (!settled) {
    const checkpoint = await readRunCheckpoint(runDir);
    if (checkpoint.cancelled) {
      child.kill("SIGTERM");
      const exit = await wrappedExit;
      return { ...exit, cancelled: true };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return wrappedExit;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildRunnerInvocation(runnerConfig, job, paths) {
  if (runnerConfig.type === "claude") {
    return buildClaudeInvocation(runnerConfig, job, paths);
  }
  return buildCodexInvocation(runnerConfig, job, paths);
}

function buildCodexInvocation(runnerConfig, job, paths) {
  const args = [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "--cd",
    job.cwd,
    "-o",
    paths.lastMessagePath,
    "-",
  ];
  if (runnerConfig.model) {
    args.splice(1, 0, "--model", runnerConfig.model);
  }
  return {
    args,
    bin: runnerConfig.bin,
    env: {
      CODEX_HOME: runnerConfig.home,
    },
  };
}

function buildClaudeInvocation(runnerConfig, job, paths) {
  const args = [
    "-p",
    "Execute the Sable background job described on stdin. Work only inside the requested scope, then return a concise final report.",
    "--output-format",
    runnerConfig.outputFormat || DEFAULT_CLAUDE_OUTPUT_FORMAT,
    "--permission-mode",
    runnerConfig.permissionMode || DEFAULT_CLAUDE_PERMISSION_MODE,
  ];
  if (runnerConfig.model) {
    args.push("--model", runnerConfig.model);
  }
  if (runnerConfig.allowedTools) {
    args.push("--allowedTools", runnerConfig.allowedTools);
  }
  if (runnerConfig.disallowedTools) {
    args.push("--disallowedTools", runnerConfig.disallowedTools);
  }
  return {
    args,
    bin: runnerConfig.bin,
    env: {
      CLAUDE_CONFIG_DIR: runnerConfig.home,
    },
    afterExit: async () => {
      const stdoutText = fs.existsSync(paths.stdoutPath)
        ? await fsp.readFile(paths.stdoutPath, "utf8")
        : "";
      const result = extractClaudeResult(stdoutText);
      if (result.trim()) {
        await fsp.writeFile(paths.lastMessagePath, `${result.trim()}\n`, "utf8");
      }
    },
  };
}

function extractClaudeResult(stdoutText) {
  const text = String(stdoutText || "").trim();
  if (!text) {
    return "";
  }
  const whole = parseJson(text);
  const wholeResult = extractClaudeResultFromJson(whole);
  if (wholeResult) {
    return wholeResult;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of [...lines].reverse()) {
    const parsed = parseJson(line);
    const result = extractClaudeResultFromJson(parsed);
    if (result) {
      return result;
    }
  }
  return text;
}

function extractClaudeResultFromJson(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return "";
  }
  if (typeof parsed.result === "string") {
    return parsed.result;
  }
  if (typeof parsed.text === "string") {
    return parsed.text;
  }
  if (typeof parsed.message === "string") {
    return parsed.message;
  }
  const content = parsed.message?.content || parsed.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        return typeof item?.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function runTerminalCallback(job, paths, terminalStatus) {
  const callbackStartedAt = new Date();
  await updateStatus(paths.statusPath, {
    runtimeCallbackStartedAt: callbackStartedAt.toISOString(),
  });
  try {
    const result = await handleRunCallback({
      event: terminalStatus,
      runDir: job.jobDir,
      runId: job.runId || job.id,
      runPath: paths.runPath,
    });
    await updateStatus(paths.statusPath, {
      runtimeCallbackCompletedAt: new Date().toISOString(),
      runtimeCallbackNotificationQueued: Boolean(result.notificationQueued),
      runtimeCallbackReason: result.reason || "",
    });
  } catch (error) {
    await updateStatus(paths.statusPath, {
      runtimeCallbackCompletedAt: new Date().toISOString(),
      runtimeCallbackError: error.message,
    });
  }
}

async function runCompletionCallback(job, paths, exit, terminalStatus) {
  const callbackStartedAt = new Date();
  await updateStatus(paths.statusPath, {
    callbackStartedAt: callbackStartedAt.toISOString(),
  });

  const callback = spawn(job.callbackCommand, [], {
    cwd: job.cwd,
    env: {
      ...process.env,
      SABLE_BACKGROUND_JOB_DIR: job.jobDir,
      SABLE_BACKGROUND_JOB_ID: job.id,
      SABLE_BACKGROUND_JOB_LAST_MESSAGE: paths.lastMessagePath,
      SABLE_BACKGROUND_JOB_STATUS: terminalStatus || (exit.code === 0 ? "completed" : "failed"),
      SABLE_BACKGROUND_JOB_STATUS_PATH: paths.statusPath,
      SABLE_RUN_CONTROL_PATH: paths.controlPath,
      SABLE_RUN_EVENTS_PATH: paths.eventsPath,
      SABLE_RUN_ID: job.runId || job.id,
      SABLE_RUN_PATH: paths.runPath,
      SABLE_RUN_RISK_TIER: String(job.riskTier ?? ""),
      SABLE_RUN_RISK_TIER_DESCRIPTION: job.riskTierDescription || "",
    },
    shell: true,
    stdio: "ignore",
  });

  const result = await new Promise((resolve) => {
    callback.on("exit", (code, signal) => resolve({ code, signal }));
    callback.on("error", (error) => resolve({ code: 1, error: error.message, signal: null }));
  });

  await updateStatus(paths.statusPath, {
    callbackCompletedAt: new Date().toISOString(),
    callbackError: result.error || "",
    callbackExitCode: result.code,
    callbackSignal: result.signal || "",
  });
}

async function loadJob(options) {
  const jobsRoot = options.jobsRoot || defaultJobsRoot();
  const id = options.id || options.name;
  if (!id) {
    throw new Error("Missing --id/--job.");
  }
  const statusPath = path.join(jobsRoot, id, "status.json");
  return JSON.parse(await fsp.readFile(statusPath, "utf8"));
}

async function writeStatus(statusPath, status) {
  await fsp.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function updateStatus(statusPath, patch) {
  const current = JSON.parse(await fsp.readFile(statusPath, "utf8"));
  await writeStatus(statusPath, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

async function listJobs(options) {
  const jobsRoot = options.jobsRoot || defaultJobsRoot();
  if (!fs.existsSync(jobsRoot)) {
    return [];
  }
  const rows = [];
  for (const entry of await fsp.readdir(jobsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      rows.push(JSON.parse(await fsp.readFile(path.join(jobsRoot, entry.name, "status.json"), "utf8")));
    } catch {
      rows.push({ id: entry.name, status: "unreadable" });
    }
  }
  return rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function stopJob(options) {
  const job = await loadJob(options);
  const paths = jobPaths(job.jobDir);
  if (TERMINAL_STATUSES.has(String(job.status || ""))) {
    return job;
  }
  const targetPid = job.workerPid || job.pid;
  if (!targetPid) {
    throw new Error(`Job has no process id: ${job.id}`);
  }

  let stopError = "";
  try {
    process.kill(-targetPid, "SIGTERM");
  } catch (error) {
    try {
      process.kill(targetPid, "SIGTERM");
    } catch (fallbackError) {
      if (fallbackError.code !== "ESRCH") {
        throw fallbackError;
      }
      stopError = fallbackError.message;
    }
    if (!stopError && error.code !== "ESRCH") {
      stopError = error.message;
    }
  }

  await updateStatus(paths.statusPath, {
    status: "stopping",
    stopError,
    stoppedAt: new Date().toISOString(),
  });
  return JSON.parse(await fsp.readFile(paths.statusPath, "utf8"));
}

async function controlJob(options) {
  if (!options.id) {
    throw new Error("control requires --id.");
  }
  if (!options.action) {
    throw new Error("control requires --action pause|resume|cancel|steer.");
  }
  const store = createBackgroundJobRunStore({
    jobsRoot: options.jobsRoot || defaultJobsRoot(),
  });
  const result = await store.controlRun(options.id, {
    action: options.action,
    instruction: options.instruction || "",
    actor: "background-job-cli",
  });
  if (!result) {
    throw new Error(`No run matched ${options.id}.`);
  }
  if (result.ok === false) {
    throw new Error(result.message || `Could not ${options.action} run ${options.id}.`);
  }
  return result.run || result;
}

async function reportJob(options) {
  const job = await loadJob(options);
  const paths = jobPaths(job.jobDir);
  const lastMessage = fs.existsSync(paths.lastMessagePath)
    ? await fsp.readFile(paths.lastMessagePath, "utf8")
    : "";
  const stderrTail = await tailFile(paths.stderrPath, options.recentLines || DEFAULT_RECENT_LOG_LINES);
  return {
    ...job,
    lastMessage: lastMessage.trim(),
    stderrTail,
  };
}

async function tailFile(filePath, lineCount) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const text = await fsp.readFile(filePath, "utf8");
  return text.split(/\r?\n/).slice(-lineCount).join("\n").trim();
}

function formatJobList(rows) {
  if (rows.length === 0) {
    return "No background jobs.";
  }
  return rows
    .map((job) => `${job.id} [${job.status || "unknown"}:${job.runner || "codex"}] ${job.name || ""} ${job.cwd || ""}`.trim())
    .join("\n");
}

function usage() {
  return [
    "Usage:",
    "  npm run background-job -- start --name NAME [--id JOB_ID] --cwd DIR (--prompt TEXT | --prompt-file FILE)",
    "  npm run background-job -- start --name NAME [--id JOB_ID] --worktree-from REPO [--worktree-branch BRANCH] [--worktree-dir DIR] (--prompt TEXT | --prompt-file FILE)",
    "  npm run background-job -- start --runner codex|claude --name NAME [--id JOB_ID] --cwd DIR (--prompt TEXT | --prompt-file FILE)",
    "  npm run background-job -- list",
    "  npm run background-job -- status --id JOB_ID",
    "  npm run background-job -- report --id JOB_ID",
    "  npm run background-job -- control --id JOB_ID --action pause|resume|cancel|steer [--instruction TEXT]",
    "  npm run background-job -- stop --id JOB_ID",
    "  npm run background-job -- watchdog [--jobs-root DIR] [--older-than-minutes N] [--fix] [--json|--text]",
    "  npm run background-job -- profiles",
    "  node tools/background-job/batch-notify.js init --batch-file FILE --job JOB_ID [--job JOB_ID...]",
    "",
    "Starts detached bounded background agent jobs with durable logs/status. Codex is the default runner; Claude Code can be selected with --runner claude.",
    "Run metadata: --agent-profile PROFILE --trigger manual|scheduled|callback|autonomous --visibility silent|final_only|milestones|interactive --delivery none|orchestrator_only|signal --risk-tier 0..5.",
    "Pass --callback-command COMMAND to start so the worker runs COMMAND after completion with SABLE_BACKGROUND_JOB_* env vars.",
    "For sibling batches, put the same callback on every job: node tools/background-job/batch-notify.js callback --batch-file FILE.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.command === "help") {
    console.log(usage());
    return 0;
  }

  if (options.command === "start") {
    console.log(JSON.stringify(await startJob(options), null, 2));
    return 0;
  }
  if (options.command === "run-worker") {
    await runWorker(options);
    return 0;
  }
  if (options.command === "list") {
    console.log(formatJobList(await listJobs(options)));
    return 0;
  }
  if (options.command === "status") {
    console.log(JSON.stringify(await loadJob(options), null, 2));
    return 0;
  }
  if (options.command === "report") {
    console.log(JSON.stringify(await reportJob(options), null, 2));
    return 0;
  }
  if (options.command === "control") {
    console.log(JSON.stringify(await controlJob(options), null, 2));
    return 0;
  }
  if (options.command === "stop") {
    console.log(JSON.stringify(await stopJob(options), null, 2));
    return 0;
  }
  if (options.command === "watchdog") {
    const watchdogOptions = {
      fix: options.fix,
      jobsRoot: options.jobsRoot || defaultJobsRoot(),
    };
    if (options.olderThanMinutes !== undefined) {
      watchdogOptions.olderThanMinutes = options.olderThanMinutes;
    }
    const summary = await scanWatchdogRuns(watchdogOptions);
    console.log(
      options.watchdogFormat === "json" ? JSON.stringify(summary, null, 2) : formatWatchdogSummary(summary)
    );
    return summary.errors.length > 0 ? 1 : 0;
  }
  if (options.command === "profiles") {
    console.log(formatAgentProfiles());
    return 0;
  }

  console.error(`Unknown command: ${options.command}`);
  console.error(usage());
  return 2;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildRunnerConfig,
  buildRunnerInvocation,
  controlJob,
  createJobId,
  defaultClaudeHome,
  defaultJobsRoot,
  defaultWorktreeDir,
  extractClaudeResult,
  formatJobList,
  jobPaths,
  normalizeRunner,
  parseArgs,
  resolveWorktreePlan,
  startJob,
  waitForChildWithControls,
};
