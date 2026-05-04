const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createCodexSessionReader,
  isTimestampOnOrAfter,
  parseSessionEntriesSince,
  safeJsonParse,
} = require("../apps/signal-bridge/codex-session-reader");

function makeTempSessionsDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sable-sessions-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return root;
}

function writeSession(root, threadId, lines) {
  const dir = path.join(root, "2026", "05", "04");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `rollout-${threadId}.jsonl`);
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return filePath;
}

test("codex session reader finds tool suggestions after the turn start", async (t) => {
  const root = makeTempSessionsDir(t);
  writeSession(root, "thread-1", [
    {
      timestamp: "2026-05-04T09:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "tool_suggest",
        call_id: "old",
        arguments: JSON.stringify({ tool_id: "old", tool_type: "plugin" }),
      },
    },
    {
      timestamp: "2026-05-04T10:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "tool_suggest",
        call_id: "call-1",
        arguments: JSON.stringify({
          action_type: "install",
          suggest_reason: "Needed",
          tool_id: "github@openai-curated",
          tool_type: "plugin",
        }),
      },
    },
    {
      timestamp: "2026-05-04T10:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: JSON.stringify({
          completed: true,
          tool_name: "github",
          user_confirmed: true,
        }),
      },
    },
  ]);

  const reader = createCodexSessionReader({ sessionsDir: root });
  assert.deepEqual(await reader.findToolSuggestionForTurn("thread-1", "2026-05-04T09:30:00.000Z"), {
    actionType: "install",
    suggestReason: "Needed",
    toolId: "github@openai-curated",
    toolName: "github",
    toolType: "plugin",
    completed: true,
    userConfirmed: true,
  });
});

test("codex session reader returns the latest turn error", async (t) => {
  const root = makeTempSessionsDir(t);
  writeSession(root, "thread-2", [
    {
      timestamp: "2026-05-04T09:00:00.000Z",
      type: "event_msg",
      payload: { type: "error", message: "old error" },
    },
    {
      timestamp: "2026-05-04T10:00:00.000Z",
      type: "event_msg",
      payload: { type: "error", message: "first" },
    },
    {
      timestamp: "2026-05-04T10:00:01.000Z",
      type: "event_msg",
      payload: { type: "error", message: "second" },
    },
  ]);

  const reader = createCodexSessionReader({ sessionsDir: root });
  assert.equal(
    await reader.findSessionErrorMessageForTurn("thread-2", "2026-05-04T09:30:00.000Z"),
    "second"
  );
});

test("codex session reader returns null for missing session dirs", async (t) => {
  const root = path.join(makeTempSessionsDir(t), "missing");
  const reader = createCodexSessionReader({ sessionsDir: root });
  assert.equal(await reader.findSessionFileForThread("thread-3"), null);
  assert.equal(await reader.findToolSuggestionForTurn("thread-3", "2026-05-04T09:30:00.000Z"), null);
  assert.equal(
    await reader.findSessionErrorMessageForTurn("thread-3", "2026-05-04T09:30:00.000Z"),
    ""
  );
});

test("codex session reader parses timestamps and JSON safely", () => {
  const entries = [
    JSON.stringify({ timestamp: "2026-05-04T09:00:00.000Z", ok: false }),
    "not json",
    JSON.stringify({ timestamp: "2026-05-04T10:00:00.000Z", ok: true }),
  ].join("\n");

  assert.deepEqual([...parseSessionEntriesSince(entries, "2026-05-04T09:30:00.000Z")], [
    { timestamp: "2026-05-04T10:00:00.000Z", ok: true },
  ]);
  assert.equal(isTimestampOnOrAfter("2026-05-04T10:00:00.000Z", "2026-05-04T09:00:00.000Z"), true);
  assert.equal(isTimestampOnOrAfter("bad", "2026-05-04T09:00:00.000Z"), false);
  assert.deepEqual(safeJsonParse("{\"ok\":true}"), { ok: true });
  assert.equal(safeJsonParse("{"), null);
});
