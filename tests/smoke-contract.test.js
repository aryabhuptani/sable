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
  assert.equal(pkg.scripts["test:plugins"], "node --test tests/plugin-manifest.test.js tests/plugin-runtime.test.js tests/plugin-create.test.js");
  assert.equal(pkg.scripts["test:scheduler"], "node --test tests/scheduler-cli.test.js");
  assert.equal(pkg.scripts["test:kb"], "node --test tests/knowledge-base-init.test.js tests/autoresearch-init.test.js tests/autoresearch-archive.test.js");
  assert.equal(pkg.scripts["test:autotweet"], "node --test tests/autotweet.test.js");
  assert.equal(pkg.scripts["test:homeassistant"], "python3 -m unittest tests/test_homeassistant_plugin.py tests/test_homeassistant_cli.py");
  assert.equal(pkg.scripts["test:humidifier"], "python3 -m unittest tests/test_humidifier_low_water_signal.py");
  assert.equal(pkg.scripts["test:telegram"], "python3 -m unittest tests/test_telegram_cli.py");
  assert.equal(pkg.scripts["test:signal-attachment"], "node --test tests/test_signal_attachment_cli.js");
  assert.equal(pkg.scripts["plugin:create"], "node tools/plugins/create-plugin.js");
  assert.equal(pkg.scripts["shareability:check"], "node tools/shareability/check.js");
  assert.equal(pkg.scripts["simulate:fresh-clone"], "node tools/community/fresh-clone-sim.js");
  assert.equal(pkg.scripts["upgrade"], "node tools/upgrade/upgrade.js run");
  assert.equal(pkg.scripts["upgrade:check"], "node tools/upgrade/upgrade.js check");
  assert.ok(pkg.scripts["test:community"].includes("npm run shareability:check"));
  assert.equal(pkg.scripts["init:instance"], "node tools/instance/init-instance.js");
  assert.equal(pkg.scripts["install:user-service"], "node tools/service/user-service.js install");
  assert.equal(pkg.scripts["uninstall:user-service"], "node tools/service/user-service.js uninstall");
  assert.equal(pkg.scripts["service:restart"], "node tools/service/user-service.js restart");
  assert.equal(pkg.scripts["service:start"], "node tools/service/user-service.js start");
  assert.equal(pkg.scripts["service:status"], "node tools/service/user-service.js status");
  assert.equal(pkg.scripts["service:stop"], "node tools/service/user-service.js stop");
});

test("current Sable core candidates are present before architecture extraction", () => {
  [
    "apps/signal-bridge/bridge.js",
    "apps/signal-bridge/app-server-message-helpers.js",
    "apps/signal-bridge/app-server-turn-runner.js",
    "apps/signal-bridge/bridge-config.js",
    "apps/signal-bridge/bridge-codex-client.js",
    "apps/signal-bridge/bridge-commands.js",
    "apps/signal-bridge/bridge-lifecycle.js",
    "apps/signal-bridge/bridge-job-runtime.js",
    "apps/signal-bridge/bridge-queue-runtime.js",
    "apps/signal-bridge/bridge-scheduler-runtime.js",
    "apps/signal-bridge/bridge-state-store.js",
    "apps/signal-bridge/bridge-test-support.js",
    "apps/signal-bridge/bridge-utils.js",
    "apps/signal-bridge/codex-session-reader.js",
    "apps/signal-bridge/autoresearch-monitor.js",
    "apps/signal-bridge/job-control.js",
    "apps/signal-bridge/live-update-channel.js",
    "apps/signal-bridge/obsidian-link-plugin.js",
    "apps/signal-bridge/plugin-auth-manager.js",
    "apps/signal-bridge/plugin-runtime.js",
    "apps/signal-bridge/runner-adapter.js",
    "apps/signal-bridge/scheduled-attachment-discovery.js",
    "apps/signal-bridge/signal-attachment-plugin.js",
    "apps/signal-bridge/signal-inbound-plugin.js",
    "apps/signal-bridge/signal-profile-plugin.js",
    "apps/signal-bridge/signal-reply-channel.js",
    "apps/signal-bridge/signal-rpc-session.js",
    "apps/signal-bridge/telegram-review-plugin.js",
    "apps/signal-bridge/voice-note-plugin.js",
    "apps/signal-bridge/scheduler.js",
    "apps/signal-bridge/scheduler_cli.js",
    "tools/homeassistant/homeassistant_plugin.py",
    "tools/homeassistant/homeassistant_cli.py",
    "tools/homeassistant/humidifier_low_water_signal.py",
    "tools/telegram/telegram_cli.py",
    "tools/autotweet/run-draft-cycle.js",
    "tools/autotweet/typefully-cli.js",
    "tools/knowledge-base/init-autoresearch-run.js",
    "tools/knowledge-base/init-topic.js",
    "tools/plugins/plugin-manifest.js",
    "tools/plugins/create-plugin.js",
    "tools/shareability/check.js",
    "tools/community/fresh-clone-sim.js",
    "tools/upgrade/upgrade.js",
    "tools/doctor/sable-doctor.js",
    "tools/instance/instance-config.js",
    "tools/instance/init-instance.js",
    "tools/instance/instance_config.py",
    "tools/background-job/background-job.js",
    "tools/obsidian-link/ensure-serve.js",
    "tools/service/user-service.js",
    "tools/signal/send_attachment.js",
    "apps/signal-bridge/.env.example",
    "tools/telegram/.env.example",
    "tools/instance/templates/sable.env.example",
    "docs/community-install.md",
    "docs/first-user-handoff.md",
    "docs/upgrade.md",
    "docs/sable-architecture-migration-checklist.md",
    "CONTRIBUTING.md",
    "DEVELOPER_PREVIEW.md",
    "plugins/schema/plugin-manifest.schema.json",
  ].forEach(assertFile);
});

test("local durable operating docs exist outside the shareable runtime", () => {
  const instance = createInstanceConfig();

  [
    instance.agentsPath,
    instance.todoPath,
    path.join(instance.skillsRoot, "INDEX.md"),
    path.join(instance.skillsRoot, "home-assistant-management", "SKILL.md"),
    path.join(instance.skillsRoot, "telegram-review", "SKILL.md"),
    path.join(instance.skillsRoot, "tweet-ideas", "SKILL.md"),
    path.join(instance.projectKnowledgeRoot, "outputs", "2026-05-04-community-sable-plan.md"),
  ].forEach((absolutePath) => {
    assert.equal(fs.statSync(absolutePath).isFile(), true, `${absolutePath} should exist`);
  });
});
