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
  const memoryRoot = path.resolve(env.SABLE_MEMORY_ROOT || path.join(resolvedHomeDir, "memory"));
  const knowledgeRoot = path.resolve(
    env.SABLE_KNOWLEDGE_ROOT || path.join(memoryRoot, "knowledge")
  );
  const tasksRoot = path.resolve(env.SABLE_TASKS_ROOT || path.join(memoryRoot, "tasks"));
  const skillsRoot = path.resolve(env.SABLE_SKILLS_ROOT || path.join(resolvedHomeDir, "skills"));

  return {
    homeDir: resolvedHomeDir,
    repoRoot: resolvedRepoRoot,
    agentsPath: path.join(resolvedHomeDir, "AGENTS.md"),
    todoPath: path.join(resolvedHomeDir, "TODO.md"),
    memoryRoot,
    knowledgeRoot,
    tasksRoot,
    skillsRoot,
    projectKnowledgeRoot: path.join(knowledgeRoot, "projects", "sable"),
    projectTasksPath: path.join(tasksRoot, "projects", "sable", "TODO.md"),
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
