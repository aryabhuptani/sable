const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createInstanceConfig,
  redactInstancePath,
} = require("../tools/instance/instance-config");

test("instance config defaults to Arya's current local layout", () => {
  const config = createInstanceConfig({ env: {} });

  assert.equal(config.homeDir, "/home/arya");
  assert.equal(config.domainsRoot, "/home/arya/domains");
  assert.equal(config.sharedRoot, "/home/arya/domains/shared");
  assert.equal(config.orchestratorRoot, "/home/arya/domains/orchestrator");
  assert.equal(config.codingRoot, "/home/arya/domains/coding");
  assert.equal(config.researchDomainRoot, "/home/arya/domains/research");
  assert.equal(config.workRoot, "/home/arya/domains/work");
  assert.equal(config.personalRoot, "/home/arya/domains/personal");
  assert.equal(config.opsRoot, "/home/arya/domains/personal");
  assert.equal(config.memoryRoot, "/home/arya/domains");
  assert.equal(config.knowledgeRoot, "/home/arya/domains");
  assert.equal(config.researchRoot, "/home/arya/domains/research/projects");
  assert.equal(config.autotweetRoot, "/home/arya/domains/orchestrator/projects/autotweet");
  assert.equal(config.signalBridgeDir, "/home/arya/domains/coding/projects/sable/apps/signal-bridge");
  assert.equal(config.tasksRoot, "/home/arya/domains");
  assert.equal(config.skillsRoot, "/home/arya/domains/shared/skills");
  assert.equal(config.agentsPath, "/home/arya/AGENTS.md");
  assert.equal(config.todoPath, "/home/arya/TODO.md");
  assert.equal(config.runsRoot, "/home/arya/domains/orchestrator/runs");
  assert.equal(config.projectKnowledgeRoot, "/home/arya/domains/coding/projects/sable/knowledge");
  assert.equal(config.projectTasksPath, "/home/arya/domains/coding/projects/sable/TASKS.md");
  assert.equal(
    config.defaultSchedulerJobsPath,
    "/home/arya/domains/orchestrator/schedules/default-scheduler-jobs.json"
  );
  assert.equal(config.schedulerJobsPath, "/home/arya/domains/orchestrator/schedules/scheduler-jobs.json");
  assert.equal(config.schedulerStatePath, "/home/arya/domains/orchestrator/schedules/scheduler-state.json");
});

test("instance config supports future non-Arya install paths through env overrides", () => {
  const config = createInstanceConfig({
    repoRoot: "/opt/sable",
    env: {
      SABLE_INSTANCE_HOME: "/srv/alex",
      SABLE_DOMAINS_ROOT: "/domains/alex",
      SABLE_MEMORY_ROOT: "/data/alex/memory",
      SABLE_RESEARCH_ROOT: "/data/alex/research",
      SABLE_AUTOTWEET_ROOT: "/data/alex/autotweet",
      SABLE_SIGNAL_BRIDGE_DIR: "/srv/alex/signal-bridge",
      SABLE_SKILLS_ROOT: "/data/alex/skills",
      SABLE_REPO_ROOT: "/srv/sable-core",
    },
  });

  assert.equal(config.homeDir, "/srv/alex");
  assert.equal(config.repoRoot, "/srv/sable-core");
  assert.equal(config.domainsRoot, "/domains/alex");
  assert.equal(config.orchestratorRoot, "/domains/alex/orchestrator");
  assert.equal(config.codingRoot, "/domains/alex/coding");
  assert.equal(config.personalRoot, "/domains/alex/personal");
  assert.equal(config.opsRoot, "/domains/alex/personal");
  assert.equal(config.memoryRoot, "/data/alex/memory");
  assert.equal(config.knowledgeRoot, "/domains/alex");
  assert.equal(config.researchRoot, "/data/alex/research");
  assert.equal(config.autotweetRoot, "/data/alex/autotweet");
  assert.equal(config.signalBridgeDir, "/srv/alex/signal-bridge");
  assert.equal(config.tasksRoot, "/domains/alex");
  assert.equal(config.skillsRoot, "/data/alex/skills");
  assert.equal(config.projectKnowledgeRoot, "/domains/alex/coding/projects/sable/knowledge");
  assert.equal(config.projectTasksPath, "/domains/alex/coding/projects/sable/TASKS.md");
  assert.equal(
    config.defaultSchedulerJobsPath,
    "/domains/alex/orchestrator/schedules/default-scheduler-jobs.json"
  );
  assert.equal(config.schedulerJobsPath, "/domains/alex/orchestrator/schedules/scheduler-jobs.json");
  assert.equal(config.schedulerStatePath, "/domains/alex/orchestrator/schedules/scheduler-state.json");
});

test("instance config supports explicit home dir over env defaults", () => {
  const config = createInstanceConfig({
    homeDir: "/tmp/sable-user",
    env: {
      SABLE_INSTANCE_HOME: "/srv/ignored",
    },
  });

  assert.equal(config.homeDir, "/tmp/sable-user");
  assert.equal(config.domainsRoot, path.join("/tmp/sable-user", "domains"));
  assert.equal(config.memoryRoot, path.join("/tmp/sable-user", "domains"));
});

test("instance path redaction uses the active instance home", () => {
  assert.equal(
    redactInstancePath("/srv/alex/memory/tasks/TODO.md", { homeDir: "/srv/alex" }),
    "~/memory/tasks/TODO.md"
  );
  assert.equal(redactInstancePath("/home/arya/.codex-bridge"), "~/.codex-bridge");
});
