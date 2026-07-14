const path = require("node:path");

const DEFAULT_HOME_DIR = "/home/arya";
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");

function createInstanceConfig({
  repoRoot = DEFAULT_REPO_ROOT,
  homeDir = "",
  env = process.env,
} = {}) {
  const resolvedHomeDir = path.resolve(
    homeDir || env.SABLE_INSTANCE_HOME || env.SABLE_HOME || DEFAULT_HOME_DIR
  );
  const resolvedRepoRoot = path.resolve(env.SABLE_REPO_ROOT || repoRoot);
  const domainsRoot = path.resolve(env.SABLE_DOMAINS_ROOT || path.join(resolvedHomeDir, "domains"));
  const sharedRoot = path.resolve(env.SABLE_SHARED_ROOT || path.join(domainsRoot, "shared"));
  const orchestratorRoot = path.resolve(
    env.SABLE_ORCHESTRATOR_ROOT || path.join(domainsRoot, "orchestrator")
  );
  const codingRoot = path.resolve(env.SABLE_CODING_ROOT || path.join(domainsRoot, "coding"));
  const researchDomainRoot = path.resolve(
    env.SABLE_RESEARCH_DOMAIN_ROOT || path.join(domainsRoot, "research")
  );
  const workRoot = path.resolve(env.SABLE_WORK_ROOT || path.join(domainsRoot, "work"));
  const personalRoot = path.resolve(
    env.SABLE_PERSONAL_ROOT || env.SABLE_OPS_ROOT || path.join(domainsRoot, "personal")
  );
  const archiveRoot = path.resolve(env.SABLE_ARCHIVE_ROOT || path.join(domainsRoot, "archive"));
  const memoryRoot = path.resolve(
    env.SABLE_MEMORY_ROOT || domainsRoot
  );
  const knowledgeRoot = path.resolve(env.SABLE_KNOWLEDGE_ROOT || domainsRoot);
  const tasksRoot = path.resolve(env.SABLE_TASKS_ROOT || domainsRoot);
  const skillsRoot = path.resolve(env.SABLE_SKILLS_ROOT || path.join(sharedRoot, "skills"));
  const researchRoot = path.resolve(
    env.SABLE_RESEARCH_ROOT || path.join(researchDomainRoot, "projects")
  );
  const autotweetRoot = path.resolve(
    env.SABLE_AUTOTWEET_ROOT || path.join(orchestratorRoot, "projects", "autotweet")
  );
  const signalBridgeDir = path.resolve(
    env.SABLE_SIGNAL_BRIDGE_DIR || path.join(resolvedRepoRoot, "apps", "signal-bridge")
  );
  const codingSableRoot = path.join(codingRoot, "projects", "sable");
  const schedulesRoot = path.join(orchestratorRoot, "schedules");
  const runsRoot = path.join(orchestratorRoot, "runs");

  return {
    homeDir: resolvedHomeDir,
    repoRoot: resolvedRepoRoot,
    domainsRoot,
    sharedRoot,
    orchestratorRoot,
    codingRoot,
    researchDomainRoot,
    workRoot,
    personalRoot,
    opsRoot: personalRoot,
    archiveRoot,
    agentsPath: path.join(resolvedHomeDir, "AGENTS.md"),
    todoPath: path.join(resolvedHomeDir, "TODO.md"),
    memoryRoot,
    knowledgeRoot,
    researchRoot,
    autotweetRoot,
    signalBridgeDir,
    tasksRoot,
    skillsRoot,
    runsRoot,
    projectKnowledgeRoot: path.join(codingSableRoot, "knowledge"),
    projectTasksPath: path.join(codingSableRoot, "TASKS.md"),
    defaultSchedulerJobsPath: path.join(schedulesRoot, "default-scheduler-jobs.json"),
    schedulerJobsPath: path.join(schedulesRoot, "scheduler-jobs.json"),
    schedulerStatePath: path.join(schedulesRoot, "scheduler-state.json"),
  };
}

function redactInstancePath(value, { homeDir = DEFAULT_HOME_DIR } = {}) {
  const normalized = String(value || "");
  const resolvedHomeDir = path.resolve(homeDir || DEFAULT_HOME_DIR);

  if (normalized === resolvedHomeDir) {
    return "~";
  }
  if (normalized.startsWith(`${resolvedHomeDir}${path.sep}`)) {
    return `~${normalized.slice(resolvedHomeDir.length)}`;
  }

  return normalized.replace(/^\/home\/[^/]+/, "~");
}

module.exports = {
  DEFAULT_HOME_DIR,
  DEFAULT_REPO_ROOT,
  createInstanceConfig,
  redactInstancePath,
};
