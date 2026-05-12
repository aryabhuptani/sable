function createBridgeSchedulerRuntime(options = {}) {
  const {
    buildAttachmentContext,
    computeFollowingRunAt,
    defaultScheduledSender = "",
    defaultSchedulerJobsPath = "",
    discoverFileAttachments,
    discoverImageAttachments,
    formatScheduleList,
    loadSchedulerJobs,
    logger = console,
    normalizeText = defaultNormalizeText,
    schedulerJobsPath,
    saveSchedulerJobs,
    timestamp = () => new Date().toISOString(),
  } = options;

  let defaultSchedulerJobs = loadDefaultJobs();
  let localSchedulerJobs = loadSchedulerJobs(schedulerJobsPath);
  let schedulerJobs = mergeJobs(defaultSchedulerJobs, localSchedulerJobs);

  function getJobs() {
    return schedulerJobs;
  }

  function loadDefaultJobs() {
    return defaultSchedulerJobsPath ? loadSchedulerJobs(defaultSchedulerJobsPath) : [];
  }

  function persistJobs() {
    if (defaultSchedulerJobsPath) {
      saveSchedulerJobs(defaultSchedulerJobsPath, defaultSchedulerJobs);
    }
    saveSchedulerJobs(schedulerJobsPath, localSchedulerJobs);
  }

  function refreshJobs() {
    defaultSchedulerJobs = loadDefaultJobs();
    localSchedulerJobs = loadSchedulerJobs(schedulerJobsPath);
    schedulerJobs = mergeJobs(defaultSchedulerJobs, localSchedulerJobs);
    return schedulerJobs;
  }

  function removeScheduledJob(scheduleId) {
    refreshJobs();
    const normalizedId = normalizeText(scheduleId);
    if (!normalizedId) {
      return { removed: false, protectedDefault: false };
    }

    const protectedDefault = defaultSchedulerJobs.some((job) => job.id === normalizedId);
    const localLength = localSchedulerJobs.length;
    localSchedulerJobs = localSchedulerJobs.filter((job) => job.id !== normalizedId);
    if (localSchedulerJobs.length === localLength) {
      return { removed: false, protectedDefault };
    }

    persistJobs();
    schedulerJobs = mergeJobs(defaultSchedulerJobs, localSchedulerJobs);
    return { removed: true, protectedDefault: false };
  }

  function listSchedules() {
    refreshJobs();
    return formatScheduleList(schedulerJobs);
  }

  async function checkForDueScheduledJobs(options = {}) {
    const {
      enqueueBackgroundJob,
      ensureBackgroundProcessing,
      isPaused = () => false,
    } = options;
    if (isPaused()) {
      return;
    }

    refreshJobs();

    if (!Array.isArray(schedulerJobs) || schedulerJobs.length === 0) {
      return;
    }

    const now = new Date();
    let changed = false;

    for (const scheduledJob of schedulerJobs) {
      if (!scheduledJob || scheduledJob.active === false) {
        continue;
      }

      const nextRunMs = Date.parse(scheduledJob.nextRunAt);
      if (Number.isNaN(nextRunMs) || nextRunMs > now.getTime()) {
        continue;
      }

      enqueueBackgroundJob(queueScheduledWorkflowRun(scheduledJob));
      scheduledJob.lastRunAt = now.toISOString();
      scheduledJob.nextRunAt = computeFollowingRunAt(scheduledJob, now);
      scheduledJob.updatedAt = timestamp();
      changed = true;
    }

    if (changed) {
      persistJobs();
      ensureBackgroundProcessing();
    }
  }

  function queueScheduledWorkflowRun(scheduledJob) {
    const sender =
      scheduledJob.sender === "__default_sender__"
        ? defaultScheduledSender
        : scheduledJob.sender;
    const executionPrompt = [
      scheduledJob.workflowPrompt,
      "",
      "This is a scheduled recurring workflow triggered automatically by Sable.",
    ].join("\n");
    const localImageAttachments = discoverImageAttachments(scheduledJob.workflowPrompt);
    const localFileAttachments = discoverFileAttachments(scheduledJob.workflowPrompt);

    return {
      sender,
      command: { type: "prompt", prompt: executionPrompt },
      context: buildAttachmentContext(
        {},
        scheduledJob.sender,
        localImageAttachments,
        [],
        localFileAttachments
      ),
      queuedVoicePreparation: null,
      allowSilentNoReply: true,
      replyMode: scheduledJob.replyMode === "silent" ? "silent" : "default",
      origin: "scheduled",
    };
  }

  return {
    checkForDueScheduledJobs,
    getJobs,
    listSchedules,
    queueScheduledWorkflowRun,
    refreshJobs,
    removeScheduledJob,
  };
}

function mergeJobs(defaultJobs, localJobs) {
  return [
    ...tagJobs(defaultJobs, "default"),
    ...tagJobs(localJobs, "local"),
  ];
}

function tagJobs(jobs, scheduleKind) {
  return (Array.isArray(jobs) ? jobs : []).map((job) => {
    if (job && typeof job === "object" && !job.scheduleKind) {
      job.scheduleKind = scheduleKind;
    }
    return job;
  });
}

function defaultNormalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

module.exports = {
  createBridgeSchedulerRuntime,
};
