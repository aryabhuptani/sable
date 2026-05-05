#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const { createInstanceConfig } = require("../instance/instance-config");
const { getInstanceEnvPath } = require("../instance/init-instance");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVICE_NAME = "sable-signal-bridge.service";

function parseArgs(argv) {
  const options = {
    command: argv[0] || "status",
    dryRun: false,
    homeDir: "",
    repoRoot: DEFAULT_REPO_ROOT,
    systemctl: "systemctl",
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--instance-home" || arg === "--home-dir") {
      options.homeDir = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--repo-root") {
      options.repoRoot = path.resolve(expandHome(argv[++index] || ""));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--systemctl") {
      options.systemctl = argv[++index] || "systemctl";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function getUserServicePath({ env = process.env } = {}) {
  const configHome = env.XDG_CONFIG_HOME
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  return path.join(configHome, "systemd", "user", SERVICE_NAME);
}

function renderUserServiceUnit({
  instance,
  nodeBin = process.execPath,
  serviceName = SERVICE_NAME,
}) {
  const bridgeDir = path.join(instance.repoRoot, "apps", "signal-bridge");
  const bridgeEnvPath = path.join(bridgeDir, ".env");
  const instanceEnvPath = getInstanceEnvPath(instance);

  return [
    "[Unit]",
    "Description=Sable Signal bridge",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdEscape(bridgeDir)}`,
    `EnvironmentFile=-${systemdEscape(instanceEnvPath)}`,
    `EnvironmentFile=-${systemdEscape(bridgeEnvPath)}`,
    `ExecStart=${systemdEscape(nodeBin)} ${systemdEscape(path.join(bridgeDir, "bridge.js"))}`,
    "Restart=on-failure",
    "RestartSec=5",
    "KillSignal=SIGTERM",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function systemdEscape(value) {
  const text = String(value || "");
  if (/[\s"'\\]/.test(text)) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return text;
}

function runServiceCommand({
  command,
  dryRun = false,
  env = process.env,
  homeDir = "",
  logger = console,
  repoRoot = DEFAULT_REPO_ROOT,
  spawn = spawnSync,
  systemctl = "systemctl",
} = {}) {
  const instance = createInstanceConfig({ repoRoot, homeDir, env });
  const servicePath = getUserServicePath({ env });
  const unit = renderUserServiceUnit({ instance });
  const actions = [];

  function systemctlUser(args) {
    actions.push(`${systemctl} --user ${args.join(" ")}`);
    if (dryRun) {
      return { status: 0 };
    }
    return spawn(systemctl, ["--user", ...args], { stdio: "inherit" });
  }

  if (command === "render") {
    logger.log(unit);
    return { actions, instance, servicePath, status: 0, unit };
  }

  if (command === "install") {
    actions.push(`write ${servicePath}`);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(servicePath), { recursive: true });
      fs.writeFileSync(servicePath, unit, "utf8");
    }
    let result = systemctlUser(["daemon-reload"]);
    if ((result.status || 0) !== 0) {
      return { actions, instance, servicePath, status: result.status || 1, unit };
    }
    result = systemctlUser(["enable", SERVICE_NAME]);
    return { actions, instance, servicePath, status: result.status || 0, unit };
  }

  if (command === "uninstall") {
    let result = systemctlUser(["disable", "--now", SERVICE_NAME]);
    if ((result.status || 0) !== 0 && !dryRun) {
      return { actions, instance, servicePath, status: result.status || 1, unit };
    }
    actions.push(`remove ${servicePath}`);
    if (!dryRun) {
      fs.rmSync(servicePath, { force: true });
    }
    result = systemctlUser(["daemon-reload"]);
    return { actions, instance, servicePath, status: result.status || 0, unit };
  }

  const commandMap = {
    restart: ["restart", SERVICE_NAME],
    start: ["start", SERVICE_NAME],
    status: ["status", SERVICE_NAME],
    stop: ["stop", SERVICE_NAME],
  };

  if (!commandMap[command]) {
    throw new Error(`Unknown service command: ${command}`);
  }

  const result = systemctlUser(commandMap[command]);
  return { actions, instance, servicePath, status: result.status || 0, unit };
}

function usage() {
  return [
    "Usage: node tools/service/user-service.js <install|uninstall|start|stop|restart|status|render> [--instance-home PATH] [--dry-run]",
    "",
    "Installs or controls the user-level Sable Signal bridge service.",
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
    const result = runServiceCommand(options);
    if (options.dryRun && result.actions.length > 0) {
      console.log(result.actions.join("\n"));
    }
    return result.status;
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  SERVICE_NAME,
  getUserServicePath,
  parseArgs,
  renderUserServiceUnit,
  runServiceCommand,
};
