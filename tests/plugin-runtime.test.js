const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPluginRuntime } = require("../apps/signal-bridge/plugin-runtime");

test("plugin runtime loads a local command and dispatches it", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-plugin-runtime-"));
  const repoRoot = path.join(temp, "repo");
  const instanceHome = path.join(temp, "instance");
  const pluginRoot = path.join(instanceHome, "plugins");
  const pluginDir = path.join(pluginRoot, "local-hello");
  fs.mkdirSync(path.join(repoRoot, "plugins"), { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify(
      {
        id: "local-hello",
        name: "Local Hello",
        version: "0.1.0",
        pluginApiVersion: 1,
        status: "experimental",
        category: "local",
        description: "Test plugin.",
        runtime: { type: "node-module", entry: "handler.js" },
        capabilities: ["commands.hello"],
        commands: [{ name: "/hello", description: "Say hello." }],
        requiredConfig: [],
        requiredSecrets: [],
        diagnostics: [],
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(pluginDir, "handler.js"),
    `"use strict";\nfunction registerPlugin(api) {\n  api.registerCommand("/hello", async ({ args }) => \`hello \${args}\`, { description: "Say hello." });\n}\nmodule.exports = { registerPlugin };\n`
  );

  const replies = [];
  const runtime = createPluginRuntime({
    env: {},
    instanceConfig: { homeDir: instanceHome },
    repoRoot,
    sendReply: async (recipient, text) => replies.push({ recipient, text }),
  });

  const command = runtime.parsePluginCommand("/hello Chris");
  assert.equal(command.type, "plugin-command");
  assert.equal(command.args, "Chris");
  assert.equal(command.pluginId, "local-hello");

  const handled = await runtime.dispatch({ sender: "+1555", command });
  assert.equal(handled, true);
  assert.deepEqual(replies, [{ recipient: "+1555", text: "hello Chris" }]);
  assert.match(runtime.formatStatus(), /Active plugins: 1/);
  assert.match(
    runtime.formatStatus(),
    /Local Hello \(local-hello, local, experimental\/local\) - commands: \/hello/
  );
  assert.match(runtime.formatStatus(), /\/hello \(local-hello\)/);
});

test("plugin runtime rejects local plugins that shadow official ids", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-plugin-shadow-"));
  const repoRoot = path.join(temp, "repo");
  const officialDir = path.join(repoRoot, "plugins", "telegram-review");
  const localRoot = path.join(temp, "instance", "plugins");
  const localDir = path.join(localRoot, "telegram-review");
  fs.mkdirSync(officialDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });
  const manifest = {
    id: "telegram-review",
    name: "Telegram Review",
    version: "0.1.0",
    pluginApiVersion: 1,
    status: "descriptive",
    category: "test",
    description: "Test.",
    runtime: { type: "node-cli" },
    capabilities: ["test"],
    commands: [],
    requiredConfig: [],
    requiredSecrets: [],
    diagnostics: [],
  };
  fs.writeFileSync(path.join(officialDir, "plugin.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(localDir, "plugin.json"), JSON.stringify(manifest));

  const runtime = createPluginRuntime({
    env: {},
    instanceConfig: { homeDir: path.join(temp, "instance") },
    repoRoot,
  });

  assert.ok(runtime.validationErrors.some((error) => error.includes("shadows official plugin")));
  assert.match(runtime.formatStatus(), /Active plugins: 1/);
  assert.match(runtime.formatStatus(), /Telegram Review \(telegram-review, official, descriptive\/test\)/);
});
