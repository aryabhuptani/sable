const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAutoAcceptedMcpElicitationContent,
  createAppServerMessageHelpers,
  safeJsonParse,
} = require("../apps/signal-bridge/app-server-message-helpers");

function createHelpers(overrides = {}) {
  return createAppServerMessageHelpers({
    formatProgressMessage: (text) => `• ${String(text).trim()}`,
    normalizeText: (text) => (typeof text === "string" && text.trim() ? text.trim() : ""),
    timestamp: () => "now",
    truncateText: (text, maxLength) => {
      const normalized = typeof text === "string" && text.trim() ? text.trim() : "";
      return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
    },
    ...overrides,
  });
}

test("app-server helpers capture completed tool suggestions from notification pairs", () => {
  const helpers = createHelpers();
  const calls = new Map();
  assert.equal(
    helpers.captureToolSuggestionFromNotification(
      {
        params: {
          item: {
            type: "function_call",
            name: "tool_suggest",
            call_id: "call-1",
            arguments: JSON.stringify({
              action_type: "install",
              tool_id: "github@openai-curated",
              tool_type: "plugin",
            }),
          },
        },
      },
      calls
    ),
    null
  );

  const suggestion = helpers.captureToolSuggestionFromNotification(
    {
      params: {
        item: {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({
            completed: true,
            tool_name: "github",
            user_confirmed: true,
          }),
        },
      },
    },
    calls
  );

  assert.deepEqual(suggestion, {
    actionType: "install",
    suggestReason: "",
    toolId: "github@openai-curated",
    toolName: "github",
    toolType: "plugin",
    completed: true,
    userConfirmed: true,
  });
});

test("app-server helpers stream pending agent messages before command execution", () => {
  const queued = [];
  const helpers = createHelpers();
  let state = {
    pendingAgentMessage: null,
    finalMessage: "",
    liveUpdates: { queue: (message) => queued.push(message) },
    subagentState: { activeCount: 0 },
  };

  state = {
    ...state,
    ...helpers.handleCodexAppServerItem({ type: "agentMessage", text: "first" }, state),
  };
  state = {
    ...state,
    ...helpers.handleCodexAppServerItem({ type: "agentMessage", text: "second" }, state),
  };

  assert.deepEqual(queued, ["• first"]);
  assert.equal(state.pendingAgentMessage, "second");
  assert.equal(state.finalMessage, "second");
});

test("app-server helpers collapse subagent progress to one kickoff message", () => {
  const queued = [];
  const helpers = createHelpers();
  const subagentState = helpers.createSubagentProgressState();
  const liveUpdates = { queue: (message) => queued.push(message) };

  helpers.handleSubagentToolCallNotification(
    {
      method: "item/started",
      params: {
        item: {
          type: "mcpToolCall",
          id: "a",
          toolName: "spawn_agent",
        },
      },
    },
    subagentState,
    liveUpdates
  );
  helpers.handleSubagentToolCallNotification(
    {
      method: "item/started",
      params: {
        item: {
          type: "mcpToolCall",
          id: "b",
          toolName: "wait_agent",
        },
      },
    },
    subagentState,
    liveUpdates
  );

  assert.deepEqual(queued, ["• Kicking off a subagent for a bounded task..."]);
  assert.equal(subagentState.activeCount, 2);
});

test("app-server helpers format unanswered tool input and MCP elicitation requests", () => {
  const helpers = createHelpers();
  assert.equal(
    helpers.formatToolUserInputRequest({
      questions: [
        { header: "Choice", question: "Pick one?" },
        { question: "Confirm?" },
      ],
    }),
    "Sable requested tool input that this bridge cannot answer yet:\nChoice: Pick one?\nConfirm?"
  );
  assert.equal(
    helpers.formatMcpElicitationRequest({
      message: "Open this",
      url: "https://example.com",
    }),
    "Open this\nhttps://example.com"
  );
});

test("app-server helpers build optimistic MCP elicitation form responses", () => {
  const helpers = createHelpers();
  const params = {
    mode: "form",
    requestedSchema: {
      type: "object",
      properties: {
        allowed: { type: "boolean" },
        count: { type: "integer", default: 3 },
        name: { type: "string" },
        mode: { enum: ["fast", "slow"] },
      },
    },
  };

  assert.deepEqual(helpers.buildAutoAcceptedMcpElicitationResponse(params), {
    action: "accept",
    content: {
      allowed: true,
      count: 3,
      name: "",
      mode: "fast",
    },
  });
  assert.equal(
    buildAutoAcceptedMcpElicitationContent({
      type: "object",
      properties: { unknown: { type: "array" } },
    }),
    null
  );
});

test("app-server helpers suppress install prompt text beside tool suggestions", () => {
  const helpers = createHelpers();
  assert.equal(
    helpers.shouldForwardAgentMessageAlongsideToolSuggestion("Please install `github`."),
    false
  );
  assert.equal(helpers.shouldForwardAgentMessageAlongsideToolSuggestion("Done."), true);
  assert.deepEqual(safeJsonParse("{\"ok\":true}"), { ok: true });
  assert.equal(safeJsonParse("not json"), null);
});
