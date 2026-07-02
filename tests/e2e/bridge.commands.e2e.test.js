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

function createFakeCommandRecorder({ tempRoot, binDirName, binaryName, logFileName, output }) {
  const binDir = path.join(tempRoot, binDirName);
  const logPath = path.join(tempRoot, logFileName);
  fs.mkdirSync(binDir, { recursive: true });
  const binaryPath = path.join(binDir, binaryName);
  fs.writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$PWD" "$@" > ${JSON.stringify(logPath)}`,
      `printf '%s\\n' ${JSON.stringify(output)}`,
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(binaryPath, 0o755);
  return { binaryPath, logPath };
}

function createFakeTelegramCleanupRecorder({ tempRoot }) {
  const binaryPath = path.join(tempRoot, "fake-telegram-python");
  const logPath = path.join(tempRoot, "telegram-cleanup-invocations.txt");
  fs.writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}`,
      'if [ "$2" = "cleanup-solicitations" ]; then',
      "  printf '%s\\n' '{\"ok\":true,\"cleaned_count\":1,\"skipped_count\":0}'",
      "else",
      "  printf '%s\\n' 'Telegram queue review: 2 dialogs'",
      "fi",
      "",
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(binaryPath, 0o755);
  return { binaryPath, logPath };
}

test("/help returns the live command list without starting a Codex turn", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/help",
        },
      ],
    },
    codexScenario: { turns: [] },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("Sable commands:") &&
        request.params.message.includes("/ops - Show bridge, scheduler, research") &&
        request.params.message.includes("/plugins - Show discovered official/local plugins") &&
        request.params.message.includes("/whatsapp [limit] - Review approved WhatsApp chats") &&
        request.params.message.includes("/setavatar - Use the first attached image"),
      "help reply"
    );

    assert.match(reply.params.message, /\/authresume - Resume the saved prompt/);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

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
        request.params.message.includes("runnable=0") &&
        request.params.message.includes("budget-exhausted=1") &&
        request.params.message.includes("usage: not surfaced by Codex yet"),
      "ops report reply"
    );

    assert.match(reply.params.message, /host flags: lingering=/);
    assert.match(reply.params.message, /scheduler: \d+ active/);
    assert.match(reply.params.message, /Research watchlist:/);
    assert.match(reply.params.message, /darkbloom\/stalled-run: active/);

    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/unschedule refuses default workflows without starting a Codex turn", async () => {
  let defaultSchedulerJobsPath = "";
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/unschedule default-dreaming",
        },
      ],
    },
    codexScenario: { turns: [] },
    extraEnv: ({ tempRoot }) => {
      defaultSchedulerJobsPath = path.join(tempRoot, "default-scheduler-jobs.json");
      fs.writeFileSync(
        defaultSchedulerJobsPath,
        `${JSON.stringify(
          {
            jobs: [
              {
                id: "default-dreaming",
                active: true,
                recurrence: { type: "daily" },
                time: { hour: 5, minute: 0, text: "5:00 AM" },
                workflowPrompt: "Run Sable's conservative dreaming workflow",
                scheduleKind: "default",
              },
            ],
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      return {
        SABLE_DEFAULT_SCHEDULER_JOBS_PATH: defaultSchedulerJobsPath,
      };
    },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("Default workflow default-dreaming is managed by Sable's default scheduler file"),
      "protected default unschedule reply"
    );

    assert.match(reply.params.message, /Disable or edit it there instead of using \/unschedule/);
    const storedDefaults = JSON.parse(fs.readFileSync(defaultSchedulerJobsPath, "utf8"));
    assert.deepEqual(storedDefaults.jobs.map((job) => job.id), ["default-dreaming"]);
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

test("/telegram auto-cleans solicitation spam before triage when enabled", async () => {
  let invocationLogPath = "";
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/telegram 3",
        },
      ],
    },
    codexScenario: { turns: [] },
    extraEnv: ({ tempRoot }) => {
      const fakeTelegram = createFakeTelegramCleanupRecorder({ tempRoot });
      invocationLogPath = fakeTelegram.logPath;
      return {
        SABLE_TELEGRAM_AUTO_CLEANUP_SOLICITATIONS: "true",
        SABLE_TELEGRAM_AUTO_CLEANUP_LIMIT: "50",
        SABLE_TELEGRAM_PYTHON_BIN: fakeTelegram.binaryPath,
      };
    },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("Telegram solicitation cleanup: blocked/deleted 1"),
      "telegram cleanup plus triage reply"
    );

    assert.match(reply.params.message, /Telegram queue review: 2 dialogs/);
    const invocations = fs.readFileSync(invocationLogPath, "utf8").trim().split("\n");
    assert.match(invocations[0], /cleanup-solicitations --limit 50$/);
    assert.match(invocations[1], /triage --limit 3 --stale-days 21$/);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/telegram uses instance repo defaults for the Telegram CLI cwd", async () => {
  let telegramLogPath = "";
  let repoRoot = "";
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
      repoRoot = path.join(tempRoot, "sable-core");
      fs.mkdirSync(path.join(repoRoot, "tools", "telegram"), { recursive: true });
      const fakePython = createFakeCommandRecorder({
        tempRoot,
        binDirName: "telegram-bin",
        binaryName: "fake-python",
        logFileName: "telegram-invocation.txt",
        output: "Telegram queue review: 0 dialogs",
      });
      telegramLogPath = fakePython.logPath;
      return {
        SABLE_REPO_ROOT: repoRoot,
        SABLE_TELEGRAM_PYTHON_BIN: fakePython.binaryPath,
      };
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("Telegram queue review: 0 dialogs"),
      "telegram triage reply from fake python"
    );

    const invocation = fs.readFileSync(telegramLogPath, "utf8").trim().split("\n");
    assert.equal(invocation[0], repoRoot);
    assert.equal(invocation[1], path.join(repoRoot, "tools", "telegram", "telegram_cli.py"));
    assert.deepEqual(invocation.slice(2), ["triage", "--limit", "7", "--stale-days", "21"]);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/whatsapp returns approved-chat triage output without starting a Codex turn", async () => {
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/whatsapp",
        },
      ],
    },
    codexScenario: { turns: [] },
    extraEnv: {
      SABLE_E2E_WHATSAPP_TRIAGE_OUTPUT: [
        "WhatsApp queue review: 1 approved chat surfaced.",
        "Needs reply now: 1",
        "- Close Friend unread=1 - landing soon?",
      ].join("\n"),
    },
  });

  try {
    const reply = await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("WhatsApp queue review: 1 approved chat surfaced."),
      "whatsapp triage reply"
    );

    assert.match(reply.params.message, /Close Friend/);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});

test("/whatsapp limit invokes the configured WhatsApp CLI without starting a Codex turn", async () => {
  let repoRoot;
  let whatsappLogPath;
  const harness = await startBridgeScenario({
    signalScenario: {
      receive: [
        {
          delayMs: 50,
          sender: "+15551112222",
          message: "/whatsapp 4",
        },
      ],
    },
    codexScenario: { turns: [] },
    extraEnv: ({ tempRoot }) => {
      repoRoot = path.join(tempRoot, "sable-core");
      fs.mkdirSync(path.join(repoRoot, "tools", "whatsapp"), { recursive: true });
      const fakeNode = createFakeCommandRecorder({
        tempRoot,
        binDirName: "whatsapp-bin",
        binaryName: "fake-node",
        logFileName: "whatsapp-invocation.txt",
        output: "WhatsApp queue review: 0 approved chats surfaced.",
      });
      whatsappLogPath = fakeNode.logPath;
      return {
        SABLE_REPO_ROOT: repoRoot,
        SABLE_WHATSAPP_NODE_BIN: fakeNode.binaryPath,
      };
    },
  });

  try {
    await harness.waitForSignalRequest(
      (request) =>
        request.method === "send" &&
        typeof request.params?.message === "string" &&
        request.params.message.includes("WhatsApp queue review: 0 approved chats surfaced."),
      "whatsapp triage reply from fake node"
    );

    const invocation = fs.readFileSync(whatsappLogPath, "utf8").trim().split("\n");
    assert.equal(invocation[0], repoRoot);
    assert.equal(invocation[1], path.join(repoRoot, "tools", "whatsapp", "whatsapp_cli.js"));
    assert.deepEqual(invocation.slice(2), ["triage", "--limit", "4", "--stale-days", "21"]);
    await assertNoCodexTurnStarted(harness);
  } finally {
    await harness.shutdown();
  }
});
