"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { createInstanceConfig } = require("../instance/instance-config");

function normalizeText(value) {
  return String(value || "").trim();
}

async function queueSignalMessage({
  bridgeDir = "",
  env = process.env,
  idPrefix = "message",
  message,
  queueDir = "",
  recipient = "",
}) {
  const instance = createInstanceConfig({ env });
  const resolvedBridgeDir = path.resolve(
    normalizeText(bridgeDir) || normalizeText(env.SABLE_SIGNAL_BRIDGE_DIR) || instance.signalBridgeDir
  );
  const resolvedQueueDir = path.resolve(
    normalizeText(queueDir) ||
      normalizeText(env.SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR) ||
      path.join(resolvedBridgeDir, ".attachment-queue")
  );
  const requestId = `${normalizeText(idPrefix) || "message"}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 10)}`;
  const pendingDir = path.join(resolvedQueueDir, "pending");
  await fs.mkdir(pendingDir, { recursive: true });
  await fs.mkdir(path.join(resolvedQueueDir, "results"), { recursive: true });
  const payload = {
    files: [],
    id: requestId,
    message: normalizeText(message),
    recipient: normalizeText(recipient) || normalizeText(env.SABLE_SIGNAL_REPLY_TO),
  };
  await fs.writeFile(
    path.join(pendingDir, `${requestId}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  return {
    id: requestId,
    payload,
    queueDir: resolvedQueueDir,
  };
}

module.exports = { queueSignalMessage };
