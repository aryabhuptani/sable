"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
  dmUserIds = [],
  pollIntervalMs = 5000,
  allowedUsers = [],
  botUserId = "",
  cursorPath = "",
  skipExistingOnStart = true,
  fetchImpl = globalThis.fetch,
  fsModule = fs,
  logger = console,
  onEnvelope = async () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const client = createMattermostClient({ baseUrl, token, fetchImpl });
  const allowedUserSet = new Set((allowedUsers || []).map(String).filter(Boolean));
  const directUserIds = (dmUserIds || []).map(String).filter(Boolean);
  let timer = null;
  let resolvedChannelId = parentChannelId || "";
  let watchedChannels = [];
  const lastCreateAtByChannel = new Map();
  let cursorLoaded = false;

  function isEnabled() {
    return Boolean(
      enabled &&
        baseUrl &&
        token &&
        ((parentChannelId || (team && parentChannel)) || (botUserId && directUserIds.length > 0))
    );
  }

  async function start() {
    if (!isEnabled() || timer) {
      return false;
    }
    loadCursors();
    watchedChannels = await resolveWatchedChannels();
    resolvedChannelId = watchedChannels[0]?.id || "";
    seedNewChannelCursors();
    saveCursors();
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
    if (watchedChannels.length === 0) {
      return;
    }
    for (const channel of watchedChannels) {
      const lastCreateAt = lastCreateAtByChannel.get(channel.id) || 0;
      const history = await client.getChannelHistory(channel.id, {
        perPage: 20,
        since: lastCreateAt,
      });
      const posts = Object.values(history.posts || {})
        .sort((a, b) => Number(a.create_at || 0) - Number(b.create_at || 0));
      for (const post of posts) {
        const created = Number(post.create_at || 0);
        if (created <= (lastCreateAtByChannel.get(channel.id) || 0)) {
          continue;
        }
        lastCreateAtByChannel.set(
          channel.id,
          Math.max(lastCreateAtByChannel.get(channel.id) || 0, created)
        );
        saveCursors();
        const envelope = normalizeMattermostPostEvent({ post }, { botUserId });
        if (!envelope || !isAllowedSender(envelope.sender)) {
          continue;
        }
        await onEnvelope({
          ...envelope,
          channelKind: channel.kind,
          replyTarget: formatMattermostTarget(envelope.conversationId),
        });
      }
    }
  }

  async function resolveWatchedChannels() {
    const channels = [];
    if (parentChannelId || (team && parentChannel)) {
      const channel = await client.resolveChannel({
        team,
        channel: parentChannel,
        channelId: parentChannelId,
      });
      if (channel?.id) {
        channels.push({ id: channel.id, kind: "channel" });
      }
    }
    for (const userId of directUserIds) {
      const channel = await client.createDirectChannel([botUserId, userId]);
      if (channel?.id && !channels.some((entry) => entry.id === channel.id)) {
        channels.push({ id: channel.id, kind: "direct", userId });
      }
    }
    return channels;
  }

  function isAllowedSender(sender) {
    return allowedUserSet.size === 0 || allowedUserSet.has(String(sender || ""));
  }

  function loadCursors() {
    if (cursorLoaded || !cursorPath) {
      cursorLoaded = true;
      return;
    }
    cursorLoaded = true;
    try {
      const parsed = JSON.parse(fsModule.readFileSync(cursorPath, "utf8"));
      for (const [channelId, value] of Object.entries(parsed.channels || {})) {
        const cursor = Number(value || 0);
        if (channelId && Number.isFinite(cursor) && cursor > 0) {
          lastCreateAtByChannel.set(channelId, cursor);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn?.(`Mattermost cursor load failed: ${error.message}`);
      }
    }
  }

  function seedNewChannelCursors() {
    if (!skipExistingOnStart) {
      return;
    }
    const startupCursor = Date.now();
    for (const channel of watchedChannels) {
      if (!lastCreateAtByChannel.has(channel.id)) {
        lastCreateAtByChannel.set(channel.id, startupCursor);
      }
    }
  }

  function saveCursors() {
    if (!cursorPath) {
      return;
    }
    try {
      fsModule.mkdirSync(path.dirname(cursorPath), { recursive: true });
      const channels = {};
      for (const [channelId, cursor] of lastCreateAtByChannel.entries()) {
        channels[channelId] = cursor;
      }
      fsModule.writeFileSync(
        cursorPath,
        `${JSON.stringify({ version: 1, channels }, null, 2)}\n`,
        "utf8"
      );
    } catch (error) {
      logger.warn?.(`Mattermost cursor save failed: ${error.message}`);
    }
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
    getWatchedChannels: () => [...watchedChannels],
    getCursors: () => Object.fromEntries(lastCreateAtByChannel.entries()),
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
