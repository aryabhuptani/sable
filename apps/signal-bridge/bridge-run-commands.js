"use strict";

const RUN_COMMAND_USAGE = [
  "Run commands:",
  "- /runs",
  "- /run <id>",
  "- /run <id> pause|resume|cancel",
  "- /run <id> steer <instruction>",
  "- /blockers",
].join("\n");

/*
 * V0 run-store adapter:
 *   listRuns({ statuses?, limit? }) -> run[]
 *   getRun(runId) -> run | null
 *   controlRun(runId, { action, instruction?, actor })
 *     -> run | { run } | { ok: false, message? } | null
 *
 * State transitions and checkpoint delivery belong to the shared run kernel.
 * This module only translates Signal commands and formats public run fields.
 */
function createBridgeRunCommands({ runStore = null, listLimit = 10 } = {}) {
  async function handle(command, { actor = "signal" } = {}) {
    if (command.type === "run-usage") {
      return RUN_COMMAND_USAGE;
    }
    if (!runStore) {
      return "Run controls are not available in this Sable runtime yet.";
    }

    try {
      if (command.type === "list-runs") {
        const runs = await runStore.listRuns({ limit: listLimit });
        return formatRunList(runs, { heading: "Recent runs", empty: "No delegated runs yet." });
      }
      if (command.type === "list-run-blockers") {
        const runs = await runStore.listRuns({ statuses: ["blocked"], limit: listLimit });
        return formatRunList(runs, {
          heading: "Blockers",
          empty: "No delegated runs are blocked.",
          includeNextAction: true,
        });
      }
      if (command.type === "show-run") {
        const run = await runStore.getRun(command.runId);
        return run ? formatRunDetail(run) : `No run matched ${command.runId}.`;
      }
      if (command.type === "control-run") {
        const result = await runStore.controlRun(command.runId, {
          action: command.action,
          ...(command.instruction ? { instruction: command.instruction } : {}),
          actor,
        });
        if (result?.ok === false) {
          return result.message || `Could not ${command.action} run ${command.runId}.`;
        }
        const run = result?.run || result;
        if (!run) {
          return `No run matched ${command.runId}.`;
        }
        return formatControlResult(command, run);
      }
    } catch (error) {
      return `Run command failed: ${cleanText(error?.message) || "unknown error"}`;
    }

    return RUN_COMMAND_USAGE;
  }

  return { handle };
}

function formatRunList(runs, { heading, empty, includeNextAction = false }) {
  const items = Array.isArray(runs) ? runs : [];
  if (items.length === 0) {
    return empty;
  }
  const lines = [`${heading} (${items.length}):`];
  for (const run of items) {
    lines.push(`- ${runLabel(run)} - ${runState(run)}${summarySuffix(run)}`);
    if (includeNextAction && cleanText(run?.next_action || run?.nextAction)) {
      lines.push(`  Next: ${cleanText(run.next_action || run.nextAction)}`);
    }
  }
  return lines.join("\n");
}

function formatRunDetail(run) {
  const lines = [`${runLabel(run)} - ${runState(run)}`];
  const profile = cleanText(run?.agent_profile || run?.agentProfile);
  const updated = cleanText(run?.updated_at || run?.updatedAt);
  if (profile || updated) {
    lines.push([profile && `Agent: ${profile}`, updated && `Updated: ${updated}`].filter(Boolean).join(" · "));
  }
  const summary = publicSummary(run);
  if (summary) {
    lines.push(`Summary: ${summary}`);
  }
  const nextAction = cleanText(run?.next_action || run?.nextAction);
  if (nextAction) {
    lines.push(`Next: ${nextAction}`);
  }
  const finalSummary = cleanText(run?.final_summary || run?.finalSummary);
  if (finalSummary && finalSummary !== summary) {
    lines.push(`Result: ${finalSummary}`);
  }
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts.length : 0;
  if (artifacts > 0) {
    lines.push(`Artifacts: ${artifacts}`);
  }
  return lines.join("\n");
}

function formatControlResult(command, run) {
  if (command.action === "steer") {
    return `Steering queued for ${runLabel(run)}. ${runState(run)}.`;
  }
  const verbs = { pause: "Pause requested", resume: "Resume requested", cancel: "Cancellation requested" };
  return `${verbs[command.action] || "Control updated"} for ${runLabel(run)}. ${runState(run)}.`;
}

function runLabel(run) {
  return cleanText(run?.run_id || run?.runId) || "unknown-run";
}

function runState(run) {
  const status = cleanText(run?.status) || "unknown";
  const phase = cleanText(run?.phase);
  return phase ? `${status} · ${phase}` : status;
}

function publicSummary(run) {
  return cleanText(run?.public_summary || run?.publicSummary);
}

function summarySuffix(run) {
  const summary = publicSummary(run);
  return summary ? ` - ${summary}` : "";
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

module.exports = {
  RUN_COMMAND_USAGE,
  createBridgeRunCommands,
  formatRunDetail,
  formatRunList,
};
