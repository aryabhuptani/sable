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
    loadSchedulerState = () => ({ activeTimezone: "" }),
    logger = console,
    normalizeText = defaultNormalizeText,
    normalizeJobTimezoneMode = defaultNormalizeJobTimezoneMode,
    schedulerJobsPath,
    schedulerStatePath = "",
    now = () => new Date(),
    saveSchedulerJobs,
    timestamp = () => new Date().toISOString(),
    launchScheduledWorker = null,
  } = options;

  let defaultSchedulerJobs = loadDefaultJobs();
  let localSchedulerJobs = loadSchedulerJobs(schedulerJobsPath);
  let schedulerState = loadState();
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

  function loadState() {
    return schedulerStatePath ? loadSchedulerState(schedulerStatePath) : { activeTimezone: "" };
  }

  function refreshJobs() {
    defaultSchedulerJobs = loadDefaultJobs();
    localSchedulerJobs = loadSchedulerJobs(schedulerJobsPath);
    schedulerState = loadState();
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

    const nowDate = now();
    let changed = false;
    let queuedLegacyJob = false;

    if (refreshTimezoneSensitiveJobs(nowDate)) {
      changed = true;
    }

    for (const scheduledJob of schedulerJobs) {
      if (!scheduledJob || scheduledJob.active === false) {
        continue;
      }

      const nextRunMs = Date.parse(scheduledJob.nextRunAt);
      if (Number.isNaN(nextRunMs) || nextRunMs > nowDate.getTime()) {
        continue;
      }

      if (scheduledJob.agentProfile) {
        if (typeof launchScheduledWorker !== "function") {
          logger.error?.(
            `[${timestamp()}] Refusing typed scheduled workflow ${scheduledJob.id || "(unknown)"}: no worker launcher is configured.`
          );
          continue;
        }
        try {
          await launchScheduledWorker(buildScheduledWorkerRequest(scheduledJob));
        } catch (error) {
          logger.error?.(
            `[${timestamp()}] Failed launching typed scheduled workflow ${scheduledJob.id || "(unknown)"}: ${error.message}`
          );
          continue;
        }
      } else {
        enqueueBackgroundJob(queueScheduledWorkflowRun(scheduledJob));
        queuedLegacyJob = true;
      }
      scheduledJob.lastRunAt = nowDate.toISOString();
      scheduledJob.nextRunAt = computeFollowingRunAt(
        scheduledJob,
        nowDate,
        getComputeOptionsForJob(scheduledJob)
      );
      scheduledJob.scheduledTimezone = getScheduledTimezoneForJob(scheduledJob);
      scheduledJob.updatedAt = timestamp();
      changed = true;
    }

    if (changed) {
      persistJobs();
      if (queuedLegacyJob) {
        ensureBackgroundProcessing();
      }
    }
  }

  function refreshTimezoneSensitiveJobs(now) {
    let timezoneChanged = false;

    for (const scheduledJob of schedulerJobs) {
      if (!scheduledJob || scheduledJob.active === false || !scheduledJob.time) {
        continue;
      }
      if (scheduledJob.recurrence?.type === "interval") {
        continue;
      }

      const scheduledTimezone = getScheduledTimezoneForJob(scheduledJob);
      if (!scheduledTimezone || scheduledJob.scheduledTimezone === scheduledTimezone) {
        continue;
      }

      const nextRunMs = Date.parse(scheduledJob.nextRunAt);
      const isDue = !Number.isNaN(nextRunMs) && nextRunMs <= now.getTime();
      if (isDue && !scheduledJob.scheduledTimezone) {
        continue;
      }

      scheduledJob.timezone = getTimezoneModeForJob(scheduledJob);
      scheduledJob.scheduledTimezone = scheduledTimezone;
      scheduledJob.nextRunAt = computeFollowingRunAt(
        scheduledJob,
        now,
        getComputeOptionsForJob(scheduledJob)
      );
      scheduledJob.updatedAt = timestamp();
      timezoneChanged = true;
    }

    return timezoneChanged;
  }

  function getComputeOptionsForJob(job) {
    const timezone = getScheduledTimezoneForJob(job);
    return timezone ? { timezone } : {};
  }

  function getTimezoneModeForJob(job) {
    return normalizeJobTimezoneMode(job?.timezone, job?.replyMode);
  }

  function getScheduledTimezoneForJob(job) {
    const mode = getTimezoneModeForJob(job);
    if (mode === "active") {
      return normalizeText(schedulerState?.activeTimezone);
    }
    if (mode === "host") {
      return "";
    }
    return "";
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

  function buildScheduledWorkerRequest(scheduledJob) {
    const sender =
      scheduledJob.sender === "__default_sender__"
        ? defaultScheduledSender
        : normalizeText(scheduledJob.sender);
    const delivery = normalizeText(scheduledJob.delivery).toLowerCase();
    const recipient = normalizeText(scheduledJob.recipient) || sender;
    if (delivery === "signal" && !recipient) {
      throw new Error(`Scheduled workflow ${scheduledJob.id || "(unknown)"} has Signal delivery but no recipient.`);
    }
    return {
      scheduleId: scheduledJob.id,
      name: `Scheduled: ${scheduledJob.id || "workflow"}`,
      prompt: [
        scheduledJob.workflowPrompt,
        "",
        "This is a scheduled recurring workflow triggered automatically by Sable.",
      ].join("\n"),
      agentProfile: normalizeText(scheduledJob.agentProfile),
      model: normalizeText(scheduledJob.model),
      delivery,
      recipient,
      sender,
      trigger: "scheduled",
      visibility: scheduledJob.replyMode === "silent" ? "silent" : "final_only",
    };
  }

  return {
    checkForDueScheduledJobs,
    getJobs,
    listSchedules,
    queueScheduledWorkflowRun,
    buildScheduledWorkerRequest,
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

function defaultNormalizeJobTimezoneMode(timezone, replyMode) {
  const normalized = defaultNormalizeText(timezone).toLowerCase();
  if (normalized === "active" || normalized === "host") {
    return normalized;
  }
  return replyMode === "silent" ? "host" : "active";
}

module.exports = {
  createBridgeSchedulerRuntime,
};
