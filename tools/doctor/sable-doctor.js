#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  loadPluginManifests,
  validatePluginRegistry,
} = require("../plugins/plugin-manifest");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");

function buildDoctorReport({
  repoRoot = DEFAULT_REPO_ROOT,
  homeDir = "/home/arya",
  env = process.env,
  commandExists = defaultCommandExists,
} = {}) {
  const checks = [];

  checks.push(checkPath("repo", repoRoot, "dir"));
  checks.push(checkPath("package.json", path.join(repoRoot, "package.json"), "file"));
  checks.push(checkPath("migration checklist", path.join(repoRoot, "docs", "sable-architecture-migration-checklist.md"), "file"));
  checks.push(checkPath("smoke runner", path.join(repoRoot, "tools", "smoke", "run-smoke-tests.js"), "file"));
  checks.push(checkPath("runner adapter", path.join(repoRoot, "apps", "signal-bridge", "runner-adapter.js"), "file"));
  checks.push(checkPath("Signal bridge", path.join(repoRoot, "apps", "signal-bridge", "bridge.js"), "file"));

  checks.push(checkCommand("codex", commandExists));
  checks.push(checkRunnerConfig(repoRoot, env));
  checks.push(...checkPluginRegistry(repoRoot));
  checks.push(...checkLocalInstance(homeDir));
  checks.push(...checkConfigPresence(repoRoot));

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

function checkRunnerConfig(repoRoot, env) {
  const bridgeEnvPath = path.join(repoRoot, "apps", "signal-bridge", ".env");
  const envSummary = readEnvSummary(bridgeEnvPath);
  const configuredCodexHome = env.CODEX_HOME || envSummary.CODEX_HOME || "";

  if (!configuredCodexHome) {
    return warn("runner:codex-cli", "CODEX_HOME is not set in process env or bridge .env");
  }

  return pass("runner:codex-cli", `CODEX_HOME is configured as ${redactPath(configuredCodexHome)}`);
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

function checkLocalInstance(homeDir) {
  return [
    checkPath("instance:home", homeDir, "dir"),
    checkPath("instance:AGENTS", path.join(homeDir, "AGENTS.md"), "file"),
    checkPath("instance:TODO", path.join(homeDir, "TODO.md"), "file"),
    checkPath("instance:memory", path.join(homeDir, "memory"), "dir"),
    checkPath("instance:skills", path.join(homeDir, "skills"), "dir"),
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

function redactPath(value) {
  return String(value || "").replace(/^\/home\/[^/]+/, "~");
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
    homeDir: "/home/arya",
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
};
