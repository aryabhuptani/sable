const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateDiscoveredPluginRegistry,
  loadPluginManifests,
  validatePluginManifest,
  validatePluginRegistry,
} = require("../tools/plugins/plugin-manifest");

test("current plugin manifests are valid and have stable IDs", () => {
  const entries = loadPluginManifests();
  const ids = entries.map((entry) => entry.manifest.id).sort();

  assert.deepEqual(ids, [
    "autoresearch",
    "autotweet",
    "browser-ops",
    "employee-control",
    "google-calendar",
    "home-assistant",
    "mattermost-transport",
    "memory-obsidian",
    "signal-transport",
    "telegram-review",
    "whatsapp-review",
  ]);

  assert.deepEqual(validatePluginRegistry(entries), []);
});

test("plugin validator rejects missing capabilities and private Arya paths", () => {
  const errors = validatePluginManifest(
    {
      id: "bad-plugin",
      name: "Bad Plugin",
      version: "0.1.0",
      pluginApiVersion: 1,
      status: "descriptive",
      category: "test",
      description: "Invalid on purpose.",
      runtime: {
        type: "node-cli",
        currentEntryPoints: ["/home/arya/private/tool.js"],
      },
      capabilities: [],
      commands: [],
      requiredConfig: [],
      requiredSecrets: [],
      diagnostics: [],
    },
    { manifestPath: "bad/plugin.json" }
  );

  assert.ok(errors.some((error) => error.includes("capabilities must be a non-empty array")));
  assert.ok(errors.some((error) => error.includes("private Arya path leaked")));
});

test("plugin registry validator rejects duplicate IDs", () => {
  const entries = [
    {
      manifestPath: "a/plugin.json",
      manifest: validManifest("duplicate-plugin"),
    },
    {
      manifestPath: "b/plugin.json",
      manifest: validManifest("duplicate-plugin"),
    },
  ];

  const errors = validatePluginRegistry(entries);
  assert.ok(errors.some((error) => error.includes("duplicate plugin id duplicate-plugin")));
});

test("discovered plugin registry permits local namespaced plugins but rejects shadowing", () => {
  const entries = [
    {
      source: "official",
      manifestPath: "plugins/telegram-review/plugin.json",
      manifest: validManifest("telegram-review"),
    },
    {
      source: "local",
      manifestPath: "/tmp/local-hello/plugin.json",
      manifest: validManifest("local-hello"),
    },
    {
      source: "local",
      manifestPath: "/tmp/telegram-review/plugin.json",
      manifest: validManifest("telegram-review"),
    },
  ];

  const errors = validateDiscoveredPluginRegistry(entries);
  assert.ok(errors.some((error) => error.includes("shadows official plugin")));
  assert.ok(errors.some((error) => error.includes("must start with local-")));
});

function validManifest(id) {
  return {
    id,
    name: "Valid Plugin",
    version: "0.1.0",
    pluginApiVersion: 1,
    status: "descriptive",
    category: "test",
    description: "Valid manifest for a test.",
    runtime: {
      type: "node-cli",
      currentEntryPoints: ["tools/test.js"],
    },
    capabilities: ["test.capability"],
    commands: [],
    requiredConfig: [],
    requiredSecrets: [],
    diagnostics: [],
  };
}
