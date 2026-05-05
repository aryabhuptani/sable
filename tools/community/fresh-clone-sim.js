#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_SOURCE_REPO = path.resolve(__dirname, "..", "..");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    keep: false,
    sourceRepo: DEFAULT_SOURCE_REPO,
    workRoot: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-repo") {
      options.sourceRepo = path.resolve(argv[++index] || options.sourceRepo);
    } else if (arg === "--work-root") {
      options.workRoot = path.resolve(argv[++index] || "");
    } else if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function runFreshCloneSimulation({
  fsModule = fs,
  keep = false,
  logger = console,
  sourceRepo = DEFAULT_SOURCE_REPO,
  spawn = spawnSync,
  workRoot = "",
} = {}) {
  const root = workRoot || fsModule.mkdtempSync(path.join(os.tmpdir(), "sable-fresh-clone-"));
  fsModule.mkdirSync(root, { recursive: true });
  const cloneDir = path.join(root, "sable");
  const instanceHome = path.join(root, "instance");
  const actions = [];

  const childEnv = {
    ...process.env,
    SABLE_INSTANCE_HOME: instanceHome,
    XDG_CONFIG_HOME: path.join(root, "xdg-config"),
  };

  function run(command, args, cwd = root) {
    actions.push(`(${cwd}) ${command} ${args.join(" ")}`);
    const result = spawn(command, args, {
      cwd,
      encoding: "utf8",
      env: childEnv,
      stdio: "inherit",
    });
    if ((result.status || 0) !== 0) {
      throw new Error(`Fresh-clone simulation failed at: ${command} ${args.join(" ")}`);
    }
  }

  try {
    run("git", ["clone", sourceRepo, cloneDir]);
    run("npm", ["install"], cloneDir);
    run("npm", ["run", "init:instance", "--", "--instance-home", instanceHome], cloneDir);
    run("npm", ["run", "sable:doctor", "--", "--home-dir", instanceHome], cloneDir);
    run("npm", ["run", "plugin:create", "--", "--id", "local-sim-hello", "--target", "local"], cloneDir);
    run("npm", ["run", "install:user-service", "--", "--instance-home", instanceHome, "--dry-run"], cloneDir);
    run("npm", ["run", "shareability:check"], cloneDir);
  } finally {
    if (!keep) {
      fsModule.rmSync(root, { recursive: true, force: true });
    }
  }

  const result = {
    actions,
    cloneDir,
    instanceHome,
    kept: keep,
    root,
  };
  logger.log(formatSimulationResult(result));
  return result;
}

function formatSimulationResult(result) {
  return [
    "Fresh-clone simulation passed.",
    `work root: ${result.root}`,
    `clone: ${result.cloneDir}`,
    `instance: ${result.instanceHome}`,
    `kept: ${result.kept ? "yes" : "no"}`,
    "actions:",
    ...result.actions.map((action) => `- ${action}`),
    "",
  ].join("\n");
}

function usage() {
  return [
    "Usage: node tools/community/fresh-clone-sim.js [--source-repo PATH] [--work-root PATH] [--keep]",
    "",
    "Clones Sable into a temporary directory and validates first-user setup with fake instance paths.",
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
    runFreshCloneSimulation(options);
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
  formatSimulationResult,
  parseArgs,
  runFreshCloneSimulation,
};
