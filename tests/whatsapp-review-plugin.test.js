const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createWhatsAppReviewPlugin } = require("../apps/signal-bridge/whatsapp-review-plugin");

function createInstance(overrides = {}) {
  return {
    repoRoot: "/srv/sable-core",
    ...overrides,
  };
}

test("whatsapp review plugin returns E2E triage output without spawning node", async () => {
  let called = false;
  const plugin = createWhatsAppReviewPlugin({
    execFile: () => {
      called = true;
    },
    env: {
      SABLE_E2E_WHATSAPP_TRIAGE_OUTPUT: "WhatsApp queue review: 0 approved chats surfaced.",
    },
    instanceConfig: createInstance(),
  });

  assert.equal(await plugin.getTriageReport(), "WhatsApp queue review: 0 approved chats surfaced.");
  assert.equal(called, false);
});

test("whatsapp review plugin invokes the configured CLI with bounded args", async () => {
  let invocation = null;
  const plugin = createWhatsAppReviewPlugin({
    execFile: (command, args, options, callback) => {
      invocation = { command, args, options };
      callback(null, "WhatsApp queue review: 2 approved chats surfaced.\n", "");
    },
    env: {
      SABLE_WHATSAPP_NODE_BIN: "/usr/local/bin/node-custom",
      SABLE_WHATSAPP_CLI_PATH: "/opt/plugins/whatsapp_cli.js",
      SABLE_WHATSAPP_TRIAGE_STALE_DAYS: "14",
    },
    instanceConfig: createInstance(),
  });

  assert.equal(await plugin.getTriageReport(7), "WhatsApp queue review: 2 approved chats surfaced.");
  assert.equal(invocation.command, "/usr/local/bin/node-custom");
  assert.deepEqual(invocation.args, [
    "/opt/plugins/whatsapp_cli.js",
    "triage",
    "--limit",
    "7",
    "--stale-days",
    "14",
  ]);
  assert.equal(invocation.options.cwd, "/srv/sable-core");
  assert.equal(invocation.options.timeout, 60_000);
});

test("whatsapp review plugin defaults to instance repo CLI and normalizes bad limits", async () => {
  let invocation = null;
  const plugin = createWhatsAppReviewPlugin({
    execFile: (command, args, options, callback) => {
      invocation = { command, args, options };
      callback(null, "\n", "");
    },
    env: {
      SABLE_WHATSAPP_TRIAGE_LIMIT: "9",
    },
    instanceConfig: createInstance(),
  });

  assert.equal(await plugin.getTriageReport(-1), "WhatsApp triage returned no output.");
  assert.deepEqual(invocation.args, [
    path.join("/srv/sable-core", "tools", "whatsapp", "whatsapp_cli.js"),
    "triage",
    "--limit",
    "9",
    "--stale-days",
    "21",
  ]);
});

test("whatsapp review plugin converts CLI failures into a safe report", async () => {
  const plugin = createWhatsAppReviewPlugin({
    execFile: (command, args, options, callback) => {
      callback(new Error("failed"), "", "bad ".repeat(200));
    },
    env: {},
    instanceConfig: createInstance(),
    truncateText: (value, limit) => value.slice(0, limit),
  });

  const report = await plugin.getTriageReport(5);
  assert.match(report, /^WhatsApp triage failed: bad bad/);
  assert.ok(report.length <= "WhatsApp triage failed: ".length + 500);
});
