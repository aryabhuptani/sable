const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSignalAttachmentPlugin } = require("../apps/signal-bridge/signal-attachment-plugin");

async function createPlugin({ allowedNumbers = ["+15551112222"], sendSignalRequest } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-signal-attachment-plugin-"));
  const pendingDir = path.join(tempRoot, "pending");
  const resultsDir = path.join(tempRoot, "results");
  const requests = [];
  const plugin = createSignalAttachmentPlugin({
    allowedNumbers,
    pendingDir,
    resultsDir,
    sendSignalRequest:
      sendSignalRequest ||
      ((method, params) => {
        requests.push({ method, params });
        return Promise.resolve({ ok: true });
      }),
    logger: { error() {}, log() {} },
  });
  return { plugin, pendingDir, requests, resultsDir, tempRoot };
}

test("signal attachment plugin normalizes existing outgoing attachment paths", async () => {
  const { plugin, tempRoot } = await createPlugin();
  const reportPath = path.join(tempRoot, "report.pdf");
  const missingPath = path.join(tempRoot, "missing.pdf");
  await fs.writeFile(reportPath, "fake-pdf", "utf8");

  assert.deepEqual(
    plugin.normalizeOutgoingAttachmentPaths([reportPath, reportPath, missingPath, ""]),
    [reportPath]
  );
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("signal attachment plugin processes attachment queue requests", async () => {
  const { plugin, pendingDir, requests, resultsDir, tempRoot } = await createPlugin();
  const reportPath = path.join(tempRoot, "report.pdf");
  await fs.writeFile(reportPath, "fake-pdf", "utf8");
  await plugin.ensureQueueDirs();
  await fs.writeFile(
    path.join(pendingDir, "attach-test.json"),
    JSON.stringify({
      id: "attach-test",
      recipient: "+15550001111",
      message: "attached report",
      files: [reportPath],
    }),
    "utf8"
  );

  await plugin.processNextQueuedCommand();

  assert.deepEqual(requests, [
    {
      method: "send",
      params: {
        recipient: ["+15550001111"],
        message: "attached report",
        attachment: [reportPath],
      },
    },
  ]);
  const result = JSON.parse(await fs.readFile(path.join(resultsDir, "attach-test.json"), "utf8"));
  assert.equal(result.ok, true);
  assert.deepEqual(result.files, [reportPath]);
  await assert.rejects(fs.stat(path.join(pendingDir, "attach-test.json")));
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("signal attachment plugin writes failures for invalid queued files", async () => {
  const { plugin, pendingDir, requests, resultsDir, tempRoot } = await createPlugin();
  await plugin.ensureQueueDirs();
  await fs.writeFile(
    path.join(pendingDir, "bad.json"),
    JSON.stringify({
      id: "bad",
      recipient: "+15550001111",
      files: [path.join(tempRoot, "missing.pdf")],
    }),
    "utf8"
  );

  await plugin.processNextQueuedCommand();

  assert.deepEqual(requests, []);
  const result = JSON.parse(await fs.readFile(path.join(resultsDir, "bad.json"), "utf8"));
  assert.equal(result.ok, false);
  assert.match(result.error, /valid files/);
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("signal attachment plugin classifies and materializes incoming attachments", async () => {
  const imageData = Buffer.from("fake-image", "utf8").toString("base64");
  const fileData = Buffer.from("hello from file", "utf8").toString("base64");
  const { plugin, tempRoot } = await createPlugin({
    sendSignalRequest: (method, params) => {
      assert.equal(method, "getAttachment");
      if (params.id === "image-1") {
        return Promise.resolve({ data: imageData });
      }
      if (params.id === "file-1") {
        return Promise.resolve({ data: fileData });
      }
      return Promise.resolve({ data: "" });
    },
  });
  const envelope = {
    dataMessage: {
      groupInfo: { groupId: "group-1" },
      attachments: [
        { id: "image-1", filename: "photo.png", contentType: "image/png" },
        { id: "file-1", filename: "note.txt", contentType: "text/plain" },
      ],
    },
  };

  const imageAttachments = plugin.extractIncomingImageAttachments(envelope);
  const fileAttachments = plugin.extractIncomingFileAttachments(envelope);
  const context = plugin.buildAttachmentContext(
    envelope,
    "+15550001111",
    imageAttachments,
    [],
    fileAttachments
  );
  const imagePaths = await plugin.materializeIncomingImages(context);
  const filePaths = await plugin.materializeIncomingFiles(context);

  assert.equal(imagePaths.length, 1);
  assert.equal(filePaths.length, 1);
  assert.equal(await fs.readFile(imagePaths[0], "utf8"), "fake-image");
  assert.equal(await fs.readFile(filePaths[0], "utf8"), "hello from file");
  assert.match(path.basename(imagePaths[0]), /^1-photo\.png$/);
  assert.match(path.basename(filePaths[0]), /^1-note\.txt$/);

  await fs.rm(path.dirname(imagePaths[0]), { recursive: true, force: true });
  await fs.rm(path.dirname(filePaths[0]), { recursive: true, force: true });
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("signal attachment plugin builds text attachment prompt context", async () => {
  const { plugin, tempRoot } = await createPlugin();
  const notePath = path.join(tempRoot, "note.md");
  await fs.writeFile(notePath, "hello\n\n\nfrom attachment", "utf8");
  const context = {
    fileAttachments: [
      { id: "file-1", filename: "note.md", contentType: "text/markdown" },
    ],
  };

  const result = await plugin.buildFileAttachmentPromptContext(context, [notePath]);

  assert.equal(result.ok, true);
  assert.match(result.promptText, /Attached file context:/);
  assert.match(result.promptText, /\[File\] note\.md \(text\/markdown\)/);
  assert.match(result.promptText, /hello\n\nfrom attachment/);
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("signal attachment plugin reports unsupported binary attachment context", async () => {
  const { plugin, tempRoot } = await createPlugin();
  const binaryPath = path.join(tempRoot, "blob.bin");
  await fs.writeFile(binaryPath, Buffer.from([0, 1, 2, 3]));
  const context = {
    fileAttachments: [
      { id: "file-1", filename: "blob.bin", contentType: "application/octet-stream" },
    ],
  };

  const result = await plugin.buildFileAttachmentPromptContext(context, [binaryPath]);

  assert.equal(result.ok, false);
  assert.match(result.message, /Unsupported attachment type/);
  await fs.rm(tempRoot, { recursive: true, force: true });
});
