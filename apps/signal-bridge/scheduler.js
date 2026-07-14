"use strict";

const fs = require("fs");
const path = require("path");

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function loadSchedulerJobs(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.jobs) ? parsed.jobs.filter(Boolean) : [];
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
    return [];
  }
}

function loadSchedulerState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeSchedulerState(parsed);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
    return createDefaultSchedulerState();
  }
}

function saveSchedulerState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalizeSchedulerState(state), null, 2)}\n`, "utf8");
}

function createDefaultSchedulerState() {
  return {
    activeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    updatedAt: "",
    source: "host-default",
  };
}

function normalizeSchedulerState(state) {
  const fallback = createDefaultSchedulerState();
  const activeTimezone = normalizeText(state?.activeTimezone);
  return {
    activeTimezone: isValidTimeZone(activeTimezone) ? activeTimezone : fallback.activeTimezone,
    updatedAt: normalizeText(state?.updatedAt),
    source: normalizeText(state?.source) || fallback.source,
  };
}

function saveSchedulerJobs(filePath, jobs) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ jobs }, null, 2)}\n`, "utf8");
}

function createDefaultScheduledWorkflowJobs({ now = new Date() } = {}) {
  const dreamingTime = parseTimeText("3:30AM");
  const memoryEvalTime = parseTimeText("4:15AM");
  const recurrence = { type: "daily" };
  const createdAt = now.toISOString();
  return [
    {
      id: "default-dreaming",
      sender: "__default_sender__",
      createdAt,
      updatedAt: createdAt,
      active: true,
      recurrence,
      time: dreamingTime,
      replyMode: "silent",
      workflowPrompt:
        "Run Sable's conservative dreaming workflow: review AGENTS.md, TODO.md, skills, and task files for duplicates, drift, and safe consolidation opportunities. Keep the pass silent unless there is a final user-facing output or a real blocker.",
      timezone: "host",
      nextRunAt: computeNextRunAt(recurrence, dreamingTime, now),
      lastRunAt: "",
      scheduleKind: "default",
    },
    {
      id: "default-memory-eval",
      sender: "__default_sender__",
      createdAt,
      updatedAt: createdAt,
      active: true,
      recurrence,
      time: memoryEvalTime,
      replyMode: "silent",
      workflowPrompt:
        "Run Sable's daily domain-memory eval loop. First run `npm run autoresearch:archive-completed` from the Sable repo root if the repo and research paths are available. Read the configured domains root README, the domain architecture docs, and any current eval notes if present. Test 3-5 capability probes across source-of-truth recovery, procedure activation, current-state recovery, task continuity, research synthesis reuse, staleness detection, contradiction handling, and generalization after fixes. Score retrieval and application, append concise metrics under the relevant orchestrator project if available, update latest metrics, then make at most one low-risk improvement that improves a reusable protocol/template/index/skill convention before making a one-off note fix. Keep the run silent unless human judgment is required.",
      timezone: "host",
      nextRunAt: computeNextRunAt(recurrence, memoryEvalTime, now),
      lastRunAt: "",
      scheduleKind: "default",
    },
  ];
}

function createScheduledWorkflowJob({
  sender,
  recurrenceType,
  dayOfWeek = -1,
  intervalMinutes = 0,
  timeText,
  workflowPrompt,
  replyMode = "default",
  timezone = "",
  now = new Date(),
}) {
  const recurrence = buildRecurrence(recurrenceType, dayOfWeek, intervalMinutes);
  const time = recurrence?.type === "interval" ? null : parseTimeText(timeText);
  const cleanedPrompt = normalizeText(workflowPrompt);
  const normalizedReplyMode = normalizeReplyMode(replyMode);

  if (
    !sender ||
    !recurrence ||
    (!time && recurrence.type !== "interval") ||
    !cleanedPrompt ||
    !normalizedReplyMode
  ) {
    throw new Error("Missing required scheduler job fields.");
  }

  const createdAt = now.toISOString();
  return {
    id: `sched-${Date.now().toString(36)}`,
    sender,
    createdAt,
    updatedAt: createdAt,
    active: true,
    recurrence,
    time,
    replyMode: normalizedReplyMode,
    timezone: normalizeJobTimezoneMode(timezone, replyMode),
    workflowPrompt: cleanedPrompt,
    nextRunAt: computeNextRunAt(recurrence, time, now),
    lastRunAt: "",
    scheduleKind: "local",
  };
}

function buildRecurrence(type, dayOfWeek, intervalMinutes) {
  const normalizedType = normalizeText(type).toLowerCase();
  if (normalizedType === "daily") {
    return { type: "daily" };
  }

  if (normalizedType === "weekday") {
    return { type: "weekday" };
  }

  if (normalizedType === "weekly" && Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6) {
    return { type: "weekly", dayOfWeek };
  }

  if (
    normalizedType === "interval" &&
    Number.isInteger(intervalMinutes) &&
    intervalMinutes >= 1 &&
    intervalMinutes <= 24 * 60
  ) {
    return { type: "interval", intervalMinutes };
  }

  return null;
}

function parseTimeText(text) {
  const normalized = normalizeText(text).toLowerCase().replace(/\./g, "");
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) {
    return null;
  }

  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] || "0", 10);
  const meridiem = match[3] || "";

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    if (meridiem === "pm" && hour !== 12) {
      hour += 12;
    }
    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }
  } else if (hour > 23) {
    return null;
  }

  return {
    hour,
    minute,
    text: formatTime(hour, minute),
  };
}

function computeNextRunAt(recurrence, time, now = new Date(), options = {}) {
  if (recurrence.type === "interval") {
    return computeNextIntervalRunAt(recurrence.intervalMinutes, now);
  }

  const timezone = normalizeText(options.timezone);
  if (timezone && isValidTimeZone(timezone)) {
    return computeNextRunAtInTimeZone(recurrence, time, now, timezone);
  }

  const base = new Date(now);
  base.setSeconds(0, 0);

  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    candidate.setHours(time.hour, time.minute, 0, 0);

    if (candidate <= now) {
      continue;
    }

    if (recurrence.type === "daily") {
      return candidate.toISOString();
    }

    if (recurrence.type === "weekday") {
      const day = candidate.getDay();
      if (day >= 1 && day <= 5) {
        return candidate.toISOString();
      }
      continue;
    }

    if (recurrence.type === "weekly" && candidate.getDay() === recurrence.dayOfWeek) {
      return candidate.toISOString();
    }
  }

  return "";
}

function computeFollowingRunAt(job, now = new Date(), options = {}) {
  return computeNextRunAt(job.recurrence, job.time, now, options);
}

function computeNextRunAtInTimeZone(recurrence, time, now, timezone) {
  const base = getZonedParts(now, timezone);

  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset, 12, 0, 0));
    const candidateParts = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: time.hour,
      minute: time.minute,
      second: 0,
    };
    const candidate = zonedTimeToUtc(candidateParts, timezone);

    if (candidate <= now) {
      continue;
    }

    if (recurrence.type === "daily") {
      return candidate.toISOString();
    }

    if (recurrence.type === "weekday") {
      const day = date.getUTCDay();
      if (day >= 1 && day <= 5) {
        return candidate.toISOString();
      }
      continue;
    }

    if (recurrence.type === "weekly" && date.getUTCDay() === recurrence.dayOfWeek) {
      return candidate.toISOString();
    }
  }

  return "";
}

function zonedTimeToUtc(parts, timezone) {
  const desiredUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0
  );
  let candidate = new Date(desiredUtc);

  for (let index = 0; index < 3; index += 1) {
    const actual = getZonedParts(candidate, timezone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second || 0
    );
    const delta = desiredUtc - actualUtc;
    if (delta === 0) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + delta);
  }

  return candidate;
}

function getZonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number.parseInt(part.value, 10)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function isValidTimeZone(timezone) {
  if (!timezone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeJobTimezoneMode(timezone, replyMode = "") {
  const normalized = normalizeText(timezone).toLowerCase();
  if (normalized === "host" || normalized === "active") {
    return normalized;
  }
  return replyMode === "silent" ? "host" : "active";
}

function formatScheduleConfirmation(job) {
  return [
    `Scheduled recurring workflow ${job.id}.`,
    formatScheduleHeadline(job),
    `Next run: ${formatTimestamp(job.nextRunAt)}`,
    `Workflow: ${job.workflowPrompt}`,
  ].join("\n");
}

function formatScheduleList(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return "No recurring Sable workflows are scheduled.";
  }

  const activeJobs = jobs.filter((job) => job.active !== false);
  if (activeJobs.length === 0) {
    return "No active recurring Sable workflows are scheduled.";
  }

  return activeJobs
    .filter((job) => job.active !== false)
    .map((job) =>
      [
        `${job.id} [${formatScheduleKind(job)}]: ${formatScheduleHeadline(job)}`,
        `next: ${formatTimestamp(job.nextRunAt)}`,
        `reply mode: ${formatReplyMode(job.replyMode)}`,
        `workflow: ${job.workflowPrompt}`,
      ].join("\n")
    )
    .join("\n\n");
}

function dayNameToIndex(dayName) {
  return DAY_NAMES.indexOf(normalizeText(dayName).toLowerCase());
}

function formatRecurrence(recurrence) {
  if (!recurrence || typeof recurrence !== "object") {
    return "unknown recurrence";
  }

  if (recurrence.type === "daily") {
    return "every day";
  }

  if (recurrence.type === "weekday") {
    return "every weekday";
  }

  if (recurrence.type === "weekly") {
    const dayName = DAY_NAMES[recurrence.dayOfWeek] || "unknown day";
    return `every ${dayName}`;
  }

  if (recurrence.type === "interval") {
    return `every ${recurrence.intervalMinutes} minute${recurrence.intervalMinutes === 1 ? "" : "s"}`;
  }

  return "unknown recurrence";
}

function formatScheduleHeadline(job) {
  if (job?.recurrence?.type === "interval") {
    return withReplyModeSuffix(formatRecurrence(job.recurrence), job.replyMode);
  }
  return withReplyModeSuffix(
    `${formatRecurrence(job.recurrence)} at ${job.time?.text || "unknown time"}`,
    job.replyMode
  );
}

function computeNextIntervalRunAt(intervalMinutes, now = new Date()) {
  const base = new Date(now);
  base.setSeconds(0, 0);
  const remainder = base.getMinutes() % intervalMinutes;
  const deltaMinutes = remainder === 0 ? intervalMinutes : intervalMinutes - remainder;
  base.setMinutes(base.getMinutes() + deltaMinutes);
  return base.toISOString();
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString("en-GB", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(hour, minute) {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function normalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

function normalizeReplyMode(value) {
  const normalized = normalizeText(value).toLowerCase() || "default";
  return normalized === "default" || normalized === "silent" ? normalized : "";
}

function formatReplyMode(value) {
  return normalizeReplyMode(value) || "default";
}

function withReplyModeSuffix(headline, replyMode) {
  return formatReplyMode(replyMode) === "silent" ? `${headline} [silent]` : headline;
}

function formatScheduleKind(job) {
  return job?.scheduleKind === "default" ? "default" : "local";
}

module.exports = {
  createDefaultScheduledWorkflowJobs,
  createScheduledWorkflowJob,
  computeFollowingRunAt,
  computeNextRunAt,
  dayNameToIndex,
  formatScheduleConfirmation,
  formatScheduleKind,
  formatScheduleList,
  isValidTimeZone,
  loadSchedulerJobs,
  loadSchedulerState,
  normalizeJobTimezoneMode,
  parseTimeText,
  saveSchedulerJobs,
  saveSchedulerState,
};
