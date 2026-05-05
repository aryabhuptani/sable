const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const {
  parseArgs,
  runFreshCloneSimulation,
} = require("../tools/community/fresh-clone-sim");

test("fresh clone simulation runs the first-user command sequence", () => {
  const calls = [];
  const result = runFreshCloneSimulation({
    fsModule: {
      mkdirSync() {},
      mkdtempSync: () => "/tmp/sable-sim",
      rmSync() {},
    },
    logger: { log() {} },
    sourceRepo: "/repo/sable",
    spawn: (cmd, args, options) => {
      calls.push({ cmd, args, cwd: options.cwd });
      return { status: 0 };
    },
  });

  assert.equal(result.kept, false);
  assert.deepEqual(
    calls.map((call) => `${call.cmd} ${call.args.join(" ")}`),
    [
      "git clone /repo/sable /tmp/sable-sim/sable",
      "npm install",
      "npm run init:instance -- --instance-home /tmp/sable-sim/instance",
      "npm run sable:doctor -- --home-dir /tmp/sable-sim/instance",
      "npm run plugin:create -- --id local-sim-hello --target local",
      "npm run install:user-service -- --instance-home /tmp/sable-sim/instance --dry-run",
      "npm run shareability:check",
    ]
  );
});

test("fresh clone simulation parser supports source, root, and keep", () => {
  assert.deepEqual(parseArgs(["--source-repo", "/repo", "--work-root", "/tmp/work", "--keep"]), {
    keep: true,
    sourceRepo: "/repo",
    workRoot: "/tmp/work",
  });
  assert.equal(parseArgs([]).sourceRepo, path.resolve(__dirname, ".."));
});
