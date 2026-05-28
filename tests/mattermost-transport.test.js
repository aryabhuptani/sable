const assert = require("node:assert/strict");
const test = require("node:test");

const { createMattermostTransport } = require("../apps/signal-bridge/mattermost-transport");

test("mattermost transport polls direct message channels", async () => {
  const envelopes = [];
  const calls = [];
  const transport = createMattermostTransport({
    allowedUsers: ["arya-user"],
    baseUrl: "https://mattermost.example.test",
    botUserId: "bot-user",
    dmUserIds: ["arya-user"],
    enabled: true,
    token: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/api/v4/channels/direct")) {
        return jsonResponse({ id: "dm-channel" });
      }
      if (url.includes("/api/v4/channels/dm-channel/posts")) {
        return jsonResponse({
          posts: {
            "post-1": {
              id: "post-1",
              channel_id: "dm-channel",
              user_id: "arya-user",
              message: "hello from dm",
              create_at: 1779945600000,
            },
            "post-2": {
              id: "post-2",
              channel_id: "dm-channel",
              user_id: "bot-user",
              message: "ignore bot echo",
              create_at: 1779945600001,
            },
          },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    },
    onEnvelope: async (envelope) => envelopes.push(envelope),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });

  assert.equal(await transport.start(), true);
  assert.deepEqual(transport.getWatchedChannels(), [
    { id: "dm-channel", kind: "direct", userId: "arya-user" },
  ]);

  await transport.poll();

  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].conversationId, "dm-channel");
  assert.equal(envelopes[0].replyTarget, "mattermost:dm-channel");
  assert.equal(envelopes[0].channelKind, "direct");
  assert.equal(envelopes[0].text, "hello from dm");
  assert.equal(calls[0].url, "https://mattermost.example.test/api/v4/channels/direct");
});

function jsonResponse(value) {
  return {
    ok: true,
    text: async () => JSON.stringify(value),
  };
}
