const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createInstanceConfig } = require("../tools/instance/instance-config");
const {
  SERVICE_NAME,
  getRestartRequestPath,
  getUserServicePath,
  parseArgs,
  renderUserServiceUnit,
  runServiceCommand,
} = require("../tools/service/user-service");

test("user service renderer points at repo bridge and private instance env", () => {
  const instance = createInstanceConfig({
    homeDir: "/srv/sable-user",
    repoRoot: "/opt/sable",
  });
  const unit = renderUserServiceUnit({
    instance,
    nodeBin: "/usr/bin/node",
  });

  assert.match(unit, /Description=Sable Signal bridge/);
  assert.match(unit, /WorkingDirectory=\/opt\/sable\/apps\/signal-bridge/);
  assert.match(unit, /EnvironmentFile=-\/srv\/sable-user\/\.config\/sable\/sable\.env/);
  assert.match(unit, /EnvironmentFile=-\/opt\/sable\/apps\/signal-bridge\/\.env/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/sable\/apps\/signal-bridge\/bridge\.js/);
  assert.match(unit, /Restart=on-failure/);
});

test("service install dry-run reports actions without writing unit files", async () => {
  const tempConfig = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-systemd-"));
  const calls = [];

  try {
    const result = runServiceCommand({
      command: "install",
      dryRun: true,
      env: { XDG_CONFIG_HOME: tempConfig },
      homeDir: "/srv/sable-user",
      logger: null,
      repoRoot: "/opt/sable",
      spawn: (command, args) => {
        calls.push([command, args]);
        return { status: 0 };
      },
    });

    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(getUserServicePath({ env: { XDG_CONFIG_HOME: tempConfig } })), false);
    assert.deepEqual(calls, []);
    assert.deepEqual(result.actions, [
      `write ${path.join(tempConfig, "systemd", "user", SERVICE_NAME)}`,
      "systemctl --user daemon-reload",
      `systemctl --user enable ${SERVICE_NAME}`,
    ]);
  } finally {
    await fsp.rm(tempConfig, { recursive: true, force: true });
  }
});

test("service install writes unit and invokes user systemctl commands", async () => {
  const tempConfig = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-systemd-"));
  const calls = [];

  try {
    const result = runServiceCommand({
      command: "install",
      env: { XDG_CONFIG_HOME: tempConfig },
      homeDir: "/srv/sable-user",
      logger: null,
      repoRoot: "/opt/sable",
      spawn: (command, args) => {
        calls.push([command, args]);
        return { status: 0 };
      },
    });

    const servicePath = getUserServicePath({ env: { XDG_CONFIG_HOME: tempConfig } });
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(servicePath), true);
    assert.match(await fsp.readFile(servicePath, "utf8"), /Sable Signal bridge/);
    assert.deepEqual(calls, [
      ["systemctl", ["--user", "daemon-reload"]],
      ["systemctl", ["--user", "enable", SERVICE_NAME]],
    ]);
  } finally {
    await fsp.rm(tempConfig, { recursive: true, force: true });
  }
});

test("service restart requests graceful bridge restart when service is active", async () => {
  const tempRepo = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-repo-"));
  const calls = [];

  try {
    const result = runServiceCommand({
      command: "restart",
      homeDir: "/srv/sable-user",
      repoRoot: tempRepo,
      spawn: (command, args) => {
        calls.push([command, args]);
        return { status: 0 };
      },
    });

    const restartRequestPath = getRestartRequestPath({ repoRoot: tempRepo });
    assert.equal(result.status, 0);
    assert.deepEqual(result.actions, [
      `systemctl --user is-active --quiet ${SERVICE_NAME}`,
      `write ${restartRequestPath}`,
      `systemctl --user start ${SERVICE_NAME}`,
    ]);
    assert.deepEqual(calls, [
      ["systemctl", ["--user", "is-active", "--quiet", SERVICE_NAME]],
      ["systemctl", ["--user", "start", SERVICE_NAME]],
    ]);
    assert.equal(fs.existsSync(restartRequestPath), true);
  } finally {
    await fsp.rm(tempRepo, { recursive: true, force: true });
  }
});

test("service restart falls back to systemctl restart when service is inactive", () => {
  const calls = [];
  const result = runServiceCommand({
    command: "restart",
    homeDir: "/srv/sable-user",
    repoRoot: "/opt/sable",
    spawn: (command, args) => {
      calls.push([command, args]);
      return args.includes("is-active") ? { status: 3 } : { status: 0 };
    },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.actions, [
    `systemctl --user is-active --quiet ${SERVICE_NAME}`,
    `systemctl --user restart ${SERVICE_NAME}`,
  ]);
});

test("service parser supports command, instance home, dry-run, and systemctl override", () => {
  const options = parseArgs([
    "install",
    "--instance-home",
    "/tmp/instance",
    "--repo-root",
    "/tmp/repo",
    "--dry-run",
    "--systemctl",
    "/bin/systemctl",
  ]);

  assert.equal(options.command, "install");
  assert.equal(options.homeDir, "/tmp/instance");
  assert.equal(options.repoRoot, "/tmp/repo");
  assert.equal(options.dryRun, true);
  assert.equal(options.systemctl, "/bin/systemctl");
});
