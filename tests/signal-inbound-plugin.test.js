const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSignalInboundPlugin,
  extractIncomingText,
  extractSenderCandidates,
} = require("../apps/signal-bridge/signal-inbound-plugin");

test("signal inbound plugin extracts sender candidates in bridge priority order", () => {
  assert.deepEqual(
    extractSenderCandidates({
      sourceNumber: " +15551112222 ",
      source: "+15553334444",
      sourceUuid: "uuid-1",
      sourceName: "Arya",
    }),
    ["+15551112222", "+15553334444", "uuid-1", "Arya"]
  );
});

test("signal inbound plugin checks allowed numbers and senders", () => {
  const plugin = createSignalInboundPlugin({
    allowedNumbers: new Set(["+15551112222"]),
    allowedSenders: new Set(["uuid-1"]),
  });

  assert.equal(plugin.isAllowedSender(["+15550000000", "uuid-1"]), true);
  assert.equal(plugin.isAllowedSender(["+15550000000"]), false);
});

test("signal inbound plugin extracts text from Signal envelope shapes", () => {
  assert.equal(extractIncomingText({ dataMessage: { message: " hello " } }), "hello");
  assert.equal(extractIncomingText({ message: " fallback " }), "fallback");
  assert.equal(extractIncomingText({ body: " body " }), "body");
  assert.equal(extractIncomingText({ dataMessage: { message: " " } }), null);
});
