const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCommand } = require("../apps/signal-bridge/bridge-commands");

test("parseCommand recognizes bridge control commands", () => {
  assert.deepEqual(parseCommand("/bridgestatus"), { type: "status" });
  assert.deepEqual(parseCommand("/ops"), { type: "ops" });
  assert.deepEqual(parseCommand("/schedules"), { type: "list-schedules" });
  assert.deepEqual(parseCommand("/cancel"), { type: "cancel" });
  assert.deepEqual(parseCommand("/setavatar"), { type: "set-avatar" });
  assert.deepEqual(parseCommand("/removeavatar"), { type: "remove-avatar" });
  assert.deepEqual(parseCommand("/authstatus"), { type: "auth-status" });
  assert.deepEqual(parseCommand("/authcancel"), { type: "auth-cancel" });
  assert.deepEqual(parseCommand("/authresume"), { type: "auth-resume" });
});

test("parseCommand parses telegram triage limits", () => {
  assert.deepEqual(parseCommand("/telegram", { telegramTriageLimit: 25 }), {
    type: "telegram-triage",
    limit: 25,
  });
  assert.deepEqual(parseCommand("/telegram 7", { telegramTriageLimit: 25 }), {
    type: "telegram-triage",
    limit: 7,
  });
  assert.deepEqual(parseCommand("/telegram nope", { telegramTriageLimit: 25 }), {
    type: "telegram-triage",
    limit: 25,
  });
});

test("parseCommand handles /new and attachment defaults", () => {
  assert.deepEqual(parseCommand("/new"), {
    type: "new",
    prompt: null,
  });
  assert.deepEqual(parseCommand("/new summarize this"), {
    type: "new",
    prompt: "summarize this",
  });
  assert.deepEqual(parseCommand("/new", { hasImages: true }), {
    type: "new",
    prompt: "Please analyze the attached image.",
  });
  assert.deepEqual(parseCommand("/new", { hasFiles: true }), {
    type: "new",
    prompt: "Please analyze the attached files.",
  });
});

test("parseCommand treats audio-only /new as a null prompt and normal text as prompt input", () => {
  assert.deepEqual(parseCommand("/new", { hasAudio: true }), {
    type: "prompt",
    prompt: null,
  });
  assert.deepEqual(parseCommand("hello world"), {
    type: "prompt",
    prompt: "hello world",
  });
});

test("parseCommand parses unschedule ids", () => {
  assert.deepEqual(parseCommand("/unschedule sched-abc123"), {
    type: "unschedule",
    scheduleId: "sched-abc123",
  });
});
