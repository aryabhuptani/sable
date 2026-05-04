const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createInstanceConfig } = require("../tools/instance/instance-config");

const REPO_ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function assertFile(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  assert.equal(fs.statSync(absolutePath).isFile(), true, `${relativePath} should exist`);
}

test("smoke gate script covers the current migration-critical surfaces", () => {
  const pkg = readJson("package.json");

  assert.equal(pkg.scripts["test:smoke"], "node tools/smoke/run-smoke-tests.js");
  assert.equal(pkg.scripts["test:e2e"], "node --test tests/e2e/*.test.js");
  assert.equal(pkg.scripts["test:doctor"], "node --test tests/sable-doctor.test.js");
  assert.equal(pkg.scripts["test:instance"], "node --test tests/instance-config.test.js");
  assert.equal(pkg.scripts["test:instance:py"], "python3 -m unittest tests/test_instance_config.py");
  assert.equal(pkg.scripts["test:plugins"], "node --test tests/plugin-manifest.test.js");
  assert.equal(pkg.scripts["test:scheduler"], "node --test tests/scheduler-cli.test.js");
  assert.equal(pkg.scripts["test:kb"], "node --test tests/knowledge-base-init.test.js tests/autoresearch-init.test.js");
  assert.equal(pkg.scripts["test:autotweet"], "node --test tests/autotweet.test.js");
  assert.equal(pkg.scripts["test:homeassistant"], "python3 -m unittest tests/test_homeassistant_cli.py");
  assert.equal(pkg.scripts["test:humidifier"], "python3 -m unittest tests/test_humidifier_low_water_signal.py");
  assert.equal(pkg.scripts["test:telegram"], "python3 -m unittest tests/test_telegram_cli.py");
  assert.equal(pkg.scripts["test:signal-attachment"], "node --test tests/test_signal_attachment_cli.js");
});

test("current Sable core candidates are present before architecture extraction", () => {
  [
    "apps/signal-bridge/bridge.js",
    "apps/signal-bridge/bridge-codex-client.js",
    "apps/signal-bridge/bridge-commands.js",
    "apps/signal-bridge/runner-adapter.js",
    "apps/signal-bridge/scheduler.js",
    "apps/signal-bridge/scheduler_cli.js",
    "tools/homeassistant/homeassistant_cli.py",
    "tools/homeassistant/humidifier_low_water_signal.py",
    "tools/telegram/telegram_cli.py",
    "tools/autotweet/run-draft-cycle.js",
    "tools/autotweet/typefully-cli.js",
    "tools/knowledge-base/init-autoresearch-run.js",
    "tools/knowledge-base/init-topic.js",
    "tools/plugins/plugin-manifest.js",
    "tools/doctor/sable-doctor.js",
    "tools/instance/instance-config.js",
    "tools/instance/instance_config.py",
    "tools/signal/send_attachment.js",
    "docs/community-install.md",
    "docs/sable-architecture-migration-checklist.md",
    "plugins/schema/plugin-manifest.schema.json",
  ].forEach(assertFile);
});

test("local durable operating docs exist outside the shareable runtime", () => {
  const instance = createInstanceConfig();

  [
    instance.agentsPath,
    instance.todoPath,
    path.join(instance.skillsRoot, "home-assistant-management", "SKILL.md"),
    path.join(instance.skillsRoot, "telegram-review", "SKILL.md"),
    path.join(instance.skillsRoot, "tweet-ideas", "SKILL.md"),
    path.join(instance.projectKnowledgeRoot, "outputs", "2026-05-04-community-sable-plan.md"),
  ].forEach((absolutePath) => {
    assert.equal(fs.statSync(absolutePath).isFile(), true, `${absolutePath} should exist`);
  });
});
