#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const { CURRENT_PLUGIN_API_VERSION } = require("./plugin-manifest");
const { createInstanceConfig } = require("../instance/instance-config");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    id: "",
    repoRoot: path.resolve(__dirname, "..", ".."),
    target: "local",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") {
      options.id = argv[++index] || "";
    } else if (arg === "--target") {
      options.target = argv[++index] || "";
    } else if (arg === "--repo-root") {
      options.repoRoot = path.resolve(argv[++index] || options.repoRoot);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function createPlugin({ env = process.env, fsModule = fs, id, repoRoot, target = "local" }) {
  const pluginId = normalizePluginId(id);
  if (!pluginId) {
    throw new Error("Pass --id with a lowercase kebab-case plugin id");
  }
  if (!["local", "repo"].includes(target)) {
    throw new Error("--target must be local or repo");
  }
  if (target === "local" && !pluginId.startsWith("local-")) {
    throw new Error("Local plugin ids must start with local- so they cannot shadow official plugins");
  }

  const instance = createInstanceConfig({ env, repoRoot });
  const pluginDir =
    target === "repo"
      ? path.join(repoRoot, "plugins", pluginId)
      : path.join(instance.homeDir, "plugins", pluginId);
  fsModule.mkdirSync(pluginDir, { recursive: true });
  const files = {
    "plugin.json": renderManifest(pluginId),
    "README.md": renderReadme(pluginId, target),
    "handler.js": renderHandler(pluginId),
    "handler.test.js": renderTest(pluginId),
  };
  const created = [];
  const skipped = [];
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(pluginDir, name);
    if (fsModule.existsSync(filePath)) {
      skipped.push(filePath);
      continue;
    }
    fsModule.writeFileSync(filePath, content);
    created.push(filePath);
  }
  return { created, pluginDir, skipped, target };
}

function renderManifest(id) {
  return `${JSON.stringify(
    {
      $schema: "../../projects/sable/plugins/schema/plugin-manifest.schema.json",
      id,
      name: titleize(id),
      version: "0.1.0",
      pluginApiVersion: CURRENT_PLUGIN_API_VERSION,
      status: "experimental",
      category: "local",
      description: "Local Sable plugin.",
      runtime: {
        type: "node-module",
        entry: "handler.js",
      },
      capabilities: ["commands.example"],
      commands: [
        {
          name: `/${id.replace(/^local-/, "")}`,
          description: "Example local command.",
        },
      ],
      requiredConfig: [],
      requiredSecrets: [],
      diagnostics: [],
    },
    null,
    2
  )}\n`;
}

function renderReadme(id, target) {
  return `# ${titleize(id)}\n\n${target === "local" ? "Local" : "Repo"} Sable plugin scaffold.\n\nRun \`/plugins\` in Signal after restarting Sable to confirm that this plugin loaded.\n`;
}

function renderHandler(id) {
  const commandName = `/${id.replace(/^local-/, "")}`;
  return `"use strict";\n\nfunction registerPlugin(api) {\n  api.registerCommand("${commandName}", async ({ args }) => {\n    const suffix = args ? \` \${args}\` : "";\n    return \`${titleize(id)} received\${suffix}\`;\n  }, {\n    description: "Example local command.",\n  });\n}\n\nmodule.exports = { registerPlugin };\n`;
}

function renderTest(id) {
  return `const assert = require("node:assert/strict");\nconst test = require("node:test");\nconst { registerPlugin } = require("./handler");\n\ntest("${id} registers a command", async () => {\n  const commands = [];\n  registerPlugin({\n    registerCommand: (name, handler) => commands.push({ name, handler }),\n  });\n  assert.equal(commands.length, 1);\n  assert.equal(await commands[0].handler({ args: "test" }), "${titleize(id)} received test");\n});\n`;
}

function formatResult(result) {
  const lines = [`Plugin scaffolded at ${result.pluginDir}`];
  if (result.created.length > 0) {
    lines.push("Created:");
    for (const filePath of result.created) {
      lines.push(`- ${filePath}`);
    }
  }
  if (result.skipped.length > 0) {
    lines.push("Skipped existing:");
    for (const filePath of result.skipped) {
      lines.push(`- ${filePath}`);
    }
  }
  lines.push("Next: restart Sable and send /plugins.");
  return lines.join("\n");
}

function normalizePluginId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id) ? id : "";
}

function titleize(id) {
  return String(id)
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

if (require.main === module) {
  try {
    const options = parseArgs();
    if (options.help) {
      console.log("Usage: npm run plugin:create -- --id local-hello [--target local|repo]");
      process.exit(0);
    }
    console.log(formatResult(createPlugin(options)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  createPlugin,
  formatResult,
  parseArgs,
  renderHandler,
  renderManifest,
};
