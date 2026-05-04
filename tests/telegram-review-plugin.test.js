const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createTelegramReviewPlugin } = require("../apps/signal-bridge/telegram-review-plugin");

function createInstance(overrides = {}) {
  return {
    repoRoot: "/srv/sable-core",
    ...overrides,
  };
}

test("telegram review plugin returns E2E triage output without spawning python", async () => {
  let called = false;
  const plugin = createTelegramReviewPlugin({
    execFile: () => {
      called = true;
    },
    env: {
      SABLE_E2E_TELEGRAM_TRIAGE_OUTPUT: "Telegram queue review: 0 dialogs",
    },
    instanceConfig: createInstance(),
  });

  assert.equal(await plugin.getTriageReport(), "Telegram queue review: 0 dialogs");
  assert.equal(called, false);
});

test("telegram review plugin invokes the configured CLI with bounded args", async () => {
  let invocation = null;
  const plugin = createTelegramReviewPlugin({
    execFile: (command, args, options, callback) => {
      invocation = { command, args, options };
      callback(null, "Telegram queue review: 2 dialogs\n", "");
    },
    env: {
      SABLE_TELEGRAM_PYTHON_BIN: "/usr/local/bin/python-custom",
      SABLE_TELEGRAM_CLI_PATH: "/opt/plugins/telegram_cli.py",
      SABLE_TELEGRAM_TRIAGE_STALE_DAYS: "14",
    },
    instanceConfig: createInstance(),
  });

  assert.equal(await plugin.getTriageReport(7), "Telegram queue review: 2 dialogs");
  assert.equal(invocation.command, "/usr/local/bin/python-custom");
  assert.deepEqual(invocation.args, [
    "/opt/plugins/telegram_cli.py",
    "triage",
    "--limit",
    "7",
    "--stale-days",
    "14",
  ]);
  assert.equal(invocation.options.cwd, "/srv/sable-core");
  assert.equal(invocation.options.timeout, 30_000);
});

test("telegram review plugin defaults to instance repo CLI and normalizes bad limits", async () => {
  let invocation = null;
  const plugin = createTelegramReviewPlugin({
    execFile: (command, args, options, callback) => {
      invocation = { command, args, options };
      callback(null, "\n", "");
    },
    env: {
      SABLE_TELEGRAM_TRIAGE_LIMIT: "9",
    },
    instanceConfig: createInstance(),
  });

  assert.equal(await plugin.getTriageReport(-1), "Telegram triage returned no output.");
  assert.equal(invocation.command, "python3");
  assert.deepEqual(invocation.args, [
    path.join("/srv/sable-core", "tools", "telegram", "telegram_cli.py"),
    "triage",
    "--limit",
    "9",
    "--stale-days",
    "21",
  ]);
});

test("telegram review plugin converts CLI failures into a safe report", async () => {
  const plugin = createTelegramReviewPlugin({
    execFile: (command, args, options, callback) => {
      callback(new Error("failed"), "", "bad ".repeat(200));
    },
    env: {},
    instanceConfig: createInstance(),
    truncateText: (value, limit) => value.slice(0, limit),
  });

  const report = await plugin.getTriageReport(5);
  assert.match(report, /^Telegram triage failed: bad bad/);
  assert.ok(report.length <= "Telegram triage failed: ".length + 400);
});
