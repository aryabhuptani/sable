#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  loadPluginManifests,
  loadPluginManifestsFromRoots,
  validateDiscoveredPluginRegistry,
  validatePluginRegistry,
} = require("../plugins/plugin-manifest");
const {
  createInstanceConfig,
  redactInstancePath,
} = require("../instance/instance-config");
const { getInstanceEnvPath } = require("../instance/init-instance");
const { getUserServicePath, SERVICE_NAME } = require("../service/user-service");

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
  checks.push(checkCodexHomeWritable(env, instance));
  checks.push(checkBridgeRuntimePaths(env, instance));
  checks.push(...checkPluginRegistry(resolvedRepoRoot, env, instance));
  checks.push(...checkLocalInstance(instance));
  checks.push(...checkServiceInstall(env, instance));
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

function checkCodexHomeWritable(env, instance) {
  const bridgeEnvPath = path.join(instance.repoRoot, "apps", "signal-bridge", ".env");
  const envSummary = readEnvSummary(bridgeEnvPath);
  const configuredCodexHome =
    env.CODEX_HOME ||
    (envSummary.CODEX_HOME === "[present]" ? "" : envSummary.CODEX_HOME) ||
    path.join(instance.homeDir, ".codex-bridge");

  const codexHome = configuredCodexHome || path.join(instance.homeDir, ".codex-bridge");
  try {
    if (!fs.existsSync(codexHome)) {
      return warn(
        "runner:codex-home",
        `${redactInstancePath(codexHome, { homeDir: instance.homeDir })} does not exist yet`
      );
    }
    fs.accessSync(codexHome, fs.constants.W_OK);
    return pass(
      "runner:codex-home",
      `${redactInstancePath(codexHome, { homeDir: instance.homeDir })} is writable`
    );
  } catch (error) {
    return fail(
      "runner:codex-home",
      `${redactInstancePath(codexHome, { homeDir: instance.homeDir })} is not writable`
    );
  }
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

function checkPluginRegistry(repoRoot, env = process.env, instance = createInstanceConfig({ repoRoot, env })) {
  const pluginsRoot = path.join(repoRoot, "plugins");
  const officialEntries = loadPluginManifests(pluginsRoot);
  const localRoots = getLocalPluginRoots(env, instance);
  const localEntries = loadPluginManifestsFromRoots(localRoots, { source: "local" });
  const entries = [...officialEntries, ...localEntries];
  const officialErrors = validatePluginRegistry(officialEntries);
  const discoveredErrors = validateDiscoveredPluginRegistry(entries, {
    allowLocalShadowIds: splitList(env.SABLE_ALLOW_PLUGIN_SHADOWS),
  });
  const localErrors = discoveredErrors.filter(
    (error) =>
      !officialErrors.includes(error) &&
      localEntries.some((entry) => error.includes(entry.manifestPath))
  );

  if (officialEntries.length === 0) {
    return [fail("plugins", "no plugin manifests found")];
  }

  const checks = [
    officialErrors.length === 0
      ? pass("plugins:official", `${officialEntries.length} official plugin manifests validated`)
      : fail("plugins:official", `${officialErrors.length} official plugin manifest validation errors`),
    localErrors.length === 0
      ? pass("plugins:local", `${localEntries.length} local plugin manifests validated from ${localRoots.length} root(s)`)
      : warn("plugins:local", `${localErrors.length} local plugin manifest validation errors`),
  ];

  for (const entry of officialEntries) {
    const manifest = entry.manifest;
    checks.push(
      pass(
        `plugin:${manifest.id}`,
        `${manifest.status} ${manifest.category} plugin declares ${manifest.capabilities.length} capabilities`
      )
    );
  }

  for (const error of officialErrors.slice(0, 5)) {
    checks.push(fail("plugins:official-error", error));
  }
  for (const error of localErrors.slice(0, 5)) {
    checks.push(warn("plugins:local-error", error));
  }

  return checks;
}

function getLocalPluginRoots(env, instance) {
  const roots = splitList(env.SABLE_PLUGIN_PATHS);
  roots.push(path.join(instance.homeDir, "plugins"));
  return [...new Set(roots.map((root) => path.resolve(root)).filter((root) => fs.existsSync(root)))];
}

function checkLocalInstance(instance) {
  return [
    checkPath("instance:home", instance.homeDir, "dir"),
    checkPath("instance:AGENTS", instance.agentsPath, "file"),
    checkPath("instance:TODO", instance.todoPath, "file"),
    checkPath("instance:memory", instance.memoryRoot, "dir"),
    checkPath("instance:knowledge", instance.knowledgeRoot, "dir"),
    checkPath("instance:tasks", instance.tasksRoot, "dir"),
    checkPath("instance:skills", instance.skillsRoot, "dir"),
    checkOptionalInstancePath("instance:codex-home", path.join(instance.homeDir, ".codex"), "dir", instance),
    checkOptionalInstancePath("instance:codex-bridge-home", path.join(instance.homeDir, ".codex-bridge"), "dir", instance),
    checkOptionalInstancePath("instance:plugins", path.join(instance.homeDir, "plugins"), "dir", instance),
    checkOptionalInstancePath("instance:env", getInstanceEnvPath(instance), "file", instance),
    checkPrivateStateBoundary(instance),
  ];
}

function checkOptionalInstancePath(name, targetPath, expectedType, instance) {
  const check = checkPath(name, targetPath, expectedType);
  if (check.status === "fail") {
    return warn(name, redactInstancePath(check.detail, { homeDir: instance.homeDir }));
  }
  return {
    ...check,
    detail: redactInstancePath(check.detail, { homeDir: instance.homeDir }),
  };
}

function checkPrivateStateBoundary(instance) {
  const repoRoot = path.resolve(instance.repoRoot);
  const privatePaths = [
    instance.homeDir,
    instance.memoryRoot,
    instance.tasksRoot,
    instance.skillsRoot,
    path.join(instance.homeDir, "plugins"),
  ].map((entry) => path.resolve(entry));

  const insideRepo = privatePaths.filter(
    (entry) => entry === repoRoot || entry.startsWith(`${repoRoot}${path.sep}`)
  );
  if (insideRepo.length > 0) {
    return fail(
      "instance:private-boundary",
      `private paths are inside the repo: ${insideRepo
        .map((entry) => redactInstancePath(entry, { homeDir: instance.homeDir }))
        .join(", ")}`
    );
  }
  return pass("instance:private-boundary", "private instance paths are outside the repo");
}

function checkServiceInstall(env, instance) {
  const servicePath = getUserServicePath({ env });
  const checks = [checkPath("service:user-unit", servicePath, "file")];
  if (!fs.existsSync(servicePath)) {
    checks[0] = warn("service:user-unit", `${servicePath} is not installed`);
    return checks;
  }

  const unit = fs.readFileSync(servicePath, "utf8");
  const hasExpectedService = unit.includes(SERVICE_NAME) || unit.includes("Sable Signal bridge");
  const hasInstanceEnv = unit.includes(getInstanceEnvPath(instance));
  if (!hasExpectedService || !hasInstanceEnv) {
    checks.push(warn("service:user-unit-content", "service exists but does not look like the current Sable unit"));
  } else {
    checks.push(pass("service:user-unit-content", "service unit references the current instance env"));
  }
  return checks;
}

function checkConfigPresence(repoRoot) {
  const bridgeEnvPath = path.join(repoRoot, "apps", "signal-bridge", ".env");
  const telegramEnvPath = path.join(repoRoot, "tools", "telegram", ".env");
  const checks = [];

  checks.push(checkSecretFileSummary("config:signal-bridge-env", bridgeEnvPath, ["PHONE_NUMBER", "ALLOWED_NUMBERS", "CODEX_HOME"]));
  checks.push(checkSecretFileSummary("config:telegram-env", telegramEnvPath, ["TELEGRAM_API_ID", "TELEGRAM_API_HASH"]));
  checks.push(checkPath("config:signal-bridge-env-example", path.join(repoRoot, "apps", "signal-bridge", ".env.example"), "file"));
  checks.push(checkPath("config:telegram-env-example", path.join(repoRoot, "tools", "telegram", ".env.example"), "file"));

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

function splitList(value) {
  return String(value || "")
    .split(path.delimiter)
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);
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
  checkCodexHomeWritable,
  checkBridgeRuntimePaths,
  checkPluginRegistry,
  checkLocalInstance,
  checkPrivateStateBoundary,
  checkServiceInstall,
};
