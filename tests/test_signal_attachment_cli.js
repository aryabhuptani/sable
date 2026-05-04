const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const TOOL_PATH = "/home/arya/projects/sable/tools/signal/send_attachment.js";

test("send_attachment helper writes a queue request and waits for the bridge result file", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-signal-attach-"));
  const bridgeDir = path.join(tempRoot, "bridge");
  const queueDir = path.join(tempRoot, "queue");
  const attachmentPath = path.join(tempRoot, "report.pdf");

  await fs.mkdir(bridgeDir, { recursive: true });
  await fs.writeFile(
    path.join(bridgeDir, ".env"),
    "ALLOWED_NUMBERS=+15551112222\n",
    "utf8"
  );
  await fs.writeFile(attachmentPath, "fake-pdf", "utf8");
  await fs.mkdir(path.join(queueDir, "pending"), { recursive: true });
  await fs.mkdir(path.join(queueDir, "results"), { recursive: true });

  const bridgeWorker = (async () => {
    const pendingDir = path.join(queueDir, "pending");
    const resultsDir = path.join(queueDir, "results");
    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline) {
      const entries = await fs.readdir(pendingDir);
      const nextEntry = entries.find((entry) => entry.endsWith(".json"));
      if (!nextEntry) {
        await delay(100);
        continue;
      }

      const requestPath = path.join(pendingDir, nextEntry);
      const raw = await fs.readFile(requestPath, "utf8");
      const payload = JSON.parse(raw);
      await fs.writeFile(
        path.join(resultsDir, `${payload.id}.json`),
        `${JSON.stringify({ ok: true, recipient: payload.recipient })}\n`,
        "utf8"
      );
      return payload;
    }

    throw new Error("Timed out waiting for helper to write a queue request.");
  })();

  await execFileAsync(
    "node",
    [
      TOOL_PATH,
      "--bridge-dir",
      bridgeDir,
      "--queue-dir",
      queueDir,
      "--file",
      attachmentPath,
      "--message",
      "attached report",
    ],
    {
      env: {
        ...process.env,
        SABLE_SIGNAL_REPLY_TO: "+15559990000",
      },
    }
  );

  const capturedRequest = await bridgeWorker;
  assert.match(capturedRequest.id, /^attach-/);
  assert.equal(capturedRequest.recipient, "+15559990000");
  assert.equal(capturedRequest.message, "attached report");
  assert.deepEqual(capturedRequest.files, [attachmentPath]);

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("send_attachment helper derives bridge dir from instance config", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-signal-instance-"));
  const repoRoot = path.join(tempRoot, "sable-core");
  const bridgeDir = path.join(repoRoot, "apps", "signal-bridge");
  const attachmentPath = path.join(tempRoot, "report.pdf");

  await fs.mkdir(bridgeDir, { recursive: true });
  await fs.writeFile(
    path.join(bridgeDir, ".env"),
    "ALLOWED_NUMBERS=+15551112222\n",
    "utf8"
  );
  await fs.writeFile(attachmentPath, "fake-pdf", "utf8");

  const queueDir = path.join(bridgeDir, ".attachment-queue");
  const bridgeWorker = waitForAttachmentRequest(queueDir);

  await execFileAsync(
    "node",
    [
      TOOL_PATH,
      "--file",
      attachmentPath,
      "--message",
      "attached report",
    ],
    {
      env: {
        PATH: process.env.PATH,
        SABLE_REPO_ROOT: repoRoot,
      },
    }
  );

  const capturedRequest = await bridgeWorker;
  assert.equal(capturedRequest.recipient, "+15551112222");
  assert.equal(capturedRequest.message, "attached report");
  assert.deepEqual(capturedRequest.files, [attachmentPath]);

  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function waitForAttachmentRequest(queueDir) {
  const pendingDir = path.join(queueDir, "pending");
  const resultsDir = path.join(queueDir, "results");
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    let entries = [];
    try {
      entries = await fs.readdir(pendingDir);
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }
    const nextEntry = entries.find((entry) => entry.endsWith(".json"));
    if (!nextEntry) {
      await delay(100);
      continue;
    }

    const requestPath = path.join(pendingDir, nextEntry);
    const raw = await fs.readFile(requestPath, "utf8");
    const payload = JSON.parse(raw);
    await fs.mkdir(resultsDir, { recursive: true });
    await fs.writeFile(
      path.join(resultsDir, `${payload.id}.json`),
      `${JSON.stringify({ ok: true, recipient: payload.recipient })}\n`,
      "utf8"
    );
    return payload;
  }

  throw new Error("Timed out waiting for helper to write a queue request.");
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
