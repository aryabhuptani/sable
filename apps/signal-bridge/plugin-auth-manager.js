"use strict";

function createPluginAuthManager({
  callCodexAppServer,
  codexCwd = "",
  getPending,
  isInteractiveProcessing = () => false,
  savePending,
  sendReply,
  timestamp = defaultTimestamp,
} = {}) {
  if (typeof callCodexAppServer !== "function") {
    throw new Error("createPluginAuthManager requires callCodexAppServer.");
  }
  if (typeof getPending !== "function" || typeof savePending !== "function") {
    throw new Error("createPluginAuthManager requires getPending and savePending.");
  }
  if (typeof sendReply !== "function") {
    throw new Error("createPluginAuthManager requires sendReply.");
  }

  async function maybeStart(sender, sourcePrompt, toolSuggestion) {
    if (
      toolSuggestion.toolType !== "plugin" ||
      toolSuggestion.actionType !== "install" ||
      !toolSuggestion.toolId
    ) {
      return false;
    }

    const installInfo = await getPluginInstallInfo(toolSuggestion.toolId);
    if (!installInfo || !installInfo.installUrl) {
      return false;
    }

    const pending = {
      sender,
      pluginId: installInfo.pluginId,
      pluginName: installInfo.pluginName,
      displayName: installInfo.displayName,
      marketplacePath: installInfo.marketplacePath,
      installUrl: installInfo.installUrl,
      sourcePrompt: normalizeText(sourcePrompt),
      status: "pending",
      startedAt: timestamp(),
      completedAt: "",
      lastCheckedAt: "",
      nextCheckAt: "",
      checkCount: 0,
    };
    savePending(pending);

    await sendReply(sender, formatPrompt(pending));
    return true;
  }

  function clear() {
    savePending(null);
  }

  async function check() {
    const pending = getPending();
    if (!pending || pending.status !== "pending" || isInteractiveProcessing()) {
      return { checked: false, reason: "inactive" };
    }

    const now = timestamp();
    if (!isDueForCheck(pending, now)) {
      return { checked: false, reason: "not-due", nextCheckAt: pending.nextCheckAt };
    }

    try {
      const status = await getPluginInstallStatus(pending);
      pending.lastCheckedAt = now;
      pending.checkCount = normalizeNonNegativeInteger(pending.checkCount) + 1;

      if (!pending.installUrl && status.installUrl) {
        pending.installUrl = status.installUrl;
      }

      if (status.installed) {
        pending.status = "completed";
        pending.completedAt = now;
        pending.nextCheckAt = "";
        savePending(pending);
        await sendReply(pending.sender, formatCompleted(pending));
        return { checked: true, installed: true };
      }

      pending.nextCheckAt = computeNextCheckAt(now, pending.checkCount);
      savePending(pending);
      return { checked: true, installed: false, nextCheckAt: pending.nextCheckAt };
    } catch (error) {
      throw new Error(`Pending plugin auth poll failed: ${error.message}`);
    }
  }

  async function getPluginInstallInfo(pluginId) {
    const { pluginName } = splitPluginId(pluginId);
    const pluginSummary = await findPluginSummary(pluginId);

    if (!pluginSummary) {
      return null;
    }

    const detail = await callCodexAppServer("plugin/read", {
      marketplacePath: pluginSummary.marketplacePath,
      pluginName,
    });

    const appWithInstallUrl = Array.isArray(detail?.plugin?.apps)
      ? detail.plugin.apps.find((app) => normalizeText(app.installUrl))
      : null;

    return {
      pluginId,
      pluginName,
      displayName:
        normalizeText(detail?.plugin?.summary?.interface?.displayName) ||
        normalizeText(pluginSummary.displayName) ||
        pluginName,
      marketplacePath: pluginSummary.marketplacePath,
      installUrl: normalizeText(appWithInstallUrl?.installUrl),
    };
  }

  async function getPluginInstallStatus(pendingPluginAuth) {
    const pluginSummary = await findPluginSummary(pendingPluginAuth.pluginId, true);

    if (pluginSummary) {
      return {
        installed: Boolean(pluginSummary.installed),
        enabled: Boolean(pluginSummary.enabled),
        installUrl: normalizeText(pluginSummary.installUrl),
      };
    }

    const detail = await callCodexAppServer("plugin/read", {
      marketplacePath: pendingPluginAuth.marketplacePath,
      pluginName: pendingPluginAuth.pluginName,
    });

    const appWithInstallUrl = Array.isArray(detail?.plugin?.apps)
      ? detail.plugin.apps.find((app) => normalizeText(app.installUrl))
      : null;

    return {
      installed: Boolean(detail?.plugin?.summary?.installed),
      enabled: Boolean(detail?.plugin?.summary?.enabled),
      installUrl: normalizeText(appWithInstallUrl?.installUrl),
    };
  }

  async function findPluginSummary(pluginId, forceRemoteSync = false) {
    const response = await callCodexAppServer("plugin/list", {
      cwds: normalizeText(codexCwd) ? [normalizeText(codexCwd)] : [],
      forceRemoteSync,
    });

    for (const marketplace of response?.marketplaces || []) {
      for (const plugin of marketplace.plugins || []) {
        if (plugin.id !== pluginId) {
          continue;
        }

        return {
          ...plugin,
          displayName: normalizeText(plugin.interface?.displayName),
          installUrl: "",
          marketplacePath: marketplace.path,
        };
      }
    }

    return null;
  }

  return {
    check,
    clear,
    findPluginSummary,
    formatCompleted,
    formatPrompt,
    formatStatus,
    getPluginInstallInfo,
    getPluginInstallStatus,
    maybeStart,
    splitPluginId,
    summarize,
  };
}

function normalizePendingPluginAuth(value, timestamp = defaultTimestamp) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const sender = normalizeText(value.sender);
  const pluginId = normalizeText(value.pluginId);
  const pluginName = normalizeText(value.pluginName);
  const marketplacePath = normalizeText(value.marketplacePath);
  const installUrl = normalizeText(value.installUrl);
  const startedAt = normalizeText(value.startedAt) || timestamp();
  const checkCount = Math.max(
    normalizeNonNegativeInteger(value.checkCount),
    inferInitialCheckCount(startedAt, timestamp())
  );

  if (!sender || !pluginId || !pluginName || !marketplacePath || !installUrl) {
    return null;
  }

  return {
    sender,
    pluginId,
    pluginName,
    displayName: normalizeText(value.displayName) || pluginName,
    marketplacePath,
    installUrl,
    sourcePrompt: normalizeText(value.sourcePrompt),
    status: normalizePendingPluginAuthStatus(value.status),
    startedAt,
    completedAt: normalizeText(value.completedAt),
    lastCheckedAt: normalizeText(value.lastCheckedAt),
    nextCheckAt: normalizeText(value.nextCheckAt),
    checkCount,
  };
}

function normalizePendingPluginAuthStatus(value) {
  return value === "completed" ? "completed" : "pending";
}

function splitPluginId(pluginId) {
  const normalized = normalizeText(pluginId);
  const atIndex = normalized.indexOf("@");

  if (atIndex === -1) {
    return { pluginName: normalized, marketplaceName: "" };
  }

  return {
    pluginName: normalized.slice(0, atIndex),
    marketplaceName: normalized.slice(atIndex + 1),
  };
}

function formatPrompt(pendingPluginAuth) {
  return [
    `${pendingPluginAuth.displayName} needs a browser auth step.`,
    pendingPluginAuth.installUrl,
    "Open the link on your phone, finish the connector flow, and I will poll for completion automatically.",
    "Commands: /authstatus, /authcancel, /authresume",
  ].join("\n");
}

function formatStatus(pendingPluginAuth) {
  if (!pendingPluginAuth) {
    return "No plugin auth flow is currently pending.";
  }

  const lines = [
    `${pendingPluginAuth.displayName}: ${pendingPluginAuth.status}`,
    `started: ${pendingPluginAuth.startedAt}`,
  ];

  if (pendingPluginAuth.lastCheckedAt) {
    lines.push(`last checked: ${pendingPluginAuth.lastCheckedAt}`);
  }

  if (pendingPluginAuth.completedAt) {
    lines.push(`completed: ${pendingPluginAuth.completedAt}`);
  }

  if (
    pendingPluginAuth.status !== "completed" &&
    normalizeText(pendingPluginAuth.nextCheckAt)
  ) {
    lines.push(`next check: ${pendingPluginAuth.nextCheckAt}`);
  }

  lines.push(pendingPluginAuth.installUrl);

  if (pendingPluginAuth.status === "completed") {
    lines.push("Reply /authresume to retry the request that triggered the connection.");
  } else {
    lines.push("Still waiting for the browser-side connector flow to finish.");
  }

  return lines.join("\n");
}

function formatCompleted(pendingPluginAuth) {
  return [
    `${pendingPluginAuth.displayName} now looks connected.`,
    "Reply /authresume to retry the request that triggered this auth flow, or just ask normally.",
  ].join("\n");
}

function summarize(pendingPluginAuth) {
  if (!pendingPluginAuth) {
    return "none";
  }

  return `${pendingPluginAuth.displayName} ${pendingPluginAuth.status}`;
}

function isDueForCheck(pendingPluginAuth, now = defaultTimestamp()) {
  const nextCheckAt = normalizeText(pendingPluginAuth?.nextCheckAt);
  if (!nextCheckAt) {
    return true;
  }

  const nextCheckTime = Date.parse(nextCheckAt);
  const nowTime = Date.parse(now);
  if (!Number.isFinite(nextCheckTime) || !Number.isFinite(nowTime)) {
    return true;
  }

  return nowTime >= nextCheckTime;
}

function computeNextCheckAt(now, checkCount) {
  const nowTime = Date.parse(now);
  if (!Number.isFinite(nowTime)) {
    return "";
  }
  return new Date(nowTime + getPollDelayMs(checkCount)).toISOString();
}

function getPollDelayMs(checkCount) {
  const normalized = normalizeNonNegativeInteger(checkCount);
  if (normalized <= 4) {
    return 15_000;
  }
  if (normalized <= 12) {
    return 60_000;
  }
  if (normalized <= 48) {
    return 5 * 60_000;
  }
  return 60 * 60_000;
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function inferInitialCheckCount(startedAt, now) {
  const startedTime = Date.parse(startedAt);
  const nowTime = Date.parse(now);
  if (!Number.isFinite(startedTime) || !Number.isFinite(nowTime)) {
    return 0;
  }
  return nowTime - startedTime >= 24 * 60 * 60 * 1000 ? 49 : 0;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function defaultTimestamp() {
  return new Date().toISOString();
}

module.exports = {
  computeNextCheckAt,
  createPluginAuthManager,
  formatCompleted,
  formatPrompt,
  formatStatus,
  getPollDelayMs,
  inferInitialCheckCount,
  isDueForCheck,
  normalizePendingPluginAuth,
  normalizePendingPluginAuthStatus,
  splitPluginId,
  summarize,
};
