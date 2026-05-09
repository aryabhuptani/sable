const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  getInstanceEnvPath,
  initInstance,
  parseArgs,
  renderInstanceEnv,
} = require("../tools/instance/init-instance");
const { createInstanceConfig } = require("../tools/instance/instance-config");

test("init instance creates private state and generated env without overwriting", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "sable-instance-"));
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), "sable-repo-"));

  try {
    const first = initInstance({
      homeDir: tempHome,
      logger: null,
      repoRoot: tempRepo,
    });
    const instance = first.instance;

    for (const targetPath of [
      instance.agentsPath,
      instance.todoPath,
      instance.projectTasksPath,
      path.join(instance.memoryRoot, "README.md"),
      path.join(instance.knowledgeRoot, "projects", "memory", "ARCHITECTURE.md"),
      path.join(instance.knowledgeRoot, "projects", "memory", "ARCHITECTURE_LOG.md"),
      path.join(instance.knowledgeRoot, "projects", "memory", "evals", "MEMORY_EVALS.md"),
      path.join(instance.knowledgeRoot, "projects", "memory", "metrics"),
      path.join(instance.tasksRoot, "projects", "memory", "TODO.md"),
      instance.defaultSchedulerJobsPath,
      instance.schedulerJobsPath,
      getInstanceEnvPath(instance),
      path.join(instance.homeDir, "plugins"),
      path.join(instance.homeDir, ".codex-bridge"),
    ]) {
      assert.equal(await exists(targetPath), true, `${targetPath} should exist`);
    }

    await fs.writeFile(instance.todoPath, "custom todo\n", "utf8");
    const second = initInstance({
      homeDir: tempHome,
      logger: null,
      repoRoot: tempRepo,
    });
    assert.equal(await fs.readFile(instance.todoPath, "utf8"), "custom todo\n");
    assert.ok(second.skipped.some((entry) => entry.endsWith("TODO.md")));
    assert.equal(second.overwritten.length, 0);
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test("init instance can reset generated files without overwriting user notes", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "sable-instance-"));

  try {
    const first = initInstance({ homeDir: tempHome, logger: null });
    await fs.writeFile(first.instance.defaultSchedulerJobsPath, "{\"jobs\":[{\"id\":\"old-default\"}]}\n", "utf8");
    await fs.writeFile(first.instance.schedulerJobsPath, "{\"jobs\":[{\"id\":\"old\"}]}\n", "utf8");
    await fs.writeFile(first.instance.agentsPath, "custom agents\n", "utf8");

    const second = initInstance({
      homeDir: tempHome,
      logger: null,
      resetGenerated: true,
    });

    const defaultSchedulerJobs = await fs.readFile(first.instance.defaultSchedulerJobsPath, "utf8");
    assert.match(defaultSchedulerJobs, /default-dreaming/);
    assert.match(defaultSchedulerJobs, /default-memory-eval/);
    assert.equal(await fs.readFile(first.instance.schedulerJobsPath, "utf8"), "{\"jobs\":[]}\n");
    assert.equal(await fs.readFile(first.instance.agentsPath, "utf8"), "custom agents\n");
    assert.ok(second.overwritten.some((entry) => entry.endsWith("default-scheduler-jobs.json")));
    assert.ok(second.overwritten.some((entry) => entry.endsWith("scheduler-jobs.json")));
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test("rendered instance env points runtime paths at the private instance", () => {
  const instance = createInstanceConfig({
    homeDir: "/srv/sable-user",
    repoRoot: "/opt/sable",
  });
  const env = renderInstanceEnv(instance);

  assert.match(env, /SABLE_INSTANCE_HOME=\/srv\/sable-user/);
  assert.match(env, /SABLE_REPO_ROOT=\/opt\/sable/);
  assert.match(env, /SABLE_CODEX_CWD=\/srv\/sable-user/);
  assert.match(env, /SABLE_DEFAULT_SCHEDULER_JOBS_PATH=\/srv\/sable-user\/memory\/tasks\/projects\/sable\/default-scheduler-jobs\.json/);
  assert.match(env, /SABLE_PLUGIN_PATHS=\/srv\/sable-user\/plugins/);
  assert.match(env, /CODEX_HOME=\/srv\/sable-user\/\.codex-bridge/);
});

test("init instance parser supports home, repo, and overwrite flags", () => {
  const options = parseArgs([
    "--instance-home",
    "/tmp/instance",
    "--repo-root",
    "/tmp/repo",
    "--force",
    "--reset-generated",
  ]);

  assert.equal(options.homeDir, "/tmp/instance");
  assert.equal(options.repoRoot, "/tmp/repo");
  assert.equal(options.force, true);
  assert.equal(options.resetGenerated, true);
});

async function exists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}
