const fs = require("fs");

function createBridgeTestSupport(options = {}) {
  const {
    appendTimestamp = () => new Date().toISOString(),
    buildAppServerThreadParams,
    buildAppServerTurnParams,
    clearTimer = clearTimeout,
    handleReceiveEvent,
    logger = console,
    normalizeText = defaultNormalizeText,
    registerCancellationHandler,
    setTimer = setTimeout,
    testAppServerLogPath,
    testReceiveScenarioPath,
    testSignalLogPath,
    testTurnCursorPath,
    testTurnScenarioPath,
  } = options;

  async function startReceiveScenario(filePath) {
    try {
      const payload = await fs.promises.readFile(filePath, "utf8");
      const scenario = JSON.parse(payload);
      const events = Array.isArray(scenario?.receive) ? scenario.receive : [];

      for (const event of events) {
        const delayMs = Number.isFinite(event?.delayMs) ? event.delayMs : 0;
        setTimer(() => {
          void handleReceiveEvent({
            params: {
              envelope: buildReceiveEnvelope(event),
            },
          });
        }, delayMs);
      }
    } catch (error) {
      logger.error?.(
        `[${appendTimestamp()}] Failed loading Sable e2e receive scenario: ${
          error.stack || error.message
        }`
      );
    }
  }

  function buildReceiveEnvelope(event) {
    const sender = normalizeText(event?.sender) || "+15550000001";
    const attachments = Array.isArray(event?.attachments) ? event.attachments : [];
    const message = typeof event?.message === "string" ? event.message : "";

    return {
      sourceNumber: sender,
      source: sender,
      dataMessage: {
        message,
        attachments,
      },
    };
  }

  function appendAppServerLog(entry) {
    appendJsonLine(testAppServerLogPath, entry, "app-server");
  }

  function appendSignalLog(entry) {
    appendJsonLine(testSignalLogPath, entry, "signal");
  }

  function appendJsonLine(filePath, entry, label) {
    if (!filePath) {
      return;
    }

    try {
      fs.appendFileSync(
        filePath,
        `${JSON.stringify({ at: appendTimestamp(), ...entry })}\n`,
        "utf8"
      );
    } catch (error) {
      logger.error?.(
        `[${appendTimestamp()}] Failed writing Sable e2e ${label} log: ${error.message}`
      );
    }
  }

  function getAttachmentMap() {
    if (!testReceiveScenarioPath) {
      return {};
    }

    try {
      const payload = fs.readFileSync(testReceiveScenarioPath, "utf8");
      const scenario = JSON.parse(payload);
      return scenario?.attachments && typeof scenario.attachments === "object"
        ? scenario.attachments
        : {};
    } catch (error) {
      logger.error?.(
        `[${appendTimestamp()}] Failed reading Sable e2e attachment map: ${error.message}`
      );
      return {};
    }
  }

  async function runCodexViaTestScenario(
    prompt,
    sessionId,
    imagePaths = [],
    jobControl = null
  ) {
    const threadMethod = sessionId ? "thread/resume" : "thread/start";
    const threadParams = buildAppServerThreadParams(sessionId || undefined);
    appendAppServerLog({
      method: threadMethod,
      params: threadParams,
    });

    const scenario = await loadTurnScenario();
    const index = takeNextTurnIndex();
    const turnConfig = scenario[index] || {};
    const resolvedSessionId = sessionId || turnConfig.threadId || `thread-${index + 1}`;
    const turnParams = {
      ...buildAppServerTurnParams(resolvedSessionId, prompt, imagePaths),
    };
    appendAppServerLog({
      method: "turn/start",
      params: turnParams,
    });

    const delayMs = Number.isFinite(turnConfig.messageDelayMs) ? turnConfig.messageDelayMs : 120;
    await new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        unregister();
        resolve();
      }, delayMs);
      const unregister = registerCancellationHandler(jobControl, (error) => {
        clearTimer(timer);
        unregister();
        reject(error);
      });
    });

    return {
      sessionId: resolvedSessionId,
      message:
        typeof turnConfig.message === "string" ? turnConfig.message : `fake reply ${index + 1}`,
      toolSuggestion: null,
      startedFreshBecauseResumeFailed: false,
    };
  }

  async function loadTurnScenario() {
    const payload = await fs.promises.readFile(testTurnScenarioPath, "utf8");
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed?.turns) ? parsed.turns : [];
  }

  function takeNextTurnIndex() {
    let index = 0;

    try {
      index = Number.parseInt(fs.readFileSync(testTurnCursorPath, "utf8"), 10) || 0;
    } catch (error) {
      index = 0;
    }

    try {
      fs.writeFileSync(testTurnCursorPath, String(index + 1), "utf8");
    } catch (error) {
      logger.error?.(
        `[${appendTimestamp()}] Failed advancing Sable e2e turn cursor: ${error.message}`
      );
    }

    return index;
  }

  return {
    appendAppServerLog,
    appendSignalLog,
    buildReceiveEnvelope,
    getAttachmentMap,
    loadTurnScenario,
    runCodexViaTestScenario,
    startReceiveScenario,
    takeNextTurnIndex,
  };
}

function defaultNormalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

module.exports = {
  createBridgeTestSupport,
};
