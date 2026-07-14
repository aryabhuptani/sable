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
    instance.domainsRoot,
    instance.sharedRoot,
    instance.orchestratorRoot,
    instance.codingRoot,
    instance.researchDomainRoot,
    instance.workRoot,
    instance.opsRoot,
    instance.archiveRoot,
    path.join(instance.sharedRoot, "skills"),
    path.join(instance.orchestratorRoot, "skills"),
    path.join(instance.orchestratorRoot, "projects"),
    path.join(instance.orchestratorRoot, "runs"),
    path.join(instance.orchestratorRoot, "schedules"),
    path.join(instance.orchestratorRoot, "callbacks"),
    path.join(instance.orchestratorRoot, "state"),
    path.join(instance.codingRoot, "skills"),
    path.join(instance.codingRoot, "projects"),
    path.join(instance.researchDomainRoot, "skills"),
    instance.researchRoot,
    path.join(instance.workRoot, "skills"),
    path.join(instance.workRoot, "projects"),
    path.join(instance.opsRoot, "skills"),
    path.join(instance.opsRoot, "projects"),
    path.join(instance.archiveRoot, "projects"),
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
      "This file is a compatibility shim for harnesses that look for AGENTS.md.",
      "Canonical instructions should live in `domains/orchestrator/PROFILE.md`.",
      "Do not commit secrets, OAuth tokens, phone numbers, or private memory into the Sable repo.",
      "",
      "Load `domains/orchestrator/PROFILE.md` first, then use domain-local profiles and skills as routed by the orchestrator.",
      "",
    ].join("\n")
  );
  writeFile(path.join(instance.domainsRoot, "README.md"), renderDomainsReadme());
  writeFile(path.join(instance.sharedRoot, "PROFILE.md"), renderSharedProfile());
  writeFile(path.join(instance.orchestratorRoot, "PROFILE.md"), renderOrchestratorProfile());
  writeFile(path.join(instance.codingRoot, "PROFILE.md"), renderCodingProfile());
  writeFile(path.join(instance.researchDomainRoot, "PROFILE.md"), renderResearchProfile());
  writeFile(path.join(instance.workRoot, "PROFILE.md"), renderWorkProfile());
  writeFile(path.join(instance.opsRoot, "PROFILE.md"), renderOpsProfile());
  writeFile(path.join(instance.archiveRoot, "PROFILE.md"), renderArchiveProfile());
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
      "- [ ] Add domain-local skills under `domains/<domain>/skills`",
      "",
    ].join("\n")
  );
  writeFile(path.join(instance.homeDir, "SETUP.md"), renderSetupChecklist(instance));
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
  writeFile(
    instance.schedulerStatePath,
    `${JSON.stringify(
      {
        activeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        updatedAt: new Date().toISOString(),
        source: "init-instance",
      },
      null,
      2
    )}\n`,
    { generated: true }
  );
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
    `SABLE_DOMAINS_ROOT=${shellValue(instance.domainsRoot)}`,
    `SABLE_SHARED_ROOT=${shellValue(instance.sharedRoot)}`,
    `SABLE_ORCHESTRATOR_ROOT=${shellValue(instance.orchestratorRoot)}`,
    `SABLE_CODING_ROOT=${shellValue(instance.codingRoot)}`,
    `SABLE_RESEARCH_DOMAIN_ROOT=${shellValue(instance.researchDomainRoot)}`,
    `SABLE_WORK_ROOT=${shellValue(instance.workRoot)}`,
    `SABLE_OPS_ROOT=${shellValue(instance.opsRoot)}`,
    `SABLE_ARCHIVE_ROOT=${shellValue(instance.archiveRoot)}`,
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
    `SABLE_SCHEDULER_STATE_PATH=${shellValue(instance.schedulerStatePath)}`,
    `SABLE_PLUGIN_PATHS=${shellValue(path.join(instance.homeDir, "plugins"))}`,
    `CODEX_HOME=${shellValue(path.join(instance.homeDir, ".codex-bridge"))}`,
    "",
  ];
  return `${lines.join("\n")}`;
}

function renderDomainsReadme() {
  return [
    "# Sable Domains",
    "",
    "`domains/` is the canonical operating structure for this Sable instance.",
    "",
    "Memory is not a separate top-level product. Each domain owns its own project context, skills, documents, code when applicable, runs, and durable notes.",
    "",
    "## Domains",
    "",
    "- `shared/` - baseline context and common skills.",
    "- `orchestrator/` - routing, schedules, run control, callbacks, and synthesis.",
    "- `coding/` - code repositories, tests, deployments, and engineering context.",
    "- `research/` - research projects, benchmarks, experiments, and traces.",
    "- `work/` - work/org context, meetings, strategy, and agendas.",
    "- `ops/` - personal/admin execution, documents, finance, travel, household workflows.",
    "- `archive/` - inactive historical retrieval.",
    "",
  ].join("\n");
}

function renderSharedProfile() {
  return [
    "# Shared Domain Profile",
    "",
    "Shared contains small baseline context and skills that every domain may use.",
    "",
    "Keep this short. Domain-specific procedure belongs in that domain's `skills/` directory.",
    "",
  ].join("\n");
}

function renderOrchestratorProfile() {
  return [
    "# Orchestrator Domain Profile",
    "",
    "The orchestrator owns conversation, routing, schedules, run control, callbacks, and final synthesis.",
    "",
    "Domain agents should report back to the orchestrator instead of delegating sideways.",
    "",
  ].join("\n");
}

function renderCodingProfile() {
  return [
    "# Coding Domain Profile",
    "",
    "Coding owns software implementation. Code repositories live under `projects/` and code is primary memory for software projects.",
    "",
    "Read the repo before relying on external notes.",
    "",
  ].join("\n");
}

function renderResearchProfile() {
  return [
    "# Research Domain Profile",
    "",
    "Research owns experiments, autoresearch, benchmark loops, methods, traces, and evidence maps.",
    "",
    "Prefer concise run summaries and retros before raw traces.",
    "",
  ].join("\n");
}

function renderWorkProfile() {
  return [
    "# Work Domain Profile",
    "",
    "Work owns work/org context, meetings, strategy, agendas, and stakeholder synthesis.",
    "",
    "For now, assume a single work workspace unless this instance explicitly adds more.",
    "",
  ].join("\n");
}

function renderOpsProfile() {
  return [
    "# Ops Domain Profile",
    "",
    "Ops owns personal and administrative execution: forms, documents, finance, taxes, travel, household workflows, and similar practical life operations.",
    "",
    "Treat private documents as sensitive. Start from indexes before opening raw contents.",
    "",
  ].join("\n");
}

function renderArchiveProfile() {
  return [
    "# Archive Domain Profile",
    "",
    "Archive is inactive historical retrieval, not a live agent domain.",
    "",
    "Archive means inactive, not deleted.",
    "",
  ].join("\n");
}

function renderMemoryReadme() {
  return [
    "# Legacy Memory Compatibility",
    "",
    "This directory exists for compatibility with older Sable tools and links.",
    "",
    "Canonical state belongs under `domains/`, where each domain owns its own projects, skills, documents, runs, and durable context.",
    "",
    "## Source Of Truth",
    "",
    "| Kind | Canonical location | Purpose |",
    "| --- | --- | --- |",
    "| Durable norms | `AGENTS.md` | Identity, operating policy, broad behavior rules |",
    "| Shared procedures | `domains/shared/skills/*/SKILL.md` | Reusable workflows and SOPs |",
    "| Orchestrator state | `domains/orchestrator/` | Routing, schedules, callbacks, run ledgers, synthesis |",
    "| Code projects | `domains/coding/projects/` | Repos, engineering context, tests, deployments |",
    "| Research projects | `domains/research/projects/` | Experiments, traces, benchmarks, evidence maps |",
    "| Work projects | `domains/work/projects/` | Work/org context, meetings, strategy, agendas |",
    "| Ops projects | `domains/ops/projects/` | Admin, documents, finance/taxes, travel, household workflows |",
    "",
    "## Architecture Record",
    "",
    "The current domain architecture is codified in:",
    "",
    "- `domains/orchestrator/projects/domain-architecture/ARCHITECTURE.md`",
    "",
    "Architecture changes should be logged in:",
    "",
    "- `domains/orchestrator/projects/domain-architecture/ARCHITECTURE_LOG.md`",
    "",
    "If a change alters where domain state belongs, how it should be indexed, what templates future projects should use, or how maintenance/eval loops operate, update both the architecture record and the log in the same pass.",
    "",
  ].join("\n");
}

function renderSetupChecklist(instance) {
  return [
    "# Sable First-Run Setup",
    "",
    "Use this checklist before treating this instance as ready for daily use.",
    "",
    "## Identity",
    "",
    "- [ ] Edit `AGENTS.md` and choose the assistant name, personality, tone, and operating norms you want.",
    "- [ ] Start the Signal bridge and send `/setavatar` with an attached image to set the Signal profile picture.",
    "- [ ] Send `/help` over Signal and confirm the command list works.",
    "",
    "## Runtime",
    "",
    "- [ ] Fill private Signal settings in the bridge `.env` file.",
    "- [ ] Run `npm run sable:doctor -- --home-dir " + instance.homeDir + "` from the Sable repo.",
    "- [ ] Install and start the user service if this should run continuously.",
    "",
    "## Scheduling",
    "",
    "- [ ] Review default workflows in `domains/orchestrator/schedules/default-scheduler-jobs.json`.",
    "- [ ] Add personal/local recurring workflows to `domains/orchestrator/schedules/scheduler-jobs.json`.",
    "- [ ] Keep default workflows separate from local workflows so upgrades can refresh Sable defaults without trampling personal routines.",
    "",
    "## Domains",
    "",
    "- [ ] Add any private starting context to `TODO.md` and the relevant `domains/<domain>/projects/` directory.",
    "- [ ] Keep code in `domains/coding/projects/` and domain context next to the domain that owns it.",
    "",
  ].join("\n");
}

function renderMemoryArchitecture() {
  return [
    "# Current Domain Architecture",
    "",
    "This document codifies this Sable instance's domain architecture. Update it whenever the architecture itself changes.",
    "",
    "## Core Premise",
    "",
    "`domains/` is canonical. Memory is folded into domain/project state instead of treated as its own top-level product.",
    "",
    "## Domain Layers",
    "",
    "| Domain | Canonical location | Purpose |",
    "| --- | --- | --- |",
    "| Shared | `domains/shared/` | Common profiles and skills |",
    "| Orchestrator | `domains/orchestrator/` | Routing, schedules, callbacks, run ledgers, synthesis |",
    "| Coding | `domains/coding/` | Repos, implementation, tests, deployments |",
    "| Research | `domains/research/` | Experiments, traces, benchmarks, evidence maps |",
    "| Work | `domains/work/` | Work/org context, meetings, strategy, agendas |",
    "| Ops | `domains/ops/` | Admin, finance/taxes, travel, household workflows |",
    "| Archive | `domains/archive/` | Inactive historical retrieval |",
    "",
    "## Indexing Rules",
    "",
    "- `TODO.md` should stay a thin index into task files.",
    "- `domains/README.md` maps the top-level domain architecture.",
    "- substantial projects should expose a source-of-truth block linking repo, tasks, status/context, research, and archive/progress.",
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
    "If a change alters where domain state belongs, how it is indexed, how project/research context is structured, how improvement loops operate, or what conventions future Sable instances should inherit, update this file and append to `ARCHITECTURE_LOG.md` in the same pass.",
    "",
  ].join("\n");
}

function renderMemoryArchitectureLog() {
  return [
    "# Domain Architecture Log",
    "",
    "This log records changes to the domain architecture itself: structure, indexing rules, templates, scheduled improvement loops, and conventions that should carry forward to future Sable instances.",
    "",
    "## Initial",
    "",
    "- Instance initialized with domain-first project layers, seed evals, default dreaming, default maintenance, and the architecture change rule.",
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
    "- `domains/coding/projects/sable/TASKS.md`",
    "- `domains/coding/projects/sable/knowledge/`",
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
    "- `domains/README.md`",
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
    "Current state: this instance has the default domain-first architecture and a seed eval suite. The daily silent maintenance loop should score a few probes, fix at most one low-risk generalizable issue, and log metrics under `domains/orchestrator/projects/domain-architecture/metrics/`.",
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
  renderSetupChecklist,
  renderMemoryArchitecture,
  renderMemoryArchitectureLog,
  renderMemoryEvalSuite,
  renderMemoryReadme,
  renderMemoryTaskFile,
};
