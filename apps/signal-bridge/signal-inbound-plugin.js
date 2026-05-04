"use strict";

function createSignalInboundPlugin({ allowedNumbers, allowedSenders } = {}) {
  const allowedNumberSet = allowedNumbers instanceof Set ? allowedNumbers : new Set(allowedNumbers || []);
  const allowedSenderSet = allowedSenders instanceof Set ? allowedSenders : new Set(allowedSenders || []);

  function isAllowedSender(senderCandidates) {
    return senderCandidates.some(
      (candidate) => allowedNumberSet.has(candidate) || allowedSenderSet.has(candidate)
    );
  }

  return {
    extractIncomingText,
    extractSenderCandidates,
    isAllowedSender,
  };
}

function extractSenderCandidates(envelope) {
  const candidates = [
    envelope?.sourceNumber,
    envelope?.source,
    envelope?.sourceUuid,
    envelope?.sourceName,
  ];

  return candidates
    .filter((candidate) => typeof candidate === "string" && candidate.trim())
    .map((candidate) => candidate.trim());
}

function extractIncomingText(envelope) {
  const candidates = [
    envelope?.dataMessage?.message,
    envelope?.message,
    envelope?.body,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

module.exports = {
  createSignalInboundPlugin,
  extractIncomingText,
  extractSenderCandidates,
};
