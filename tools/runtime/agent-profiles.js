#!/usr/bin/env node
"use strict";

const AGENT_PROFILES = Object.freeze({
  orchestrator: Object.freeze({
    agentProfile: "orchestrator",
    defaultTrigger: "callback",
    defaultVisibility: "final_only",
    defaultDelivery: "signal",
    defaultRiskTier: 1,
    description: "Coordinates delegated work and reports consolidated outcomes.",
  }),
  personal: Object.freeze({
    agentProfile: "personal",
    defaultTrigger: "manual",
    defaultVisibility: "interactive",
    defaultDelivery: "signal",
    defaultRiskTier: 3,
    description: "Handles personal/admin tasks, documents, travel, finance, and household workflows.",
  }),
  coding: Object.freeze({
    agentProfile: "coding",
    defaultTrigger: "manual",
    defaultVisibility: "milestones",
    defaultDelivery: "orchestrator_only",
    defaultRiskTier: 2,
    description: "Implements and verifies bounded software changes.",
  }),
  research: Object.freeze({
    agentProfile: "research",
    defaultTrigger: "manual",
    defaultVisibility: "final_only",
    defaultDelivery: "orchestrator_only",
    defaultRiskTier: 1,
    description: "Collects evidence and returns a concise synthesis.",
  }),
  work: Object.freeze({
    agentProfile: "work",
    defaultTrigger: "manual",
    defaultVisibility: "final_only",
    defaultDelivery: "orchestrator_only",
    defaultRiskTier: 1,
    description: "Owns Eigen Labs/work context and returns structured synthesis.",
  }),
});

const AGENT_PROFILE_NAMES = Object.freeze(Object.keys(AGENT_PROFILES));
const AGENT_PROFILE_ALIASES = Object.freeze({
  ops: "personal",
});

function getAgentProfile(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const canonicalName = AGENT_PROFILE_ALIASES[normalized] || normalized;
  const profile = AGENT_PROFILES[canonicalName];
  if (!profile) {
    throw new Error(
      `Unsupported --agent-profile: ${name}. Expected one of: ${AGENT_PROFILE_NAMES.join(", ")}.`
    );
  }
  return profile;
}

function formatAgentProfiles() {
  const header = "PROFILE       TRIGGER   VISIBILITY   DELIVERY           RISK  PURPOSE";
  const rows = AGENT_PROFILE_NAMES.map((name) => {
    const profile = AGENT_PROFILES[name];
    return [
      name.padEnd(13),
      profile.defaultTrigger.padEnd(9),
      profile.defaultVisibility.padEnd(12),
      profile.defaultDelivery.padEnd(18),
      String(profile.defaultRiskTier).padEnd(5),
      profile.description,
    ].join("");
  });
  return [header, ...rows].join("\n");
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--list") || argv.includes("-l")) {
    console.log(formatAgentProfiles());
    return 0;
  }
  console.error("Usage: node tools/runtime/agent-profiles.js --list");
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  AGENT_PROFILES,
  AGENT_PROFILE_NAMES,
  formatAgentProfiles,
  getAgentProfile,
};
