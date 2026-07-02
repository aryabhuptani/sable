const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { createHermesCliRunnerAdapter } = require("../apps/signal-bridge/hermes-cli-runner");

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = {
    endedWith: "",
    end(value, callback) {
      this.endedWith = value;
      callback?.();
    },
  };
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

function createRunner(spawn) {
  return createHermesCliRunnerAdapter({
    spawn,
    containerName: "hermes-test",
    workspaceDir: "/opt/data/workspace with space",
    timeoutMs: 1000,
    normalizeText: (value) => String(value || "").trim(),
    timestamp: () => "2026-07-01T00:00:00.000Z",
  });
}

test("Hermes CLI runner launches docker exec and sends prompt over stdin", async () => {
  const child = createFakeChild();
  let spawnCall = null;
  const runner = createRunner((bin, args, options) => {
    spawnCall = { bin, args, options };
    return child;
  });

  const pending = runner.runTurn("hello Hermes");
  child.stdout.emit("data", "Hermes says hello\n");
  child.emit("exit", 0, null);
  const result = await pending;

  assert.equal(spawnCall.bin, "docker");
  assert.deepEqual(spawnCall.args.slice(0, 5), ["exec", "-i", "-u", "hermes", "hermes-test"]);
  assert.match(spawnCall.args.at(-1), /cd '\/opt\/data\/workspace with space'/);
  assert.equal(child.stdin.endedWith, "hello Hermes");
  assert.deepEqual(result, {
    sessionId: null,
    message: "Hermes says hello",
    toolSuggestion: null,
    startedFreshBecauseResumeFailed: false,
  });
});

test("Hermes CLI runner reports stderr on failed exit", async () => {
  const child = createFakeChild();
  const runner = createRunner(() => child);

  const pending = runner.runTurn("fail please");
  child.stderr.emit("data", "bad auth");
  child.emit("exit", 1, null);

  await assert.rejects(pending, /Hermes CLI exited with code 1.*bad auth/);
});
