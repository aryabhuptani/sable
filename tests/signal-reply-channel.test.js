const assert = require("node:assert/strict");
const test = require("node:test");

const { createSignalReplyChannel } = require("../apps/signal-bridge/signal-reply-channel");
const { splitIntoChunks } = require("../apps/signal-bridge/bridge-utils");

test("signal reply channel chunks replies and logs each outgoing chunk", async () => {
  const requests = [];
  const logs = [];
  const outgoing = [];
  const channel = createSignalReplyChannel({
    allowedNumbers: new Set(["+1"]),
    chunkDelayMs: 1,
    delay: async () => {},
    logger: { log: (line) => logs.push(line) },
    maxMessageLength: 5,
    noteOutgoing: (recipient) => outgoing.push(recipient),
    rewriteText: (text) => `${text}!`,
    sendSignalRequest: async (method, params) => requests.push({ method, params }),
    splitIntoChunks,
    timestamp: () => "now",
  });

  await channel.sendReply("+1", "aa\nbb\ncc");

  assert.deepEqual(
    requests.map((request) => request.params.message),
    ["aa\nbb", "cc!"]
  );
  assert.deepEqual(outgoing, ["+1", "+1"]);
  assert.match(logs[0], /^\[now\] OUT \+1 \(1\/2\):/);
});

test("signal reply channel broadcasts to allowed recipients", async () => {
  const requests = [];
  const channel = createSignalReplyChannel({
    allowedNumbers: new Set(["+1", "+2"]),
    delay: async () => {},
    logger: { log() {} },
    sendSignalRequest: async (method, params) => requests.push({ method, params }),
    splitIntoChunks,
  });

  await channel.broadcastAllowedMessage("hello");

  assert.deepEqual(
    requests.map((request) => request.params.recipient[0]),
    ["+1", "+2"]
  );
});

test("signal reply channel logs incoming messages", () => {
  const logs = [];
  const incoming = [];
  const channel = createSignalReplyChannel({
    delay: async () => {},
    logger: { log: (line) => logs.push(line) },
    noteIncoming: (sender) => incoming.push(sender),
    sendSignalRequest: async () => {},
    splitIntoChunks,
    timestamp: () => "now",
  });

  channel.logIncoming("+1", "hello", 2);

  assert.deepEqual(incoming, ["+1"]);
  assert.equal(logs[0], "[now] IN  +1 [images=2]: hello");
});
