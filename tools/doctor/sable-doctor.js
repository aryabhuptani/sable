#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  loadPluginManifests,
  validatePluginRegistry,
} = require("../plugins/plugin-manifest");
const {
  createInstanceConfig,
  redactInstancePath,
} = require("../instance/instance-config");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");

function buildDoctorReport({
  repoRoot = DEFAULT_REPO_ROOT,
  homeDir = "",
  env = process.env,
  commandExists = defaultCommandExists,
} = {}) {
  const checks = [];
  const instance = createInstanceConfig({ repoRoot, homeDir, env });
  const resolvedRepoRoot = instance.repoRoot;

  checks.push(checkPath("repo", resolvedRepoRoot, "dir"));
  checks.push(checkPath("package.json", path.join(resolvedRepoRoot, "package.json"), "file"));
  checks.push(checkPath("migration checklist", path.join(resolvedRepoRoot, "docs", "sable-architecture-migration-checklist.md"), "file"));
  checks.push(checkPath("smoke runner", path.join(resolvedRepoRoot, "tools", "smoke", "run-smoke-tests.js"), "file"));
  checks.push(checkPath("runner adapter", path.join(resolvedRepoRoot, "apps", "signal-bridge", "runner-adapter.js"), "file"));
  checks.push(checkPath("Signal bridge", path.join(resolvedRepoRoot, "apps", "signal-bridge", "bridge.js"), "file"));
  checks.push(checkPath("instance:python-config", path.join(resolvedRepoRoot, "tools", "instance", "instance_config.py"), "file"));

  checks.push(checkCommand("codex", commandExists));
  checks.push(checkRunnerConfig(resolvedRepoRoot, env, instance));
  checks.push(checkBridgeRuntimePaths(env, instance));
  checks.push(...checkPluginRegistry(resolvedRepoRoot));
  checks.push(...checkLocalInstance(instance));
  checks.push(...checkConfigPresence(resolvedRepoRoot));

  return {
    ok: checks.every((check) => check.status !== "fail"),
    generatedAt: new Date().toISOString(),
    checks,
  };
}

function checkPath(name, targetPath, expectedType) {
  try {
    const stat = fs.statSync(targetPath);
    const matches =
      expectedType === "dir" ? stat.isDirectory() : expectedType === "file" ? stat.isFile() : true;

    if (!matches) {
      return fail(name, `${targetPath} exists but is not a ${expectedType}`);
    }
    return pass(name, `${targetPath} exists`);
  } catch (error) {
    return fail(name, `${targetPath} is missing`);
  }
}

function checkCommand(command, commandExists) {
  if (commandExists(command)) {
    return pass(`command:${command}`, `${command} is available on PATH`);
  }
  return warn(`command:${command}`, `${command} is not available on PATH`);
}

function checkRunnerConfig(repoRoot, env, instance) {
  const bridgeEnvPath = path.join(repoRoot, "apps", "signal-bridge", ".env");
  const envSummary = readEnvSummary(bridgeEnvPath);
  const configuredCodexHome = env.CODEX_HOME || envSummary.CODEX_HOME || "";

  if (!configuredCodexHome) {
    return warn("runner:codex-cli", "CODEX_HOME is not set in process env or bridge .env");
  }

  return pass(
    "runner:codex-cli",
    `CODEX_HOME is configured as ${redactInstancePath(configuredCodexHome, {
      homeDir: instance.homeDir,
    })}`
  );
}

function checkBridgeRuntimePaths(env, instance) {
  const runtimePaths = {
    codexCwd: normalizeText(env.SABLE_CODEX_CWD) || instance.homeDir,
    schedulerJobsPath: normalizeText(env.SABLE_SCHEDULER_JOBS_PATH) || instance.schedulerJobsPath,
    researchRoot: normalizeText(env.SABLE_RESEARCH_ROOT) || instance.researchRoot,
    telegramCliPath:
      normalizeText(env.SABLE_TELEGRAM_CLI_PATH) ||
      path.join(instance.repoRoot, "tools", "telegram", "telegram_cli.py"),
    obsidianVaultRoot: normalizeText(env.SABLE_OBSIDIAN_VAULT_ROOT) || instance.memoryRoot,
    voiceModelPath:
      normalizeText(env.VOICE_NOTES_MODEL_PATH) ||
      path.join(instance.homeDir, "models", "faster-whisper-base.en"),
  };
  const detail = Object.entries(runtimePaths)
    .map(
      ([key, value]) =>
        `${key}=${redactInstancePath(value, {
          homeDir: instance.homeDir,
        })}`
    )
    .join(", ");
  return pass("bridge:runtime-paths", detail);
}

function checkPluginRegistry(repoRoot) {
  const pluginsRoot = path.join(repoRoot, "plugins");
  const entries = loadPluginManifests(pluginsRoot);
  const errors = validatePluginRegistry(entries);

  if (entries.length === 0) {
    return [fail("plugins", "no plugin manifests found")];
  }

  const checks = [
    errors.length === 0
      ? pass("plugins", `${entries.length} plugin manifests validated`)
      : fail("plugins", `${errors.length} plugin manifest validation errors`),
  ];

  for (const entry of entries) {
    const manifest = entry.manifest;
    checks.push(
      pass(
        `plugin:${manifest.id}`,
        `${manifest.status} ${manifest.category} plugin declares ${manifest.capabilities.length} capabilities`
      )
    );
  }

  for (const error of errors.slice(0, 5)) {
    checks.push(fail("plugins:error", error));
  }

  return checks;
}

function checkLocalInstance(instance) {
  return [
    checkPath("instance:home", instance.homeDir, "dir"),
    checkPath("instance:AGENTS", instance.agentsPath, "file"),
    checkPath("instance:TODO", instance.todoPath, "file"),
    checkPath("instance:memory", instance.memoryRoot, "dir"),
    checkPath("instance:skills", instance.skillsRoot, "dir"),
  ];
}

function checkConfigPresence(repoRoot) {
  const bridgeEnvPath = path.join(repoRoot, "apps", "signal-bridge", ".env");
  const telegramEnvPath = path.join(repoRoot, "tools", "telegram", ".env");
  const checks = [];

  checks.push(checkSecretFileSummary("config:signal-bridge-env", bridgeEnvPath, ["ALLOWED_NUMBERS", "CODEX_HOME"]));
  checks.push(checkSecretFileSummary("config:telegram-env", telegramEnvPath, ["TELEGRAM_API_ID", "TELEGRAM_API_HASH"]));

  return checks;
}

function checkSecretFileSummary(name, filePath, expectedKeys) {
  const values = readEnvSummary(filePath);
  if (!values.__exists) {
    return warn(name, `${filePath} is missing`);
  }

  const missing = expectedKeys.filter((key) => !values[key]);
  if (missing.length > 0) {
    return warn(name, `${path.basename(filePath)} exists but is missing ${missing.join(", ")}`);
  }

  return pass(name, `${path.basename(filePath)} exists with required keys present`);
}

function readEnvSummary(filePath) {
  const summary = {};

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    summary.__exists = true;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key) {
        summary[key] = value ? "[present]" : "";
      }
    }
  } catch (error) {
    summary.__exists = false;
  }

  return summary;
}

function defaultCommandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function pass(name, detail) {
  return { status: "pass", name, detail };
}

function warn(name, detail) {
  return { status: "warn", name, detail };
}

function fail(name, detail) {
  return { status: "fail", name, detail };
}

function formatDoctorReport(report) {
  const lines = [
    `Sable doctor: ${report.ok ? "PASS" : "FAIL"}`,
    `generated: ${report.generatedAt}`,
    "",
  ];

  for (const check of report.checks) {
    const marker = check.status === "pass" ? "ok" : check.status === "warn" ? "warn" : "fail";
    lines.push(`[${marker}] ${check.name}: ${check.detail}`);
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    repoRoot: DEFAULT_REPO_ROOT,
    homeDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--repo-root") {
      options.repoRoot = path.resolve(argv[++index] || "");
    } else if (arg === "--home-dir") {
      options.homeDir = path.resolve(argv[++index] || "");
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: node tools/doctor/sable-doctor.js [--json] [--repo-root PATH] [--home-dir PATH]",
    "",
    "Runs read-only diagnostics for Sable's migration-critical runtime surfaces.",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const report = buildDoctorReport({
    repoRoot: options.repoRoot,
    homeDir: options.homeDir,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatDoctorReport(report));
  }

  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  buildDoctorReport,
  formatDoctorReport,
  parseArgs,
  readEnvSummary,
  checkBridgeRuntimePaths,
};
