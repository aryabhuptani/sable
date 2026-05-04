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
  assert.equal(config.memoryRoot, "/home/arya/memory");
  assert.equal(config.knowledgeRoot, "/home/arya/memory/knowledge");
  assert.equal(config.researchRoot, "/home/arya/memory/knowledge/research");
  assert.equal(config.autotweetRoot, "/home/arya/memory/knowledge/projects/sable/autotweet");
  assert.equal(config.signalBridgeDir, "/home/arya/projects/sable/apps/signal-bridge");
  assert.equal(config.tasksRoot, "/home/arya/memory/tasks");
  assert.equal(config.skillsRoot, "/home/arya/skills");
  assert.equal(config.agentsPath, "/home/arya/AGENTS.md");
  assert.equal(config.todoPath, "/home/arya/TODO.md");
});

test("instance config supports future non-Arya install paths through env overrides", () => {
  const config = createInstanceConfig({
    repoRoot: "/opt/sable",
    env: {
      SABLE_INSTANCE_HOME: "/srv/alex",
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
  assert.equal(config.memoryRoot, "/data/alex/memory");
  assert.equal(config.knowledgeRoot, "/data/alex/memory/knowledge");
  assert.equal(config.researchRoot, "/data/alex/research");
  assert.equal(config.autotweetRoot, "/data/alex/autotweet");
  assert.equal(config.signalBridgeDir, "/srv/alex/signal-bridge");
  assert.equal(config.tasksRoot, "/data/alex/memory/tasks");
  assert.equal(config.skillsRoot, "/data/alex/skills");
});

test("instance config supports explicit home dir over env defaults", () => {
  const config = createInstanceConfig({
    homeDir: "/tmp/sable-user",
    env: {
      SABLE_INSTANCE_HOME: "/srv/ignored",
    },
  });

  assert.equal(config.homeDir, "/tmp/sable-user");
  assert.equal(config.memoryRoot, path.join("/tmp/sable-user", "memory"));
});

test("instance path redaction uses the active instance home", () => {
  assert.equal(
    redactInstancePath("/srv/alex/memory/tasks/TODO.md", { homeDir: "/srv/alex" }),
    "~/memory/tasks/TODO.md"
  );
  assert.equal(redactInstancePath("/home/arya/.codex-bridge"), "~/.codex-bridge");
});
