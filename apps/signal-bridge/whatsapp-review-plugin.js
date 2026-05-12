"use strict";

const path = require("path");
const { execFile: defaultExecFile } = require("child_process");

function createWhatsAppReviewPlugin({
  execFile = defaultExecFile,
  env = process.env,
  instanceConfig,
  truncateText = defaultTruncateText,
} = {}) {
  if (!instanceConfig) {
    throw new Error("createWhatsAppReviewPlugin requires instanceConfig.");
  }

  const triageLimit = normalizeIntegerEnv(env.SABLE_WHATSAPP_TRIAGE_LIMIT, 25);
  const staleDays = normalizeIntegerEnv(env.SABLE_WHATSAPP_TRIAGE_STALE_DAYS, 21);
  const testTriageOutput = normalizeText(env.SABLE_E2E_WHATSAPP_TRIAGE_OUTPUT);
  const nodeBin = normalizeText(env.SABLE_WHATSAPP_NODE_BIN) || process.execPath || "node";
  const cliPath =
    normalizeText(env.SABLE_WHATSAPP_CLI_PATH) ||
    path.join(instanceConfig.repoRoot, "tools", "whatsapp", "whatsapp_cli.js");

  function getTriageReport(limit = triageLimit) {
    if (testTriageOutput) {
      return Promise.resolve(testTriageOutput);
    }

    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : triageLimit;
    return new Promise((resolve) => {
      execFile(
        nodeBin,
        [
          cliPath,
          "triage",
          "--limit",
          String(normalizedLimit),
          "--stale-days",
          String(staleDays),
        ],
        {
          cwd: instanceConfig.repoRoot,
          encoding: "utf8",
          env,
          timeout: 60_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = truncateText(
              normalizeText(stderr) || normalizeText(stdout) || error.message || "unknown failure",
              500
            );
            resolve(`WhatsApp triage failed: ${detail}`);
            return;
          }

          const report = normalizeText(stdout);
          resolve(report || "WhatsApp triage returned no output.");
        }
      );
    });
  }

  return {
    cliPath,
    getTriageReport,
    nodeBin,
    staleDays,
    triageLimit,
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
  createWhatsAppReviewPlugin,
};
