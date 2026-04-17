#!/usr/bin/env node

const fs = require("fs");

const scenarioPath = process.env.FAKE_CODEX_SCENARIO_PATH;
const cursorPath = process.env.FAKE_CODEX_CURSOR_PATH;

if (!scenarioPath || !cursorPath) {
  console.error("fake-codex requires FAKE_CODEX_SCENARIO_PATH and FAKE_CODEX_CURSOR_PATH");
  process.exit(1);
}

const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const turns = Array.isArray(scenario.turns) ? scenario.turns : [];
const keepAlive = setInterval(() => {}, 60_000);

function writeJson(message) {
  fs.writeSync(1, `${JSON.stringify(message)}\n`);
}

function takeTurnConfig() {
  let index = 0;

  try {
    index = Number.parseInt(fs.readFileSync(cursorPath, "utf8"), 10) || 0;
  } catch (error) {
    index = 0;
  }

  fs.writeFileSync(cursorPath, String(index + 1));
  return turns[index] || {};
}

function scheduleTurnLifecycle(turnConfig) {
  const threadId = turnConfig.threadId || "thread-1";
  const turnId = turnConfig.turnId || `turn-${Date.now()}`;
  const initializeDelayMs = Number.isFinite(turnConfig.initializeDelayMs) ? turnConfig.initializeDelayMs : 50;
  const threadDelayMs = Number.isFinite(turnConfig.threadDelayMs) ? turnConfig.threadDelayMs : 180;
  const turnResponseDelayMs = Number.isFinite(turnConfig.turnResponseDelayMs)
    ? turnConfig.turnResponseDelayMs
    : 420;
  const startedDelayMs = Math.max(
    Number.isFinite(turnConfig.startedDelayMs) ? turnConfig.startedDelayMs : 520,
    turnResponseDelayMs + 10
  );
  const messageDelayMs = Math.max(
    Number.isFinite(turnConfig.messageDelayMs) ? turnConfig.messageDelayMs : 620,
    startedDelayMs + 20
  );
  const completedDelayMs = Math.max(
    Number.isFinite(turnConfig.completedDelayMs) ? turnConfig.completedDelayMs : messageDelayMs + 20,
    messageDelayMs + 10
  );
  const finalMessage =
    typeof turnConfig.message === "string" ? turnConfig.message : `fake reply ${turnId}`;

  setTimeout(() => {
    writeJson({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
  }, initializeDelayMs);

  setTimeout(() => {
    writeJson({
      jsonrpc: "2.0",
      id: 2,
      result: {
        thread: { id: threadId },
      },
    });
  }, threadDelayMs);

  setTimeout(() => {
    writeJson({
      jsonrpc: "2.0",
      id: 3,
      result: {
        turn: { id: turnId },
      },
    });
  }, turnResponseDelayMs);

  setTimeout(() => {
    writeJson({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        turn: { id: turnId },
      },
    });
  }, startedDelayMs);

  if (finalMessage) {
    setTimeout(() => {
      writeJson({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            status: "completed",
            text: finalMessage,
          },
        },
      });
    }, messageDelayMs);
  }

  setTimeout(() => {
    writeJson({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        turn: { id: turnId },
      },
    });
  }, completedDelayMs);
}

scheduleTurnLifecycle(takeTurnConfig());

process.on("SIGTERM", () => {
  clearInterval(keepAlive);
  process.exit(0);
});
