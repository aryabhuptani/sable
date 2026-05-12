#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { createInstanceConfig } = require("../instance/instance-config");

const DEFAULT_TIMEOUT_MS = 60_000;

function defaultBrowserPaths(env = process.env) {
  const instance = createInstanceConfig({ env });
  const root = path.resolve(env.SABLE_BROWSER_STATE_DIR || path.join(instance.homeDir, ".local", "state", "sable-browser"));
  return {
    artifactsDir: path.resolve(env.SABLE_BROWSER_ARTIFACTS_DIR || path.join(root, "artifacts")),
    downloadsDir: path.resolve(env.SABLE_BROWSER_DOWNLOADS_DIR || path.join(root, "downloads")),
    profileDir: path.resolve(env.SABLE_BROWSER_PROFILE_DIR || path.join(root, "profile")),
    root,
    taskStatePath: path.resolve(env.SABLE_BROWSER_TASK_STATE_PATH || path.join(root, "task-state.json")),
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "status", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }
    args[token.slice(2)] = rest[index + 1] || "";
    index += 1;
  }
  return args;
}

function ensureBrowserDirs(paths = defaultBrowserPaths()) {
  for (const dir of [paths.root, paths.artifactsDir, paths.downloadsDir, paths.profileDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

function playwrightStatus() {
  try {
    require.resolve("playwright");
    return { installed: true, message: "playwright is installed" };
  } catch {
    return {
      installed: false,
      message: "playwright is not installed; install it with `npm install --no-save playwright` and `npx playwright install chromium` for live browser runs",
    };
  }
}

function commandStatus(args = {}, env = process.env) {
  const paths = defaultBrowserPaths(env);
  const status = {
    ok: true,
    headlessDefault: normalizeBoolean(args.headless, true),
    paths,
    playwright: playwrightStatus(),
    activeTask: readTaskState(paths.taskStatePath),
  };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  return 0;
}

function commandInit(args = {}, env = process.env) {
  const paths = ensureBrowserDirs(defaultBrowserPaths(env));
  process.stdout.write(`Initialized Sable browser state at ${paths.root}\n`);
  return 0;
}

function commandCalendarLinkPlan(args = {}, env = process.env) {
  const paths = ensureBrowserDirs(defaultBrowserPaths(env));
  const now = new Date().toISOString();
  const plan = buildCalendarLinkPlan({
    bookingLink: args.link || env.SABLE_PRIMARY_BOOKING_LINK || "https://calendar.app.google/kmTYYPhnkoetGWTy8",
    endDate: args.end || "",
    startDate: args.start || "",
    timezone: args.timezone || "America/Los_Angeles",
  });
  const task = {
    id: `calendar-link-${compactTimestamp(now)}`,
    kind: "calendar-link-management",
    createdAt: now,
    status: "needs_browser_run",
    approvalRequired: true,
    plan,
  };
  writeTaskState(paths.taskStatePath, task);
  const outputPath = args.output ? path.resolve(args.output) : path.join(paths.artifactsDir, `${task.id}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  process.stdout.write(`${formatCalendarLinkPlan(task)}\n\nWrote task plan: ${outputPath}\n`);
  return 0;
}

async function commandScreenshot(args = {}, env = process.env) {
  const url = normalizeText(args.url);
  if (!url) {
    throw new Error("Pass --url for screenshot.");
  }
  const paths = ensureBrowserDirs(defaultBrowserPaths(env));
  const outputPath = path.resolve(args.output || path.join(paths.artifactsDir, `screenshot-${Date.now()}.png`));
  await withPlaywrightPage({
    env,
    headless: normalizeBoolean(args.headless, true),
    paths,
    timeoutMs: normalizeInteger(args.timeoutMs || args["timeout-ms"], DEFAULT_TIMEOUT_MS),
  }, async (page) => {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.screenshot({ fullPage: true, path: outputPath });
  });
  process.stdout.write(`${outputPath}\n`);
  return 0;
}

async function commandOpen(args = {}, env = process.env) {
  const url = normalizeText(args.url);
  if (!url) {
    throw new Error("Pass --url for open.");
  }
  const paths = ensureBrowserDirs(defaultBrowserPaths(env));
  await withPlaywrightPage({
    env,
    headless: normalizeBoolean(args.headless, true),
    keepOpenMs: normalizeInteger(args["keep-open-ms"], 0),
    paths,
    timeoutMs: normalizeInteger(args.timeoutMs || args["timeout-ms"], DEFAULT_TIMEOUT_MS),
  }, async (page) => {
    await page.goto(url, { waitUntil: "networkidle" });
    const title = await page.title();
    process.stdout.write(`Opened ${url}\nTitle: ${title}\n`);
  });
  return 0;
}

async function withPlaywrightPage({ headless = true, keepOpenMs = 0, paths, timeoutMs = DEFAULT_TIMEOUT_MS } = {}, callback) {
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    throw new Error(playwrightStatus().message);
  }
  const context = await playwright.chromium.launchPersistentContext(paths.profileDir, {
    acceptDownloads: true,
    downloadsPath: paths.downloadsDir,
    headless,
    timeout: timeoutMs,
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await callback(page, context);
    if (keepOpenMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, keepOpenMs));
    }
  } finally {
    await context.close();
  }
}

function buildCalendarLinkPlan({ bookingLink, endDate, startDate, timezone }) {
  return {
    bookingLink,
    timezone,
    dateRange: {
      start: startDate,
      end: endDate,
    },
    goal: "Update Google Calendar appointment-schedule availability to match the target timezone, or verify calendar busy guard blocks are sufficient.",
    browserSteps: [
      "Open Google Calendar in the persistent Sable browser profile.",
      "Navigate to appointment schedules / booking page settings.",
      `Find the schedule backing ${bookingLink}.`,
      `Set or verify timezone as ${timezone}.`,
      "Review availability windows for the requested date range.",
      "Capture a screenshot before saving.",
      "Pause for Arya approval before clicking Save or Publish.",
      "After saving, reopen the public booking link and verify displayed availability.",
    ],
    approvalGate: "Do not save appointment-schedule changes until Arya approves the screenshot/diff.",
  };
}

function formatCalendarLinkPlan(task) {
  const plan = task.plan;
  return [
    `Browser task: ${task.id}`,
    `Booking link: ${plan.bookingLink}`,
    `Timezone: ${plan.timezone}`,
    `Date range: ${plan.dateRange.start || "(unspecified)"} to ${plan.dateRange.end || "(unspecified)"}`,
    "Status: ready for browser run; approval required before saving.",
    "",
    "Steps:",
    ...plan.browserSteps.map((step, index) => `${index + 1}. ${step}`),
  ].join("\n");
}

function readTaskState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    return { error: error.message };
  }
}

function writeTaskState(filePath, task) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeBoolean(value, fallback) {
  const text = normalizeText(value).toLowerCase();
  if (!text) {
    return fallback;
  }
  if (["1", "true", "yes", "y"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(text)) {
    return false;
  }
  return fallback;
}

function compactTimestamp(isoString) {
  return isoString.replace(/[-:.TZ]/g, "").slice(0, 14);
}

async function asyncMain(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.command === "status") {
    return commandStatus(args, env);
  }
  if (args.command === "init") {
    return commandInit(args, env);
  }
  if (args.command === "calendar-link-plan") {
    return commandCalendarLinkPlan(args, env);
  }
  if (args.command === "screenshot") {
    return commandScreenshot(args, env);
  }
  if (args.command === "open") {
    return commandOpen(args, env);
  }
  printUsage();
  return 1;
}

function printUsage() {
  process.stderr.write([
    "Usage:",
    "  browser_cli.js status",
    "  browser_cli.js init",
    "  browser_cli.js calendar-link-plan --link URL --timezone America/Los_Angeles [--start YYYY-MM-DD] [--end YYYY-MM-DD]",
    "  browser_cli.js screenshot --url URL [--output path] [--headless true]",
    "  browser_cli.js open --url URL [--headless true]",
  ].join("\n") + "\n");
}

if (require.main === module) {
  asyncMain().then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  asyncMain,
  buildCalendarLinkPlan,
  commandCalendarLinkPlan,
  commandInit,
  commandStatus,
  defaultBrowserPaths,
  formatCalendarLinkPlan,
  parseArgs,
  playwrightStatus,
};
