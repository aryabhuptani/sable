"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  CURRENT_PLUGIN_API_VERSION,
  loadPluginManifests,
  loadPluginManifestsFromRoots,
  validateDiscoveredPluginRegistry,
} = require("../../tools/plugins/plugin-manifest");

function createPluginRuntime({
  env = process.env,
  instanceConfig,
  logger = console,
  repoRoot = path.resolve(__dirname, "..", ".."),
  sendReply = async () => {},
} = {}) {
  const officialRoot = path.join(repoRoot, "plugins");
  const localRoots = getLocalPluginRoots({ env, instanceConfig });
  const allowLocalShadowIds = splitList(env.SABLE_ALLOW_PLUGIN_SHADOWS);
  const officialEntries = loadPluginManifests(officialRoot).map((entry) => ({
    ...entry,
    source: "official",
  }));
  const localEntries = loadPluginManifestsFromRoots(localRoots, { source: "local" });
  const entries = [...officialEntries, ...localEntries];
  const validationErrors = validateDiscoveredPluginRegistry(entries, { allowLocalShadowIds });
  const commands = new Map();
  const diagnostics = [];

  for (const entry of entries) {
    if (validationErrors.some((error) => error.includes(entry.manifestPath))) {
      continue;
    }
    registerEntry(entry);
  }

  function registerEntry(entry) {
    const runtime = entry.manifest?.runtime || {};
    const entryPath = runtime.entry || runtime.handler || "";
    if (!entryPath) {
      return;
    }
    if (runtime.type !== "node-module") {
      diagnostics.push({
        level: "warn",
        pluginId: entry.manifest.id,
        message: `runtime.entry is ignored for unsupported runtime type ${runtime.type}`,
      });
      return;
    }

    const modulePath = path.resolve(path.dirname(entry.manifestPath), entryPath);
    try {
      const pluginModule = require(modulePath);
      const registerPlugin =
        typeof pluginModule === "function" ? pluginModule : pluginModule.registerPlugin;
      if (typeof registerPlugin !== "function") {
        diagnostics.push({
          level: "error",
          pluginId: entry.manifest.id,
          message: `${modulePath} does not export registerPlugin`,
        });
        return;
      }
      registerPlugin(buildPluginApi(entry));
    } catch (error) {
      diagnostics.push({
        level: "error",
        pluginId: entry.manifest.id,
        message: `failed loading plugin handler: ${error.message}`,
      });
    }
  }

  function buildPluginApi(entry) {
    const manifest = entry.manifest;
    return {
      apiVersion: CURRENT_PLUGIN_API_VERSION,
      config: env,
      diagnostics(handler) {
        if (typeof handler === "function") {
          diagnostics.push({
            level: "info",
            pluginId: manifest.id,
            message: "diagnostics hook registered",
            handler,
          });
        }
      },
      getConfig(name, fallback = "") {
        const value = env[name];
        return value === undefined || value === "" ? fallback : value;
      },
      instance: instanceConfig,
      logger,
      manifest,
      paths: {
        instanceHome: instanceConfig?.homeDir || "",
        pluginDir: path.dirname(entry.manifestPath),
        repoRoot,
      },
      registerCommand(name, handler, metadata = {}) {
        registerCommand({ entry, handler, metadata, name });
      },
      reply(job, message) {
        return sendReply(job.sender, message);
      },
    };
  }

  function registerCommand({ entry, handler, metadata, name }) {
    const normalizedName = normalizeCommandName(name);
    if (!normalizedName) {
      diagnostics.push({
        level: "error",
        pluginId: entry.manifest.id,
        message: `invalid command name ${name}`,
      });
      return;
    }
    if (commands.has(normalizedName)) {
      const existing = commands.get(normalizedName);
      diagnostics.push({
        level: "error",
        pluginId: entry.manifest.id,
        message: `${normalizedName} already registered by ${existing.pluginId}`,
      });
      return;
    }
    commands.set(normalizedName, {
      commandName: normalizedName,
      description: metadata.description || findCommandDescription(entry.manifest, normalizedName),
      handler,
      manifestPath: entry.manifestPath,
      pluginId: entry.manifest.id,
      pluginName: entry.manifest.name,
      source: entry.source,
    });
  }

  function parsePluginCommand(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed.startsWith("/")) {
      return null;
    }
    const [name] = trimmed.split(/\s+/, 1);
    const normalizedName = normalizeCommandName(name);
    const registration = commands.get(normalizedName);
    if (!registration) {
      return null;
    }
    const args = trimmed.slice(name.length).trim();
    return {
      type: "plugin-command",
      args,
      commandName: normalizedName,
      pluginId: registration.pluginId,
      rawText: trimmed,
    };
  }

  async function dispatch(job) {
    const registration = commands.get(job.command.commandName);
    if (!registration) {
      return false;
    }
    const result = await registration.handler({
      args: job.command.args || "",
      command: job.command,
      job,
      rawText: job.command.rawText || "",
      text: job.command.rawText || "",
    });
    if (typeof result === "string" && result.trim()) {
      await sendReply(job.sender, result);
    } else if (result?.reply) {
      await sendReply(job.sender, result.reply);
    }
    return true;
  }

  function formatStatus() {
    const lines = [
      `Plugins: ${entries.length} discovered (${officialEntries.length} official, ${localEntries.length} local).`,
      `Plugin API: v${CURRENT_PLUGIN_API_VERSION}.`,
    ];
    if (validationErrors.length > 0) {
      lines.push("", "Validation issues:");
      for (const error of validationErrors.slice(0, 8)) {
        lines.push(`- ${error}`);
      }
    }
    if (commands.size > 0) {
      lines.push("", "Commands:");
      for (const command of [...commands.values()].sort((a, b) => a.commandName.localeCompare(b.commandName))) {
        const suffix = command.description ? ` - ${command.description}` : "";
        lines.push(`- ${command.commandName} (${command.pluginId})${suffix}`);
      }
    } else {
      lines.push("", "Commands: none registered by runtime plugins yet.");
    }
    const visibleDiagnostics = diagnostics.filter((item) => item.level !== "info");
    if (visibleDiagnostics.length > 0) {
      lines.push("", "Runtime diagnostics:");
      for (const item of visibleDiagnostics.slice(0, 8)) {
        lines.push(`- ${item.pluginId}: ${item.message}`);
      }
    }
    return lines.join("\n");
  }

  return {
    commands,
    diagnostics,
    dispatch,
    entries,
    formatStatus,
    localRoots,
    parsePluginCommand,
    validationErrors,
  };
}

function findCommandDescription(manifest, commandName) {
  const command = (manifest.commands || []).find((entry) => entry.name === commandName);
  return command?.description || "";
}

function getLocalPluginRoots({ env = process.env, instanceConfig } = {}) {
  const roots = splitList(env.SABLE_PLUGIN_PATHS);
  if (instanceConfig?.homeDir) {
    roots.push(path.join(instanceConfig.homeDir, "plugins"));
  }
  return [...new Set(roots.map((root) => path.resolve(root)).filter((root) => fs.existsSync(root)))];
}

function normalizeCommandName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function splitList(value) {
  return String(value || "")
    .split(path.delimiter)
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);
}

module.exports = {
  createPluginRuntime,
  getLocalPluginRoots,
  normalizeCommandName,
};
