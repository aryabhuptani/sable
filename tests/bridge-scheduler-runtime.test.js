const assert = require("node:assert/strict");
const test = require("node:test");

const { createBridgeSchedulerRuntime } = require("../apps/signal-bridge/bridge-scheduler-runtime");

function createRuntime(jobs, defaultJobs = [], overrides = {}) {
  const saved = {};
  const runtime = createBridgeSchedulerRuntime({
    buildAttachmentContext: (_envelope, sender, images, audio, files) => ({
      sender,
      images,
      audio,
      files,
    }),
    computeFollowingRunAt: overrides.computeFollowingRunAt || (() => "2026-05-04T11:00:00.000Z"),
    discoverFileAttachments: () => [{ path: "/tmp/file.txt" }],
    discoverImageAttachments: () => [{ path: "/tmp/image.png" }],
    defaultScheduledSender: "+1555",
    defaultSchedulerJobsPath: "/tmp/default-jobs.json",
    formatScheduleList: (items) => `schedules:${items.length}:${items.map((job) => job.scheduleKind).join(",")}`,
    loadSchedulerJobs: (filePath) => (filePath.includes("default") ? defaultJobs : jobs),
    loadSchedulerState: overrides.loadSchedulerState || (() => ({ activeTimezone: "" })),
    now: overrides.now || (() => new Date("2026-05-04T10:00:00.000Z")),
    normalizeText: (value) => (typeof value === "string" && value.trim() ? value.trim() : ""),
    normalizeJobTimezoneMode:
      overrides.normalizeJobTimezoneMode ||
      ((timezone, replyMode) => {
        const normalized = typeof timezone === "string" ? timezone.trim().toLowerCase() : "";
        if (normalized === "active" || normalized === "host") {
          return normalized;
        }
        return replyMode === "silent" ? "host" : "active";
      }),
    saveSchedulerJobs: (_path, items) => {
      saved[_path] = JSON.parse(JSON.stringify(items));
    },
    schedulerJobsPath: "/tmp/jobs.json",
    schedulerStatePath: "/tmp/state.json",
    timestamp: () => "2026-05-04T10:00:00.000Z",
    launchScheduledWorker: overrides.launchScheduledWorker,
  });
  return {
    runtime,
    getSaved: () => saved,
  };
}

test("scheduler runtime queues due jobs and advances schedule state", async () => {
  const dueJob = {
    id: "due",
    active: true,
    nextRunAt: "2026-05-04T09:00:00.000Z",
    sender: "+1555",
    workflowPrompt: "Run maintenance",
    replyMode: "silent",
  };
  const futureJob = {
    id: "future",
    active: true,
    nextRunAt: "2999-01-01T00:00:00.000Z",
    sender: "+1555",
    workflowPrompt: "Later",
  };
  const queued = [];
  let ensured = 0;
  const { runtime, getSaved } = createRuntime([dueJob, futureJob]);

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: (job) => queued.push(job),
    ensureBackgroundProcessing: () => {
      ensured += 1;
    },
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].sender, "+1555");
  assert.equal(queued[0].origin, "scheduled");
  assert.equal(queued[0].replyMode, "silent");
  assert.deepEqual(queued[0].context.images, [{ path: "/tmp/image.png" }]);
  assert.deepEqual(queued[0].context.files, [{ path: "/tmp/file.txt" }]);
  assert.equal(dueJob.lastRunAt, "2026-05-04T10:00:00.000Z");
  assert.equal(dueJob.nextRunAt, "2026-05-04T11:00:00.000Z");
  assert.equal(dueJob.updatedAt, "2026-05-04T10:00:00.000Z");
  assert.equal(ensured, 1);
  assert.equal(getSaved()["/tmp/jobs.json"].length, 2);
});

test("scheduler runtime launches typed domain workers directly with resolved Signal recipient", async () => {
  const dueJob = {
    id: "tax-check",
    active: true,
    nextRunAt: "2026-05-04T09:00:00.000Z",
    sender: "__default_sender__",
    workflowPrompt: "Check the tax email thread",
    replyMode: "default",
    agentProfile: "personal",
    model: "gpt-5.6-luna",
    delivery: "signal",
  };
  const launched = [];
  const queued = [];
  let ensured = 0;
  const { runtime, getSaved } = createRuntime([dueJob], [], {
    launchScheduledWorker: async (request) => launched.push(request),
  });

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: (job) => queued.push(job),
    ensureBackgroundProcessing: () => {
      ensured += 1;
    },
  });

  assert.deepEqual(queued, []);
  assert.equal(ensured, 0);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].agentProfile, "personal");
  assert.equal(launched[0].model, "gpt-5.6-luna");
  assert.equal(launched[0].trigger, "scheduled");
  assert.equal(launched[0].visibility, "final_only");
  assert.equal(launched[0].delivery, "signal");
  assert.equal(launched[0].recipient, "+1555");
  assert.equal(getSaved()["/tmp/jobs.json"][0].lastRunAt, "2026-05-04T10:00:00.000Z");
});

test("scheduler runtime executes on the inclusive active-timezone end date and then deactivates", async () => {
  const dueJob = {
    id: "edap-check",
    active: true,
    recurrence: { type: "daily" },
    time: { hour: 14, minute: 0, text: "2:00 PM" },
    timezone: "active",
    scheduledTimezone: "Europe/Lisbon",
    nextRunAt: "2026-08-10T13:00:00.000Z",
    endDate: "2026-08-10",
    sender: "+1555",
    workflowPrompt: "Check EDAP",
    agentProfile: "personal",
    delivery: "signal",
  };
  const launched = [];
  const { runtime, getSaved } = createRuntime([dueJob], [], {
    now: () => new Date("2026-08-10T13:00:05.000Z"),
    loadSchedulerState: () => ({ activeTimezone: "Europe/Lisbon" }),
    launchScheduledWorker: async (request) => launched.push(request),
  });

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: () => {},
    ensureBackgroundProcessing: () => {},
  });

  assert.equal(launched.length, 1);
  assert.equal(dueJob.lastRunAt, "2026-08-10T13:00:05.000Z");
  assert.equal(dueJob.active, false);
  assert.equal(dueJob.nextRunAt, "");
  assert.equal(getSaved()["/tmp/jobs.json"][0].active, false);
});

test("scheduler runtime never launches a missed job after its active-timezone end date", async () => {
  const expiredJob = {
    id: "expired-edap-check",
    active: true,
    recurrence: { type: "daily" },
    time: { hour: 14, minute: 0, text: "2:00 PM" },
    timezone: "active",
    scheduledTimezone: "Europe/Lisbon",
    nextRunAt: "2026-08-10T13:00:00.000Z",
    endDate: "2026-08-10",
    sender: "+1555",
    workflowPrompt: "Check EDAP",
    agentProfile: "personal",
    delivery: "signal",
  };
  const launched = [];
  const { runtime, getSaved } = createRuntime([expiredJob], [], {
    now: () => new Date("2026-08-11T13:00:00.000Z"),
    loadSchedulerState: () => ({ activeTimezone: "Europe/Lisbon" }),
    launchScheduledWorker: async (request) => launched.push(request),
  });

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: () => {},
    ensureBackgroundProcessing: () => {},
  });

  assert.deepEqual(launched, []);
  assert.equal(expiredJob.active, false);
  assert.equal(expiredJob.nextRunAt, "");
  assert.equal(getSaved()["/tmp/jobs.json"][0].active, false);
});

test("scheduler runtime does not advance a typed schedule when worker launch fails", async () => {
  const dueJob = {
    id: "broken-worker",
    active: true,
    nextRunAt: "2026-05-04T09:00:00.000Z",
    sender: "+1555",
    workflowPrompt: "Run task",
    agentProfile: "personal",
    delivery: "signal",
  };
  const { runtime, getSaved } = createRuntime([dueJob], [], {
    launchScheduledWorker: async () => {
      throw new Error("launch failed");
    },
  });

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: () => {},
    ensureBackgroundProcessing: () => {},
  });
  assert.equal(dueJob.lastRunAt, undefined);
  assert.equal(dueJob.nextRunAt, "2026-05-04T09:00:00.000Z");
  assert.deepEqual(getSaved(), {});
});

test("scheduler runtime removes jobs and formats refreshed listings", () => {
  const jobs = [
    { id: "keep", active: true },
    { id: "remove-me", active: true },
  ];
  const defaultJobs = [{ id: "default-dreaming", active: true }];
  const { runtime, getSaved } = createRuntime(jobs, defaultJobs);

  assert.equal(runtime.listSchedules(), "schedules:3:default,local,local");
  assert.deepEqual(runtime.removeScheduledJob(" remove-me "), {
    removed: true,
    protectedDefault: false,
  });
  assert.deepEqual(getSaved()["/tmp/jobs.json"].map((job) => job.id), ["keep"]);
  assert.deepEqual(getSaved()["/tmp/default-jobs.json"].map((job) => job.id), ["default-dreaming"]);
  assert.deepEqual(runtime.removeScheduledJob("missing"), {
    removed: false,
    protectedDefault: false,
  });
});

test("scheduler runtime protects default workflows from normal removal", () => {
  const jobs = [{ id: "local", active: true }];
  const defaultJobs = [{ id: "default-dreaming", active: true }];
  const { runtime, getSaved } = createRuntime(jobs, defaultJobs);

  assert.deepEqual(runtime.removeScheduledJob("default-dreaming"), {
    removed: false,
    protectedDefault: true,
  });
  assert.deepEqual(getSaved(), {});
});

test("scheduler runtime queues default jobs with configured sender and persists default state separately", async () => {
  const defaultDueJob = {
    id: "default-dreaming",
    active: true,
    nextRunAt: "2026-05-04T09:00:00.000Z",
    sender: "__default_sender__",
    workflowPrompt: "Run dreaming",
    replyMode: "silent",
  };
  const queued = [];
  const { runtime, getSaved } = createRuntime([], [defaultDueJob]);

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: (job) => queued.push(job),
    ensureBackgroundProcessing: () => {},
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].sender, "+1555");
  assert.equal(queued[0].replyMode, "silent");
  assert.equal(getSaved()["/tmp/default-jobs.json"][0].nextRunAt, "2026-05-04T11:00:00.000Z");
  assert.deepEqual(getSaved()["/tmp/jobs.json"], []);
});

test("scheduler runtime respects paused checks", async () => {
  const queued = [];
  const { runtime, getSaved } = createRuntime([
    {
      id: "due",
      active: true,
      nextRunAt: "2026-05-04T09:00:00.000Z",
      sender: "+1555",
      workflowPrompt: "Run maintenance",
    },
  ]);

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: (job) => queued.push(job),
    isPaused: () => true,
  });

  assert.deepEqual(queued, []);
  assert.deepEqual(getSaved(), {});
});

test("scheduler runtime reschedules active-timezone jobs when the timezone state changes", async () => {
  const activeJob = {
    id: "morning",
    active: true,
    recurrence: { type: "daily" },
    time: { hour: 9, minute: 0, text: "9:00 AM" },
    timezone: "active",
    scheduledTimezone: "Europe/Lisbon",
    nextRunAt: "2026-06-13T08:00:00.000Z",
    sender: "+1555",
    workflowPrompt: "Morning check",
    replyMode: "default",
  };
  const queued = [];
  const calls = [];
  const { runtime, getSaved } = createRuntime([activeJob], [], {
    now: () => new Date("2026-06-13T07:00:00.000Z"),
    loadSchedulerState: () => ({ activeTimezone: "America/Los_Angeles" }),
    computeFollowingRunAt: (_job, _now, options) => {
      calls.push(options);
      return "2026-06-13T16:00:00.000Z";
    },
  });

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: (job) => queued.push(job),
    ensureBackgroundProcessing: () => {},
  });

  assert.deepEqual(queued, []);
  assert.equal(activeJob.scheduledTimezone, "America/Los_Angeles");
  assert.equal(activeJob.nextRunAt, "2026-06-13T16:00:00.000Z");
  assert.deepEqual(calls[0], { timezone: "America/Los_Angeles" });
  assert.equal(getSaved()["/tmp/jobs.json"][0].scheduledTimezone, "America/Los_Angeles");
});

test("scheduler runtime still runs legacy due jobs without timezone metadata", async () => {
  const legacyDueJob = {
    id: "legacy-due",
    active: true,
    recurrence: { type: "daily" },
    time: { hour: 9, minute: 0, text: "9:00 AM" },
    nextRunAt: "2026-05-04T09:00:00.000Z",
    sender: "+1555",
    workflowPrompt: "Run now",
    replyMode: "default",
  };
  const queued = [];
  const { runtime } = createRuntime([legacyDueJob], [], {
    loadSchedulerState: () => ({ activeTimezone: "America/Los_Angeles" }),
  });

  await runtime.checkForDueScheduledJobs({
    enqueueBackgroundJob: (job) => queued.push(job),
    ensureBackgroundProcessing: () => {},
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].command.prompt.includes("Run now"), true);
});
