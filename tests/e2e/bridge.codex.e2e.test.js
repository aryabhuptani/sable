const test = require("node:test");

const {
  assert,
  extractSentMessages,
  startBridgeScenario,
} = require("./helpers/bridge-harness");

const EMPTY_TURN_SCENARIO_ENV = {
  SABLE_E2E_TURN_SCENARIO_PATH: "",
  SABLE_E2E_TURN_CURSOR_PATH: "",
};

test("text message round-trip sends the final reply", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "hello",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message: "hi from sable",
          messageDelayMs: 40,
        },
      ],
    },
    extraEnv: EMPTY_TURN_SCENARIO_ENV,
  });

  try {
    await harness.waitForSignalRequest(
      (request) => request.method === "send" && request.params?.message === "hi from sable",
      "final text reply"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(sentMessages.includes("hi from sable"));
  } finally {
    await harness.shutdown();
  }
});

test("vault-backed markdown links are rewritten to Obsidian redirect links for Signal replies", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "link me that note",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message:
            "Read [privacy note](/home/arya/memory/knowledge/research/darkbloom/wiki/notes/optional-e2e-encryption-and-plaintext-fallbacks.md:1)",
          messageDelayMs: 40,
        },
      ],
    },
    extraEnv: {
      SABLE_OBSIDIAN_BASE_URL: "https://arya-minipc.test.ts.net",
    },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send"
        && typeof request.params?.message === "string"
        && request.params.message.includes("privacy note: https://arya-minipc.test.ts.net/obsidian/open?"),
      "Obsidian rewrite reply"
    );

    assert.match(
      reply.params.message,
      /privacy note: https:\/\/arya-minipc\.test\.ts\.net\/obsidian\/open\?path=%2Fhome%2Farya%2Fmemory%2Fknowledge%2Fresearch%2Fdarkbloom%2Fwiki%2Fnotes%2Foptional-e2e-encryption-and-plaintext-fallbacks\.md&line=1/
    );
    assert.doesNotMatch(reply.params.message, /\[privacy note\]/);
  } finally {
    await harness.shutdown();
  }
});
