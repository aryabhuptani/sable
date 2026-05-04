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
  const cliPath =
    normalizeText(env.SABLE_TELEGRAM_CLI_PATH) ||
    path.join(instanceConfig.repoRoot, "tools", "telegram", "telegram_cli.py");

  function getTriageReport(limit = triageLimit) {
    if (testTriageOutput) {
      return Promise.resolve(testTriageOutput);
    }

    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : triageLimit;
    return new Promise((resolve) => {
      execFile(
        pythonBin,
        [
          cliPath,
          "triage",
          "--limit",
          String(normalizedLimit),
          "--stale-days",
          String(triageStaleDays),
        ],
        {
          cwd: instanceConfig.repoRoot,
          encoding: "utf8",
          env,
          timeout: 30_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = truncateText(
              normalizeText(stderr) || normalizeText(stdout) || error.message || "unknown failure",
              400
            );
            resolve(`Telegram triage failed: ${detail}`);
            return;
          }

          const report = normalizeText(stdout);
          resolve(report || "Telegram triage returned no output.");
        }
      );
    });
  }

  return {
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

function defaultTruncateText(value, limit) {
  const normalized = String(value || "");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

module.exports = {
  createTelegramReviewPlugin,
};
