"use strict";

function createMattermostClient({
  baseUrl = "",
  token = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const authToken = String(token || "");

  function assertConfigured() {
    if (!normalizedBaseUrl) {
      throw new Error("Mattermost base URL is not configured.");
    }
    if (!authToken) {
      throw new Error("Mattermost token is not configured.");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("Mattermost client requires fetch.");
    }
  }

  async function request(method, route, body = null) {
    assertConfigured();
    const response = await fetchImpl(`${normalizedBaseUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${authToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) {
      const message = parsed?.message || text || response.statusText;
      throw new Error(`Mattermost ${method} ${route} failed: ${response.status} ${message}`);
    }
    return parsed === null ? text : parsed;
  }

  async function postMessage(channelId, message, props = {}) {
    return request("POST", "/api/v4/posts", {
      channel_id: channelId,
      message,
      ...(Object.keys(props).length > 0 ? { props } : {}),
    });
  }

  async function getChannelHistory(channelId, { page = 0, perPage = 20, since = 0 } = {}) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("per_page", String(perPage));
    if (since) {
      params.set("since", String(since));
    }
    return request("GET", `/api/v4/channels/${encodeURIComponent(channelId)}/posts?${params}`);
  }

  async function getTeamByName(name) {
    return request("GET", `/api/v4/teams/name/${encodeURIComponent(name)}`);
  }

  async function getChannelByName(teamId, channelName) {
    return request(
      "GET",
      `/api/v4/teams/${encodeURIComponent(teamId)}/channels/name/${encodeURIComponent(channelName)}`
    );
  }

  async function resolveChannel({ team = "", channel = "", channelId = "" } = {}) {
    if (channelId) {
      return { id: channelId };
    }
    if (!team || !channel) {
      throw new Error("Mattermost team and channel are required when channel id is absent.");
    }
    const teamRecord = await getTeamByName(team);
    return getChannelByName(teamRecord.id, channel);
  }

  return {
    baseUrl: normalizedBaseUrl,
    getChannelByName,
    getChannelHistory,
    getTeamByName,
    postMessage,
    request,
    resolveChannel,
  };
}

function normalizeMattermostPostEvent(event, { botUserId = "" } = {}) {
  const post = parseMattermostPost(event);
  if (!post || !post.id) {
    return null;
  }
  if (botUserId && post.user_id === botUserId) {
    return null;
  }
  return {
    transport: "mattermost",
    conversationId: post.channel_id || event?.broadcast?.channel_id || "",
    sender: post.user_id || event?.broadcast?.user_id || "",
    text: post.message || "",
    attachments: [],
    receivedAt: post.create_at ? new Date(Number(post.create_at)).toISOString() : new Date().toISOString(),
    raw: { event, post },
  };
}

function parseMattermostPost(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const rawPost = event.data?.post;
  if (typeof rawPost === "string") {
    return parseJson(rawPost);
  }
  if (rawPost && typeof rawPost === "object") {
    return rawPost;
  }
  return event.post && typeof event.post === "object" ? event.post : null;
}

function redactMattermostSecrets(value, token = "") {
  let text = String(value || "");
  const secret = String(token || "");
  if (secret) {
    text = text.split(secret).join("[REDACTED_MATTERMOST_TOKEN]");
  }
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]");
  return text;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = {
  createMattermostClient,
  normalizeMattermostPostEvent,
  parseMattermostPost,
  redactMattermostSecrets,
};

