const test = require("node:test");

const {
  assert,
  extractSentMessages,
  startBridgeScenario,
} = require("./helpers/bridge-harness");

test("subagent activity is collapsed to a kickoff note plus the integrated final result", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "please delegate the bounded bit",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          notifications: [
            {
              delayMs: 40,
              message: {
                jsonrpc: "2.0",
                method: "turn/started",
                params: {},
              },
            },
            {
              delayMs: 60,
              message: {
                jsonrpc: "2.0",
                method: "item/started",
                params: {
                  item: {
                    id: "subagent-1",
                    type: "mcpToolCall",
                    toolName: "spawn_agent",
                    status: "in_progress",
                  },
                },
              },
            },
            {
              delayMs: 80,
              message: {
                jsonrpc: "2.0",
                method: "item/completed",
                params: {
                  item: {
                    type: "agentMessage",
                    status: "completed",
                    text: "Worker 1 says hello from the crawl.",
                  },
                },
              },
            },
            {
              delayMs: 100,
              message: {
                jsonrpc: "2.0",
                method: "item/mcpToolCall/progress",
                params: {
                  message: "Worker 1 is 40% done.",
                },
              },
            },
            {
              delayMs: 140,
              message: {
                jsonrpc: "2.0",
                method: "item/completed",
                params: {
                  item: {
                    id: "subagent-1",
                    type: "mcpToolCall",
                    toolName: "spawn_agent",
                    status: "completed",
                  },
                },
              },
            },
            {
              delayMs: 180,
              message: {
                jsonrpc: "2.0",
                method: "item/completed",
                params: {
                  item: {
                    type: "agentMessage",
                    status: "completed",
                    text: "Integrated result from the bounded task.",
                  },
                },
              },
            },
            {
              delayMs: 220,
              message: {
                jsonrpc: "2.0",
                method: "turn/completed",
                params: {},
              },
            },
          ],
        },
      ],
    },
    extraEnv: {
      SABLE_E2E_TURN_SCENARIO_PATH: "",
      SABLE_E2E_TURN_CURSOR_PATH: "",
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send"
        && request.params?.message === "Integrated result from the bounded task.",
      "final integrated result"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(
      sentMessages.some((message) => message.includes("Kicking off a subagent for a bounded task")),
      "expected a concise kickoff note for subagent work"
    );
    assert.equal(
      sentMessages.some((message) => message.includes("Worker 1 says hello from the crawl.")),
      false
    );
    assert.equal(
      sentMessages.some((message) => message.includes("Worker 1 is 40% done.")),
      false
    );
  } finally {
    await harness.shutdown();
  }
});

test("ordinary non-subagent progress still streams through the bridge", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "do the normal thing",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          notifications: [
            {
              delayMs: 40,
              message: {
                jsonrpc: "2.0",
                method: "turn/started",
                params: {},
              },
            },
            {
              delayMs: 60,
              message: {
                jsonrpc: "2.0",
                method: "item/mcpToolCall/progress",
                params: {
                  message: "Scanning repo state...",
                },
              },
            },
            {
              delayMs: 120,
              message: {
                jsonrpc: "2.0",
                method: "item/completed",
                params: {
                  item: {
                    type: "agentMessage",
                    status: "completed",
                    text: "Normal final answer.",
                  },
                },
              },
            },
            {
              delayMs: 160,
              message: {
                jsonrpc: "2.0",
                method: "turn/completed",
                params: {},
              },
            },
          ],
        },
      ],
    },
    extraEnv: {
      SABLE_E2E_TURN_SCENARIO_PATH: "",
      SABLE_E2E_TURN_CURSOR_PATH: "",
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send"
        && request.params?.message === "Normal final answer.",
      "normal final answer"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(
      sentMessages.some((message) => message.includes("Scanning repo state...")),
      "expected ordinary non-subagent progress to keep flowing"
    );
  } finally {
    await harness.shutdown();
  }
});
