const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createMattermostClient,
  normalizeMattermostPostEvent,
  redactMattermostSecrets,
} = require("../apps/signal-bridge/mattermost-client");

test("mattermost client posts messages with bearer auth", async () => {
  const calls = [];
  const client = createMattermostClient({
    baseUrl: "https://mattermost.example.test/",
    token: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({ id: "post-id" }),
      };
    },
  });

  const result = await client.postMessage("channel-id", "hello");
  assert.deepEqual(result, { id: "post-id" });
  assert.equal(calls[0].url, "https://mattermost.example.test/api/v4/posts");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
});

test("mattermost post events normalize to transport envelopes", () => {
  const event = {
    data: {
      post: JSON.stringify({
        id: "post-id",
        channel_id: "channel-id",
        user_id: "user-id",
        message: "hello sable",
        create_at: 1779945600000,
      }),
    },
  };
  const envelope = normalizeMattermostPostEvent(event);
  assert.equal(envelope.transport, "mattermost");
  assert.equal(envelope.conversationId, "channel-id");
  assert.equal(envelope.sender, "user-id");
  assert.equal(envelope.text, "hello sable");
});

test("mattermost token redaction removes bearer and raw token", () => {
  assert.equal(
    redactMattermostSecrets("Bearer abc123 token secret-token", "secret-token"),
    "Bearer [REDACTED] token [REDACTED_MATTERMOST_TOKEN]"
  );
});

