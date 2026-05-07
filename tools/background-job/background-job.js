#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { createInstanceConfig } = require("../instance/instance-config");

const DEFAULT_CODEX_HOME = "/home/arya/.codex-bridge";
const DEFAULT_RECENT_LOG_LINES = 80;

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
    codex: process.env.CODEX_BIN || "codex",
    codexHome: process.env.CODEX_HOME || DEFAULT_CODEX_HOME,
    model: "",
    recentLines: DEFAULT_RECENT_LOG_LINES,
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
    } else if (arg === "--codex") {
      options.codex = argv[++index] || options.codex;
    } else if (arg === "--codex-home") {
      options.codexHome = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--model") {
      options.model = argv[++index] || "";
    } else if (arg === "--recent-lines") {
      options.recentLines = parsePositiveInteger(argv[++index], DEFAULT_RECENT_LOG_LINES);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  return path.join(path.dirname(instance.projectTasksPath), "background-jobs");
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

function jobPaths(jobDir) {
  return {
    jobDir,
    lastMessagePath: path.join(jobDir, "last-message.md"),
    promptPath: path.join(jobDir, "prompt.md"),
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
  if (!options.cwd) {
    throw new Error("start requires --cwd. The harness does not assume a repo/workspace.");
  }
  if (!fs.existsSync(options.cwd)) {
    throw new Error(`cwd does not exist: ${options.cwd}`);
  }
  if (!options.prompt && !options.promptFile) {
    throw new Error("start requires --prompt or --prompt-file.");
  }

  const jobsRoot = options.jobsRoot || defaultJobsRoot();
  const id = options.id || createJobId(options.name, now);
  const jobDir = path.join(jobsRoot, id);
  const paths = jobPaths(jobDir);
  const prompt = await readPrompt(options);
  if (!prompt.trim()) {
    throw new Error("background job prompt is empty.");
  }

  await fsp.mkdir(jobDir, { recursive: true });
  await fsp.writeFile(paths.promptPath, prompt, "utf8");

  const status = {
    id,
    name: options.name,
    cwd: options.cwd,
    codex: options.codex,
    codexHome: options.codexHome,
    createdAt: now.toISOString(),
    dryRun: Boolean(options.dryRun),
    jobDir,
    model: options.model || "",
    pid: null,
    status: options.dryRun ? "prepared" : "starting",
    updatedAt: now.toISOString(),
  };

  await writeStatus(paths.statusPath, status);
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
      "--codex",
      options.codex,
      "--codex-home",
      options.codexHome,
      ...(options.model ? ["--model", options.model] : []),
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

async function runWorker(options) {
  const job = await loadJob(options);
  const paths = jobPaths(job.jobDir);
  await updateStatus(paths.statusPath, {
    startedAt: new Date().toISOString(),
    status: "running",
    workerPid: process.pid,
  });

  const stdout = fs.openSync(paths.stdoutPath, "a");
  const stderr = fs.openSync(paths.stderrPath, "a");
  const args = [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    job.cwd,
    "-o",
    paths.lastMessagePath,
    "-",
  ];
  if (options.model || job.model) {
    args.splice(1, 0, "--model", options.model || job.model);
  }

  const child = spawn(options.codex || job.codex || "codex", args, {
    cwd: job.cwd,
    env: {
      ...process.env,
      CODEX_HOME: options.codexHome || job.codexHome || DEFAULT_CODEX_HOME,
    },
    stdio: ["pipe", stdout, stderr],
  });

  await updateStatus(paths.statusPath, {
    codexPid: child.pid,
    codexStartedAt: new Date().toISOString(),
  });

  child.stdin.end(await fsp.readFile(paths.promptPath, "utf8"));

  const exit = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", (error) => resolve({ code: 1, error: error.message, signal: null }));
  });

  fs.closeSync(stdout);
  fs.closeSync(stderr);

  await updateStatus(paths.statusPath, {
    completedAt: new Date().toISOString(),
    error: exit.error || "",
    exitCode: exit.code,
    signal: exit.signal || "",
    status: exit.code === 0 ? "completed" : "failed",
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
  const targetPid = job.workerPid || job.pid;
  if (!targetPid) {
    throw new Error(`Job has no process id: ${job.id}`);
  }

  try {
    process.kill(-targetPid, "SIGTERM");
  } catch {
    process.kill(targetPid, "SIGTERM");
  }

  await updateStatus(paths.statusPath, {
    status: "stopping",
    stoppedAt: new Date().toISOString(),
  });
  return JSON.parse(await fsp.readFile(paths.statusPath, "utf8"));
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
    .map((job) => `${job.id} [${job.status || "unknown"}] ${job.name || ""} ${job.cwd || ""}`.trim())
    .join("\n");
}

function usage() {
  return [
    "Usage:",
    "  npm run background-job -- start --name NAME --cwd DIR (--prompt TEXT | --prompt-file FILE)",
    "  npm run background-job -- list",
    "  npm run background-job -- status --id JOB_ID",
    "  npm run background-job -- report --id JOB_ID",
    "  npm run background-job -- stop --id JOB_ID",
    "",
    "Starts detached bounded Codex implementation jobs with durable logs/status.",
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
  if (options.command === "stop") {
    console.log(JSON.stringify(await stopJob(options), null, 2));
    return 0;
  }

  console.error(`Unknown command: ${options.command}`);
  console.error(usage());
  return 2;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  createJobId,
  defaultJobsRoot,
  formatJobList,
  jobPaths,
  parseArgs,
  startJob,
};
