"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  archiveCompletedAutoresearchRuns,
} = require("../../tools/knowledge-base/archive-completed-autoresearch-runs");

function createAutoresearchMonitor({
  logger = console,
  researchRoot,
  archiveCompletedRuns = true,
  archiveCompletedRunsFn = archiveCompletedAutoresearchRuns,
  stalledRunThresholdMs = 6 * 60 * 60 * 1000,
  timestamp = defaultTimestamp,
} = {}) {
  const root = normalizeText(researchRoot);

  function snapshotRuns() {
    const snapshots = new Map();

    if (!root || !fs.existsSync(root)) {
      return snapshots;
    }

    for (const topicEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!topicEntry.isDirectory()) {
        continue;
      }

      const activeDir = path.join(
        root,
        topicEntry.name,
        "autoresearch",
        "active"
      );

      if (!fs.existsSync(activeDir)) {
        continue;
      }

      for (const runEntry of fs.readdirSync(activeDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory()) {
          continue;
        }

        const runRoot = path.join(activeDir, runEntry.name);
        const statePath = path.join(runRoot, "STATE.json");
        if (!fs.existsSync(statePath)) {
          continue;
        }

        try {
          const raw = fs.readFileSync(statePath, "utf8");
          const parsed = JSON.parse(raw);
          const pendingQuestions = Array.isArray(parsed?.pendingQuestions)
            ? parsed.pendingQuestions
            : [];
          snapshots.set(runRoot, {
            runRoot,
            topicSlug: normalizeText(parsed?.topicSlug) || topicEntry.name,
            runSlug: normalizeText(parsed?.runSlug) || runEntry.name,
            rootQuestion: normalizeText(parsed?.rootQuestion),
            status: normalizeText(parsed?.status) || "unknown",
            pendingCount: pendingQuestions.length,
            processedCount: Array.isArray(parsed?.processedQuestions)
              ? parsed.processedQuestions.length
              : 0,
            maxTotalQuestions: normalizeInteger(parsed?.maxTotalQuestions, 0),
            startedAt: normalizeText(parsed?.startedAt),
            lastUpdatedAt: normalizeText(parsed?.updatedAt) || normalizeText(parsed?.completedAt),
            statePath,
            logPath: path.join(runRoot, "LOG.md"),
            wikiIndexPath: path.join(root, topicEntry.name, "wiki", "index.md"),
          });
        } catch (error) {
          logger.error?.(
            `[${timestamp()}] Failed reading autoresearch state at ${statePath}: ${error.message}`
          );
        }
      }
    }

    return snapshots;
  }

  function loadRunState(statePath) {
    if (!statePath || !fs.existsSync(statePath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch (error) {
      logger.error?.(
        `[${timestamp()}] Failed reading completed autoresearch run state at ${statePath}: ${error.message}`
      );
      return null;
    }
  }

  function buildCompletionSummary(run) {
    const state = loadRunState(run.statePath);
    const processedQuestions = Array.isArray(state?.processedQuestions)
      ? state.processedQuestions
      : [];
    const evidenceText = [
      normalizeText(state?.rootQuestion),
      ...processedQuestions
        .slice(-3)
        .flatMap((question) => [
          normalizeText(question?.question),
          ...(Array.isArray(question?.notes) ? question.notes : []),
        ]),
    ]
      .map((text) => normalizeText(text).toLowerCase())
      .filter(Boolean)
      .join(" ");

    const conclusions = [];
    const followUps = [];

    if (evidenceText.includes("plaintext") && evidenceText.includes("request")) {
      conclusions.push(
        "Request delivery is better than a plain-JSON baseline, but plaintext-compatible request shapes still exist in the protocol surface."
      );
      followUps.push(
        "Exercise downgrade and legacy request paths to prove plaintext prompts cannot be reintroduced through compatibility routes."
      );
    }

    if (evidenceText.includes("response") && evidenceText.includes("plaintext")) {
      conclusions.push(
        "Response confidentiality is still the weakest live boundary: the provider response path remains plaintext to the coordinator today."
      );
      followUps.push(
        "Close or explicitly de-scope the live response plaintext path, including streaming, retry, and logging branches."
      );
    }

    if (
      evidenceText.includes("open mode") ||
      evidenceText.includes("missing hash") ||
      evidenceText.includes("trust tier") ||
      evidenceText.includes("routing floor") ||
      evidenceText.includes("runtime verified") ||
      evidenceText.includes("attestation")
    ) {
      conclusions.push(
        "Attestation and trust enforcement still have downgrade or fail-open edges, so privacy depends on operator policy staying strict."
      );
      followUps.push(
        "Audit Open Mode, missing-hash handling, and trust-floor overrides with proof-of-concept attempts to confirm they fail closed where the privacy story expects them to."
      );
    }

    if (conclusions.length === 0) {
      const fallbackNotes = processedQuestions
        .slice(-2)
        .flatMap((question) => Array.isArray(question?.notes) ? question.notes : [])
        .map((note) => truncateText(note, 220))
        .filter(Boolean);
      conclusions.push(
        fallbackNotes[0] || "The run completed without preserving a machine-readable synthesis in the artifacts."
      );
      if (fallbackNotes[1]) {
        conclusions.push(fallbackNotes[1]);
      }
    }

    if (followUps.length === 0) {
      followUps.push(
        "Review the most recent completed branches and pick the next deepest path with a downgrade, plaintext, or fail-open surface."
      );
    }

    return {
      conclusions: dedupeStrings(conclusions),
      followUps: dedupeStrings(followUps),
    };
  }

  function formatCompletionNotice(run) {
    const topicLabel = formatSlugForDisplay(run.topicSlug);
    const summary = buildCompletionSummary(run);
    const lines = [`Autoresearch completed for ${topicLabel}.`];

    if (run.rootQuestion) {
      lines.push(`Question: ${truncateText(run.rootQuestion, 220)}`);
    }

    if (summary.conclusions.length > 0) {
      lines.push("Conclusions:");
      for (const conclusion of summary.conclusions) {
        lines.push(`- ${conclusion}`);
      }
    }

    if (summary.followUps.length > 0) {
      lines.push("Follow-ups:");
      for (const followUp of summary.followUps) {
        lines.push(`- ${followUp}`);
      }
    }

    lines.push(`Wiki index: ${run.wikiIndexPath}`);
    lines.push(`Run log: ${run.logPath}`);
    return lines.join("\n");
  }

  function formatAllCompleteNotice(beforeRuns, afterRuns) {
    const completedNow = collectCompletedRuns(beforeRuns, afterRuns);
    const topics = dedupeStrings(
      [...afterRuns.values()].map((run) => formatSlugForDisplay(run.topicSlug))
    );
    const runLabels = completedNow.map((run) => formatSlugForDisplay(run.runSlug));
    const wikiIndexes = dedupeStrings(
      [...afterRuns.values()].map((run) => normalizeText(run.wikiIndexPath)).filter(Boolean)
    );
    const lines = [
      `All active autoresearch work is complete${topics.length > 0 ? ` for ${topics.join(", ")}` : ""}.`,
    ];

    if (runLabels.length > 0) {
      lines.push(`Final completed run${runLabels.length === 1 ? "" : "s"}: ${runLabels.join(", ")}.`);
    }

    lines.push("The active autoresearch frontier is now empty, so this is the handoff point to review findings and choose the next phase.");

    if (wikiIndexes.length > 0) {
      lines.push(`Review starting point: ${wikiIndexes[0]}`);
    }

    return lines.join("\n");
  }

  function summarizeRuns(runs, now = new Date()) {
    return summarizeAutoresearchRuns(runs, now, stalledRunThresholdMs);
  }

  async function sendCompletionNotices(beforeRuns, sender, sendReply) {
    const afterRuns = snapshotRuns();
    const completedRuns = collectCompletedRuns(beforeRuns, afterRuns);
    const completionNotices = completedRuns.map((completedRun) => ({
      runRoot: completedRun.runRoot,
      message: formatCompletionNotice(completedRun),
    }));
    const allCompleteNotice = didFrontierDrain(beforeRuns, afterRuns)
      ? formatAllCompleteNotice(beforeRuns, afterRuns)
      : "";
    const archiveResult = archiveCompletedRuns
      ? await archiveFinishedRunsAfterNoticePreparation()
      : null;

    for (const notice of completionNotices) {
      await sendReply(sender, applyArchivePathRewrites(notice.message, archiveResult));
    }

    if (allCompleteNotice) {
      await sendReply(sender, allCompleteNotice);
    }
  }

  async function archiveFinishedRunsAfterNoticePreparation() {
    if (!root) {
      return null;
    }
    try {
      return await archiveCompletedRunsFn({ researchRoot: root });
    } catch (error) {
      logger.error?.(
        `[${timestamp()}] Failed archiving completed autoresearch runs: ${error.message}`
      );
      return null;
    }
  }

  return {
    collectCompletedRuns,
    didFrontierDrain,
    formatAllCompleteNotice,
    formatCompletionNotice,
    sendCompletionNotices,
    snapshotRuns,
    summarizeRuns,
  };
}

function applyArchivePathRewrites(message, archiveResult) {
  if (!archiveResult?.archived?.length) {
    return message;
  }
  let rewritten = message;
  for (const run of archiveResult.archived) {
    if (!run.runRoot || !run.destination) {
      continue;
    }
    rewritten = rewritten.split(run.runRoot).join(run.destination);
  }
  return rewritten;
}

function collectCompletedRuns(beforeRuns, afterRuns) {
  const completed = [];

  for (const [runRoot, before] of beforeRuns.entries()) {
    if (before.status !== "active" || before.pendingCount === 0) {
      continue;
    }

    const after = afterRuns.get(runRoot);
    if (!after) {
      continue;
    }

    if (after.status === "completed" || after.pendingCount === 0) {
      completed.push(after);
    }
  }

  return completed;
}

function countRunnableRuns(runs) {
  let count = 0;

  for (const run of runs.values()) {
    if (isRunnableRun(run)) {
      count += 1;
    }
  }

  return count;
}

function isRunnableRun(run, { isBudgetExhausted } = {}) {
  const budgetExhausted =
    typeof isBudgetExhausted === "boolean"
      ? isBudgetExhausted
      : isBudgetExhaustedRun(run);

  return run.status === "active" && run.pendingCount > 0 && !budgetExhausted;
}

function isBudgetExhaustedRun(run) {
  return (
    run.status === "active" &&
    run.maxTotalQuestions > 0 &&
    run.processedCount >= run.maxTotalQuestions &&
    run.pendingCount > 0
  );
}

function summarizeAutoresearchRuns(runs, now = new Date(), stalledRunThresholdMs = 6 * 60 * 60 * 1000) {
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
    const isBudgetExhausted = isBudgetExhaustedRun(run);

    if (run.status === "active") {
      summary.active += 1;
      if (isRunnableRun(run, { isBudgetExhausted })) {
        summary.runnable += 1;
      }
    }

    if (run.status === "completed") {
      summary.completed += 1;
    }

    const lastUpdatedAgeMs = ageMsFromIso(run.lastUpdatedAt, now);
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

function didFrontierDrain(beforeRuns, afterRuns) {
  return (
    countRunnableRuns(beforeRuns) > 0 &&
    countRunnableRuns(afterRuns) === 0
  );
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeInteger(value, defaultValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function truncateText(text, maxLength) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

function formatSlugForDisplay(value) {
  return normalizeText(value)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dedupeStrings(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
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

function defaultTimestamp() {
  return new Date().toISOString();
}

module.exports = {
  collectCompletedRuns,
  createAutoresearchMonitor,
  didFrontierDrain,
  applyArchivePathRewrites,
  summarizeAutoresearchRuns,
};
