#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { createInstanceConfig } = require("./instance-config");
const { createDefaultScheduledWorkflowJobs } = require("../../apps/signal-bridge/scheduler");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const options = {
    force: false,
    homeDir: "",
    repoRoot: DEFAULT_REPO_ROOT,
    resetGenerated: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--instance-home" || arg === "--home-dir") {
      options.homeDir = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--repo-root") {
      options.repoRoot = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--reset-generated") {
      options.resetGenerated = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
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

function getInstanceEnvPath(instance) {
  return path.join(instance.homeDir, ".config", "sable", "sable.env");
}

function initInstance({
  env = process.env,
  force = false,
  homeDir = "",
  logger = console,
  repoRoot = DEFAULT_REPO_ROOT,
  resetGenerated = false,
} = {}) {
  const instance = createInstanceConfig({ repoRoot, homeDir, env });
  const created = [];
  const skipped = [];
  const overwritten = [];

  function ensureDir(targetPath) {
    if (fs.existsSync(targetPath)) {
      skipped.push(`dir ${targetPath}`);
      return;
    }
    fs.mkdirSync(targetPath, { recursive: true });
    created.push(`dir ${targetPath}`);
  }

  function writeFile(targetPath, content, { generated = false } = {}) {
    const exists = fs.existsSync(targetPath);
    const canOverwrite = force || (generated && resetGenerated);
    if (exists && !canOverwrite) {
      skipped.push(`file ${targetPath}`);
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    (exists ? overwritten : created).push(`file ${targetPath}`);
  }

  [
    instance.homeDir,
    instance.memoryRoot,
    instance.knowledgeRoot,
    instance.tasksRoot,
    instance.skillsRoot,
    instance.researchRoot,
    instance.autotweetRoot,
    path.dirname(instance.projectTasksPath),
    instance.projectKnowledgeRoot,
    path.join(instance.knowledgeRoot, "projects", "memory"),
    path.join(instance.knowledgeRoot, "projects", "memory", "evals"),
    path.join(instance.knowledgeRoot, "projects", "memory", "metrics"),
    path.join(instance.tasksRoot, "projects", "memory"),
    path.join(instance.homeDir, ".codex"),
    path.join(instance.homeDir, ".codex-bridge"),
    path.join(instance.homeDir, "plugins"),
    path.join(instance.homeDir, ".config", "sable"),
  ].forEach(ensureDir);

  writeFile(
    instance.agentsPath,
    [
      "# Sable Instance Instructions",
      "",
      "This file is private instance state. Put your local assistant identity, preferences, and operating norms here.",
      "Do not commit secrets, OAuth tokens, phone numbers, or private memory into the Sable repo.",
      "",
      "## First-Run Identity",
      "",
      "- Assistant name: Sable",
      "- Personality: edit this section to describe how Sable should sound and what she should prioritize for you.",
      "- Avatar: after the Signal bridge is running, send `/setavatar` with an attached image to set Sable's profile picture.",
      "",
    ].join("\n")
  );
  writeFile(
    instance.todoPath,
    [
      "## Today",
      "",
      "- [ ] Start using Sable",
      "",
      "## Backlog",
      "",
      "- [ ] Add personal setup tasks here",
      "",
    ].join("\n")
  );
  writeFile(
    instance.projectTasksPath,
    [
      "## Sable",
      "",
      "- [ ] Finish local setup",
      "- [ ] Add any local plugins under `~/plugins`",
      "",
    ].join("\n")
  );
  writeFile(path.join(instance.memoryRoot, "README.md"), renderMemoryReadme());
  writeFile(
    path.join(instance.knowledgeRoot, "projects", "memory", "ARCHITECTURE.md"),
    renderMemoryArchitecture()
  );
  writeFile(
    path.join(instance.knowledgeRoot, "projects", "memory", "ARCHITECTURE_LOG.md"),
    renderMemoryArchitectureLog()
  );
  writeFile(
    path.join(instance.knowledgeRoot, "projects", "memory", "evals", "MEMORY_EVALS.md"),
    renderMemoryEvalSuite()
  );
  writeFile(
    path.join(instance.tasksRoot, "projects", "memory", "TODO.md"),
    renderMemoryTaskFile()
  );
  writeFile(
    instance.defaultSchedulerJobsPath,
    `${JSON.stringify({ jobs: createDefaultScheduledWorkflowJobs() }, null, 2)}\n`,
    { generated: true }
  );
  writeFile(instance.schedulerJobsPath, '{"jobs":[]}\n', { generated: true });
  writeFile(getInstanceEnvPath(instance), renderInstanceEnv(instance), {
    generated: true,
  });

  const result = {
    created,
    envPath: getInstanceEnvPath(instance),
    instance,
    overwritten,
    skipped,
  };

  if (logger) {
    logger.log(formatInitResult(result));
  }

  return result;
}

function renderInstanceEnv(instance) {
  const lines = [
    "# Generated by npm run init:instance. Keep this file private.",
    `SABLE_INSTANCE_HOME=${shellValue(instance.homeDir)}`,
    `SABLE_REPO_ROOT=${shellValue(instance.repoRoot)}`,
    `SABLE_MEMORY_ROOT=${shellValue(instance.memoryRoot)}`,
    `SABLE_KNOWLEDGE_ROOT=${shellValue(instance.knowledgeRoot)}`,
    `SABLE_TASKS_ROOT=${shellValue(instance.tasksRoot)}`,
    `SABLE_SKILLS_ROOT=${shellValue(instance.skillsRoot)}`,
    `SABLE_RESEARCH_ROOT=${shellValue(instance.researchRoot)}`,
    `SABLE_AUTOTWEET_ROOT=${shellValue(instance.autotweetRoot)}`,
    `SABLE_SIGNAL_BRIDGE_DIR=${shellValue(instance.signalBridgeDir)}`,
    `SABLE_CODEX_CWD=${shellValue(instance.homeDir)}`,
    `SABLE_DEFAULT_SCHEDULER_JOBS_PATH=${shellValue(instance.defaultSchedulerJobsPath)}`,
    `SABLE_SCHEDULER_JOBS_PATH=${shellValue(instance.schedulerJobsPath)}`,
    `SABLE_PLUGIN_PATHS=${shellValue(path.join(instance.homeDir, "plugins"))}`,
    `CODEX_HOME=${shellValue(path.join(instance.homeDir, ".codex-bridge"))}`,
    "",
  ];
  return `${lines.join("\n")}`;
}

function renderMemoryReadme() {
  return [
    "# Sable Memory",
    "",
    "This private instance memory is markdown-first. Keep canonical state in files that humans, agents, and scripts can read.",
    "",
    "## Source Of Truth",
    "",
    "| Memory kind | Location | Purpose |",
    "| --- | --- | --- |",
    "| Durable norms | `AGENTS.md` | Identity, operating policy, broad behavior rules |",
    "| Procedures | `skills/*/SKILL.md` | Reusable workflows and SOPs |",
    "| Tasks | `memory/tasks/` | Active work, queues, blockers, next actions |",
    "| Semantic knowledge | `memory/knowledge/` | Project context, research notes, stable facts |",
    "| Logs/audits | `memory/knowledge/**/LOG.md` or `logs/` | What happened, when, and why |",
    "",
    "## Default Improvement Loop",
    "",
    "Sable includes a silent daily memory eval loop. It should test reusable memory capabilities, score whether Sable retrieved and applied the right memory, then make at most one low-risk improvement that generalizes.",
    "",
    "When improving memory, prefer protocol/template/index fixes before one-off note fixes.",
    "",
    "## Architecture Record",
    "",
    "The current memory architecture is codified in:",
    "",
    "- `memory/knowledge/projects/memory/ARCHITECTURE.md`",
    "",
    "Architecture changes should be logged in:",
    "",
    "- `memory/knowledge/projects/memory/ARCHITECTURE_LOG.md`",
    "",
    "If a change alters where memory belongs, how it should be indexed, what templates future projects should use, or how maintenance/eval loops operate, update both the architecture record and the log in the same pass.",
    "",
  ].join("\n");
}

function renderMemoryArchitecture() {
  return [
    "# Current Memory Architecture",
    "",
    "This document codifies this Sable instance's memory architecture. Update it whenever the architecture itself changes.",
    "",
    "## Core Premise",
    "",
    "Sable memory is markdown-first and filesystem-native. Tools may index or render memory, but markdown remains canonical.",
    "",
    "## Memory Layers",
    "",
    "| Memory kind | Canonical location | Purpose |",
    "| --- | --- | --- |",
    "| Durable norms | `AGENTS.md` | Identity, operating policy, broad behavior rules |",
    "| Procedures | `skills/*/SKILL.md` | Reusable workflows and SOPs |",
    "| Tasks | `memory/tasks/` | Active work, queues, blockers, next actions |",
    "| Semantic knowledge | `memory/knowledge/` | Project context, research notes, stable facts |",
    "| Research sources | `memory/knowledge/research/<topic>/raw/` | Raw inputs and processed provenance |",
    "| Logs/audits | `memory/knowledge/**/LOG.md` or `logs/` | What happened, when, and why |",
    "| Generated/background artifacts | project-specific `outputs/` or background-job dirs | Durable evidence, not the first retrieval surface |",
    "",
    "## Indexing Rules",
    "",
    "- `TODO.md` should stay a thin index into task files.",
    "- `memory/README.md` maps the top-level memory architecture.",
    "- `memory/tasks/README.md` maps task memory.",
    "- substantial projects should expose a source-of-truth block linking repo, tasks, status/knowledge, research, and archive/progress.",
    "- research topics should expose navigation through `README.md`, `KB.md`, and `wiki/index.md` when relevant.",
    "",
    "## Improvement Processes",
    "",
    "- `default-dreaming`: conservative cleanup review of norms, skills, and task state.",
    "- `default-memory-eval`: daily eval-driven memory improvement loop.",
    "- end-of-task reflection: classify new lessons into norms, skills, tasks, knowledge, or nowhere permanent.",
    "",
    "## Architecture Change Rule",
    "",
    "If a change alters where memory belongs, how it is indexed, how project/research memory is structured, how memory improvement loops operate, or what conventions future Sable instances should inherit, update this file and append to `memory/knowledge/projects/memory/ARCHITECTURE_LOG.md` in the same pass.",
    "",
  ].join("\n");
}

function renderMemoryArchitectureLog() {
  return [
    "# Memory Architecture Log",
    "",
    "This log records changes to the memory architecture itself: structure, indexing rules, templates, scheduled improvement loops, and conventions that should carry forward to future Sable instances.",
    "",
    "## Initial",
    "",
    "- Instance initialized with markdown-first memory layers, seed memory evals, default dreaming, default memory eval, and the architecture change rule.",
    "",
  ].join("\n");
}

function renderMemoryEvalSuite() {
  return [
    "# Memory Evals",
    "",
    "These evals are probes for general memory capabilities. Add domain-specific examples over time, but optimize for reusable protocol improvements rather than one-off answers.",
    "",
    "## Scoring",
    "",
    "- `0`: missed memory entirely",
    "- `1`: found vague or stale memory",
    "- `2`: found the canonical source",
    "- `3`: found the canonical source and applied it correctly",
    "",
    "## Capability Types",
    "",
    "- `source_of_truth_recovery`",
    "- `procedure_activation`",
    "- `current_state_recovery`",
    "- `task_continuity`",
    "- `research_synthesis_reuse`",
    "- `staleness_detection`",
    "- `contradiction_handling`",
    "- `generalization_after_fix`",
    "",
    "## Seed Evals",
    "",
    "### source-of-truth-sable-tasks",
    "",
    "Capability: `source_of_truth_recovery`",
    "",
    "Prompt: Where does Sable track active Sable project work?",
    "",
    "Expected sources:",
    "- `memory/tasks/projects/sable/TODO.md`",
    "- `memory/knowledge/projects/sable/`",
    "",
    "Expected behavior:",
    "- distinguish active tasks from archive/history",
    "- point to the canonical task file first",
    "",
    "### memory-procedure-promotion",
    "",
    "Capability: `procedure_activation`",
    "",
    "Prompt: A repeated workflow keeps coming up. Where should Sable store the reusable procedure?",
    "",
    "Expected sources:",
    "- `AGENTS.md`",
    "- `skills/`",
    "- `memory/README.md`",
    "",
    "Expected behavior:",
    "- use `skills/` for reusable procedures",
    "- use `AGENTS.md` only for durable broad operating norms",
    "",
    "### stale-active-detection",
    "",
    "Capability: `staleness_detection`",
    "",
    "Prompt: A completed research run still appears in an active directory. What should Sable do?",
    "",
    "Expected sources:",
    "- `memory/README.md`",
    "- relevant project task or research run state",
    "",
    "Expected behavior:",
    "- preserve provenance",
    "- move or mark completed state out of active lanes",
    "- avoid deletion unless explicitly approved",
    "",
  ].join("\n");
}

function renderMemoryTaskFile() {
  return [
    "# Memory System Tasks",
    "",
    "## In Progress",
    "",
    "1. Improve Sable's memory through the daily eval loop",
    "Current state: this instance has the default markdown-first memory architecture and a seed eval suite. The daily silent memory eval loop should score a few probes, fix at most one low-risk generalizable memory issue, and log metrics under `memory/knowledge/projects/memory/metrics/`.",
    "",
    "## Backlog",
    "",
    "- [ ] Add project-specific eval probes as new domains become important.",
    "- [ ] Review memory metrics weekly and promote repeated fixes into templates, skills, or architecture docs.",
    "",
  ].join("\n");
}

function shellValue(value) {
  return String(value || "").replace(/\n/g, "");
}

function formatInitResult(result) {
  const lines = [
    `Sable instance initialized at ${result.instance.homeDir}`,
    `private env: ${result.envPath}`,
    "",
  ];

  for (const [label, entries] of [
    ["created", result.created],
    ["overwritten", result.overwritten],
    ["skipped", result.skipped],
  ]) {
    lines.push(`${label}: ${entries.length}`);
    for (const entry of entries) {
      lines.push(`  - ${entry}`);
    }
  }

  lines.push("");
  lines.push("Next:");
  lines.push(`  npm run sable:doctor -- --home-dir ${shellQuote(result.instance.homeDir)}`);
  lines.push("  fill apps/signal-bridge/.env from apps/signal-bridge/.env.example");
  lines.push("  edit AGENTS.md to choose Sable's personality and send /setavatar with an image");
  lines.push(`  npm run install:user-service -- --instance-home ${shellQuote(result.instance.homeDir)}`);

  return `${lines.join("\n")}\n`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function usage() {
  return [
    "Usage: node tools/instance/init-instance.js [--instance-home PATH] [--repo-root PATH] [--force] [--reset-generated]",
    "",
    "Creates private Sable instance state outside the repo. Existing files are not overwritten unless --force is passed.",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
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

  initInstance(options);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  formatInitResult,
  getInstanceEnvPath,
  initInstance,
  parseArgs,
  renderInstanceEnv,
  renderMemoryArchitecture,
  renderMemoryArchitectureLog,
  renderMemoryEvalSuite,
  renderMemoryReadme,
  renderMemoryTaskFile,
};
