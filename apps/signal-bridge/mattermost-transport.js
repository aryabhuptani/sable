"use strict";

const {
  createMattermostClient,
  normalizeMattermostPostEvent,
  redactMattermostSecrets,
} = require("./mattermost-client");

function createMattermostTransport({
  enabled = false,
  baseUrl = "",
  token = "",
  team = "",
  parentChannel = "",
  parentChannelId = "",
  pollIntervalMs = 5000,
  allowedUsers = [],
  botUserId = "",
  fetchImpl = globalThis.fetch,
  logger = console,
  onEnvelope = async () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const client = createMattermostClient({ baseUrl, token, fetchImpl });
  const allowedUserSet = new Set((allowedUsers || []).map(String).filter(Boolean));
  let timer = null;
  let resolvedChannelId = parentChannelId || "";
  let lastCreateAt = 0;

  function isEnabled() {
    return Boolean(enabled && baseUrl && token && (parentChannelId || (team && parentChannel)));
  }

  async function start() {
    if (!isEnabled() || timer) {
      return false;
    }
    const channel = await client.resolveChannel({
      team,
      channel: parentChannel,
      channelId: parentChannelId,
    });
    resolvedChannelId = channel.id;
    timer = setIntervalFn(() => {
      void poll().catch((error) => {
        logger.error?.(`Mattermost poll failed: ${redactMattermostSecrets(error.message, token)}`);
      });
    }, pollIntervalMs);
    return true;
  }

  function stop() {
    if (timer) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  async function poll() {
    if (!resolvedChannelId) {
      return;
    }
    const history = await client.getChannelHistory(resolvedChannelId, {
      perPage: 20,
      since: lastCreateAt,
    });
    const posts = Object.values(history.posts || {})
      .sort((a, b) => Number(a.create_at || 0) - Number(b.create_at || 0));
    for (const post of posts) {
      const created = Number(post.create_at || 0);
      if (created <= lastCreateAt) {
        continue;
      }
      lastCreateAt = Math.max(lastCreateAt, created);
      const envelope = normalizeMattermostPostEvent({ post }, { botUserId });
      if (!envelope || !isAllowedSender(envelope.sender)) {
        continue;
      }
      await onEnvelope(envelope);
    }
  }

  function isAllowedSender(sender) {
    return allowedUserSet.size === 0 || allowedUserSet.has(String(sender || ""));
  }

  async function sendReply(target, text) {
    const channelId = parseMattermostTarget(target) || resolvedChannelId;
    if (!channelId) {
      throw new Error("Mattermost channel id is not available.");
    }
    return client.postMessage(channelId, text);
  }

  return {
    client,
    getChannelId: () => resolvedChannelId,
    isEnabled,
    poll,
    sendReply,
    start,
    stop,
  };
}

function parseMattermostTarget(target) {
  const text = String(target || "");
  return text.startsWith("mattermost:") ? text.slice("mattermost:".length) : "";
}

function formatMattermostTarget(channelId) {
  return `mattermost:${channelId}`;
}

module.exports = {
  createMattermostTransport,
  formatMattermostTarget,
  parseMattermostTarget,
};

