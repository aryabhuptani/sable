#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const suites = [
  {
    name: "migration contract",
    command: "node",
    args: [
      "--test",
      "tests/smoke-contract.test.js",
      "tests/app-server-message-helpers.test.js",
      "tests/app-server-turn-runner.test.js",
      "tests/autoresearch-monitor.test.js",
      "tests/bridge-codex-client.test.js",
      "tests/bridge-lifecycle.test.js",
      "tests/bridge-job-runtime.test.js",
      "tests/bridge-scheduler-runtime.test.js",
      "tests/bridge-state-store.test.js",
      "tests/bridge-test-support.test.js",
      "tests/bridge-utils.test.js",
      "tests/codex-session-reader.test.js",
      "tests/job-control.test.js",
      "tests/live-update-channel.test.js",
      "tests/obsidian-link-plugin.test.js",
      "tests/plugin-auth-manager.test.js",
      "tests/runner-adapter.test.js",
      "tests/scheduled-attachment-discovery.test.js",
      "tests/signal-attachment-plugin.test.js",
      "tests/signal-inbound-plugin.test.js",
      "tests/signal-profile-plugin.test.js",
      "tests/signal-reply-channel.test.js",
      "tests/signal-rpc-session.test.js",
      "tests/telegram-review-plugin.test.js",
      "tests/voice-note-plugin.test.js",
      "tests/test_bridge_commands.js",
      "tests/test_signal_attachment_cli.js",
    ],
  },
  {
    name: "Signal bridge E2E",
    command: "npm",
    args: ["run", "test:e2e"],
  },
  {
    name: "scheduler CLI",
    command: "npm",
    args: ["run", "test:scheduler"],
  },
  {
    name: "sable doctor",
    command: "npm",
    args: ["run", "test:doctor"],
  },
  {
    name: "instance config",
    command: "npm",
    args: ["run", "test:instance"],
  },
  {
    name: "Python instance config",
    command: "npm",
    args: ["run", "test:instance:py"],
  },
  {
    name: "plugin manifests",
    command: "npm",
    args: ["run", "test:plugins"],
  },
  {
    name: "knowledge base and autoresearch",
    command: "npm",
    args: ["run", "test:kb"],
  },
  {
    name: "autotweet",
    command: "npm",
    args: ["run", "test:autotweet"],
  },
  {
    name: "Home Assistant CLI",
    command: "npm",
    args: ["run", "test:homeassistant"],
  },
  {
    name: "humidifier low-water watcher",
    command: "npm",
    args: ["run", "test:humidifier"],
  },
  {
    name: "Telegram CLI",
    command: "npm",
    args: ["run", "test:telegram"],
  },
];

function runSuite(suite) {
  console.log(`\n==> ${suite.name}`);
  const result = spawnSync(suite.command, suite.args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Smoke suite failed to start: ${result.error.message}`);
    return 1;
  }

  return result.status || 0;
}

function main() {
  for (const suite of suites) {
    const status = runSuite(suite);
    if (status !== 0) {
      console.error(`\nSmoke gate failed in suite: ${suite.name}`);
      process.exit(status);
    }
  }

  console.log("\nSable smoke gate passed.");
}

main();
