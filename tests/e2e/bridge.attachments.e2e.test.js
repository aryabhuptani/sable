const fs = require("node:fs");
const test = require("node:test");

const {
  assert,
  assertNoCodexTurnStarted,
  fsp,
  path,
  startBridgeScenario,
  waitFor,
} = require("./helpers/bridge-harness");

async function queueAttachmentRequest(queueDir, requestId, payload) {
  const pendingPath = path.join(queueDir, "pending", `${requestId}.json`);
  await fsp.mkdir(path.dirname(pendingPath), { recursive: true });
  await fsp.writeFile(
    pendingPath,
    `${JSON.stringify({ id: requestId, ...payload }, null, 2)}\n`,
    "utf8"
  );
}

test("bridge attachment queue sends a file attachment through signal-cli", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: { turns: [] },
    extraEnv: ({ tempRoot }) => {
      const attachmentPath = path.join(tempRoot, "report.pdf");
      const queueDir = path.join(tempRoot, "attachment-queue");
      fs.writeFileSync(attachmentPath, "fake-pdf", "utf8");
      return {
        SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR: queueDir,
      };
    },
  });

  try {
    const attachmentPath = path.join(harness.tempRoot, "report.pdf");
    const queueDir = path.join(harness.tempRoot, "attachment-queue");
    await queueAttachmentRequest(queueDir, "attach-test", {
      recipient: "+15551112222",
      message: "attached report",
      files: [attachmentPath],
    });

    const sendRequest = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send"
        && Array.isArray(request.params?.attachment)
        && request.params.attachment.includes(attachmentPath)
        && request.params.message === "attached report",
      "attachment send request"
    );

    assert.deepEqual(sendRequest.params.recipient, ["+15551112222"]);

    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("bridge attachment queue writes a failure result when queued files are invalid", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: { turns: [] },
    extraEnv: ({ tempRoot }) => ({
      SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR: path.join(tempRoot, "attachment-queue"),
    }),
  });

  try {
    const queueDir = path.join(harness.tempRoot, "attachment-queue");
    const resultPath = path.join(queueDir, "results", "attach-invalid.json");
    await queueAttachmentRequest(queueDir, "attach-invalid", {
      recipient: "+15551112222",
      message: "broken attachment request",
      files: [path.join(harness.tempRoot, "missing.pdf")],
    });

    await waitFor(
      async () => {
        try {
          await fsp.access(resultPath);
          return true;
        } catch (error) {
          return false;
        }
      },
      { description: "attachment failure result file" }
    );

    const result = JSON.parse(await fsp.readFile(resultPath, "utf8"));
    assert.equal(result.ok, false);
    assert.match(result.error, /did not include any valid files/i);

    const signalRequests = await harness.getSignalRequests();
    assert.equal(
      signalRequests.find((request) => request.method === "send"),
      undefined
    );

    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});
