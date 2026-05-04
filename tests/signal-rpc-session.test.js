const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { createSignalRpcSession } = require("../apps/signal-bridge/signal-rpc-session");

function createFakeSignalProcess(writes = []) {
  const stdout = new EventEmitter();
  stdout.setEncoding = () => {};
  const stderr = new EventEmitter();
  stderr.setEncoding = () => {};
  const process = new EventEmitter();
  process.stdout = stdout;
  process.stderr = stderr;
  process.stdin = {
    write(payload, callback) {
      writes.push(payload);
      callback?.();
    },
  };
  process.killed = false;
  process.kill = (signal) => {
    process.killed = true;
    process.killSignal = signal;
  };
  return process;
}

test("signal RPC session parses receive events and buffered responses", async () => {
  const writes = [];
  const received = [];
  const spawned = [];
  const fakeProcess = createFakeSignalProcess(writes);
  const session = createSignalRpcSession({
    logger: { error() {}, log() {} },
    onReceive: (message) => received.push(message),
    phoneNumber: "+1555",
    projectDir: "/tmp/project",
    spawn: (...args) => {
      spawned.push(args);
      return fakeProcess;
    },
  });

  session.start();
  assert.deepEqual(spawned[0][1], ["-a", "+1555", "jsonRpc", "--receive-mode=on-start"]);

  fakeProcess.stdout.emit(
    "data",
    `${JSON.stringify({ method: "receive", params: { envelope: { message: "hi" } } })}\n`
  );
  assert.equal(received.length, 1);

  const request = session.sendRequest("send", { message: "hello" });
  const requestPayload = JSON.parse(writes[0]);
  assert.equal(requestPayload.method, "send");
  fakeProcess.stdout.emit("data", JSON.stringify({ id: requestPayload.id, result: { ok: true } }));
  fakeProcess.stdout.emit("data", "\n");
  assert.deepEqual(await request, { ok: true });
});

test("signal RPC session rejects pending requests on process exit and can kill the process", async () => {
  const fakeProcess = createFakeSignalProcess();
  let exitCode = null;
  const session = createSignalRpcSession({
    logger: { error() {}, log() {} },
    onExit: (code) => {
      exitCode = code;
    },
    phoneNumber: "+1555",
    projectDir: "/tmp/project",
    spawn: () => fakeProcess,
  });

  session.start();
  const request = session.sendRequest("send", {});
  fakeProcess.emit("exit", 9, null);

  await assert.rejects(request, /signal-cli exited/);
  assert.equal(exitCode, 9);
  assert.equal(session.kill("SIGTERM"), true);
  assert.equal(fakeProcess.killSignal, "SIGTERM");
});

test("signal RPC session handles E2E request mode without spawning responses", async () => {
  const logs = [];
  const session = createSignalRpcSession({
    logger: { error() {}, log() {} },
    phoneNumber: "+1555",
    projectDir: "/tmp/project",
    spawn: () => createFakeSignalProcess(),
    testSignalLogPath: "/tmp/signal.jsonl",
    testSupport: {
      appendSignalLog: (entry) => logs.push(entry),
      getAttachmentMap: () => ({ a: { dataBase64: "abc" } }),
    },
  });

  assert.deepEqual(await session.sendRequest("getAttachment", { id: "a" }), { data: "abc" });
  const sendResult = await session.sendRequest("send", { message: "hi" });
  assert.equal(typeof sendResult.timestamp, "number");
  assert.deepEqual(await session.sendRequest("updateProfile", {}), { ok: true });
  assert.equal(logs.length, 3);
  assert.equal(logs[0].message.method, "getAttachment");
});
