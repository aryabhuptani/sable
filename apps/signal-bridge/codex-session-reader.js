const fs = require("fs");
const path = require("path");

function createCodexSessionReader(options = {}) {
  const {
    sessionsDir,
    normalizeText = defaultNormalizeText,
  } = options;

  async function findToolSuggestionForTurn(threadId, startedAtIso) {
    const sessionPath = await findSessionFileForThread(threadId);
    if (!sessionPath) {
      return null;
    }

    const raw = await fs.promises.readFile(sessionPath, "utf8");
    const callsById = new Map();

    for (const entry of parseSessionEntriesSince(raw, startedAtIso)) {
      if (entry.type !== "response_item" || !entry.payload) {
        continue;
      }

      if (entry.payload.type === "function_call" && entry.payload.name === "tool_suggest") {
        const record = {
          callId: entry.payload.call_id,
          arguments: safeJsonParse(entry.payload.arguments),
          output: null,
        };
        callsById.set(record.callId, record);
      }

      if (entry.payload.type === "function_call_output" && entry.payload.call_id) {
        const existing = callsById.get(entry.payload.call_id) || {
          callId: entry.payload.call_id,
          arguments: null,
          output: null,
        };
        existing.output = safeJsonParse(entry.payload.output);
        callsById.set(existing.callId, existing);
      }
    }

    for (const record of callsById.values()) {
      const suggestion = normalizeToolSuggestion(record.arguments, record.output, normalizeText);
      if (suggestion) {
        return suggestion;
      }
    }

    return null;
  }

  async function findSessionFileForThread(threadId) {
    if (!sessionsDir || !threadId) {
      return null;
    }

    let segments;
    try {
      segments = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    for (const yearEntry of segments) {
      if (!yearEntry.isDirectory()) {
        continue;
      }

      const yearPath = path.join(sessionsDir, yearEntry.name);
      const monthEntries = await fs.promises.readdir(yearPath, { withFileTypes: true });

      for (const monthEntry of monthEntries) {
        if (!monthEntry.isDirectory()) {
          continue;
        }

        const monthPath = path.join(yearPath, monthEntry.name);
        const dayEntries = await fs.promises.readdir(monthPath, { withFileTypes: true });

        for (const dayEntry of dayEntries) {
          if (!dayEntry.isDirectory()) {
            continue;
          }

          const dayPath = path.join(monthPath, dayEntry.name);
          const fileEntries = await fs.promises.readdir(dayPath, { withFileTypes: true });

          for (const fileEntry of fileEntries) {
            if (!fileEntry.isFile()) {
              continue;
            }

            if (fileEntry.name.includes(threadId) && fileEntry.name.endsWith(".jsonl")) {
              return path.join(dayPath, fileEntry.name);
            }
          }
        }
      }
    }

    return null;
  }

  async function findSessionErrorMessageForTurn(threadId, startedAtIso) {
    const sessionPath = await findSessionFileForThread(threadId);
    if (!sessionPath) {
      return "";
    }

    const raw = await fs.promises.readFile(sessionPath, "utf8");
    let latestError = "";

    for (const entry of parseSessionEntriesSince(raw, startedAtIso)) {
      if (entry.type !== "event_msg" || entry.payload?.type !== "error") {
        continue;
      }

      latestError = normalizeText(entry.payload?.message) || latestError;
    }

    return latestError;
  }

  return {
    findSessionErrorMessageForTurn,
    findSessionFileForThread,
    findToolSuggestionForTurn,
  };
}

function* parseSessionEntriesSince(raw, startedAtIso) {
  for (const line of String(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (error) {
      continue;
    }

    if (!isTimestampOnOrAfter(entry.timestamp, startedAtIso)) {
      continue;
    }

    yield entry;
  }
}

function normalizeToolSuggestion(args, output, normalizeText = defaultNormalizeText) {
  const toolId = normalizeText(output?.tool_id) || normalizeText(args?.tool_id);
  const toolType = normalizeText(output?.tool_type) || normalizeText(args?.tool_type);

  if (!toolId || !toolType) {
    return null;
  }

  return {
    actionType: normalizeText(output?.action_type) || normalizeText(args?.action_type),
    suggestReason: normalizeText(output?.suggest_reason) || normalizeText(args?.suggest_reason),
    toolId,
    toolName: normalizeText(output?.tool_name) || normalizeText(toolId.split("@")[0]),
    toolType,
    completed: Boolean(output?.completed),
    userConfirmed: Boolean(output?.user_confirmed),
  };
}

function isTimestampOnOrAfter(candidate, reference) {
  const candidateMs = Date.parse(candidate);
  const referenceMs = Date.parse(reference);

  if (Number.isNaN(candidateMs) || Number.isNaN(referenceMs)) {
    return false;
  }

  return candidateMs >= referenceMs;
}

function safeJsonParse(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function defaultNormalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

module.exports = {
  createCodexSessionReader,
  isTimestampOnOrAfter,
  normalizeToolSuggestion,
  parseSessionEntriesSince,
  safeJsonParse,
};
