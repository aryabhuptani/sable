const fs = require("node:fs");
const test = require("node:test");

const {
  assert,
  extractSentMessages,
  fsp,
  path,
  startBridgeScenario,
  waitFor,
} = require("./helpers/bridge-harness");

const EMPTY_TURN_SCENARIO_ENV = {
  SABLE_E2E_TURN_SCENARIO_PATH: "",
  SABLE_E2E_TURN_CURSOR_PATH: "",
};

async function assertNoCodexTurnStarted(harness) {
  const codexRequests = await harness.getCodexRequests();
  assert.equal(codexRequests.find((request) => request.method === "turn/start"), undefined);
}

test("/schedules lists persisted recurring workflows", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/schedules",
        },
      ],
    },
    codexScenario: { turns: [] },
    initialSchedulerJobs: [
      {
        id: "sched-daily-brief",
        sender: "+15551112222",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        active: true,
        recurrence: { type: "daily" },
        time: { hour: 8, minute: 0, text: "8:00 AM" },
        workflowPrompt: "Give me a daily briefing of my day",
        nextRunAt: "2026-04-18T07:00:00.000Z",
        lastRunAt: "",
      },
      {
        id: "sched-background-maintenance",
        sender: "+15551112222",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        active: true,
        recurrence: { type: "interval", intervalMinutes: 5 },
        replyMode: "silent",
        workflowPrompt: "Run passive background maintenance",
        nextRunAt: "2026-04-18T07:05:00.000Z",
        lastRunAt: "",
      },
    ],
  });

  try {
    const listing = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("sched-daily-brief: every day at 8:00 AM"),
      "schedule listing"
    );

    assert.match(listing.params.message, /Give me a daily briefing of my day/);
    assert.match(
      listing.params.message,
      /sched-background-maintenance: every 5 minutes \[silent\]/
    );
    assert.match(listing.params.message, /reply mode: silent/);
    assert.match(listing.params.message, /Run passive background maintenance/);

    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("due scheduled workflows run in the background without blocking live chat turns", async () => {
  const pastDue = new Date(Date.now() - 60_000).toISOString();
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 150,
          sender: "+15551112222",
          message: "hello from live chat",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message: "scheduled daily briefing",
          messageDelayMs: 400,
        },
        {
          message: "interactive reply",
          messageDelayMs: 40,
        },
      ],
    },
    initialSchedulerJobs: [
      {
        id: "sched-daily-brief",
        sender: "+15551112222",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        active: true,
        recurrence: { type: "daily" },
        time: { hour: 8, minute: 0, text: "8:00 AM" },
        workflowPrompt: "Give me a daily briefing of my day",
        nextRunAt: pastDue,
        lastRunAt: "",
      },
    ],
  });

  try {
    await waitFor(
      async () =>
        (await harness.getCodexRequests()).filter((request) => request.method === "turn/start")
          .length >= 2,
      { description: "both scheduled and interactive turn starts" }
    );

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" && request.params?.message === "scheduled daily briefing",
      "scheduled workflow reply"
    );
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" && request.params?.message === "interactive reply",
      "interactive reply"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.equal(sentMessages.includes("Queued, will process after current task."), false);

    const stored = JSON.parse(await fsp.readFile(harness.schedulerJobsPath, "utf8"));
    assert.equal(stored.jobs[0].lastRunAt.length > 0, true);
    assert.notEqual(stored.jobs[0].nextRunAt, pastDue);

    const state = JSON.parse(await fsp.readFile(harness.statePath, "utf8"));
    assert.equal(typeof state.backgroundSessionId, "string");
    assert.equal(typeof state.interactiveSessionId, "string");
    assert.notEqual(state.backgroundSessionId, state.interactiveSessionId);
  } finally {
    await harness.shutdown();
  }
});

test("scheduled workflows suppress live progress chatter while still sending the final result", async () => {
  const pastDue = new Date(Date.now() - 60_000).toISOString();
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: {
      turns: [
        {
          notifications: [
            {
              delayMs: 40,
              message: {
                jsonrpc: "2.0",
                method: "turn/started",
                params: {},
              },
            },
            {
              delayMs: 80,
              message: {
                jsonrpc: "2.0",
                method: "item/mcpToolCall/progress",
                params: {
                  message: "Reading repo state...",
                },
              },
            },
            {
              delayMs: 120,
              message: {
                jsonrpc: "2.0",
                method: "item/completed",
                params: {
                  item: {
                    type: "agentMessage",
                    status: "completed",
                    text: "scheduled maintenance finished",
                  },
                },
              },
            },
            {
              delayMs: 160,
              message: {
                jsonrpc: "2.0",
                method: "turn/completed",
                params: {},
              },
            },
          ],
        },
      ],
    },
    initialSchedulerJobs: [
      {
        id: "sched-maintenance",
        sender: "+15551112222",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
        active: true,
        recurrence: { type: "daily" },
        time: { hour: 8, minute: 0, text: "8:00 AM" },
        workflowPrompt: "Run passive background maintenance.",
        nextRunAt: pastDue,
        lastRunAt: "",
      },
    ],
    extraEnv: EMPTY_TURN_SCENARIO_ENV,
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "scheduled maintenance finished",
      "scheduled workflow final result"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.deepEqual(sentMessages, ["scheduled maintenance finished"]);
  } finally {
    await harness.shutdown();
  }
});

test("scheduler picks up jobs added on disk after the bridge has already started", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: {
      turns: [
        {
          message: "late-added scheduled briefing",
          messageDelayMs: 40,
        },
      ],
    },
    extraEnv: EMPTY_TURN_SCENARIO_ENV,
  });

  try {
    const pastDue = new Date(Date.now() - 60_000).toISOString();
    await fsp.writeFile(
      harness.schedulerJobsPath,
      `${JSON.stringify({
        jobs: [
          {
            id: "sched-late-added",
            sender: "+15551112222",
            createdAt: "2026-04-17T07:59:00.000Z",
            updatedAt: "2026-04-17T07:59:00.000Z",
            active: true,
            recurrence: { type: "daily" },
            time: { hour: 8, minute: 0, text: "8:00 AM" },
            workflowPrompt: "Give me the late-added daily briefing",
            nextRunAt: pastDue,
            lastRunAt: "",
          },
        ],
      }, null, 2)}\n`,
      "utf8"
    );

    const turnStart = await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "late-added scheduled turn start"
    );
    const promptText = turnStart.params?.input?.[0]?.text || "";
    assert.match(promptText, /Give me the late-added daily briefing/);

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" && request.params?.message === "late-added scheduled briefing",
      "late-added scheduled workflow reply"
    );

    const stored = JSON.parse(await fsp.readFile(harness.schedulerJobsPath, "utf8"));
    assert.equal(stored.jobs[0].lastRunAt.length > 0, true);
    assert.notEqual(stored.jobs[0].nextRunAt, pastDue);
  } finally {
    await harness.shutdown();
  }
});

test("stale interval schedules advance to the future after downtime", async () => {
  const staleDue = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: {
      turns: [
        {
          message: "__SABLE_NO_REPLY__",
          messageDelayMs: 40,
        },
      ],
    },
    initialSchedulerJobs: [
      {
        id: "sched-stale-interval",
        sender: "+15551112222",
        createdAt: staleDue,
        updatedAt: staleDue,
        active: true,
        recurrence: { type: "interval", intervalMinutes: 5 },
        replyMode: "silent",
        workflowPrompt: "Run stale interval maintenance once.",
        nextRunAt: staleDue,
        lastRunAt: "",
      },
    ],
  });

  try {
    await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "stale interval scheduled turn start"
    );

    await waitFor(
      async () => {
        const stored = JSON.parse(await fsp.readFile(harness.schedulerJobsPath, "utf8"));
        const nextRunMs = Date.parse(stored.jobs[0].nextRunAt);
        return Number.isFinite(nextRunMs) && nextRunMs > Date.now();
      },
      { description: "stale interval schedule advanced past now" }
    );
  } finally {
    await harness.shutdown();
  }
});

test("scheduled workflows in silent mode suppress bridge replies", async () => {
  const pastDue = new Date(Date.now() - 60_000).toISOString();
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: {
      turns: [
        {
          message: "silent background work finished",
          messageDelayMs: 40,
        },
      ],
    },
    initialSchedulerJobs: [
      {
        id: "sched-silent-noop",
        sender: "+15551112222",
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        active: true,
        recurrence: { type: "daily" },
        time: { hour: 8, minute: 0, text: "8:00 AM" },
        replyMode: "silent",
        workflowPrompt: "Check whether any autoresearch runs are active and no-op if not.",
        nextRunAt: pastDue,
        lastRunAt: "",
      },
    ],
  });

  try {
    await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "silent scheduled turn start"
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.equal(sentMessages.includes("silent background work finished"), false);
    assert.equal(sentMessages.length, 0);
  } finally {
    await harness.shutdown();
  }
});

test("completed autoresearch runs send per-run and final aggregate notices even from silent background mode", async () => {
  const pastDue = new Date(Date.now() - 60_000).toISOString();
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: {
      turns: [
        {
          message: "__SABLE_NO_REPLY__",
          messageDelayMs: 300,
        },
      ],
    },
    extraEnv: ({ tempRoot }) => ({
      SABLE_SCHEDULER_POLL_INTERVAL_MS: "500",
      SABLE_RESEARCH_ROOT: path.join(tempRoot, "research"),
    }),
  });

  try {
    const researchRoot = path.join(harness.tempRoot, "research");
    const runRoot = path.join(
      researchRoot,
      "darkbloom",
      "autoresearch",
      "active",
      "privacy-audit"
    );
    await fsp.mkdir(path.join(researchRoot, "darkbloom", "wiki"), { recursive: true });
    await fsp.mkdir(runRoot, { recursive: true });
    await fsp.writeFile(
      path.join(runRoot, "STATE.json"),
      `${JSON.stringify(
        {
          topicSlug: "darkbloom",
          runSlug: "privacy-audit",
          status: "active",
          rootQuestion: "How does Dark Bloom privacy fail?",
          pendingQuestions: [{ id: "q1", question: "pending" }],
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await fsp.writeFile(path.join(runRoot, "LOG.md"), "# Run Log\n", "utf8");
    await fsp.writeFile(path.join(researchRoot, "darkbloom", "wiki", "index.md"), "# Index\n", "utf8");
    await fsp.writeFile(
      harness.schedulerJobsPath,
      `${JSON.stringify(
        {
          jobs: [
            {
              id: "sched-autoresearch",
              sender: "+15551112222",
              createdAt: "2026-04-17T00:00:00.000Z",
              updatedAt: "2026-04-17T00:00:00.000Z",
              active: true,
              recurrence: { type: "interval", intervalMinutes: 5 },
              replyMode: "silent",
              workflowPrompt:
                "Run the bounded autoresearch tick for Sable. First read /home/arya/memory/knowledge/research/AUTORESEARCH.md.",
              nextRunAt: pastDue,
              lastRunAt: "",
            },
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "autoresearch background turn start"
    );

    await fsp.writeFile(
      path.join(runRoot, "STATE.json"),
      `${JSON.stringify(
        {
          topicSlug: "darkbloom",
          runSlug: "privacy-audit",
          status: "completed",
          rootQuestion: "How does Dark Bloom privacy fail?",
          pendingQuestions: [],
          processedQuestions: [
            {
              id: "q1",
              question: "Can provider responses still reach the coordinator in plaintext?",
              notes: [
                "Verified that the live provider response path still forwards plaintext chunk data to the coordinator.",
                "Promoted the split between crypto-layer intent and live plaintext behavior into the wiki.",
              ],
            },
            {
              id: "q2",
              question: "Can missing runtime hashes or softer trust floors keep providers routable?",
              notes: [
                "Verified that Open Mode and self-signed providers can become routable once the operator lowers the trust floor.",
                "Verified that missing runtime hashes can bypass comparison instead of failing closed.",
              ],
            },
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const completionNotice = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("Autoresearch completed for Darkbloom."),
      "autoresearch completion notice"
    );

    assert.match(completionNotice.params.message, /Conclusions:/);
    assert.match(
      completionNotice.params.message,
      /Response confidentiality is still the weakest live boundary: the provider response path remains plaintext to the coordinator today\./
    );
    assert.match(completionNotice.params.message, /Follow-ups:/);
    assert.match(
      completionNotice.params.message,
      /Audit Open Mode, missing-hash handling, and trust-floor overrides with proof-of-concept attempts/
    );
    assert.match(completionNotice.params.message, /Wiki index:/);
    assert.match(completionNotice.params.message, /Run log:/);

    const finalNotice = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("All active autoresearch work is complete for Darkbloom."),
      "autoresearch all-complete notice"
    );

    assert.match(
      finalNotice.params.message,
      /Final completed run: Privacy Audit\./
    );
    assert.match(
      finalNotice.params.message,
      /The active autoresearch frontier is now empty, so this is the handoff point to review findings and choose the next phase\./
    );
    assert.match(finalNotice.params.message, /Review starting point:/);

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.equal(sentMessages.includes("__SABLE_NO_REPLY__"), false);
    assert.deepEqual(sentMessages.slice(-2), [
      completionNotice.params.message,
      finalNotice.params.message,
    ]);
  } finally {
    await harness.shutdown();
  }
});

test("scheduled workflows can attach local KB screenshots as image inputs", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: {
      turns: [
        {
          message: "scheduled screenshot ingest complete",
          messageDelayMs: 40,
        },
      ],
    },
  });

  try {
    const kbRoot = path.join(harness.tempRoot, "research", "screenshots-topic");
    const assetDir = path.join(kbRoot, "raw", "assets");
    const screenshotPath = path.join(assetDir, "tweet.png");
    await fsp.mkdir(assetDir, { recursive: true });
    await fsp.writeFile(screenshotPath, "fake-image-bytes", "utf8");

    const pastDue = new Date(Date.now() - 60_000).toISOString();
    await fsp.writeFile(
      harness.schedulerJobsPath,
      `${JSON.stringify({
        jobs: [
          {
            id: "sched-kb-images",
            sender: "+15551112222",
            createdAt: "2026-04-17T08:00:00.000Z",
            updatedAt: "2026-04-17T08:00:00.000Z",
            active: true,
            recurrence: { type: "daily" },
            time: { hour: 8, minute: 0, text: "8:00 AM" },
            workflowPrompt: `Review screenshot assets in ${kbRoot} and ingest anything useful.`,
            nextRunAt: pastDue,
            lastRunAt: "",
          },
        ],
      }, null, 2)}\n`,
      "utf8"
    );

    const turnStart = await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "scheduled screenshot turn start"
    );
    const inputItems = turnStart.params?.input || [];
    const imageItem = inputItems.find((item) => item?.type === "localImage");
    assert.ok(imageItem);
    assert.match(imageItem.path, /tweet\.png$/);

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "scheduled screenshot ingest complete",
      "scheduled screenshot reply"
    );
  } finally {
    await harness.shutdown();
  }
});

test("scheduled workflows can ingest local KB inbox files through the normal file path", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: {
      turns: [
        {
          message: "scheduled inbox file ingest complete",
          messageDelayMs: 40,
        },
      ],
    },
  });

  try {
    const kbRoot = path.join(harness.tempRoot, "research", "pdf-topic");
    const inboxDir = path.join(kbRoot, "raw", "inbox");
    const notePath = path.join(inboxDir, "source-note.md");
    await fsp.mkdir(inboxDir, { recursive: true });
    await fsp.writeFile(notePath, "# Source Note\n\nKey insight from the inbox.", "utf8");

    const pastDue = new Date(Date.now() - 60_000).toISOString();
    await fsp.writeFile(
      harness.schedulerJobsPath,
      `${JSON.stringify({
        jobs: [
          {
            id: "sched-kb-files",
            sender: "+15551112222",
            createdAt: "2026-04-17T08:00:00.000Z",
            updatedAt: "2026-04-17T08:00:00.000Z",
            active: true,
            recurrence: { type: "daily" },
            time: { hour: 8, minute: 0, text: "8:00 AM" },
            workflowPrompt: `Review inbox sources in ${kbRoot} and ingest anything useful.`,
            nextRunAt: pastDue,
            lastRunAt: "",
          },
        ],
      }, null, 2)}\n`,
      "utf8"
    );

    const turnStart = await harness.waitForCodexRequest(
      (request) =>
        request.method === "turn/start" &&
        Array.isArray(request.params?.input) &&
        request.params.input[0]?.text?.includes("Attached file context:"),
      "scheduled inbox file turn start"
    );
    const promptText = turnStart.params?.input?.[0]?.text || "";
    assert.match(promptText, /source-note\.md/);
    assert.match(promptText, /Key insight from the inbox\./);

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "scheduled inbox file ingest complete",
      "scheduled inbox file reply"
    );
  } finally {
    await harness.shutdown();
  }
});

test("second inbound message queues while the first turn is still running", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "first",
        },
        {
          delayMs: 80,
          sender: "+15551112222",
          message: "second",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message: "first done",
          messageDelayMs: 220,
          completedDelayMs: 240,
        },
        {
          message: "second done",
          messageDelayMs: 40,
        },
      ],
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "Queued, will process after current task.",
      "queue acknowledgement"
    );
    await harness.waitForSignalRequest(
      (request) => request.method === "send" && request.params?.message === "second done",
      "second final reply"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(sentMessages.includes("first done"));
    assert.ok(sentMessages.includes("second done"));
  } finally {
    await harness.shutdown();
  }
});

test("SIGTERM during an active turn lets the turn finish before restart", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "please keep going",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message: "finished after shutdown request",
          messageDelayMs: 180,
          completedDelayMs: 220,
        },
      ],
    },
  });

  try {
    await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "turn start request"
    );

    harness.sendSignal("SIGTERM");

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "finished after shutdown request",
      "final reply after SIGTERM"
    );

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "🟡 Restarting Connection to Sable",
      "restart notice after graceful drain"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(sentMessages.includes("finished after shutdown request"));
    assert.ok(!sentMessages.includes("Request failed before Sable could complete."));

    await harness.waitForExit("bridge exit after graceful shutdown");
  } finally {
    await harness.shutdown();
  }
});

test("new inbound work is rejected once restart drain has started", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "first task",
        },
        {
          delayMs: 130,
          sender: "+15551112222",
          message: "second task",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message: "first task finished",
          messageDelayMs: 220,
          completedDelayMs: 260,
        },
      ],
    },
  });

  try {
    await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "first turn start request"
    );

    harness.sendSignal("SIGTERM");

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message ===
          "Restart in progress. I'm finishing the current task before reconnecting, so please resend after Sable is back.",
      "restart-drain rejection message"
    );

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "first task finished",
      "first task final reply"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(sentMessages.includes("first task finished"));
    assert.ok(
      sentMessages.includes(
        "Restart in progress. I'm finishing the current task before reconnecting, so please resend after Sable is back."
      )
    );
    assert.ok(!sentMessages.includes("Queued, will process after current task."));

    const codexRequests = await harness.getCodexRequests();
    const turnStarts = codexRequests.filter((request) => request.method === "turn/start");
    assert.equal(turnStarts.length, 1);
  } finally {
    await harness.shutdown();
  }
});

test("a pending restart notice is replayed on the next startup", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: { turns: [] },
  });

  try {
    await fsp.writeFile(harness.restartNoticePath, "pending restart notice\n", "utf8");
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "🟢 Reconnected to Sable",
      "reconnect notice after startup"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(sentMessages.includes("🟢 Reconnected to Sable"));
  } finally {
    await harness.shutdown();
  }
});

test("bridge stays up after deferred startup hooks run", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: { turns: [] },
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 2_700));
    assert.equal(harness.isRunning(), true);
  } finally {
    await harness.shutdown();
  }
});

test("an interrupted in-flight turn is explained on the next startup", async () => {
  const harness = await startBridgeScenario({
    signalScenario: { receive: [] },
    codexScenario: { turns: [] },
  });

  try {
    await fsp.writeFile(
      harness.statePath,
      `${JSON.stringify({
        lastSessionId: "thread-123",
        pendingPluginAuth: null,
        inFlightTurn: {
          sender: "+15551112222",
          startedAt: "2026-04-15T18:00:00.000Z",
          promptPreview: "please continue the interrupted thing",
        },
      }, null, 2)}\n`,
      "utf8"
    );
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes(
          "Previous reply was interrupted by a bridge restart before Sable could finish."
        ),
      "interrupted-turn notice after startup"
    );

    const sentMessages = extractSentMessages(await harness.getSignalRequests());
    assert.ok(
      sentMessages.some((message) =>
        message.includes("Ask me to continue and I'll pick it back up if the session survived.")
      )
    );
    assert.ok(
      sentMessages.some((message) =>
        message.includes("Last prompt: please continue the interrupted thing")
      )
    );
  } finally {
    await harness.shutdown();
  }
});

test("bridge launches codex app-server with the bypass flags we proved work", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "hello",
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message: "hi from sable",
          messageDelayMs: 40,
        },
      ],
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) => request.method === "send" && request.params?.message === "hi from sable",
      "final text reply"
    );

    const codexRequests = await harness.getCodexRequests();
    const spawnEntry = codexRequests.find((request) => request.method === "spawn");
    assert.ok(spawnEntry, "expected the app-server spawn entry to be logged");
    const threadEntry = codexRequests.find((request) => request.method === "thread/start");
    assert.ok(threadEntry, "expected the app-server thread/start entry to be logged");
    assert.deepStrictEqual(spawnEntry.params.args, [
      "--search",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      "/home/arya",
      "-c",
      "shell_environment_policy.inherit=all",
      "app-server",
      "--listen",
      "stdio://",
    ]);
    assert.equal(threadEntry.params.sandbox, "danger-full-access");
  } finally {
    await harness.shutdown();
  }
});

test("incoming Signal image attachments start a turn with the default image prompt and local image input", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "",
          attachments: [
            {
              id: "image-1",
              filename: "photo.png",
              contentType: "image/png",
            },
          ],
        },
      ],
      attachments: {
        "image-1": {
          dataBase64: Buffer.from("fake-image-bytes", "utf8").toString("base64"),
        },
      },
    },
    codexScenario: {
      turns: [
        {
          message: "image handled",
          messageDelayMs: 40,
        },
      ],
    },
  });

  try {
    const turnStart = await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "incoming image turn start"
    );
    const inputItems = turnStart.params?.input || [];
    const promptItem = inputItems.find((item) => item?.type === "text");
    const imageItem = inputItems.find((item) => item?.type === "localImage");

    assert.match(promptItem?.text || "", /^Please analyze the attached image\./);
    assert.match(promptItem?.text || "", /Local attachment paths for this turn only:/);
    assert.ok(imageItem, "expected a local image input item");
    assert.match(imageItem.path, /photo\.png$/);

    await harness.waitForSignalRequest(
      (request) => request.method === "send" && request.params?.message === "image handled",
      "incoming image final reply"
    );
  } finally {
    await harness.shutdown();
  }
});

test("file attachments expose a temporary local path to codex and clean it up afterward", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "please inspect this file",
          attachments: [
            {
              id: "file-1",
              filename: "notes.txt",
              contentType: "text/plain",
            },
          ],
        },
      ],
      attachments: {
        "file-1": {
          dataBase64: Buffer.from("hello from attachment", "utf8").toString("base64"),
        },
      },
    },
    codexScenario: {
      turns: [
        {
          message: "file analyzed",
          messageDelayMs: 60,
        },
      ],
    },
  });

  try {
    const turnStart = await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "turn start request"
    );
    const promptText = turnStart.params?.input?.[0]?.text || "";
    assert.match(promptText, /Local attachment paths for this turn only:/);

    const match = promptText.match(/-> (\/tmp\/[^\n]+notes\.txt)/);
    assert.ok(match, "expected a temp attachment path in the prompt");
    const tempPath = match[1];

    await harness.waitForSignalRequest(
      (request) => request.method === "send" && request.params?.message === "file analyzed",
      "file analysis reply"
    );

    await waitFor(
      async () => {
        try {
          await fsp.stat(tempPath);
          return null;
        } catch (error) {
          return error && error.code === "ENOENT" ? true : null;
        }
      },
      { description: "attachment cleanup" }
    );
  } finally {
    await harness.shutdown();
  }
});

test("plain-text file attachments are inlined into the prompt context", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "please use the attached notes",
          attachments: [
            {
              id: "file-1",
              filename: "notes.md",
              contentType: "text/markdown",
            },
          ],
        },
      ],
      attachments: {
        "file-1": {
          dataBase64: Buffer.from("# Notes\n\nalpha\nbeta\n", "utf8").toString("base64"),
        },
      },
    },
    codexScenario: {
      turns: [
        {
          message: "notes analyzed",
          messageDelayMs: 60,
        },
      ],
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" && request.params?.message === "Reading attached files...",
      "file-reading progress message"
    );

    const turnStart = await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "turn start request"
    );
    const promptText = turnStart.params?.input?.[0]?.text || "";
    assert.match(promptText, /Attached file context:/);
    assert.match(promptText, /\[File\] notes\.md \(text\/markdown\)/);
    assert.match(promptText, /alpha/);
    assert.match(promptText, /beta/);
    assert.match(promptText, /\[File\] notes\.md \(text\/markdown\) -> \/tmp\//);

    await harness.waitForSignalRequest(
      (request) => request.method === "send" && request.params?.message === "notes analyzed",
      "final text reply"
    );
  } finally {
    await harness.shutdown();
  }
});

test("unsupported binary file attachments warn but still expose the local path to codex", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "please inspect this blob",
          attachments: [
            {
              id: "file-1",
              filename: "blob.bin",
              contentType: "application/octet-stream",
            },
          ],
        },
      ],
      attachments: {
        "file-1": {
          dataBase64: Buffer.from([0, 159, 146, 150, 0, 1, 2, 3]).toString("base64"),
        },
      },
    },
    codexScenario: {
      turns: [
        {
          message: "blob analyzed via path",
          messageDelayMs: 60,
        },
      ],
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" && request.params?.message === "Reading attached files...",
      "file-reading progress message"
    );

    const warning = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes(
          "Unsupported attachment type for now: blob.bin (application/octet-stream)."
        ) &&
        request.params.message.includes(
          "I still exposed the local attachment path for this turn in case a tool can use the file directly."
        ),
      "unsupported-file warning"
    );
    assert.match(warning.params.message, /Unsupported attachment type for now/);

    const turnStart = await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "turn start request"
    );
    const promptText = turnStart.params?.input?.[0]?.text || "";
    assert.doesNotMatch(promptText, /Attached file context:/);
    assert.match(promptText, /\[File\] blob\.bin \(application\/octet-stream\) -> \/tmp\//);

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" && request.params?.message === "blob analyzed via path",
      "final text reply"
    );
  } finally {
    await harness.shutdown();
  }
});

test("voice note attachments are transcribed, echoed, and sent to codex as the prompt", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      attachments: {
        voice1: {
          dataBase64: Buffer.from("fake audio bytes").toString("base64"),
        },
      },
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "",
          attachments: [
            {
              id: "voice1",
              contentType: "audio/ogg",
              filename: "note.ogg",
            },
          ],
        },
      ],
    },
    codexScenario: {
      turns: [
        {
          message: "voice note handled",
          messageDelayMs: 40,
        },
      ],
    },
    extraEnv: ({ binDir }) => {
      const pythonShimPath = path.join(binDir, "python3");
      fs.writeFileSync(
        pythonShimPath,
        `#!/bin/bash
if [ "$1" = "-c" ]; then
  exit 0
fi
echo '{"ok":true,"transcript":"hello from the voice note"}'
`,
        "utf8"
      );
      fs.chmodSync(pythonShimPath, 0o755);
      return {
        ...EMPTY_TURN_SCENARIO_ENV,
      };
    },
  });

  try {
    const turnStart = await harness.waitForCodexRequest(
      (request) => request.method === "turn/start",
      "voice note turn start"
    );
    const promptText = turnStart.params?.input?.[0]?.text || "";
    assert.match(promptText, /hello from the voice note/);

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "Transcribing voice note...",
      "voice note transcription progress"
    );
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "hello from the voice note",
      "voice note transcript echo"
    );
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "voice note handled",
      "voice note final reply"
    );
  } finally {
    await harness.shutdown();
  }
});

test("/unschedule removes a persisted recurring workflow without spawning codex", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/unschedule sched-daily-brief",
        },
      ],
    },
    codexScenario: { turns: [] },
    initialSchedulerJobs: [
      {
        id: "sched-daily-brief",
        sender: "+15551112222",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        active: true,
        recurrence: { type: "daily" },
        time: { hour: 8, minute: 0, text: "8:00 AM" },
        workflowPrompt: "Give me a daily briefing of my day",
        nextRunAt: "2026-04-17T07:00:00.000Z",
        lastRunAt: "",
      },
    ],
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "Removed scheduled workflow sched-daily-brief.",
      "unschedule confirmation"
    );

    const stored = JSON.parse(await fsp.readFile(harness.schedulerJobsPath, "utf8"));
    assert.deepStrictEqual(stored.jobs, []);

    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/setavatar uses the live signal session instead of spawning a second signal-cli", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/setavatar",
          attachments: [
            {
              id: "img-1",
              filename: "avatar.png",
              contentType: "image/png",
            },
          ],
        },
      ],
      attachments: {
        "img-1": {
          dataBase64: Buffer.from("png-bytes", "utf8").toString("base64"),
        },
      },
    },
    codexScenario: {
      turns: [],
    },
  });

  try {
    const updateRequest = await harness.waitForSignalRequest(
      (request) => request.method === "updateProfile" && typeof request.params?.avatar === "string",
      "avatar update request"
    );
    assert.match(updateRequest.params.avatar, /\/tmp\/signal-codex-images-/);

    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        request.params?.message === "Updated Sable's Signal profile picture.",
      "avatar success reply"
    );

    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});
