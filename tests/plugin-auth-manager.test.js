const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPluginAuthManager,
  formatStatus,
  getPollDelayMs,
  inferInitialCheckCount,
  isDueForCheck,
  normalizePendingPluginAuth,
  splitPluginId,
} = require("../apps/signal-bridge/plugin-auth-manager");

function createCallCodexAppServer({ installed = false } = {}) {
  const calls = [];
  const callCodexAppServer = async (method, params) => {
    calls.push({ method, params });

    if (method === "plugin/list") {
      return {
        marketplaces: [
          {
            path: "/marketplaces/openai-curated",
            plugins: [
              {
                id: "gmail@openai-curated",
                installed,
                enabled: installed,
                interface: { displayName: "Gmail" },
              },
            ],
          },
        ],
      };
    }

    if (method === "plugin/read") {
      return {
        plugin: {
          summary: {
            installed,
            enabled: installed,
            interface: { displayName: "Gmail" },
          },
          apps: [{ installUrl: "https://auth.example/gmail" }],
        },
      };
    }

    throw new Error(`unexpected method ${method}`);
  };

  return { calls, callCodexAppServer };
}

test("normalizes durable pending plugin auth state", () => {
  assert.equal(normalizePendingPluginAuth(null), null);
  assert.equal(normalizePendingPluginAuth({ pluginId: "gmail@openai-curated" }), null);

  assert.deepEqual(
    normalizePendingPluginAuth(
      {
        sender: " +15551112222 ",
        pluginId: " gmail@openai-curated ",
        pluginName: " gmail ",
        displayName: "",
        marketplacePath: " /marketplaces/openai-curated ",
        installUrl: " https://auth.example/gmail ",
        status: "nonsense",
      },
      () => "2026-05-04T10:00:00.000Z"
    ),
    {
      sender: "+15551112222",
      pluginId: "gmail@openai-curated",
      pluginName: "gmail",
      displayName: "gmail",
      marketplacePath: "/marketplaces/openai-curated",
      installUrl: "https://auth.example/gmail",
      sourcePrompt: "",
      status: "pending",
      startedAt: "2026-05-04T10:00:00.000Z",
      completedAt: "",
      lastCheckedAt: "",
      nextCheckAt: "",
      checkCount: 0,
    }
  );
});

test("normalizes old pending plugin auth states as stale", () => {
  const pending = normalizePendingPluginAuth(
    {
      sender: "+15551112222",
      pluginId: "gmail@openai-curated",
      pluginName: "gmail",
      marketplacePath: "/marketplaces/openai-curated",
      installUrl: "https://auth.example/gmail",
      status: "pending",
      startedAt: "2026-05-04T10:00:00.000Z",
    },
    () => "2026-05-06T10:00:00.000Z"
  );

  assert.equal(pending.checkCount, 49);
  assert.equal(
    inferInitialCheckCount(
      "2026-05-04T10:00:00.000Z",
      "2026-05-04T10:01:00.000Z"
    ),
    0
  );
});

test("formats pending and completed plugin auth status", () => {
  assert.equal(formatStatus(null), "No plugin auth flow is currently pending.");

  assert.match(
    formatStatus({
      displayName: "Gmail",
      status: "pending",
      startedAt: "2026-05-04T10:00:00.000Z",
      completedAt: "",
      lastCheckedAt: "",
      installUrl: "https://auth.example/gmail",
    }),
    /Still waiting for the browser-side connector flow to finish\./
  );

  assert.match(
    formatStatus({
      displayName: "Gmail",
      status: "completed",
      startedAt: "2026-05-04T10:00:00.000Z",
      completedAt: "2026-05-04T10:01:00.000Z",
      lastCheckedAt: "2026-05-04T10:01:00.000Z",
      installUrl: "https://auth.example/gmail",
    }),
    /Reply \/authresume to retry/
  );
});

test("starts plugin auth by resolving the scoped install URL", async () => {
  const { calls, callCodexAppServer } = createCallCodexAppServer();
  const replies = [];
  let pending = null;
  const manager = createPluginAuthManager({
    callCodexAppServer,
    codexCwd: "/home/arya",
    getPending: () => pending,
    savePending: (value) => {
      pending = value;
    },
    sendReply: async (sender, message) => {
      replies.push({ sender, message });
    },
    timestamp: () => "2026-05-04T10:00:00.000Z",
  });

  const handled = await manager.maybeStart("+15551112222", "read my calendar", {
    toolType: "plugin",
    actionType: "install",
    toolId: "gmail@openai-curated",
  });

  assert.equal(handled, true);
  assert.equal(pending.pluginId, "gmail@openai-curated");
  assert.equal(pending.pluginName, "gmail");
  assert.equal(pending.installUrl, "https://auth.example/gmail");
  assert.equal(pending.sourcePrompt, "read my calendar");
  assert.equal(pending.nextCheckAt, "");
  assert.equal(pending.checkCount, 0);
  assert.deepEqual(replies, [
    {
      sender: "+15551112222",
      message: [
        "Gmail needs a browser auth step.",
        "https://auth.example/gmail",
        "Open the link on your phone, finish the connector flow, and I will poll for completion automatically.",
        "Commands: /authstatus, /authcancel, /authresume",
      ].join("\n"),
    },
  ]);
  assert.deepEqual(calls[0], {
    method: "plugin/list",
    params: { cwds: ["/home/arya"], forceRemoteSync: false },
  });
});

test("polls pending plugin auth and marks completion", async () => {
  const { callCodexAppServer } = createCallCodexAppServer({ installed: true });
  const replies = [];
  let pending = {
    sender: "+15551112222",
    pluginId: "gmail@openai-curated",
    pluginName: "gmail",
    displayName: "Gmail",
    marketplacePath: "/marketplaces/openai-curated",
    installUrl: "https://auth.example/gmail",
    sourcePrompt: "read my calendar",
    status: "pending",
    startedAt: "2026-05-04T10:00:00.000Z",
    completedAt: "",
    lastCheckedAt: "",
  };
  const manager = createPluginAuthManager({
    callCodexAppServer,
    codexCwd: "/home/arya",
    getPending: () => pending,
    savePending: (value) => {
      pending = value;
    },
    sendReply: async (sender, message) => {
      replies.push({ sender, message });
    },
    timestamp: () => "2026-05-04T10:01:00.000Z",
  });

  const result = await manager.check();

  assert.deepEqual(result, { checked: true, installed: true });
  assert.equal(pending.status, "completed");
  assert.equal(pending.completedAt, "2026-05-04T10:01:00.000Z");
  assert.equal(pending.lastCheckedAt, "2026-05-04T10:01:00.000Z");
  assert.equal(pending.nextCheckAt, "");
  assert.equal(pending.checkCount, 1);
  assert.deepEqual(replies, [
    {
      sender: "+15551112222",
      message: [
        "Gmail now looks connected.",
        "Reply /authresume to retry the request that triggered this auth flow, or just ask normally.",
      ].join("\n"),
    },
  ]);
});

test("polls pending plugin auth only when the next check is due", async () => {
  const { calls, callCodexAppServer } = createCallCodexAppServer({ installed: false });
  let pending = {
    sender: "+15551112222",
    pluginId: "gmail@openai-curated",
    pluginName: "gmail",
    displayName: "Gmail",
    marketplacePath: "/marketplaces/openai-curated",
    installUrl: "https://auth.example/gmail",
    sourcePrompt: "read my calendar",
    status: "pending",
    startedAt: "2026-05-04T10:00:00.000Z",
    completedAt: "",
    lastCheckedAt: "2026-05-04T10:00:00.000Z",
    nextCheckAt: "2026-05-04T10:05:00.000Z",
    checkCount: 48,
  };
  const manager = createPluginAuthManager({
    callCodexAppServer,
    codexCwd: "/home/arya",
    getPending: () => pending,
    savePending: (value) => {
      pending = value;
    },
    sendReply: async () => {},
    timestamp: () => "2026-05-04T10:04:00.000Z",
  });

  assert.deepEqual(await manager.check(), {
    checked: false,
    reason: "not-due",
    nextCheckAt: "2026-05-04T10:05:00.000Z",
  });
  assert.deepEqual(calls, []);

  const dueManager = createPluginAuthManager({
    callCodexAppServer,
    codexCwd: "/home/arya",
    getPending: () => pending,
    savePending: (value) => {
      pending = value;
    },
    sendReply: async () => {},
    timestamp: () => "2026-05-04T10:05:00.000Z",
  });

  assert.deepEqual(await dueManager.check(), {
    checked: true,
    installed: false,
    nextCheckAt: "2026-05-04T11:05:00.000Z",
  });
  assert.equal(calls.length, 1);
  assert.equal(pending.checkCount, 49);
  assert.equal(pending.nextCheckAt, "2026-05-04T11:05:00.000Z");
});

test("plugin auth polling cadence backs off for stale flows", () => {
  assert.equal(getPollDelayMs(1), 15_000);
  assert.equal(getPollDelayMs(8), 60_000);
  assert.equal(getPollDelayMs(24), 5 * 60_000);
  assert.equal(getPollDelayMs(49), 60 * 60_000);
  assert.equal(
    isDueForCheck(
      { nextCheckAt: "2026-05-04T10:05:00.000Z" },
      "2026-05-04T10:04:59.999Z"
    ),
    false
  );
  assert.equal(
    isDueForCheck(
      { nextCheckAt: "2026-05-04T10:05:00.000Z" },
      "2026-05-04T10:05:00.000Z"
    ),
    true
  );
});

test("splits plugin ids into plugin and marketplace names", () => {
  assert.deepEqual(splitPluginId("gmail@openai-curated"), {
    pluginName: "gmail",
    marketplaceName: "openai-curated",
  });
  assert.deepEqual(splitPluginId("local-plugin"), {
    pluginName: "local-plugin",
    marketplaceName: "",
  });
});
