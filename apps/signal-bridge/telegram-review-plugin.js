"use strict";

const path = require("path");
const { execFile: defaultExecFile } = require("child_process");

function createTelegramReviewPlugin({
  execFile = defaultExecFile,
  env = process.env,
  instanceConfig,
  truncateText = defaultTruncateText,
} = {}) {
  if (!instanceConfig) {
    throw new Error("createTelegramReviewPlugin requires instanceConfig.");
  }

  const triageLimit = normalizeIntegerEnv(env.SABLE_TELEGRAM_TRIAGE_LIMIT, 25);
  const triageStaleDays = normalizeIntegerEnv(env.SABLE_TELEGRAM_TRIAGE_STALE_DAYS, 21);
  const testTriageOutput = normalizeText(env.SABLE_E2E_TELEGRAM_TRIAGE_OUTPUT);
  const pythonBin = normalizeText(env.SABLE_TELEGRAM_PYTHON_BIN) || "python3";
  const autoCleanupSolicitations = normalizeBooleanEnv(
    env.SABLE_TELEGRAM_AUTO_CLEANUP_SOLICITATIONS,
    false
  );
  const cleanupLimit = normalizeIntegerEnv(
    env.SABLE_TELEGRAM_AUTO_CLEANUP_LIMIT,
    Math.max(50, triageLimit)
  );
  const cliPath =
    normalizeText(env.SABLE_TELEGRAM_CLI_PATH) ||
    path.join(instanceConfig.repoRoot, "tools", "telegram", "telegram_cli.py");

  async function getTriageReport(limit = triageLimit) {
    if (testTriageOutput) {
      return testTriageOutput;
    }

    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : triageLimit;
    const cleanupSummary = autoCleanupSolicitations
      ? await runCleanupSolicitations(cleanupLimit)
      : "";
    const triage = await runTelegramCli([
      "triage",
      "--limit",
      String(normalizedLimit),
      "--stale-days",
      String(triageStaleDays),
    ]);
    const report = triage.ok
      ? normalizeText(triage.stdout) || "Telegram triage returned no output."
      : `Telegram triage failed: ${formatCliFailure(triage, truncateText)}`;
    return [cleanupSummary, report].filter(Boolean).join("\n\n");
  }

  async function runCleanupSolicitations(limit) {
    const cleanup = await runTelegramCli(["cleanup-solicitations", "--limit", String(limit)]);
    if (!cleanup.ok) {
      return `Telegram solicitation cleanup failed: ${formatCliFailure(cleanup, truncateText)}`;
    }
    const parsed = safeJsonParse(cleanup.stdout);
    if (!parsed || typeof parsed.cleaned_count !== "number") {
      return "Telegram solicitation cleanup ran, but returned an unreadable summary.";
    }
    if (parsed.cleaned_count === 0 && !parsed.skipped_count) {
      return "Telegram solicitation cleanup: no market-making/listing spam found.";
    }
    const pieces = [
      `Telegram solicitation cleanup: blocked/deleted ${parsed.cleaned_count} market-making/listing spam chat(s).`,
    ];
    if (parsed.skipped_count) {
      pieces.push(`Skipped ${parsed.skipped_count}; check bridge logs before trusting that queue.`);
    }
    return pieces.join(" ");
  }

  function runTelegramCli(args) {
    return new Promise((resolve) => {
      execFile(
        pythonBin,
        [cliPath, ...args],
        {
          cwd: instanceConfig.repoRoot,
          encoding: "utf8",
          env,
          timeout: 30_000,
        },
        (error, stdout, stderr) => {
          resolve({ ok: !error, error, stdout, stderr });
        }
      );
    });
  }

  return {
    autoCleanupSolicitations,
    cleanupLimit,
    cliPath,
    getTriageReport,
    pythonBin,
    triageLimit,
    triageStaleDays,
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBooleanEnv(value, fallback = false) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatCliFailure(result, truncateText = defaultTruncateText) {
  return truncateText(
    normalizeText(result.stderr) ||
      normalizeText(result.stdout) ||
      normalizeText(result.error && result.error.message) ||
      "unknown failure",
    400
  );
}

function defaultTruncateText(value, limit) {
  const normalized = String(value || "");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

module.exports = {
  createTelegramReviewPlugin,
  normalizeBooleanEnv,
};
