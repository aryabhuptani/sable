const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPlugin, parseArgs } = require("../tools/plugins/create-plugin");

test("plugin create scaffolds a local plugin under instance home", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-plugin-create-"));
  const repoRoot = path.join(temp, "repo");
  const instanceHome = path.join(temp, "instance");
  fs.mkdirSync(repoRoot, { recursive: true });

  const result = createPlugin({
    env: { SABLE_INSTANCE_HOME: instanceHome },
    id: "local-hello",
    repoRoot,
    target: "local",
  });

  assert.equal(result.pluginDir, path.join(instanceHome, "plugins", "local-hello"));
  assert.equal(fs.existsSync(path.join(result.pluginDir, "plugin.json")), true);
  assert.equal(fs.existsSync(path.join(result.pluginDir, "handler.js")), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.pluginDir, "plugin.json"), "utf8"));
  assert.equal(manifest.id, "local-hello");
  assert.equal(manifest.pluginApiVersion, 1);

  const second = createPlugin({
    env: { SABLE_INSTANCE_HOME: instanceHome },
    id: "local-hello",
    repoRoot,
    target: "local",
  });
  assert.equal(second.created.length, 0);
  assert.equal(second.skipped.length, 4);
});

test("plugin create parser and target policy are strict", () => {
  const parsed = parseArgs(["--id", "local-one", "--target", "repo"]);
  assert.equal(parsed.id, "local-one");
  assert.equal(parsed.target, "repo");
  assert.equal(parsed.repoRoot, path.resolve(__dirname, ".."));

  assert.throws(
    () => createPlugin({ id: "hello", repoRoot: "/tmp/sable", target: "local" }),
    /Local plugin ids must start with local-/
  );
});
