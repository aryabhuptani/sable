const assert = require("node:assert/strict");
const test = require("node:test");

const { createLiveUpdateChannel } = require("../apps/signal-bridge/live-update-channel");

test("live update channel batches normalized messages on flush", async () => {
  const sent = [];
  const channel = createLiveUpdateChannel({
    recipient: "+15551112222",
    sendReply: async (recipient, text) => sent.push({ recipient, text }),
    setTimer: () => "timer",
    clearTimerFn: () => {},
  });

  channel.queue(" first ");
  channel.queue("first");
  channel.queue("second");
  await channel.flush();

  assert.deepEqual(sent, [
    {
      recipient: "+15551112222",
      text: "first\nsecond",
    },
  ]);
});

test("live update channel suppresses quick duplicate flushes", async () => {
  const sent = [];
  let currentTime = 1_000;
  const channel = createLiveUpdateChannel({
    recipient: "sender",
    duplicateWindowMs: 5_000,
    now: () => currentTime,
    sendReply: async (_recipient, text) => sent.push(text),
    setTimer: () => "timer",
    clearTimerFn: () => {},
  });

  channel.queue("same");
  await channel.flush();
  channel.queue("same");
  await channel.flush();
  currentTime += 5_001;
  channel.queue("same");
  await channel.flush();

  assert.deepEqual(sent, ["same", "same"]);
});

test("live update channel drops queued messages when recipient is empty", async () => {
  const sent = [];
  const channel = createLiveUpdateChannel({
    recipient: "",
    sendReply: async (_recipient, text) => sent.push(text),
    setTimer: () => "timer",
    clearTimerFn: () => {},
  });

  channel.queue("hidden");
  await channel.flush();
  assert.deepEqual(sent, []);
});

test("live update channel logs failed timer flushes", async () => {
  const logs = [];
  const scheduled = [];
  const channel = createLiveUpdateChannel({
    recipient: "sender",
    logger: { error: (line) => logs.push(line) },
    sendReply: async () => {
      throw new Error("send failed");
    },
    setTimer: (callback) => {
      scheduled.push(callback);
      return "timer";
    },
    clearTimerFn: () => {},
    timestamp: () => "now",
  });

  channel.queue("hello");
  scheduled[0]();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(logs, ["[now] Failed sending live update: send failed"]);
});
