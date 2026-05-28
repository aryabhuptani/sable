const assert = require("node:assert/strict");
const test = require("node:test");

const { createBridgeQueueRuntime } = require("../apps/signal-bridge/bridge-queue-runtime");
const { parseCommand } = require("../apps/signal-bridge/bridge-commands");

test("bridge queue routes normalized Mattermost envelopes into parent Sable prompt", async () => {
  const processed = [];
  const replies = [];
  let runtime;
  const queue = createBridgeQueueRuntime({
    cancelJobControl: () => true,
    cleanupPaths: async () => {},
    defaultFilePrompt: "file",
    defaultImagePrompt: "image",
    getBridgeStatusReport: async () => "status",
    getJobRuntime: () => runtime,
    getRestartRequested: () => false,
    getShutdownRequested: () => false,
    isCancellationError: () => false,
    logIncoming: () => {},
    parseCommand,
    schedulerRuntime: {
      checkForDueScheduledJobs: async () => {},
    },
    sendReply: async (recipient, message) => replies.push({ recipient, message }),
    signalAttachments: {
      buildAttachmentContext: () => ({}),
      extractIncomingAudioAttachments: () => [],
      extractIncomingFileAttachments: () => [],
      extractIncomingImageAttachments: () => [],
    },
    signalInbound: {},
    timestamp: () => "now",
    voiceNotes: { isEnabled: () => false },
  });
  runtime = {
    processJob: async (job) => processed.push(job),
    sendJobReply: async () => {},
  };

  await queue.handleTransportEnvelope({
    transport: "mattermost",
    conversationId: "channel-id",
    sender: "user-id",
    text: "hello from mm",
    replyTarget: "mattermost:channel-id",
  });

  assert.equal(processed.length, 1);
  assert.equal(processed[0].sender, "mattermost:channel-id");
  assert.match(processed[0].command.prompt, /Incoming mattermost message/);
  assert.match(processed[0].command.prompt, /Conversation id: channel-id/);
  assert.match(processed[0].command.prompt, /Sender: user-id/);
  assert.match(processed[0].command.prompt, /hello from mm/);
  assert.deepEqual(replies, []);
});

