const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDefaultScheduledWorkflowJobs } = require("../apps/signal-bridge/scheduler");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(PROJECT_ROOT, "apps", "signal-bridge", "scheduler_cli.js");

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      [CLI_PATH, ...args],
      {
        env: {
          ...process.env,
          ...env,
        },
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new Error(stderr || error.message);
          failure.stdout = stdout;
          failure.stderr = stderr;
          failure.code = error.code;
          reject(failure);
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

test("scheduler cli can add, list, and remove recurring workflows", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduler-cli-"));
  const filePath = path.join(tempDir, "scheduler-jobs.json");

  try {
    const addResult = await runCli([
      "add",
      "--file",
      filePath,
      "--sender",
      "+15551112222",
      "--recurrence",
      "weekly",
      "--day",
      "monday",
      "--time",
      "9:00AM",
      "--prompt",
      "Generate a grocery list for me",
    ]);

    assert.equal(typeof addResult.stdout, "string");

    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(stored.jobs.length, 1);
    const scheduleId = stored.jobs[0].id;
    assert.match(scheduleId, /^sched-/);
    assert.equal(stored.jobs[0].workflowPrompt, "Generate a grocery list for me");
    assert.equal(stored.jobs[0].recurrence.type, "weekly");
    assert.equal(stored.jobs[0].recurrence.dayOfWeek, 1);
    assert.equal(stored.jobs[0].time.text, "9:00 AM");

    const removeResult = await runCli(["remove", "--file", filePath, "--id", scheduleId]);
    assert.equal(typeof removeResult.stdout, "string");

    const storedAfterRemove = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(storedAfterRemove.jobs.length, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("scheduler cli supports interval recurring workflows", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduler-cli-interval-"));
  const filePath = path.join(tempDir, "scheduler-jobs.json");

  try {
    await runCli([
      "add",
      "--file",
      filePath,
      "--sender",
      "+15551112222",
      "--recurrence",
      "interval",
      "--minutes",
      "5",
      "--prompt",
      "Run the autoresearch loop tick",
      "--silent",
      "true",
    ]);

    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(stored.jobs.length, 1);
    assert.equal(stored.jobs[0].recurrence.type, "interval");
    assert.equal(stored.jobs[0].recurrence.intervalMinutes, 5);
    assert.equal(stored.jobs[0].replyMode, "silent");
    assert.equal(stored.jobs[0].workflowPrompt, "Run the autoresearch loop tick");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("scheduler cli default jobs path follows instance config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduler-cli-instance-"));
  const tasksRoot = path.join(tempDir, "tasks");
  const filePath = path.join(tasksRoot, "projects", "sable", "scheduler-jobs.json");

  try {
    await runCli(
      [
        "add",
        "--sender",
        "+15551112222",
        "--recurrence",
        "daily",
        "--time",
        "8:00AM",
        "--prompt",
        "Run the morning brief",
      ],
      {
        SABLE_TASKS_ROOT: tasksRoot,
        SABLE_SCHEDULER_JOBS_PATH: "",
      }
    );

    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(stored.jobs.length, 1);
    assert.equal(stored.jobs[0].workflowPrompt, "Run the morning brief");
    assert.equal(stored.jobs[0].recurrence.type, "daily");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("default memory eval archives completed autoresearch before health checks", () => {
  const jobs = createDefaultScheduledWorkflowJobs({
    now: new Date("2026-05-10T00:00:00.000Z"),
  });

  const memoryEval = jobs.find((job) => job.id === "default-memory-eval");

  assert.equal(memoryEval.replyMode, "silent");
  assert.match(memoryEval.workflowPrompt, /npm run autoresearch:archive-completed/);
  assert.match(memoryEval.workflowPrompt, /npm run memory:health -- --write-dir memory\/knowledge\/projects\/memory\/metrics/);
  assert.ok(
    memoryEval.workflowPrompt.indexOf("npm run autoresearch:archive-completed") <
      memoryEval.workflowPrompt.indexOf("npm run memory:health"),
    "completed autoresearch runs should be archived before memory health metrics are generated"
  );
});

test("scheduler cli lists default and local scheduled workflows separately", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduler-cli-defaults-"));
  const filePath = path.join(tempDir, "scheduler-jobs.json");
  const defaultFilePath = path.join(tempDir, "default-scheduler-jobs.json");

  try {
    await fs.writeFile(
      defaultFilePath,
      JSON.stringify({
        jobs: [
          {
            id: "default-dreaming",
            active: true,
            recurrence: { type: "daily" },
            time: { text: "3:30 AM" },
            nextRunAt: "2999-01-01T00:00:00.000Z",
            replyMode: "silent",
            workflowPrompt: "Run dreaming",
            scheduleKind: "default",
          },
        ],
      }),
      "utf8"
    );
    await runCli([
      "add",
      "--file",
      filePath,
      "--sender",
      "+15551112222",
      "--recurrence",
      "daily",
      "--time",
      "8:00AM",
      "--prompt",
      "Run the morning brief",
    ]);

    const listResult = await runCli(["list", "--file", filePath, "--default-file", defaultFilePath]);
    assert.match(listResult.stdout, /default-dreaming \[default\]/);
    assert.match(listResult.stdout, /sched-.+ \[local\]/);
    assert.match(listResult.stdout, /Run the morning brief/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("scheduler cli protects default workflows unless explicitly included", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduler-cli-default-protect-"));
  const filePath = path.join(tempDir, "scheduler-jobs.json");
  const defaultFilePath = path.join(tempDir, "default-scheduler-jobs.json");

  try {
    await fs.writeFile(
      defaultFilePath,
      JSON.stringify({
        jobs: [
          {
            id: "default-dreaming",
            active: true,
            recurrence: { type: "daily" },
            time: { text: "3:30 AM" },
            nextRunAt: "2999-01-01T00:00:00.000Z",
            replyMode: "silent",
            workflowPrompt: "Run dreaming",
            scheduleKind: "default",
          },
        ],
      }),
      "utf8"
    );
    await fs.writeFile(filePath, "{\"jobs\":[]}\n", "utf8");

    await assert.rejects(
      runCli(["remove", "--file", filePath, "--default-file", defaultFilePath, "--id", "default-dreaming"]),
      /Refusing to remove default workflow default-dreaming/
    );

    const afterRejected = JSON.parse(await fs.readFile(defaultFilePath, "utf8"));
    assert.equal(afterRejected.jobs.length, 1);

    await runCli([
      "remove",
      "--file",
      filePath,
      "--default-file",
      defaultFilePath,
      "--id",
      "default-dreaming",
      "--include-defaults",
      "true",
    ]);

    const afterIncluded = JSON.parse(await fs.readFile(defaultFilePath, "utf8"));
    assert.equal(afterIncluded.jobs.length, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
