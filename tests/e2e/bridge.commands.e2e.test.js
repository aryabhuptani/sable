const fs = require("node:fs");
const test = require("node:test");

const {
  assert,
  path,
  startBridgeScenario,
} = require("./helpers/bridge-harness");

async function assertNoCodexTurnStarted(harness) {
  const codexRequests = await harness.getCodexRequests();
  assert.equal(codexRequests.find((request) => request.method === "turn/start"), undefined);
}

test("/bridgestatus reports Obsidian link server configuration", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/bridgestatus",
        },
      ],
    },
    codexScenario: { turns: [] },
    extraEnv: {
      SABLE_OBSIDIAN_BASE_URL: "https://arya-minipc.test.ts.net",
    },
  });

  try {
    const statusReply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("obsidian base url: https://arya-minipc.test.ts.net"),
      "bridge status with Obsidian config"
    );

    assert.match(statusReply.params.message, /obsidian links: /);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/ops reports bridge, scheduler, and research health without starting a Codex turn", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/ops",
        },
      ],
    },
    codexScenario: { turns: [] },
    initialSchedulerJobs: [
      {
        id: "sched-daily-brief",
        active: true,
        nextRunAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    ],
    extraEnv: ({ tempRoot }) => {
      const researchRoot = path.join(tempRoot, "research");
      const runRoot = path.join(
        researchRoot,
        "darkbloom",
        "autoresearch",
        "active",
        "stalled-run"
      );
      fs.mkdirSync(runRoot, { recursive: true });
      fs.writeFileSync(
        path.join(runRoot, "STATE.json"),
        `${JSON.stringify(
          {
            topicSlug: "darkbloom",
            runSlug: "stalled-run",
            rootQuestion: "Can multinode inference work?",
            status: "active",
            pendingQuestions: [{ question: "still pending" }],
            processedQuestions: [{ question: "done" }, { question: "done 2" }],
            maxTotalQuestions: 2,
            startedAt: "2026-04-21T00:00:00.000Z",
            updatedAt: "2026-04-21T01:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      return {
        SABLE_RESEARCH_ROOT: researchRoot,
        SABLE_OPS_STATE_DIR: path.join(tempRoot, "ops"),
        SABLE_OPS_SNAPSHOT_INTERVAL_MS: "1000",
      };
    },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("research: active=1") &&
        request.params.message.includes("usage: not surfaced by Codex yet"),
      "ops report reply"
    );

    assert.match(reply.params.message, /host flags: lingering=/);
    assert.match(reply.params.message, /scheduler: 1 active/);
    assert.match(reply.params.message, /Research watchlist:/);
    assert.match(reply.params.message, /darkbloom\/stalled-run: active/);

    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/telegram returns the local Telegram triage summary", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/telegram",
        },
      ],
    },
    codexScenario: { turns: [] },
    extraEnv: {
      SABLE_E2E_TELEGRAM_TRIAGE_OUTPUT: [
        "Telegram queue review: 3 dialogs",
        "",
        "Needs reply now: 1",
        "- Important DM [direct; 1 unread; 2m ago] — can you send the doc?",
      ].join("\n"),
    },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("Telegram queue review: 3 dialogs"),
      "telegram triage reply"
    );

    assert.match(reply.params.message, /Needs reply now: 1/);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/telegram with an explicit limit forwards the parsed limit to the local triage command", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/telegram 7",
        },
      ],
    },
    codexScenario: { turns: [] },
    extraEnv: ({ tempRoot }) => {
      const fakeTelegramPythonPath = path.join(tempRoot, "fake-telegram-python");
      fs.writeFileSync(
        fakeTelegramPythonPath,
        "#!/bin/sh\nshift\nprintf 'argv:%s\\n' \"$*\"\n",
        "utf8"
      );
      fs.chmodSync(fakeTelegramPythonPath, 0o755);
      return {
        SABLE_TELEGRAM_PYTHON_BIN: fakeTelegramPythonPath,
      };
    },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("argv:triage --limit 7"),
      "telegram triage reply with explicit limit"
    );

    assert.match(reply.params.message, /argv:triage --limit 7 --stale-days \d+/);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});
