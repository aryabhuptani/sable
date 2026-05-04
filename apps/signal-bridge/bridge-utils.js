function normalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

function normalizeBooleanEnv(value, defaultValue) {
  const normalized = normalizeText(String(value || ""));
  if (!normalized) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(normalized.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized.toLowerCase())) {
    return false;
  }

  return defaultValue;
}

function normalizeIntegerEnv(value, defaultValue) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseAllowedNumbers(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function formatProgressMessage(text) {
  return `• ${normalizeText(text)}`;
}

function truncateText(text, maxLength) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatSlugForDisplay(value) {
  return normalizeText(value)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function dedupeStrings(values) {
  const seen = new Set();
  const deduped = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function mergePromptSegments(...segments) {
  return segments
    .map((segment) => normalizeText(segment))
    .filter(Boolean)
    .join("\n\n");
}

function parseSystemdShowOutput(stdout) {
  const values = {};
  for (const line of String(stdout || "").split("\n")) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    values[key] = value;
  }

  return {
    activeState: values.ActiveState || "unknown",
    subState: values.SubState || "unknown",
    activeEnterTimestamp: values.ActiveEnterTimestamp || "unavailable",
    execMainPid: values.ExecMainPID || "",
  };
}

function formatUnitSummary(summary) {
  const state = `${summary.activeState}/${summary.subState}`;
  const pid = summary.execMainPid ? ` pid=${summary.execMainPid}` : "";
  const since = summary.activeEnterTimestamp && summary.activeEnterTimestamp !== "n/a"
    ? ` since=${summary.activeEnterTimestamp}`
    : "";
  return `${state}${pid}${since}`;
}

function isInvalidSessionError(stderr) {
  const text = String(stderr || "").toLowerCase();
  return (
    text.includes("session not found") ||
    text.includes("conversation not found") ||
    text.includes("no rollout found for thread id") ||
    (text.includes("thread") && text.includes("not found")) ||
    (text.includes("invalid") && text.includes("session"))
  );
}

function splitIntoChunks(text, limit) {
  const chunks = [];
  let remaining = String(text || "").trim();

  while (remaining.length > limit) {
    let splitIndex = remaining.lastIndexOf("\n", limit);
    if (splitIndex <= 0) {
      splitIndex = limit;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    remaining = remaining.slice(splitIndex).replace(/^\s+/, "");
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.length > 0 ? chunks : ["No output from Sable."];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  dedupeStrings,
  delay,
  formatProgressMessage,
  formatSlugForDisplay,
  formatUnitSummary,
  isInvalidSessionError,
  mergePromptSegments,
  normalizeBooleanEnv,
  normalizeIntegerEnv,
  normalizeText,
  parseAllowedNumbers,
  parseSystemdShowOutput,
  splitIntoChunks,
  truncateText,
};
