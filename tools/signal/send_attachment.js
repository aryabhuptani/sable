#!/usr/bin/env node

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const SIGNAL_REPLY_TO_ENV = "SABLE_SIGNAL_REPLY_TO";
const SIGNAL_BRIDGE_DIR_ENV = "SABLE_SIGNAL_BRIDGE_DIR";
const { createInstanceConfig } = require("../instance/instance-config");

const DEFAULT_SIGNAL_ATTACHMENT_PATHS = getDefaultSignalAttachmentPaths({ env: {} });
const DEFAULT_BRIDGE_DIR = DEFAULT_SIGNAL_ATTACHMENT_PATHS.bridgeDir;
const DEFAULT_QUEUE_DIR = path.join(DEFAULT_BRIDGE_DIR, ".attachment-queue");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const pathDefaults = getDefaultSignalAttachmentPaths();
  const bridgeDir = path.resolve(normalizeText(args.bridgeDir) || pathDefaults.bridgeDir);
  const queueDir = path.resolve(
    normalizeText(args.queueDir) ||
      normalizeText(process.env.SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR) ||
      path.join(bridgeDir, ".attachment-queue")
  );
  const bridgeEnv = loadSimpleEnv(path.join(bridgeDir, ".env"));

  const files = args.files.map((filePath) => path.resolve(filePath));
  if (files.length === 0) {
    throw new Error("Pass at least one --file path.");
  }

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`);
    }
  }

  const recipient =
    normalizeText(args.recipient) ||
    normalizeText(process.env[SIGNAL_REPLY_TO_ENV]) ||
    firstAllowedNumber(bridgeEnv.ALLOWED_NUMBERS);

  if (!recipient && !args.noteToSelf) {
    throw new Error(
      `Missing recipient. Pass --recipient or set ${SIGNAL_REPLY_TO_ENV}, or configure ALLOWED_NUMBERS in the bridge .env.`
    );
  }

  const requestId = buildRequestId();
  const payload = {
    id: requestId,
    recipient: args.noteToSelf ? "" : recipient,
    message: normalizeText(args.message),
    files,
  };
  const response = await writeRequestAndWaitForResult(queueDir, requestId, payload, args.timeoutSec);

  const result = {
    ...response,
    ok: Boolean(response?.ok),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    files: [],
    recipient: "",
    message: "",
    bridgeDir: "",
    queueDir: "",
    timeoutSec: 60,
    noteToSelf: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --file");
      }
      parsed.files.push(value);
      index += 1;
      continue;
    }
    if (arg === "--recipient") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --recipient");
      }
      parsed.recipient = value;
      index += 1;
      continue;
    }
    if (arg === "--message") {
      const value = argv[index + 1];
      if (typeof value === "undefined") {
        throw new Error("Missing value for --message");
      }
      parsed.message = value;
      index += 1;
      continue;
    }
    if (arg === "--bridge-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --bridge-dir");
      }
      parsed.bridgeDir = value;
      index += 1;
      continue;
    }
    if (arg === "--queue-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --queue-dir");
      }
      parsed.queueDir = value;
      index += 1;
      continue;
    }
    if (arg === "--timeout-sec") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --timeout-sec");
      }
      parsed.timeoutSec = parseInteger(value, 60);
      index += 1;
      continue;
    }
    if (arg === "--note-to-self") {
      parsed.noteToSelf = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  const lines = [
    "Usage:",
    "  node tools/signal/send_attachment.js --file /abs/path/to/file.pdf [--file /abs/path/to/other] [--message \"caption\"] [--recipient +1555] [--queue-dir /path/to/queue] [--timeout-sec 60]",
    "",
    "Defaults:",
    `- bridge dir from --bridge-dir, ${SIGNAL_BRIDGE_DIR_ENV}, or ${DEFAULT_BRIDGE_DIR}`,
    `- queue dir from --queue-dir, SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR, or ${DEFAULT_QUEUE_DIR}`,
    `- recipient from --recipient, ${SIGNAL_REPLY_TO_ENV}, or the first ALLOWED_NUMBERS entry in the bridge .env`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function getDefaultSignalAttachmentPaths({ env = process.env, homeDir = "", repoRoot = "" } = {}) {
  const instance = createInstanceConfig({ env, homeDir, repoRoot });
  const bridgeDir = path.resolve(
    normalizeText(env[SIGNAL_BRIDGE_DIR_ENV]) || instance.signalBridgeDir
  );
  return {
    bridgeDir,
    queueDir: path.resolve(
      normalizeText(env.SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR) ||
        path.join(bridgeDir, ".attachment-queue")
    ),
  };
}

function loadSimpleEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const values = {};
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      values[key] = value;
    }
    return values;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function firstAllowedNumber(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)[0] || "";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function writeRequestAndWaitForResult(queueDir, requestId, payload, timeoutSec = 60) {
  const pendingDir = path.join(queueDir, "pending");
  const resultsDir = path.join(queueDir, "results");
  await fsp.mkdir(pendingDir, { recursive: true });
  await fsp.mkdir(resultsDir, { recursive: true });

  const requestPath = path.join(pendingDir, `${requestId}.json`);
  const resultPath = path.join(resultsDir, `${requestId}.json`);
  await fsp.writeFile(requestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const timeoutMs = Math.max(5, timeoutSec) * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await fsp.readFile(resultPath, "utf8");
      const parsed = raw ? JSON.parse(raw) : {};
      await fsp.rm(resultPath, { force: true });
      if (!parsed?.ok) {
        throw new Error(normalizeText(parsed?.error) || "Bridge returned an attachment-send failure.");
      }
      return parsed;
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        throw error;
      }
    }

    await delay(500);
  }

  throw new Error(
    `Timed out waiting for the Signal bridge to process attachment request ${requestId}.`
  );
}

function buildRequestId() {
  return `attach-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
