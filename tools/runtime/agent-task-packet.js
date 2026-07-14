"use strict";

const { getAgentProfile } = require("./agent-profiles");
const { describeRiskTier, validateRiskTier } = require("./run-kernel");

const TASK_PACKET_VERSION = "v0";
const DEFAULT_AGENT_PROFILE = "coding";
const DOMAIN_PROFILES = Object.freeze(["personal", "coding", "research", "work"]);

const VISIBILITY_HINTS = Object.freeze({
  silent: "Keep progress quiet; checkpoint only durable state needed for recovery.",
  final_only: "Checkpoint before completion or when blocked; otherwise report only the final outcome.",
  milestones: "Checkpoint meaningful milestones and before completion or blocking.",
  interactive: "Checkpoint progress and decisions as work proceeds, including before completion or blocking.",
});

const DELIVERY_HINTS = Object.freeze({
  none: "Do not deliver externally; leave the result in the run artifacts and final response.",
  orchestrator_only: "Return the concise result to the orchestrator; do not contact the user directly.",
  signal: "Prepare a concise user-facing result for Signal delivery.",
});

function buildAgentTaskPacket({ job = {}, run = {}, status = {} } = {}) {
  const metadata = { ...job, ...status };
  const profile = getAgentProfile(
    firstDefined(run.agent_profile, metadata.agentProfile, DEFAULT_AGENT_PROFILE)
  );
  const riskTier = validateRiskTier(
    firstDefined(run.risk_tier, metadata.riskTier, profile.defaultRiskTier)
  );
  const visibility = cleanToken(
    firstDefined(run.visibility, metadata.visibility, profile.defaultVisibility)
  );
  const delivery = cleanToken(
    firstDefined(run.delivery, metadata.delivery, profile.defaultDelivery)
  );

  return Object.freeze({
    version: TASK_PACKET_VERSION,
    jobId: cleanText(firstDefined(run.background_job_id, metadata.id, run.run_id), 80),
    goal: cleanText(firstDefined(run.goal, metadata.name), 120),
    agentProfile: profile.agentProfile,
    purpose: profile.description,
    trigger: cleanToken(firstDefined(run.trigger, metadata.trigger, profile.defaultTrigger)),
    visibility,
    delivery,
    riskTier,
    riskHint: describeRiskTier(riskTier),
    hierarchyHint: hierarchyHint(profile.agentProfile),
    checkpointHint:
      VISIBILITY_HINTS[visibility] || "Checkpoint before completion and whenever progress is blocked.",
    deliveryHint:
      DELIVERY_HINTS[delivery] || "Return a concise final result through the configured delivery path.",
  });
}

function renderAgentTaskPreamble(packet) {
  const lines = [
    `[Sable domain task packet ${packet.version}]`,
    `Role: ${packet.agentProfile} - ${packet.purpose}`,
    `Run: ${packet.jobId || "unknown"}${packet.goal ? ` - ${packet.goal}` : ""}`,
    `Policy: trigger=${packet.trigger}; visibility=${packet.visibility}; delivery=${packet.delivery}; risk=${packet.riskTier}.`,
    `Hierarchy: ${packet.hierarchyHint}`,
    `Risk: ${packet.riskHint} Do not exceed this tier; stop and surface a checkpoint if more authority is required.`,
    `Checkpoint: ${packet.checkpointHint} Use $SABLE_RUN_CHECKPOINT when a checkpoint is needed.`,
    `Delivery: ${packet.deliveryHint}`,
    "[End Sable domain task packet]",
  ];
  return lines.join("\n");
}

function prependAgentTaskPreamble(prompt, packet) {
  return `${renderAgentTaskPreamble(packet)}\n\n${String(prompt)}`;
}

function agentTaskPacketEnv(packet) {
  return {
    SABLE_AGENT_PROFILE: packet.agentProfile,
    SABLE_RUN_DELIVERY: packet.delivery,
    SABLE_RUN_RISK_TIER: String(packet.riskTier),
    SABLE_RUN_TRIGGER: packet.trigger,
    SABLE_RUN_VISIBILITY: packet.visibility,
    SABLE_TASK_PACKET_VERSION: packet.version,
  };
}

function hierarchyHint(agentProfile) {
  if (agentProfile === "orchestrator") {
    return `You may delegate downward only to ${DOMAIN_PROFILES.join(", ")}; never delegate sideways.`;
  }
  return `You report to orchestrator. Do not delegate to ${DOMAIN_PROFILES.join(
    ", "
  )} or any other domain agent; no sideways delegation.`;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function cleanToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

module.exports = {
  TASK_PACKET_VERSION,
  agentTaskPacketEnv,
  buildAgentTaskPacket,
  prependAgentTaskPreamble,
  renderAgentTaskPreamble,
};
