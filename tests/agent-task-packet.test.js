const assert = require("node:assert/strict");
const test = require("node:test");

const {
  agentTaskPacketEnv,
  buildAgentTaskPacket,
  prependAgentTaskPreamble,
  renderAgentTaskPreamble,
} = require("../tools/runtime/agent-task-packet");

test("agent task packet combines canonical run metadata with profile defaults", () => {
  const packet = buildAgentTaskPacket({
    status: { id: "job-1", name: "Investigate latency", agentProfile: "personal" },
    run: { visibility: "milestones", risk_tier: 2 },
  });

  assert.deepEqual(packet, {
    version: "v0",
    jobId: "job-1",
    goal: "Investigate latency",
    agentProfile: "personal",
    purpose: "Handles personal/admin tasks, documents, travel, finance, and household workflows.",
    trigger: "manual",
    visibility: "milestones",
    delivery: "signal",
    riskTier: 2,
    riskHint: "Make reversible changes inside assigned workspace.",
    hierarchyHint:
      "You report to orchestrator. Do not delegate to personal, coding, research, work or any other domain agent; no sideways delegation.",
    checkpointHint: "Checkpoint meaningful milestones and before completion or blocking.",
    deliveryHint: "Prepare a concise user-facing result for Signal delivery.",
  });
});

test("task preamble is deterministic, bounded, and preserves the original prompt as its exact suffix", () => {
  const packet = buildAgentTaskPacket({
    job: {
      id: "job-2",
      name: `Research ${"x".repeat(500)}`,
      agentProfile: "research",
      trigger: "scheduled",
      visibility: "final_only",
      delivery: "orchestrator_only",
      riskTier: 1,
    },
  });
  const original = "First line.\n\n  Keep this spacing exactly.\n";
  const first = renderAgentTaskPreamble(packet);
  const second = renderAgentTaskPreamble(packet);
  const combined = prependAgentTaskPreamble(original, packet);

  assert.equal(first, second);
  assert.ok(first.length < 1200);
  assert.match(first, /Role: research - Collects evidence/);
  assert.match(first, /no sideways delegation/);
  assert.match(first, /visibility=final_only; delivery=orchestrator_only; risk=1/);
  assert.ok(combined.endsWith(original));
  assert.equal(combined.slice(-original.length), original);
});

test("orchestrator packet permits only downward domain delegation and exports non-secret metadata", () => {
  const packet = buildAgentTaskPacket({ job: { agentProfile: "orchestrator" } });

  assert.match(packet.hierarchyHint, /delegate downward only to personal, coding, research, work/);
  assert.deepEqual(agentTaskPacketEnv(packet), {
    SABLE_AGENT_PROFILE: "orchestrator",
    SABLE_RUN_DELIVERY: "signal",
    SABLE_RUN_RISK_TIER: "1",
    SABLE_RUN_TRIGGER: "callback",
    SABLE_RUN_VISIBILITY: "final_only",
    SABLE_TASK_PACKET_VERSION: "v0",
  });
});

test("every runtime profile renders its profile-specific purpose", () => {
  const purposes = {
    orchestrator: "Coordinates delegated work and reports consolidated outcomes.",
    personal: "Handles personal/admin tasks, documents, travel, finance, and household workflows.",
    coding: "Implements and verifies bounded software changes.",
    research: "Collects evidence and returns a concise synthesis.",
    work: "Owns Eigen Labs/work context and returns structured synthesis.",
  };

  for (const [agentProfile, purpose] of Object.entries(purposes)) {
    const packet = buildAgentTaskPacket({ job: { agentProfile } });
    assert.equal(packet.purpose, purpose);
    assert.match(renderAgentTaskPreamble(packet), new RegExp(`Role: ${agentProfile} -`));
  }
});

test("legacy ops profile requests canonicalize to personal", () => {
  const packet = buildAgentTaskPacket({ job: { agentProfile: "ops" } });
  assert.equal(packet.agentProfile, "personal");
  assert.match(renderAgentTaskPreamble(packet), /Role: personal -/);
});
