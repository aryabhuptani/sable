const fs = require("fs");

function createBridgeStateStore(options = {}) {
  const {
    logger = console,
    normalizePendingPluginAuth = (value) => value || null,
    normalizeText = defaultNormalizeText,
    statePath,
    timestamp = () => new Date().toISOString(),
    truncateText = defaultTruncateText,
  } = options;

  function loadState() {
    try {
      const raw = fs.readFileSync(statePath, "utf8");
      const parsed = JSON.parse(raw);
      const legacyLastSessionId =
        typeof parsed.lastSessionId === "string" && parsed.lastSessionId.trim()
          ? parsed.lastSessionId.trim()
          : null;
      return {
        interactiveSessionId:
          typeof parsed.interactiveSessionId === "string" && parsed.interactiveSessionId.trim()
            ? parsed.interactiveSessionId.trim()
            : legacyLastSessionId,
        backgroundSessionId:
          typeof parsed.backgroundSessionId === "string" && parsed.backgroundSessionId.trim()
            ? parsed.backgroundSessionId.trim()
            : null,
        pendingPluginAuth: normalizePendingPluginAuth(parsed.pendingPluginAuth),
        inFlightTurn: normalizeInFlightTurn(parsed.inFlightTurn),
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.error?.(`[${timestamp()}] Failed to read state file: ${error.message}`);
      }

      return createEmptyState();
    }
  }

  function saveState(state) {
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  function clearState(state) {
    return {
      ...state,
      interactiveSessionId: null,
      backgroundSessionId: null,
    };
  }

  function clearSessionState(state, kind) {
    const key = kind === "background" ? "backgroundSessionId" : "interactiveSessionId";
    return {
      ...state,
      [key]: null,
    };
  }

  function setInFlightTurn(state, sender, prompt) {
    return {
      ...state,
      inFlightTurn: {
        sender,
        startedAt: timestamp(),
        promptPreview: truncateText(normalizeText(prompt) || "", 160),
      },
    };
  }

  function clearInFlightTurn(state) {
    if (!state.inFlightTurn) {
      return state;
    }

    return {
      ...state,
      inFlightTurn: null,
    };
  }

  function normalizeInFlightTurn(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const sender = normalizeText(value.sender);
    const startedAt = normalizeText(value.startedAt);
    const promptPreview = normalizeText(value.promptPreview);

    if (!sender || !startedAt) {
      return null;
    }

    return {
      sender,
      startedAt,
      promptPreview,
    };
  }

  return {
    clearInFlightTurn,
    clearSessionState,
    clearState,
    loadState,
    normalizeInFlightTurn,
    saveState,
    setInFlightTurn,
  };
}

function createEmptyState() {
  return {
    interactiveSessionId: null,
    backgroundSessionId: null,
    pendingPluginAuth: null,
    inFlightTurn: null,
  };
}

function defaultNormalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

function defaultTruncateText(text, maxLength) {
  const normalized = defaultNormalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

module.exports = {
  createBridgeStateStore,
  createEmptyState,
};
