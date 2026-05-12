#!/usr/bin/env node
"use strict";

const {
  createScheduledWorkflowJob,
  computeFollowingRunAt,
  dayNameToIndex,
  formatScheduleConfirmation,
  formatScheduleList,
  loadSchedulerJobs,
  loadSchedulerState,
  saveSchedulerJobs,
  saveSchedulerState,
  isValidTimeZone,
} = require("./scheduler");
const { createInstanceConfig } = require("../../tools/instance/instance-config");

const DEFAULT_SCHEDULER_JOBS_PATH =
  process.env.SABLE_SCHEDULER_JOBS_PATH ||
  createInstanceConfig().schedulerJobsPath;
const DEFAULT_DEFAULT_SCHEDULER_JOBS_PATH =
  process.env.SABLE_DEFAULT_SCHEDULER_JOBS_PATH ||
  createInstanceConfig().defaultSchedulerJobsPath;
const DEFAULT_SCHEDULER_STATE_PATH =
  process.env.SABLE_SCHEDULER_STATE_PATH ||
  createInstanceConfig().schedulerStatePath;
const DEFAULT_SENDER =
  String(process.env.ALLOWED_NUMBERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0] || "";

function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const filePath = args.file || DEFAULT_SCHEDULER_JOBS_PATH;
  const defaultFilePath = args["default-file"] || DEFAULT_DEFAULT_SCHEDULER_JOBS_PATH;
  const statePath = args["state-file"] || DEFAULT_SCHEDULER_STATE_PATH;
  const jobs = loadSchedulerJobs(filePath);

  if (command === "add") {
    const recurrenceType = normalizeText(args.recurrence).toLowerCase();
    const sender = normalizeText(args.sender) || DEFAULT_SENDER;
    const dayOfWeek =
      recurrenceType === "weekly" ? dayNameToIndex(args.day || "") : -1;
    const intervalMinutes =
      recurrenceType === "interval" ? Number.parseInt(args.minutes || "", 10) : 0;
    const replyMode = normalizeText(args.silent).toLowerCase() === "true" ? "silent" : "default";

    const job = createScheduledWorkflowJob({
      sender,
      recurrenceType,
      dayOfWeek,
      intervalMinutes,
      timeText: args.time,
      workflowPrompt: args.prompt,
      replyMode,
    });
    if (job.time && job.timezone === "active") {
      const state = loadSchedulerState(statePath);
      job.scheduledTimezone = state.activeTimezone;
      job.nextRunAt = computeFollowingRunAt(job, new Date(), {
        timezone: state.activeTimezone,
      });
    }

    jobs.push(job);
    saveSchedulerJobs(filePath, jobs);
    console.log(formatScheduleConfirmation(job));
    return;
  }

  if (command === "list") {
    const state = loadSchedulerState(statePath);
    console.log([
      `Active timezone: ${state.activeTimezone}`,
      formatScheduleList([...loadSchedulerJobs(defaultFilePath), ...jobs]),
    ].join("\n\n"));
    return;
  }

  if (command === "timezone") {
    const timezone = normalizeText(args.set);
    if (!timezone) {
      const state = loadSchedulerState(statePath);
      console.log(`Active timezone: ${state.activeTimezone}`);
      return;
    }
    if (!isValidTimeZone(timezone)) {
      console.error(`Invalid IANA timezone: ${timezone}`);
      process.exit(1);
    }
    saveSchedulerState(statePath, {
      activeTimezone: timezone,
      updatedAt: new Date().toISOString(),
      source: normalizeText(args.source) || "scheduler-cli",
    });
    console.log(`Active timezone set to ${timezone}.`);
    return;
  }

  if (command === "remove") {
    const id = normalizeText(args.id);
    const includeDefaults = normalizeText(args["include-defaults"]).toLowerCase() === "true";
    const defaultJobs = loadSchedulerJobs(defaultFilePath);
    const matchedDefault = defaultJobs.some((job) => job.id === id);
    const nextDefaultJobs = includeDefaults
      ? defaultJobs.filter((job) => job.id !== id)
      : defaultJobs;
    const nextJobs = jobs.filter((job) => job.id !== id);
    if (nextJobs.length === jobs.length && nextDefaultJobs.length === defaultJobs.length) {
      if (matchedDefault && !includeDefaults) {
        console.error(
          `Refusing to remove default workflow ${id}. Pass --include-defaults true if you intentionally want to edit default scheduler state.`
        );
        process.exit(1);
      }
      console.error(`No scheduled workflow matched ${id || "that id"}.`);
      process.exit(1);
    }
    if (nextDefaultJobs.length !== defaultJobs.length) {
      saveSchedulerJobs(defaultFilePath, nextDefaultJobs);
    }
    saveSchedulerJobs(filePath, nextJobs);
    console.log(`Removed scheduled workflow ${id}.`);
    return;
  }

  printUsage();
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    parsed[token.slice(2)] = argv[index + 1] || "";
    index += 1;
  }

  return parsed;
}

function printUsage() {
  console.error(
    [
      "Usage:",
      "  scheduler_cli.js add --recurrence daily|weekday|weekly --time 8:00AM --prompt \"...\" [--day monday] [--sender +1555] [--silent true] [--file path]",
      "  scheduler_cli.js add --recurrence interval --minutes 5 --prompt \"...\" [--sender +1555] [--silent true] [--file path]",
      "  scheduler_cli.js list [--file path] [--default-file path]",
      "  scheduler_cli.js timezone [--set Europe/Lisbon] [--state-file path] [--source note]",
      "  scheduler_cli.js remove --id sched-abc [--file path] [--default-file path] [--include-defaults true]",
    ].join("\n")
  );
}

function normalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

main();
