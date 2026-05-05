const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseArgs,
  runUpgrade,
  testCommandForSmokeLevel,
} = require("../tools/upgrade/upgrade");

test("upgrade check reports pending changes without mutating repo or restarting", () => {
  const calls = [];
  const summary = runUpgrade({
    command: "check",
    logger: { log() {} },
    restartService: true,
    smokeLevel: "plugins",
    spawn: fakeSpawn(calls, {
      "git status --porcelain": "",
      "git rev-parse HEAD": "aaa\n",
      "git rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "git fetch --prune": "",
      "git rev-parse @{u}": "bbb\n",
      "git diff --name-only aaa bbb": "package.json\nREADME.md\n",
    }),
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.wouldChange, true);
  assert.equal(summary.packageChanged, true);
  assert.ok(summary.actions.includes("would run npm install"));
  assert.ok(summary.actions.includes("would run npm run test:plugins"));
  assert.ok(summary.actions.includes("would run npm run service:restart"));
  assert.equal(calls.some((call) => call === "git pull --ff-only"), false);
  assert.equal(calls.some((call) => call === "npm install"), false);
});

test("upgrade run refuses dirty working trees", () => {
  assert.throws(
    () =>
      runUpgrade({
        logger: { log() {} },
        spawn: fakeSpawn([], {
          "git status --porcelain": " M package.json\n",
        }),
      }),
    /Refusing to upgrade with local repo changes/
  );
});

test("upgrade run gates service restart behind package install and checks", () => {
  const calls = [];
  const summary = runUpgrade({
    logger: { log() {} },
    smokeLevel: "doctor",
    spawn: fakeSpawn(calls, {
      "git status --porcelain": "",
      "git rev-parse HEAD": "aaa\n",
      "git rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "git fetch --prune": "",
      "git rev-parse @{u}": "bbb\n",
      "git diff --name-only aaa bbb": "apps/signal-bridge/package-lock.json\n",
      "git pull --ff-only": "",
      "npm install": "",
      "npm run sable:doctor": "",
      "npm run service:restart": "",
    }),
  });

  assert.equal(summary.packageChanged, true);
  assert.deepEqual(calls.slice(-3), [
    "npm install",
    "npm run sable:doctor",
    "npm run service:restart",
  ]);
});

test("upgrade parser and smoke level mapping stay stable", () => {
  assert.deepEqual(parseArgs(["check", "--smoke-level", "smoke", "--no-restart"]), {
    command: "check",
    repoRoot: require("node:path").resolve(__dirname, ".."),
    restartService: false,
    smokeLevel: "smoke",
  });
  assert.deepEqual(testCommandForSmokeLevel("plugins"), ["npm", "run", "test:plugins"]);
  assert.deepEqual(testCommandForSmokeLevel("smoke"), ["npm", "run", "test:smoke"]);
});

function fakeSpawn(calls, outputs) {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    calls.push(key);
    if (!Object.prototype.hasOwnProperty.call(outputs, key)) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return {
      status: 0,
      stdout: outputs[key],
      stderr: "",
    };
  };
}
