#!/usr/bin/env node

const fs = require("fs");

const scenarioPath = process.env.FAKE_SIGNAL_SCENARIO_PATH;
const logPath = process.env.FAKE_SIGNAL_LOG_PATH;

if (!scenarioPath || !logPath) {
  console.error("fake-signal-cli requires FAKE_SIGNAL_SCENARIO_PATH and FAKE_SIGNAL_LOG_PATH");
  process.exit(1);
}

const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const receiveEvents = Array.isArray(scenario.receive) ? scenario.receive : [];
const emitReceiveEvents = !process.env.SABLE_E2E_RECEIVE_SCENARIO_PATH;
const attachments = scenario.attachments && typeof scenario.attachments === "object"
  ? scenario.attachments
  : {};
const keepAlive = setInterval(() => {}, 60_000);
const argv = process.argv.slice(2);
const sendModeIndex = argv.indexOf("send");
const jsonRpcMode = argv.includes("jsonRpc");

function appendLog(entry) {
  fs.appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
}

function writeJson(message) {
  fs.writeSync(1, `${JSON.stringify(message)}\n`);
}

function buildEnvelope(event) {
  return {
    sourceNumber: event.sender || "+15550000001",
    source: event.sender || "+15550000001",
    dataMessage: {
      message: typeof event.message === "string" ? event.message : "",
      attachments: Array.isArray(event.attachments) ? event.attachments : [],
    },
  };
}

if (sendModeIndex >= 0 && !jsonRpcMode) {
  const params = parseSendParams(argv.slice(sendModeIndex + 1));
  appendLog({
    direction: "request",
    message: {
      method: "send",
      params,
    },
  });
  clearInterval(keepAlive);
  process.exit(0);
}

if (emitReceiveEvents) {
  for (const event of receiveEvents) {
    const delayMs = Number.isFinite(event.delayMs) ? event.delayMs : 0;
    setTimeout(() => {
      appendLog({ direction: "event", event: "receive", payload: buildEnvelope(event) });
      writeJson({
        jsonrpc: "2.0",
        method: "receive",
        params: {
          envelope: buildEnvelope(event),
        },
      });
    }, delayMs);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  buffer += chunk;

  while (true) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex < 0) {
      break;
    }

    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (!line) {
      continue;
    }

    const message = JSON.parse(line);
    appendLog({ direction: "request", message });

    if (message.method === "send") {
      writeJson({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          timestamp: Date.now(),
        },
      });
      continue;
    }

    if (message.method === "updateProfile") {
      writeJson({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          ok: true,
        },
      });
      continue;
    }

    if (message.method === "getAttachment") {
      const attachment = attachments[message.params?.id];
      writeJson({
        jsonrpc: "2.0",
        id: message.id,
        result: attachment
          ? { data: attachment.dataBase64 }
          : { data: "" },
      });
      continue;
    }

    writeJson({
      jsonrpc: "2.0",
      id: message.id,
      result: {},
    });
  }
});

process.on("SIGTERM", () => {
  clearInterval(keepAlive);
  process.exit(0);
});

function parseSendParams(args) {
  const params = {
    recipient: [],
    message: "",
    attachment: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-m" || arg === "--message") {
      params.message = args[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "-a" || arg === "--attachment") {
      index += 1;
      while (index < args.length && !args[index].startsWith("-")) {
        params.attachment.push(args[index]);
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      params.recipient.push(arg);
    }
  }

  return params;
}
