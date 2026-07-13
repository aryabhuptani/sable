const test = require("node:test");
const assert = require("node:assert/strict");

const { formatHelp, parseCommand } = require("../apps/signal-bridge/bridge-commands");

test("parseCommand recognizes bridge control commands", () => {
  assert.deepEqual(parseCommand("/help"), { type: "help" });
  assert.deepEqual(parseCommand("/bridgestatus"), { type: "status" });
  assert.deepEqual(parseCommand("/ops"), { type: "ops" });
  assert.deepEqual(parseCommand("/schedules"), { type: "list-schedules" });
  assert.deepEqual(parseCommand("/cancel"), { type: "cancel" });
  assert.deepEqual(parseCommand("/setavatar"), { type: "set-avatar" });
  assert.deepEqual(parseCommand("/removeavatar"), { type: "remove-avatar" });
  assert.deepEqual(parseCommand("/authstatus"), { type: "auth-status" });
  assert.deepEqual(parseCommand("/authcancel"), { type: "auth-cancel" });
  assert.deepEqual(parseCommand("/authresume"), { type: "auth-resume" });
  assert.deepEqual(parseCommand("/plugins"), { type: "plugin-status" });
  assert.deepEqual(parseCommand("/pluginstatus"), { type: "plugin-status" });
  assert.deepEqual(parseCommand("/whatsapp"), { type: "whatsapp-triage", limit: 25 });
  assert.deepEqual(parseCommand("/runs"), { type: "list-runs" });
  assert.deepEqual(parseCommand("/blockers"), { type: "list-run-blockers" });
});

test("parseCommand parses delegated run status and controls", () => {
  assert.deepEqual(parseCommand("/run coding-20260713-001"), {
    type: "show-run",
    runId: "coding-20260713-001",
  });
  assert.deepEqual(parseCommand("/run coding-20260713-001 pause"), {
    type: "control-run",
    runId: "coding-20260713-001",
    action: "pause",
  });
  assert.deepEqual(parseCommand("/run coding-20260713-001 resume"), {
    type: "control-run",
    runId: "coding-20260713-001",
    action: "resume",
  });
  assert.deepEqual(parseCommand("/run coding-20260713-001 cancel"), {
    type: "control-run",
    runId: "coding-20260713-001",
    action: "cancel",
  });
  assert.deepEqual(parseCommand("/run coding-20260713-001 steer focus on callback tests"), {
    type: "control-run",
    runId: "coding-20260713-001",
    action: "steer",
    instruction: "focus on callback tests",
  });
});

test("parseCommand returns run usage for incomplete or invalid controls", () => {
  assert.deepEqual(parseCommand("/run"), { type: "run-usage" });
  assert.deepEqual(parseCommand("/run coding-1 steer"), { type: "run-usage", runId: "coding-1" });
  assert.deepEqual(parseCommand("/run coding-1 explode"), { type: "run-usage", runId: "coding-1" });
});

test("formatHelp includes built-in and runtime plugin commands", () => {
  const help = formatHelp({
    commands: new Map([
      [
        "/hello",
        {
          commandName: "/hello",
          description: "Say hello.",
          pluginId: "local-hello",
        },
      ],
    ]),
  });

  assert.match(help, /\/help - Show available Sable slash commands/);
  assert.match(help, /\/ops - Show bridge/);
  assert.match(help, /\/runs - List recent delegated runs/);
  assert.match(help, /\/run <id> steer <instruction>/);
  assert.match(help, /\/blockers - Show delegated runs waiting/);
  assert.match(help, /\/hello \(local-hello\) - Say hello/);
});

test("parseCommand lets runtime plugins claim slash commands before prompt fallback", () => {
  const pluginCommand = {
    type: "plugin-command",
    commandName: "/hello",
    args: "there",
    pluginId: "local-hello",
    rawText: "/hello there",
  };
  assert.deepEqual(
    parseCommand("/hello there", {
      pluginRuntime: {
        parsePluginCommand: () => pluginCommand,
      },
    }),
    pluginCommand
  );
  assert.deepEqual(
    parseCommand("/ops", {
      pluginRuntime: {
        parsePluginCommand: () => ({
          type: "plugin-command",
          commandName: "/ops",
          pluginId: "local-ops",
        }),
      },
    }),
    { type: "ops" }
  );
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

test("parseCommand parses WhatsApp triage limits", () => {
  assert.deepEqual(parseCommand("/whatsapp", { whatsappTriageLimit: 15 }), {
    type: "whatsapp-triage",
    limit: 15,
  });
  assert.deepEqual(parseCommand("/whatsapp 4", { whatsappTriageLimit: 15 }), {
    type: "whatsapp-triage",
    limit: 4,
  });
  assert.deepEqual(parseCommand("/whatsapp nope", { whatsappTriageLimit: 15 }), {
    type: "whatsapp-triage",
    limit: 15,
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
