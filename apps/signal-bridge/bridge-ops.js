"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function createBridgeOpsManager({
  opsRoot,
  attachmentQueuePendingDir,
  alertsEnabled,
  alertRecipient,
  alertBridgeRssThresholdBytes,
  alertInFlightTurnThresholdMs,
  stalledRunThresholdMs,
  snapshotAutoresearchRuns,
  getSchedulerJobs,
  getLiveState,
  getSystemdUnitSummary,
  formatUnitSummary,
  normalizeText,
  truncateText,
  timestamp,
  sendReply,
  onError = () => {},
}) {
  const opsHistoryDir = path.join(opsRoot, "history");
  const opsStatusPath = path.join(opsRoot, "status.json");
  const opsAlertStatePath = path.join(opsRoot, "alerts.json");
  const bridgeRuntime = createBridgeRuntimeState(timestamp);
  let opsAlertState = loadOpsAlertState();

  function createBridgeRuntimeState(nowTimestamp) {
    return {
      startedAt: nowTimestamp(),
      lastInboundAt: "",
      lastInboundSender: "",
      inboundCount: 0,
      lastOutboundAt: "",
      lastOutboundRecipient: "",
      outboundCount: 0,
      lastCodexTurnStartedAt: "",
      lastCodexTurnCompletedAt: "",
      codexTurnStarts: 0,
      codexTurnCompletions: 0,
      codexAppServerStderrCount: 0,
      signalCliStderrCount: 0,
      bubblewrapWarningCount: 0,
      permissionDeniedCount: 0,
      lastCodexAppServerStderr: "",
      lastSignalCliStderr: "",
      lastCodexRuntimeProbe: null,
      lastUsageSnapshot: null,
      lastRateLimitSnapshot: null,
      lastOpsSnapshotAt: "",
      lastOpsSnapshotPath: "",
    };
  }

  function ensureOpsDirs() {
    try {
      fs.mkdirSync(opsHistoryDir, { recursive: true });
    } catch (error) {
      onError(`Failed ensuring ops dirs: ${error.message}`);
    }
  }

  function loadOpsAlertState() {
    try {
      const raw = fs.readFileSync(opsAlertStatePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        lastBootedAt: normalizeText(parsed?.lastBootedAt),
        alerts: parsed?.alerts && typeof parsed.alerts === "object" ? parsed.alerts : {},
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        onError(`Failed reading ops alert state: ${error.message}`);
      }
      return {
        lastBootedAt: "",
        alerts: {},
      };
    }
  }

  function saveOpsAlertState() {
    try {
      ensureOpsDirs();
      fs.writeFileSync(opsAlertStatePath, `${JSON.stringify(opsAlertState, null, 2)}\n`, "utf8");
    } catch (error) {
      onError(`Failed writing ops alert state: ${error.message}`);
    }
  }

  function ageMsFromIso(value, now = new Date()) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return null;
    }

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return Math.max(0, now.getTime() - date.getTime());
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (days > 0) {
      parts.push(`${days}d`);
    }
    if (hours > 0) {
      parts.push(`${hours}h`);
    }
    if (minutes > 0) {
      parts.push(`${minutes}m`);
    }
    if (parts.length === 0 || (days === 0 && hours === 0)) {
      parts.push(`${seconds}s`);
    }

    return parts.slice(0, 2).join(" ");
  }

  function formatRelativeAge(value, now = new Date()) {
    const ageMs = ageMsFromIso(value, now);
    if (ageMs === null) {
      return "unknown";
    }
    return formatDuration(ageMs);
  }

  function formatByteSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "unknown";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let scaled = bytes;
    let index = 0;
    while (scaled >= 1024 && index < units.length - 1) {
      scaled /= 1024;
      index += 1;
    }

    return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
  }

  function summarizeAutoresearchRuns(runs, now = new Date()) {
    const summary = {
      total: 0,
      active: 0,
      runnable: 0,
      completed: 0,
      stalled: 0,
      budgetExhausted: 0,
      oldestActiveAgeMs: null,
      oldestActiveRun: null,
      examples: [],
    };

    for (const run of runs.values()) {
      summary.total += 1;

      if (run.status === "active") {
        summary.active += 1;
        if (run.pendingCount > 0) {
          summary.runnable += 1;
        }
      }

      if (run.status === "completed") {
        summary.completed += 1;
      }

      const lastUpdatedAgeMs = ageMsFromIso(run.lastUpdatedAt, now);
      const isBudgetExhausted =
        run.status === "active" &&
        run.maxTotalQuestions > 0 &&
        run.processedCount >= run.maxTotalQuestions &&
        run.pendingCount > 0;
      const isStalled =
        run.status === "active" &&
        (isBudgetExhausted ||
          (lastUpdatedAgeMs !== null && lastUpdatedAgeMs >= stalledRunThresholdMs));

      if (isBudgetExhausted) {
        summary.budgetExhausted += 1;
      }

      if (isStalled) {
        summary.stalled += 1;
      }

      const startedAgeMs = ageMsFromIso(run.startedAt, now);
      if (
        run.status === "active" &&
        startedAgeMs !== null &&
        (summary.oldestActiveAgeMs === null || startedAgeMs > summary.oldestActiveAgeMs)
      ) {
        summary.oldestActiveAgeMs = startedAgeMs;
        summary.oldestActiveRun = `${run.topicSlug}/${run.runSlug}`;
      }

      if (summary.examples.length < 3 && (isStalled || isBudgetExhausted || run.status === "active")) {
        summary.examples.push({
          slug: `${run.topicSlug}/${run.runSlug}`,
          status: run.status,
          pendingCount: run.pendingCount,
          processedCount: run.processedCount,
          maxTotalQuestions: run.maxTotalQuestions,
          lastUpdatedAt: run.lastUpdatedAt,
          startedAt: run.startedAt,
          stalled: isStalled,
          budgetExhausted: isBudgetExhausted,
        });
      }
    }

    return summary;
  }

  function summarizeSchedulerHealth(now = new Date()) {
    const summary = {
      total: 0,
      active: 0,
      overdue: 0,
      nextRunAt: "",
      nextRunId: "",
    };

    for (const job of getSchedulerJobs()) {
      if (!job) {
        continue;
      }

      summary.total += 1;
      if (job.active === false) {
        continue;
      }

      summary.active += 1;
      const nextRunIso = normalizeText(job.nextRunAt);
      if (!nextRunIso) {
        continue;
      }

      const nextRun = new Date(nextRunIso);
      if (Number.isNaN(nextRun.getTime())) {
        continue;
      }

      if (nextRun <= now) {
        summary.overdue += 1;
      }

      if (!summary.nextRunAt || nextRun < new Date(summary.nextRunAt)) {
        summary.nextRunAt = nextRun.toISOString();
        summary.nextRunId = normalizeText(job.id);
      }
    }

    return summary;
  }

  function getAttachmentQueueDepth() {
    try {
      return fs
        .readdirSync(attachmentQueuePendingDir)
        .filter((entry) => entry.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  function buildHostSnapshot(now = new Date()) {
    const uptimeMs = Math.max(0, Math.round(os.uptime() * 1000));
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);

    return {
      observedAt: now.toISOString(),
      hostname: os.hostname(),
      platform: os.platform(),
      uptimeMs,
      bootedAt: new Date(now.getTime() - uptimeMs).toISOString(),
      lingeringEnabled: fs.existsSync("/var/lib/systemd/linger/arya"),
      loadAverage: os.loadavg(),
      totalMemBytes,
      freeMemBytes,
      usedMemBytes,
    };
  }

  function captureUsageSnapshot(message) {
    const candidate =
      message?.params?.usage ||
      message?.params?.tokenUsage ||
      message?.params?.turn?.usage ||
      null;
    if (!candidate || typeof candidate !== "object") {
      return;
    }

    try {
      bridgeRuntime.lastUsageSnapshot = JSON.parse(JSON.stringify(candidate));
    } catch {
      bridgeRuntime.lastUsageSnapshot = candidate;
    }
  }

  function captureRateLimitSnapshot(message) {
    const candidate =
      message?.params?.rateLimits ||
      message?.params?.rateLimit ||
      message?.params?.limits ||
      null;
    if (!candidate || typeof candidate !== "object") {
      return;
    }

    try {
      bridgeRuntime.lastRateLimitSnapshot = JSON.parse(JSON.stringify(candidate));
    } catch {
      bridgeRuntime.lastRateLimitSnapshot = candidate;
    }
  }

  function noteCodexAppServerStderr(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }

    bridgeRuntime.codexAppServerStderrCount += 1;
    bridgeRuntime.lastCodexAppServerStderr = truncateText(normalized, 400);

    const lowered = normalized.toLowerCase();
    if (lowered.includes("bubblewrap") || lowered.includes("bwrap")) {
      bridgeRuntime.bubblewrapWarningCount += 1;
    }
    if (lowered.includes("permission denied") || lowered.includes("operation not permitted")) {
      bridgeRuntime.permissionDeniedCount += 1;
    }
  }

  function noteSignalCliStderr(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }

    bridgeRuntime.signalCliStderrCount += 1;
    bridgeRuntime.lastSignalCliStderr = truncateText(normalized, 400);
  }

  function noteTurnStarted() {
    bridgeRuntime.codexTurnStarts += 1;
    bridgeRuntime.lastCodexTurnStartedAt = timestamp();
  }

  function noteTurnCompleted() {
    bridgeRuntime.codexTurnCompletions += 1;
    bridgeRuntime.lastCodexTurnCompletedAt = timestamp();
  }

  function noteIncoming(sender) {
    bridgeRuntime.lastInboundAt = timestamp();
    bridgeRuntime.lastInboundSender = sender;
    bridgeRuntime.inboundCount += 1;
  }

  function noteOutgoing(recipient) {
    bridgeRuntime.lastOutboundAt = timestamp();
    bridgeRuntime.lastOutboundRecipient = recipient;
    bridgeRuntime.outboundCount += 1;
  }

  function noteCodexRuntimeProbe(probe) {
    if (!probe || typeof probe !== "object") {
      return;
    }

    try {
      bridgeRuntime.lastCodexRuntimeProbe = JSON.parse(JSON.stringify(probe));
    } catch {
      bridgeRuntime.lastCodexRuntimeProbe = probe;
    }
  }

  function formatCodexRuntimeLine(probe) {
    if (!probe || typeof probe !== "object") {
      return "unknown";
    }

    const parts = [];
    const model = normalizeText(probe.model);
    const codexHome = normalizeText(probe.codexHome);
    const sandbox =
      normalizeText(probe.sandbox?.mode) ||
      normalizeText(probe.sandbox?.type) ||
      normalizeText(probe.permissionProfile?.sandboxMode);
    const approvalPolicy =
      normalizeText(probe.permissionProfile?.approvalPolicy) ||
      normalizeText(probe.approvalPolicy);

    if (model) {
      parts.push(`model=${model}`);
    }
    if (sandbox) {
      parts.push(`sandbox=${sandbox}`);
    }
    if (approvalPolicy) {
      parts.push(`approval=${approvalPolicy}`);
    }
    if (codexHome) {
      parts.push(`home=${codexHome}`);
    }

    return parts.length > 0 ? parts.join(", ") : "captured";
  }

  function buildOpsSnapshot(now = new Date()) {
    const host = buildHostSnapshot(now);
    const runs = snapshotAutoresearchRuns();
    const research = summarizeAutoresearchRuns(runs, now);
    const scheduler = summarizeSchedulerHealth(now);
    const liveState = getLiveState();
    const rssBytes = process.memoryUsage().rss;
    const activeTurnAgeMs = liveState.inFlightTurn
      ? ageMsFromIso(liveState.inFlightTurn.startedAt, now)
      : null;

    return {
      observedAt: now.toISOString(),
      host,
      bridge: {
        startedAt: bridgeRuntime.startedAt,
        uptimeMs: ageMsFromIso(bridgeRuntime.startedAt, now) || 0,
        pid: process.pid,
        rssBytes,
        interactiveQueueDepth: liveState.interactiveQueueDepth,
        interactiveProcessing: liveState.interactiveProcessing,
        backgroundQueueDepth: liveState.backgroundQueueDepth,
        backgroundProcessing: liveState.backgroundProcessing,
        attachmentQueueDepth: getAttachmentQueueDepth(),
        attachmentQueueProcessing: liveState.attachmentQueueProcessing,
        inFlightTurn: liveState.inFlightTurn
          ? {
              sender: liveState.inFlightTurn.sender,
              startedAt: liveState.inFlightTurn.startedAt,
              ageMs: activeTurnAgeMs,
              promptPreview: liveState.inFlightTurn.promptPreview,
            }
          : null,
        lastInboundAt: bridgeRuntime.lastInboundAt,
        lastInboundSender: bridgeRuntime.lastInboundSender,
        inboundCount: bridgeRuntime.inboundCount,
        lastOutboundAt: bridgeRuntime.lastOutboundAt,
        lastOutboundRecipient: bridgeRuntime.lastOutboundRecipient,
        outboundCount: bridgeRuntime.outboundCount,
        codexTurnStarts: bridgeRuntime.codexTurnStarts,
        codexTurnCompletions: bridgeRuntime.codexTurnCompletions,
        lastCodexTurnStartedAt: bridgeRuntime.lastCodexTurnStartedAt,
        lastCodexTurnCompletedAt: bridgeRuntime.lastCodexTurnCompletedAt,
        codexAppServerStderrCount: bridgeRuntime.codexAppServerStderrCount,
        signalCliStderrCount: bridgeRuntime.signalCliStderrCount,
        bubblewrapWarningCount: bridgeRuntime.bubblewrapWarningCount,
        permissionDeniedCount: bridgeRuntime.permissionDeniedCount,
        lastCodexAppServerStderr: bridgeRuntime.lastCodexAppServerStderr,
        lastSignalCliStderr: bridgeRuntime.lastSignalCliStderr,
        codexRuntimeProbe: bridgeRuntime.lastCodexRuntimeProbe,
      },
      scheduler,
      research,
      usage: {
        tokenUsage: bridgeRuntime.lastUsageSnapshot,
        rateLimits: bridgeRuntime.lastRateLimitSnapshot,
        available:
          Boolean(bridgeRuntime.lastUsageSnapshot) || Boolean(bridgeRuntime.lastRateLimitSnapshot),
      },
    };
  }

  function buildOpsAlertDefinitions(snapshot) {
    return [
      {
        key: "bridge-memory-high",
        firing: snapshot.bridge.rssBytes >= alertBridgeRssThresholdBytes,
        summary: `Bridge RSS is high at ${formatByteSize(snapshot.bridge.rssBytes)}.`,
      },
      {
        key: "in-flight-turn-stuck",
        firing:
          Boolean(snapshot.bridge.inFlightTurn) &&
          Number(snapshot.bridge.inFlightTurn.ageMs || 0) >= alertInFlightTurnThresholdMs,
        summary: snapshot.bridge.inFlightTurn
          ? `A bridge turn has been in flight for ${formatDuration(snapshot.bridge.inFlightTurn.ageMs || 0)}.`
          : "A bridge turn is stuck in flight.",
      },
      {
        key: "scheduler-overdue",
        firing: snapshot.scheduler.overdue > 0,
        summary: `The scheduler has ${snapshot.scheduler.overdue} overdue workflow${snapshot.scheduler.overdue === 1 ? "" : "s"}.`,
      },
      {
        key: "research-stalled",
        firing: snapshot.research.stalled > 0,
        summary: `Autoresearch has ${snapshot.research.stalled} stalled run${snapshot.research.stalled === 1 ? "" : "s"} and ${snapshot.research.budgetExhausted} budget-exhausted run${snapshot.research.budgetExhausted === 1 ? "" : "s"}.`,
      },
    ];
  }

  async function evaluateOpsAlerts(snapshot) {
    if (!alertsEnabled || !alertRecipient) {
      return;
    }

    const notifications = [];
    const previousBootedAt = normalizeText(opsAlertState.lastBootedAt);
    const currentBootedAt = normalizeText(snapshot?.host?.bootedAt);

    if (currentBootedAt && previousBootedAt && previousBootedAt !== currentBootedAt) {
      notifications.push(
        `Sable ops alert: the minipc appears to have rebooted. Previous boot was ${previousBootedAt}; current boot is ${currentBootedAt}.`
      );
    }

    opsAlertState.lastBootedAt = currentBootedAt || previousBootedAt;
    const nextAlerts = {};

    for (const definition of buildOpsAlertDefinitions(snapshot)) {
      const previous = opsAlertState.alerts?.[definition.key] || {};
      const next = {
        firing: Boolean(definition.firing),
        summary: normalizeText(definition.summary),
        lastChangedAt: normalizeText(previous.lastChangedAt),
        lastNotifiedAt: normalizeText(previous.lastNotifiedAt),
      };

      if (next.firing !== Boolean(previous.firing)) {
        next.lastChangedAt = timestamp();
        next.lastNotifiedAt = next.lastChangedAt;
        notifications.push(
          next.firing
            ? `Sable ops alert: ${next.summary}`
            : `Sable ops recovery: ${next.summary} Resolved.`
        );
      }

      nextAlerts[definition.key] = next;
    }

    opsAlertState.alerts = nextAlerts;
    saveOpsAlertState();

    for (const message of notifications) {
      try {
        await sendReply(alertRecipient, message);
      } catch (error) {
        onError(`Failed sending ops alert: ${error.message}`);
      }
    }
  }

  async function writeOpsSnapshot() {
    try {
      ensureOpsDirs();
      const snapshot = buildOpsSnapshot();
      await fs.promises.writeFile(opsStatusPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      const dayKey = snapshot.observedAt.slice(0, 10);
      const historyPath = path.join(opsHistoryDir, `${dayKey}.jsonl`);
      await fs.promises.appendFile(historyPath, `${JSON.stringify(snapshot)}\n`, "utf8");
      bridgeRuntime.lastOpsSnapshotAt = snapshot.observedAt;
      bridgeRuntime.lastOpsSnapshotPath = opsStatusPath;
      await evaluateOpsAlerts(snapshot);
    } catch (error) {
      onError(`Failed writing ops snapshot: ${error.message}`);
    }
  }

  async function getOpsReport() {
    const [bridgeService, watcherService] = await Promise.all([
      getSystemdUnitSummary("signal-codex-bridge.service"),
      getSystemdUnitSummary("signal-codex-bridge-restart.service"),
    ]);
    await writeOpsSnapshot();
    const now = new Date();
    const snapshot = buildOpsSnapshot(now);
    const usageStatus = snapshot.usage.available
      ? "capturing snapshots"
      : "not surfaced by Codex yet";
    const codexRuntimeLine = formatCodexRuntimeLine(snapshot.bridge.codexRuntimeProbe);
    const lines = [
      `host: up ${formatDuration(snapshot.host.uptimeMs)}, load=${snapshot.host.loadAverage.map((value) => value.toFixed(2)).join("/")}, mem=${formatByteSize(snapshot.host.usedMemBytes)}/${formatByteSize(snapshot.host.totalMemBytes)}`,
      `booted: ${snapshot.host.bootedAt}`,
      `host flags: lingering=${snapshot.host.lingeringEnabled ? "yes" : "no"}`,
      `bridge: ${formatUnitSummary(bridgeService)} | watcher: ${formatUnitSummary(watcherService)}`,
      `bridge uptime: ${formatDuration(snapshot.bridge.uptimeMs)}, rss=${formatByteSize(snapshot.bridge.rssBytes)}, pid=${snapshot.bridge.pid}`,
      `codex runtime: ${codexRuntimeLine}`,
      `queues: interactive=${snapshot.bridge.interactiveQueueDepth}${snapshot.bridge.interactiveProcessing ? " (busy)" : ""}, background=${snapshot.bridge.backgroundQueueDepth}${snapshot.bridge.backgroundProcessing ? " (busy)" : ""}, attachments=${snapshot.bridge.attachmentQueueDepth}${snapshot.bridge.attachmentQueueProcessing ? " (busy)" : ""}`,
      `traffic: inbound=${snapshot.bridge.inboundCount} (last ${snapshot.bridge.lastInboundAt ? `${formatRelativeAge(snapshot.bridge.lastInboundAt, now)} ago from ${snapshot.bridge.lastInboundSender || "unknown"}` : "never"}), outbound=${snapshot.bridge.outboundCount} (last ${snapshot.bridge.lastOutboundAt ? `${formatRelativeAge(snapshot.bridge.lastOutboundAt, now)} ago to ${snapshot.bridge.lastOutboundRecipient || "unknown"}` : "never"})`,
      `turns: started=${snapshot.bridge.codexTurnStarts}, completed=${snapshot.bridge.codexTurnCompletions}, in flight=${snapshot.bridge.inFlightTurn ? `${formatRelativeAge(snapshot.bridge.inFlightTurn.startedAt, now)} (${truncateText(snapshot.bridge.inFlightTurn.promptPreview || "no preview", 80)})` : "none"}`,
      `scheduler: ${snapshot.scheduler.active} active, overdue=${snapshot.scheduler.overdue}, next=${snapshot.scheduler.nextRunAt ? `${snapshot.scheduler.nextRunId || "unknown"} in ${formatRelativeAge(snapshot.scheduler.nextRunAt, now)}` : "none"}`,
      `research: active=${snapshot.research.active}, runnable=${snapshot.research.runnable}, stalled=${snapshot.research.stalled}, budget-exhausted=${snapshot.research.budgetExhausted}${snapshot.research.oldestActiveRun ? `, oldest=${snapshot.research.oldestActiveRun} (${formatDuration(snapshot.research.oldestActiveAgeMs || 0)})` : ""}`,
      `usage: ${usageStatus}`,
      `stderr: codex=${snapshot.bridge.codexAppServerStderrCount}, signal-cli=${snapshot.bridge.signalCliStderrCount}, bubblewrap=${snapshot.bridge.bubblewrapWarningCount}, perm-denied=${snapshot.bridge.permissionDeniedCount}`,
      `ops snapshots: ${bridgeRuntime.lastOpsSnapshotAt ? `${formatRelativeAge(bridgeRuntime.lastOpsSnapshotAt, now)} ago at ${bridgeRuntime.lastOpsSnapshotPath}` : "not written yet"}`,
    ];

    if (snapshot.research.examples.length > 0) {
      lines.push("");
      lines.push("Research watchlist:");
      for (const example of snapshot.research.examples) {
        lines.push(
          `- ${example.slug}: ${example.status}, pending=${example.pendingCount}, processed=${example.processedCount}/${example.maxTotalQuestions || "?"}${example.stalled ? ", stalled" : ""}${example.budgetExhausted ? ", budget-exhausted" : ""}`
        );
      }
    }

    if (snapshot.bridge.lastCodexAppServerStderr) {
      lines.push("");
      lines.push(`Last codex stderr: ${snapshot.bridge.lastCodexAppServerStderr}`);
    }

    if (snapshot.usage.available && snapshot.usage.tokenUsage) {
      lines.push("");
      lines.push(`Latest token usage snapshot: ${JSON.stringify(snapshot.usage.tokenUsage)}`);
    }

    if (snapshot.usage.available && snapshot.usage.rateLimits) {
      lines.push(`Latest rate-limit snapshot: ${JSON.stringify(snapshot.usage.rateLimits)}`);
    }

    return lines.join("\n");
  }

  async function getBridgeStatusReport({
    interactiveSessionId,
    backgroundSessionId,
    obsidianLinkServerAddress,
    obsidianLinkServerHost,
    obsidianLinksEnabled,
    obsidianBaseUrl,
    pendingPluginAuthSummary,
  }) {
    const [bridgeService, watcherService] = await Promise.all([
      getSystemdUnitSummary("signal-codex-bridge.service"),
      getSystemdUnitSummary("signal-codex-bridge-restart.service"),
    ]);

    const liveState = getLiveState();
    const interactiveSessionLine = interactiveSessionId
      ? `interactive session: ${truncateText(interactiveSessionId, 20)}`
      : "interactive session: none";
    const backgroundSessionLine = backgroundSessionId
      ? `background session: ${truncateText(backgroundSessionId, 20)}`
      : "background session: none";
    const obsidianServerLine = obsidianLinkServerAddress
      ? `obsidian links: listening on ${obsidianLinkServerHost}:${obsidianLinkServerAddress.port}`
      : `obsidian links: ${obsidianLinksEnabled ? "starting or unavailable" : "disabled"}`;
    const obsidianBaseUrlLine = obsidianBaseUrl
      ? `obsidian base url: ${obsidianBaseUrl}`
      : "obsidian base url: none";

    return [
      `bridge: ${formatUnitSummary(bridgeService)}`,
      `watcher: ${formatUnitSummary(watcherService)}`,
      `interactive queue: ${liveState.interactiveQueueDepth} pending, processing=${liveState.interactiveProcessing ? "yes" : "no"}`,
      `background queue: ${liveState.backgroundQueueDepth} pending, processing=${liveState.backgroundProcessing ? "yes" : "no"}`,
      `scheduler: ${getSchedulerJobs().filter((job) => job?.active !== false).length} active workflow${getSchedulerJobs().filter((job) => job?.active !== false).length === 1 ? "" : "s"}`,
      interactiveSessionLine,
      backgroundSessionLine,
      obsidianServerLine,
      obsidianBaseUrlLine,
      `auth: ${pendingPluginAuthSummary}`,
    ].join("\n");
  }

  return {
    bridgeRuntime,
    ensureOpsDirs,
    captureUsageSnapshot,
    captureRateLimitSnapshot,
    noteCodexAppServerStderr,
    noteSignalCliStderr,
    noteTurnStarted,
    noteTurnCompleted,
    noteIncoming,
    noteOutgoing,
    noteCodexRuntimeProbe,
    writeOpsSnapshot,
    getOpsReport,
    getBridgeStatusReport,
  };
}

module.exports = {
  createBridgeOpsManager,
};
