function createBridgeSchedulerRuntime(options = {}) {
  const {
    buildAttachmentContext,
    computeFollowingRunAt,
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

  let schedulerJobs = loadSchedulerJobs(schedulerJobsPath);

  function getJobs() {
    return schedulerJobs;
  }

  function persistJobs() {
    saveSchedulerJobs(schedulerJobsPath, schedulerJobs);
  }

  function refreshJobs() {
    schedulerJobs = loadSchedulerJobs(schedulerJobsPath);
    return schedulerJobs;
  }

  function removeScheduledJob(scheduleId) {
    refreshJobs();
    const normalizedId = normalizeText(scheduleId);
    if (!normalizedId) {
      return false;
    }

    const originalLength = schedulerJobs.length;
    schedulerJobs = schedulerJobs.filter((job) => job.id !== normalizedId);
    if (schedulerJobs.length === originalLength) {
      return false;
    }

    persistJobs();
    return true;
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
    const executionPrompt = [
      scheduledJob.workflowPrompt,
      "",
      "This is a scheduled recurring workflow triggered automatically by Sable.",
    ].join("\n");
    const localImageAttachments = discoverImageAttachments(scheduledJob.workflowPrompt);
    const localFileAttachments = discoverFileAttachments(scheduledJob.workflowPrompt);

    return {
      sender: scheduledJob.sender,
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

function defaultNormalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

module.exports = {
  createBridgeSchedulerRuntime,
};
