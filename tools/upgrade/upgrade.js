#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    command: argv[0] || "run",
    repoRoot: DEFAULT_REPO_ROOT,
    restartService: true,
    smokeLevel: "community",
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      options.repoRoot = path.resolve(argv[++index] || options.repoRoot);
    } else if (arg === "--smoke-level") {
      options.smokeLevel = argv[++index] || options.smokeLevel;
    } else if (arg === "--no-restart") {
      options.restartService = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!["run", "check"].includes(options.command)) {
    throw new Error("Command must be run or check");
  }
  if (!["none", "doctor", "plugins", "community", "smoke"].includes(options.smokeLevel)) {
    throw new Error("--smoke-level must be none, doctor, plugins, community, or smoke");
  }
  return options;
}

function runUpgrade({
  command = "run",
  logger = console,
  repoRoot = DEFAULT_REPO_ROOT,
  restartService = true,
  smokeLevel = "community",
  spawn = spawnSync,
} = {}) {
  const dryRun = command === "check";
  const actions = [];

  function run(cmd, args, { allowFailure = false, capture = false } = {}) {
    actions.push(`${cmd} ${args.join(" ")}`);
    const result = spawn(cmd, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
    });
    const status = result.status || 0;
    if (status !== 0 && !allowFailure) {
      const detail = result.stderr || result.stdout || "";
      throw new Error(`Command failed: ${cmd} ${args.join(" ")}${detail ? `\n${detail.trim()}` : ""}`);
    }
    return result;
  }

  const dirty = run("git", ["status", "--porcelain"], { capture: true }).stdout.trim();
  if (dirty) {
    throw new Error("Refusing to upgrade with local repo changes. Commit/stash first; local instance state is separate and unaffected.");
  }

  const beforeHead = run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
  const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    capture: true,
  }).stdout.trim();
  run("git", ["fetch", "--prune"]);
  const remoteHead = run("git", ["rev-parse", "@{u}"], { capture: true }).stdout.trim();

  let changedFiles = [];
  if (beforeHead !== remoteHead) {
    changedFiles = run("git", ["diff", "--name-only", beforeHead, remoteHead], {
      capture: true,
    }).stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (!dryRun) {
    run("git", ["pull", "--ff-only"]);
  }

  const packageChanged = changedFiles.some((file) =>
    ["package.json", "package-lock.json", "apps/signal-bridge/package.json", "apps/signal-bridge/package-lock.json"].includes(file)
  );
  if (packageChanged) {
    if (dryRun) {
      actions.push("would run npm install");
    } else {
      run("npm", ["install"]);
    }
  }

  runChecks({ actions, dryRun, run, smokeLevel });

  if (restartService) {
    if (dryRun) {
      actions.push("would run npm run service:restart");
    } else {
      run("npm", ["run", "service:restart"]);
    }
  }

  const summary = {
    actions,
    beforeHead,
    changedFiles,
    dryRun,
    packageChanged,
    remoteHead,
    restartService,
    smokeLevel,
    upstream,
    wouldChange: beforeHead !== remoteHead,
  };
  logger.log(formatUpgradeSummary(summary));
  return summary;
}

function runChecks({ actions, dryRun, run, smokeLevel }) {
  if (smokeLevel === "none") {
    actions.push(dryRun ? "would skip checks" : "skip checks");
    return;
  }
  if (dryRun) {
    actions.push(`would run ${testCommandForSmokeLevel(smokeLevel).join(" ")}`);
    return;
  }
  const [cmd, ...args] = testCommandForSmokeLevel(smokeLevel);
  run(cmd, args);
}

function testCommandForSmokeLevel(smokeLevel) {
  if (smokeLevel === "doctor") {
    return ["npm", "run", "sable:doctor"];
  }
  if (smokeLevel === "plugins") {
    return ["npm", "run", "test:plugins"];
  }
  if (smokeLevel === "smoke") {
    return ["npm", "run", "test:smoke"];
  }
  return ["npm", "run", "test:community"];
}

function formatUpgradeSummary(summary) {
  const lines = [
    summary.dryRun ? "Sable upgrade check" : "Sable upgrade complete",
    `upstream: ${summary.upstream || "unconfigured"}`,
    `current: ${summary.beforeHead}`,
    `remote: ${summary.remoteHead}`,
    `would change: ${summary.wouldChange ? "yes" : "no"}`,
    `package files changed: ${summary.packageChanged ? "yes" : "no"}`,
    `smoke level: ${summary.smokeLevel}`,
    `restart service: ${summary.restartService ? "yes" : "no"}`,
  ];
  if (summary.changedFiles.length > 0) {
    lines.push("changed files:");
    for (const file of summary.changedFiles.slice(0, 30)) {
      lines.push(`- ${file}`);
    }
  }
  lines.push("actions:");
  for (const action of summary.actions) {
    lines.push(`- ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return [
    "Usage: node tools/upgrade/upgrade.js <run|check> [--smoke-level none|doctor|plugins|community|smoke] [--no-restart]",
    "",
    "Performs a guarded upstream update without touching private instance state or local plugins.",
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
  try {
    runUpgrade(options);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  formatUpgradeSummary,
  parseArgs,
  runUpgrade,
  testCommandForSmokeLevel,
};
